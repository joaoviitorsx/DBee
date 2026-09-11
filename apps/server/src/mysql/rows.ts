import type { Connection, RowDataPacket } from "mysql2/promise";

import type { Relation, RowCursor, RowFilter, RowsRequest, RowsResponse } from "@dbee/shared";

import { RowsError } from "../driver/erros";
import { colunasDoResultado } from "./colunas";
import { citar, condicaoKeyset, ordenacao, type Direcao } from "./keyset";
import { paraTexto, type CampoMysql } from "./tipos";

/**
 * A grade de linhas do MySQL e do MariaDB: filtro, ordenação e paginação.
 *
 * O planejador é análogo ao do Postgres (`pg/rows.ts`) e difere em três coisas
 * medidas:
 *
 * 1. **A forma do keyset é a oposta.** Aqui é a disjunção canônica com `OR`, que
 *    o otimizador transforma em busca por faixa; a comparação de linha vira
 *    varredura de índice e fica vinte vezes mais lenta. Ver `keyset.ts`.
 * 2. **Identificador entre crases**, não aspas duplas.
 * 3. **Placeholder é `?`**, posicional, não `$n`.
 *
 * O que **não** difere, e é o que importa: nome de coluna nunca vem do usuário
 * sem passar pelo catálogo, e valor nunca entra no SQL — vai por parâmetro.
 */

// A mesma classe do Postgres: o serviço reconhece um tipo só, e um nome de
// coluna errado é erro do usuário em qualquer engine — não `upstream_error`.
export { RowsError } from "../driver/erros";

/** Quantas linhas a grade traz por página quando ninguém pede outra coisa. */
const LIMITE_PADRAO = 100;

interface Plano {
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
 * `contains` e `startsWith` fazem o cast na **coluna**, não no valor: a pessoa
 * procura texto dentro de um número ou de uma data, e o `%` viaja no parâmetro
 * para não virar curinga do SQL por acidente.
 *
 * ## A busca casa mais coisas aqui do que no Postgres
 *
 * O `LIKE` do MySQL segue a collation da coluna, e o padrão do MySQL 8 é
 * `utf8mb4_0900_ai_ci`: **a**ccent-**i**nsensitive e **c**ase-**i**nsensitive.
 * Medido: procurar `ö` traz `Milton` e `Ryuichi`, porque `ö` e `o` são a mesma
 * letra para essa collation.
 *
 * O `ILIKE` do Postgres ignora maiúsculas e **respeita** acento, então a mesma
 * busca traz coisas diferentes nas duas engines. Não é defeito de nenhuma das
 * duas: é a collation do banco decidindo o que "igual" significa, e é a
 * resposta que qualquer outro cliente daria naquele servidor.
 *
 * Forçar o comportamento do Postgres exigiria `COLLATE utf8mb4_bin` na
 * comparação, o que destruiria o índice e mudaria o resultado que a pessoa vê
 * fora do DBee. A engine manda.
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
      return `CAST(${c} AS CHAR) LIKE ?`;
    case "startsWith":
      valores.push(`${filtro.value ?? ""}%`);
      return `CAST(${c} AS CHAR) LIKE ?`;
    default: {
      const op = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" }[filtro.operator];
      valores.push(filtro.value ?? null);
      /*
       * `CAST(coluna AS CHAR)` dos dois lados não: comparar número como texto
       * faria `9 > 10`. O valor vai como parâmetro e o MySQL converte para o
       * tipo da coluna, que é a comparação que a pessoa espera.
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
 * entre páginas — a armadilha clássica do keyset sobre coluna não única, que o
 * teste de integração reproduz.
 */
export function planejarLinhas(
  relation: Relation,
  database: string,
  request: RowsRequest,
): Plano {
  const conhecidas = new Set(relation.columns.map((c) => c.name));
  const exigirColuna = (nome: string): string => {
    if (!conhecidas.has(nome)) {
      // O catálogo é a única autoridade sobre nome de coluna. Sem esta
      // verificação, o nome do usuário entraria citado no SQL — citado não é
      // validado, e um nome que não existe vira erro do servidor em vez de
      // erro nosso, com a mensagem errada.
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
   */
  const offset =
    !keyset && request.offset !== undefined && request.offset > 0
      ? ` OFFSET ${String(Math.floor(request.offset))}`
      : "";

  // `limite + 1`: uma linha a mais revela que há próxima página sem contar a
  // tabela — o mesmo truque do executor.
  const sql =
    `SELECT * FROM ${citar(database)}.${citar(relation.name)}${where}${ordem}` +
    ` LIMIT ${String(limite + 1)}${offset}`;

  return { sql, valores, orderColumn, primaryKey: pk, keyset, limite };
}

/** Executa o plano e monta a resposta, com o cursor da próxima página. */
export async function lerLinhas(
  conexao: Connection,
  relation: Relation,
  database: string,
  request: RowsRequest,
): Promise<RowsResponse> {
  const inicio = performance.now();
  const plano = planejarLinhas(relation, database, request);

  const [linhas, campos] = await conexao.query<RowDataPacket[]>(plano.sql, plano.valores);
  const meta = campos as unknown as (CampoMysql & { flags?: number })[];
  const brutas = linhas as unknown as (Buffer | null)[][];

  const hasMore = brutas.length > plano.limite;
  const usadas = hasMore ? brutas.slice(0, plano.limite) : brutas;

  const rows = usadas.map((linha) =>
    meta.map((campo, i) => paraTexto(linha[i] ?? null, campo)),
  );

  /** O valor em texto de uma coluna, pelo nome, na linha dada. */
  const valorEm = (linha: readonly (Buffer | null)[], nome: string): string | null => {
    const i = meta.findIndex((c) => c.name === nome);
    const campo = meta[i];
    return campo === undefined ? null : paraTexto(linha[i] ?? null, campo);
  };

  const ultima = usadas[usadas.length - 1];

  /*
   * O cursor só existe quando há chave primária **e** há próxima página. Sem
   * chave primária não há como avançar sem pular linha; sem próxima página não
   * há para onde avançar.
   */
  const nextCursor: RowCursor | null =
    !plano.keyset || !hasMore || ultima === undefined
      ? null
      : {
          orderValue: plano.orderColumn === null ? null : valorEm(ultima, plano.orderColumn),
          orderValueIsNull:
            plano.orderColumn !== null && valorEm(ultima, plano.orderColumn) === null,
          // A chave primária nunca é nula por definição; se fosse, o cursor não
          // teria como avançar, e uma string vazia falharia alto na página
          // seguinte em vez de pular linhas em silêncio.
          primaryKey: plano.primaryKey.map((col) => valorEm(ultima, col) ?? ""),
        };

  return {
    columns: colunasDoResultado(meta),
    rows,
    nextCursor,
    hasMore,
    durationMs: Math.round(performance.now() - inicio),
    keyset: plano.keyset,
    primaryKey: [...plano.primaryKey],
  };
}
