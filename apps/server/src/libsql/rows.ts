import type { Relation, RowCursor, RowFilter, RowsRequest, RowsResponse } from "@dbee/shared";

import { RowsError } from "../driver/erros";
import { arg, executarSql, type AlvoLibsql, type StatementLibsql } from "./cliente";
import { citar } from "./citar";
import { colunasDoResultado } from "./colunas";
import { condicaoKeyset, ordenacao, type Direcao } from "./keyset";
import { paraTexto } from "./protocolo";

/**
 * A grade de linhas do libSQL: filtro, ordenação e paginação.
 *
 * Análogo ao do MySQL (`mysql/rows.ts`), e difere em três coisas:
 *
 * 1. **Identificador entre aspas duplas**, como no Postgres — mas com o
 *    `citar()` daqui, porque o escape é a aspa dobrada e não a crase.
 * 2. **Não há database para qualificar a tabela.** A URL aponta para um banco e
 *    dentro dele há tabelas; `FROM "clientes"` é o caminho inteiro.
 * 3. **Toda ligação vai como texto** (`arg`), e o SQLite converte para o tipo da
 *    coluna na comparação. É o que a tipagem dinâmica dele permite, e o que
 *    evita decidir, valor a valor, se ele "parece número".
 *
 * O que **não** difere: nome de coluna nunca vem do usuário sem passar pelo
 * catálogo, e valor nunca entra no SQL — vai por parâmetro.
 */

export { RowsError } from "../driver/erros";

/** Quantas linhas a grade traz por página quando ninguém pede outra coisa. */
const LIMITE_PADRAO = 100;

export interface Plano {
  readonly sql: string;
  /** Texto ou `null` — a regra 10 vale também no caminho de ida. */
  readonly valores: (string | null)[];
  readonly orderColumn: string | null;
  readonly primaryKey: readonly string[];
  readonly keyset: boolean;
  readonly limite: number;
}

/**
 * O filtro vira SQL — **o operador** vem de uma lista fechada e **o valor** vai
 * por parâmetro.
 *
 * ## A busca casa menos coisa aqui do que nas outras engines
 *
 * O `LIKE` do SQLite ignora maiúsculas **só em ASCII**: `a` casa `A`, e `á` não
 * casa `Á`. Não há ICU no `sqld` padrão, então `LOWER()` sofre da mesma
 * limitação e trocar um pelo outro não conserta nada — só destrói o índice.
 *
 * É diferente do Postgres (`ILIKE`, que respeita acento mas cobre Unicode) e do
 * MySQL (collation `ai_ci`, que ignora acento **e** caixa). As três engines dão
 * três respostas para a mesma busca, e cada uma é a resposta que qualquer outro
 * cliente daquele banco daria. A engine manda.
 */
function condicaoDeFiltro(filtro: RowFilter, valores: (string | null)[]): string {
  const c = citar(filtro.column);
  switch (filtro.operator) {
    case "isNull":
      return `${c} IS NULL`;
    case "isNotNull":
      return `${c} IS NOT NULL`;
    case "contains":
      valores.push(`%${filtro.value ?? ""}%`);
      return `CAST(${c} AS TEXT) LIKE ?`;
    case "startsWith":
      valores.push(`${filtro.value ?? ""}%`);
      return `CAST(${c} AS TEXT) LIKE ?`;
    default: {
      const op = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" }[filtro.operator];
      valores.push(filtro.value ?? null);
      /*
       * Sem `CAST` dos dois lados: comparar número como texto faria `9 > 10`. O
       * valor vai como parâmetro e a afinidade da coluna converte — que é a
       * comparação que a pessoa espera.
       */
      return `${c} ${op} ?`;
    }
  }
}

/**
 * Monta a consulta da página.
 *
 * A ordenação é sempre `(coluna escolhida, …chave primária)`. **Sem o desempate
 * pela chave primária a ordem não é determinística**, e linhas repetem ou somem
 * entre páginas — a armadilha clássica do keyset sobre coluna não única.
 */
export function planejarLinhas(relation: Relation, request: RowsRequest): Plano {
  const conhecidas = new Set(relation.columns.map((c) => c.name));
  const exigirColuna = (nome: string): string => {
    if (!conhecidas.has(nome)) {
      // O catálogo é a única autoridade sobre nome de coluna. Citado não é
      // validado: sem esta verificação, um nome inexistente viraria erro do
      // servidor em vez de erro nosso, com a mensagem errada.
      throw new RowsError("unknown_column", `a coluna "${nome}" não existe em ${relation.name}`);
    }
    return nome;
  };

  const pk = relation.primaryKey;
  const keyset = pk.length > 0;
  const limite = request.limit ?? LIMITE_PADRAO;
  const direcao: Direcao = request.orderDirection ?? "asc";
  const orderColumn = request.orderBy === undefined ? null : exigirColuna(request.orderBy);
  const anulavel =
    orderColumn === null
      ? false
      : relation.columns.find((c) => c.name === orderColumn)?.nullable !== false;

  const valores: (string | null)[] = [];
  const condicoes: string[] = [];

  for (const filtro of request.filters ?? []) {
    exigirColuna(filtro.column);
    condicoes.push(condicaoDeFiltro(filtro, valores));
  }

  // O cursor só vale com chave primária: sem ela não há como avançar sem pular.
  const cursor = keyset ? request.after : undefined;
  if (cursor !== undefined) {
    if (cursor.primaryKey.length !== pk.length) {
      throw new RowsError(
        "invalid_cursor",
        `o cursor tem ${String(cursor.primaryKey.length)} valores de chave e a tabela tem ${String(pk.length)}`,
      );
    }
    const cond = condicaoKeyset(cursor, orderColumn, pk, direcao, anulavel);
    condicoes.push(`(${cond.sql})`);
    valores.push(...cond.valores);
  }

  const where = condicoes.length === 0 ? "" : ` WHERE ${condicoes.join(" AND ")}`;
  const ordem = keyset
    ? ` ORDER BY ${ordenacao(orderColumn, pk, direcao)}`
    : orderColumn === null
      ? ""
      : ` ORDER BY ${citar(orderColumn)} ${direcao === "asc" ? "ASC" : "DESC"}`;

  /*
   * Sem chave primária não há keyset, e a navegação cai para `OFFSET` — que
   * degrada em tabela grande e pode repetir ou pular linha entre páginas. A
   * resposta diz `keyset: false` para a tela avisar, em vez de fingir.
   *
   * No SQLite `OFFSET` **exige** `LIMIT` antes; ele sempre está aqui.
   */
  const offset =
    !keyset && request.offset !== undefined && request.offset > 0
      ? ` OFFSET ${String(Math.floor(request.offset))}`
      : "";

  // `limite + 1`: uma linha a mais revela que há próxima página sem contar a
  // tabela — o mesmo truque do executor.
  const sql =
    `SELECT * FROM ${citar(relation.name)}${where}${ordem}` +
    ` LIMIT ${String(limite + 1)}${offset}`;

  return { sql, valores, orderColumn, primaryKey: pk, keyset, limite };
}

/** Executa o plano e monta a resposta, com o cursor da próxima página. */
export async function lerLinhas(
  alvo: AlvoLibsql,
  relation: Relation,
  request: RowsRequest,
): Promise<RowsResponse> {
  const inicio = performance.now();
  const plano = planejarLinhas(relation, request);

  const statement: StatementLibsql = { sql: plano.sql, args: plano.valores.map(arg) };
  const [resultado] = await executarSql(alvo, [statement]);
  if (resultado === undefined) {
    throw new RowsError("unknown_column", "o servidor libSQL não devolveu resultado");
  }

  const hasMore = resultado.rows.length > plano.limite;
  const usadas = hasMore ? resultado.rows.slice(0, plano.limite) : resultado.rows;

  const rows = usadas.map((linha) =>
    resultado.cols.map((_, i) => paraTexto(linha[i] ?? { type: "null" })),
  );

  /** O índice de uma coluna pelo nome, ou -1. */
  const indiceDe = (nome: string): number => resultado.cols.findIndex((c) => c.name === nome);

  const ultima = rows[rows.length - 1];

  /*
   * O cursor só existe quando há chave primária **e** há próxima página. Sem
   * chave primária não há como avançar sem pular linha; sem próxima página não
   * há para onde avançar.
   */
  const nextCursor: RowCursor | null =
    !plano.keyset || !hasMore || ultima === undefined
      ? null
      : {
          orderValue:
            plano.orderColumn === null ? null : (ultima[indiceDe(plano.orderColumn)] ?? null),
          orderValueIsNull:
            plano.orderColumn !== null && (ultima[indiceDe(plano.orderColumn)] ?? null) === null,
          // A chave primária nunca é nula por definição; se fosse, o cursor não
          // teria como avançar, e uma string vazia falharia alto na página
          // seguinte em vez de pular linhas em silêncio.
          primaryKey: plano.primaryKey.map((col) => ultima[indiceDe(col)] ?? ""),
        };

  return {
    columns: colunasDoResultado(resultado.cols),
    rows,
    nextCursor,
    hasMore,
    durationMs: Math.round(performance.now() - inicio),
    keyset: plano.keyset,
    primaryKey: [...plano.primaryKey],
  };
}
