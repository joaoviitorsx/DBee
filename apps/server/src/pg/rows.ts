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
 * mesmo que a página 2.
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

  if (keyset && request.after !== undefined) {
    if (request.after.primaryKey.length !== pk.length) {
      throw new RowsError("invalid_cursor", "o cursor não corresponde à chave primária");
    }
    onde.push(condicaoKeyset(request.after, orderColumn, tipos, pk, cmp, dir, params));
  }

  const ordem = [
    // NULLS LAST fixa onde os nulos caem, que é o que a condição de keyset
    // abaixo assume.
    ...(orderColumn === null ? [] : [`${cite(orderColumn)} ${dir.toUpperCase()} NULLS LAST`]),
    ...pk.map((c) => `${cite(c)} ${dir.toUpperCase()}`),
  ];

  const limite = request.limit ?? 100;

  const sql = [
    `SELECT * FROM ${cite(schema)}.${cite(relation.name)}`,
    onde.length > 0 ? `WHERE ${onde.join(" AND ")}` : "",
    ordem.length > 0 ? `ORDER BY ${ordem.join(", ")}` : "",
    // limite + 1 revela a próxima página sem contar a tabela.
    `LIMIT ${String(limite + 1)}`,
    // Sem PK não há keyset: OFFSET, com o aviso indo na resposta.
    !keyset && request.offset !== undefined && request.offset > 0
      ? `OFFSET ${String(request.offset)}`
      : "",
  ]
    .filter((parte) => parte !== "")
    .join("\n");

  return { sql, valores: params.valores, orderColumn, primaryKey: pk, keyset };
}

/**
 * Condição de keyset, com NULL tratado explicitamente.
 *
 * Comparação de linha — `(c, pk) > ($1, $2)` — é o jeito canônico e usa índice,
 * **mas NULL a quebra**: se `c` for NULL, a comparação devolve NULL e a linha
 * some. Numa coluna anulável isso significa perder, em silêncio, todas as
 * linhas com NULL a partir da segunda página.
 *
 * Com `NULLS LAST` os nulos ficam no fim, então há dois regimes:
 *
 * - **Ainda na região não-nula:** pega o que vem depois **e** todos os NULL.
 * - **Já entre os NULL:** só a PK desempata.
 */
function condicaoKeyset(
  cursor: RowCursor,
  orderColumn: string | null,
  tipos: ReadonlyMap<string, string>,
  pk: readonly string[],
  cmp: string,
  dir: SortDirection,
  params: Parametros,
): string {
  const pkCitada = pk.map(cite).join(", ");
  const pkValores = pk
    .map((coluna, i) => `${params.push(cursor.primaryKey[i] ?? null)}::${tipos.get(coluna) ?? "text"}`)
    .join(", ");
  const pkAvanca = `(${pkCitada}) ${cmp} (${pkValores})`;

  if (orderColumn === null) return pkAvanca;

  const c = cite(orderColumn);

  // Já entre os NULL (que vêm por último): a coluna de ordem não desempata mais.
  if (cursor.orderValueIsNull) return `(${c} IS NULL AND ${pkAvanca})`;

  const v = `${params.push(cursor.orderValue)}::${tipos.get(orderColumn) ?? "text"}`;
  // Com NULLS LAST em ASC, os nulos ainda estão por vir; em DESC eles já
  // passaram, porque NULLS LAST em DESC os coloca no fim também.
  const nulosAindaPorVir = dir === "asc" ? ` OR ${c} IS NULL` : "";

  return `(${c} ${cmp} ${v} OR (${c} = ${v} AND ${pkAvanca})${nulosAindaPorVir})`;
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
