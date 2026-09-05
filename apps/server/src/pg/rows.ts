import type { PoolClient } from "pg";

import type {
  Relation,
  RowCursor,
  RowFilter,
  RowsRequest,
  RowsResponse,
  SortDirection,
} from "@dbee/shared";

import { resolveColumns } from "./columns";

/**
 * Leitura paginada de uma tabela (DBee.md §5).
 *
 * **Não passa pelo executor de query**, de propósito. "Abre a tabela e olha" é
 * a maior parte do uso diário; pelo executor ela herdaria `maxRows` e a marca
 * de truncamento, e paginar viraria `OFFSET` — que degrada exatamente nas
 * tabelas grandes onde a paginação importa. Keyset faz a página 400 custar o
 * mesmo que a página 2 — e **isso é verificado, não afirmado**: a condição
 * emitida aqui vira `Index Cond`, não `Filter`. Ver `condicaoKeyset` e §11.26.
 *
 * Nada aqui concatena valor vindo do cliente:
 *
 * - **nome de coluna e de relação** são *escolhidos* de uma lista vinda do
 *   catálogo — a segurança vem da origem, não de escapar aspas;
 * - **operador** é literal de uma união fechada, validada pelo TypeBox;
 * - **valor** vai por parâmetro ligado, sempre.
 */

/** Todo valor de célula é string; `null` é SQL NULL (§6). */
type Cell = string | null;

interface TextTypesConfig {
  getTypeParser: () => (value: string) => string;
}
const TUDO_TEXTO: TextTypesConfig = { getTypeParser: () => (v) => v };

/**
 * Cita um identificador que **já foi conferido contra o catálogo**.
 *
 * Não é sanitização — a segurança vem de o nome ter saído da introspecção. Isto
 * existe porque `"Pedido"` e `Pedido` são coisas diferentes para o Postgres, e
 * sem aspas um identificador com maiúscula não resolve.
 */
const cite = (nome: string): string => `"${nome.replaceAll('"', '""')}"`;

export class RowsError extends Error {
  constructor(
    readonly code: "unknown_column" | "invalid_cursor",
    message: string,
  ) {
    super(message);
    this.name = "RowsError";
  }
}

/** Acumula os parâmetros e devolve o `$n` de cada um. */
class Parametros {
  readonly valores: (string | null)[] = [];

  push(valor: string | null): string {
    this.valores.push(valor);
    return `$${String(this.valores.length)}`;
  }
}

/**
 * SQL de um filtro.
 *
 * O parâmetro é sempre texto e leva um cast **para o tipo da coluna**. Comparar
 * `coluna::text > $1` ordenaria `"10" < "9"` em coluna numérica e quebraria
 * data — o cast tem que ir no parâmetro, nunca na coluna.
 */
function condicaoFiltro(
  coluna: string,
  tipo: string,
  filtro: RowFilter,
  params: Parametros,
): string {
  const c = cite(coluna);

  switch (filtro.operator) {
    case "isNull":
      return `${c} IS NULL`;
    case "isNotNull":
      return `${c} IS NOT NULL`;
    case "contains":
      // Aqui o cast vai na COLUNA de propósito: o usuário procura texto dentro
      // de um número ou de uma data, e `%` viaja no parâmetro.
      return `${c}::text ILIKE ${params.push(`%${filtro.value ?? ""}%`)}`;
    case "startsWith":
      return `${c}::text ILIKE ${params.push(`${filtro.value ?? ""}%`)}`;
    default: {
      const op = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" }[filtro.operator];
      return `${c} ${op} ${params.push(filtro.value ?? "")}::${tipo}`;
    }
  }
}

export interface Plano {
  readonly sql: string;
  readonly valores: (string | null)[];
  readonly orderColumn: string | null;
  readonly primaryKey: readonly string[];
  readonly keyset: boolean;
}

/**
 * Monta a consulta.
 *
 * A ordenação é sempre `(coluna escolhida, ...PK)`. **Sem o desempate pela PK a
 * ordem não é determinística**, e linhas repetem ou somem entre páginas — a
 * armadilha clássica de keyset sobre coluna não única.
 */
export function planRows(relation: Relation, schema: string, request: RowsRequest): Plano {
  const tipos = new Map(relation.columns.map((c) => [c.name, c.dataType]));
  const pk = relation.primaryKey;
  const keyset = pk.length > 0;

  const tipoDe = (nome: string): string => {
    const tipo = tipos.get(nome);
    if (tipo === undefined) {
      throw new RowsError("unknown_column", `a coluna "${nome}" não existe em ${relation.name}`);
    }
    return tipo;
  };

  const orderColumn = request.orderBy === undefined ? null : (tipoDe(request.orderBy), request.orderBy);
  const dir: SortDirection = request.orderDirection ?? "asc";
  const cmp = dir === "asc" ? ">" : "<";

  const params = new Parametros();
  const onde: string[] = [];

  for (const filtro of request.filters ?? []) {
    onde.push(condicaoFiltro(filtro.column, tipoDe(filtro.column), filtro, params));
  }

  const cursor = keyset ? request.after : undefined;
  if (cursor !== undefined && cursor.primaryKey.length !== pk.length) {
    throw new RowsError("invalid_cursor", "o cursor não corresponde à chave primária");
  }

  const D = dir.toUpperCase();
  const alvo = `${cite(schema)}.${cite(relation.name)}`;
  const limite = request.limit ?? 100;
  const teto = `LIMIT ${String(limite + 1)}`;

  /** `ORDER BY` de um ramo: sem `NULLS LAST`, porque dentro dele não há dúvida. */
  const ordemDoRamo = [
    ...(orderColumn === null ? [] : [`${cite(orderColumn)} ${D}`]),
    ...pk.map((c) => `${cite(c)} ${D}`),
  ].join(", ");

  const ramo = (condicoes: readonly string[]): string =>
    [
      `SELECT * FROM ${alvo}`,
      condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "",
      ordemDoRamo === "" ? "" : `ORDER BY ${ordemDoRamo}`,
      teto,
      // Sem PK não há keyset: OFFSET, com o aviso indo na resposta.
      !keyset && request.offset !== undefined && request.offset > 0
        ? `OFFSET ${String(request.offset)}`
        : "",
    ]
      .filter((parte) => parte !== "")
      .join("\n");

  const anulavel =
    orderColumn !== null &&
    (relation.columns.find((c) => c.name === orderColumn)?.nullable ?? true);

  /*
   * Só há dois ramos quando os três valem ao mesmo tempo: existe cursor, a
   * ordenação é por uma coluna **anulável**, e o cursor ainda está na região
   * não-nula. Fora disso, um ramo só — e a maioria absoluta do uso cai aqui.
   */
  // `anulavel` já implica `orderColumn !== null`, e o TypeScript propaga essa
  // estreitagem pela constante — repetir a checagem aqui seria ruído que o
  // lint acusa com razão.
  const precisaDeDoisRamos = cursor !== undefined && anulavel && !cursor.orderValueIsNull;

  if (!precisaDeDoisRamos) {
    const condicoes = [...onde];
    if (cursor !== undefined) {
      condicoes.push(condicaoKeyset(cursor, orderColumn, tipos, pk, cmp, params));
    }
    return { sql: ramo(condicoes), valores: params.valores, orderColumn, primaryKey: pk, keyset };
  }

  const c = cite(orderColumn);
  const avanco = comparacaoDeLinha(cursor, orderColumn, tipos, pk, cmp, params);

  const sql = [
    "SELECT * FROM (",
    // Ramo 1: o que vem depois do cursor entre os NÃO-NULOS. O `IS NOT NULL`
    // explícito é o que o planejador dobra dentro do `Index Cond` — medido.
    `  (${ramo([...onde, `${c} IS NOT NULL`, avanco]).replaceAll("\n", "\n   ")})`,
    "  UNION ALL",
    // Ramo 2: os NULL, que com NULLS LAST vêm todos depois. Ordenar por
    // `(coluna, pk)` em vez de só pela PK é o que deixa o índice composto
    // servir este ramo: 0,23 ms contra 2,6 ms numa coluna com NULL raro.
    `  (${ramo([...onde, `${c} IS NULL`]).replaceAll("\n", "\n   ")})`,
    ") u",
    `ORDER BY ${c} ${D} NULLS LAST, ${pk.map((k) => `${cite(k)} ${D}`).join(", ")}`,
    teto,
  ].join("\n");

  return { sql, valores: params.valores, orderColumn, primaryKey: pk, keyset };
}

/**
 * Só a chave primária avançando: `(pk1, pk2) > ($1, $2)`.
 *
 * Comparação de linha, não a disjunção equivalente. **É a forma, não o
 * conteúdo, que decide se o índice é usado** — ver `condicaoKeyset`.
 */
function pkAvancando(
  cursor: RowCursor,
  tipos: ReadonlyMap<string, string>,
  pk: readonly string[],
  cmp: string,
  params: Parametros,
): string {
  const citada = pk.map(cite).join(", ");
  const valores = pk
    .map((coluna, i) => `${params.push(cursor.primaryKey[i] ?? null)}::${tipos.get(coluna) ?? "text"}`)
    .join(", ");
  return `(${citada}) ${cmp} (${valores})`;
}

/**
 * `(coluna, ...pk) > ($v, ...$p)` — a comparação de linha canônica.
 *
 * Vale só onde `coluna` não é NULL: a comparação com NULL devolve NULL, e a
 * linha some. Quem garante isso é quem chama.
 */
function comparacaoDeLinha(
  cursor: RowCursor,
  orderColumn: string,
  tipos: ReadonlyMap<string, string>,
  pk: readonly string[],
  cmp: string,
  params: Parametros,
): string {
  const colunas = [cite(orderColumn), ...pk.map(cite)].join(", ");
  const valores = [
    `${params.push(cursor.orderValue)}::${tipos.get(orderColumn) ?? "text"}`,
    ...pk.map(
      (coluna, i) => `${params.push(cursor.primaryKey[i] ?? null)}::${tipos.get(coluna) ?? "text"}`,
    ),
  ].join(", ");
  return `(${colunas}) ${cmp} (${valores})`;
}

/**
 * Condição de keyset de **um ramo só**.
 *
 * ## A forma decide, não o conteúdo
 *
 * `(c, pk) > ($v, $p)` e `c > $v OR (c = $v AND pk > $p)` selecionam
 * exatamente as mesmas linhas — e têm planos completamente diferentes. Medido
 * na página 300.000 de uma tabela de 500 mil, coluna indexada:
 *
 * | forma | plano | tempo |
 * |---|---|---|
 * | disjunção com `OR` | `Filter`, 300.000 linhas descartadas | **76,4 ms** |
 * | comparação de linha | `Index Cond`, 101 heap fetches | **0,25 ms** |
 *
 * **Qualquer `OR` na condição derruba o `Index Cond`** — inclusive
 * `(c, pk) > ($v, $p) OR c IS NULL`, que parece manter a forma canônica e não
 * mantém (medido: 19,3 ms, `Filter`). É por isso que a região dos NULL vira um
 * segundo ramo de `UNION ALL` em `planRows`, em vez de um `OR` aqui.
 *
 * Os três casos que cabem num ramo só:
 *
 * - **sem coluna de ordenação:** só a PK avança;
 * - **coluna `NOT NULL` pelo catálogo:** comparação de linha direta;
 * - **cursor já entre os NULL:** `c IS NULL` mais a PK avançando.
 */
function condicaoKeyset(
  cursor: RowCursor,
  orderColumn: string | null,
  tipos: ReadonlyMap<string, string>,
  pk: readonly string[],
  cmp: string,
  params: Parametros,
): string {
  if (orderColumn === null) return pkAvancando(cursor, tipos, pk, cmp, params);

  // Já entre os NULL (que com NULLS LAST vêm por último): a coluna de ordem
  // não desempata mais, e `c IS NULL AND pk > $p` é indexável pelo composto.
  if (cursor.orderValueIsNull) {
    return `(${cite(orderColumn)} IS NULL AND ${pkAvancando(cursor, tipos, pk, cmp, params)})`;
  }

  return comparacaoDeLinha(cursor, orderColumn, tipos, pk, cmp, params);
}

export async function fetchRows(
  client: PoolClient,
  relation: Relation,
  schema: string,
  request: RowsRequest,
): Promise<Omit<RowsResponse, "durationMs">> {
  const plano = planRows(relation, schema, request);

  const res = await client.query<Cell[]>({
    text: plano.sql,
    values: plano.valores,
    rowMode: "array",
    types: TUDO_TEXTO,
  });

  const limite = request.limit ?? 100;
  const hasMore = res.rows.length > limite;
  const rows = hasMore ? res.rows.slice(0, limite) : res.rows;

  const nomes = res.fields.map((f) => f.name);
  const ultima = rows.at(-1);

  const nextCursor =
    !plano.keyset || !hasMore || ultima === undefined
      ? null
      : {
          orderValue:
            plano.orderColumn === null
              ? null
              : (ultima[nomes.indexOf(plano.orderColumn)] ?? null),
          orderValueIsNull:
            plano.orderColumn !== null && ultima[nomes.indexOf(plano.orderColumn)] === null,
          primaryKey: plano.primaryKey.map((c) => ultima[nomes.indexOf(c)] ?? ""),
        };

  return {
    columns: await resolveColumns(client, res.fields),
    rows,
    nextCursor,
    hasMore,
    keyset: plano.keyset,
    primaryKey: [...plano.primaryKey],
  };
}
