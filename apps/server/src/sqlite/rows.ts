import type { Relation, RowsRequest, RowsResponse, StatementResult, QueryError } from "@dbee/shared";
import { splitStatements } from "@dbee/shared/puro";

import { planejarLinhas as planejarLibsql } from "../libsql/rows";
import type { GerenteSqlite } from "./gerente";
import type { ResolvedConnection } from "../db/connections.repo";

/**
 * Grade e execução do SQLite local — o mesmo SQL do libSQL, rodando pelo worker.
 *
 * O planejador de linhas é **o do libSQL** (`planejarLibsql`): mesma citação por
 * aspas, mesmo keyset por `_id`/PK, mesma gramática `sqlite`. O que muda é o
 * transporte — em vez de HTTP, uma mensagem para o worker (`GerenteSqlite`),
 * que roda o `bun:sqlite` síncrono fora do event loop.
 */

/** Uma página da grade. */
export async function lerLinhas(
  gerente: GerenteSqlite,
  conexao: ResolvedConnection,
  relation: Relation,
  request: RowsRequest,
): Promise<{ resposta: RowsResponse; sql: string; parametros: (string | null)[] }> {
  const inicio = performance.now();
  const plano = planejarLibsql(relation, request);

  const r = await gerente.consulta(conexao, plano.sql, plano.valores, plano.limite);

  const hasMore = r.rows.length > plano.limite;
  const usadas = hasMore ? r.rows.slice(0, plano.limite) : r.rows;
  const indiceDe = (nome: string): number => r.columns.indexOf(nome);
  const ultima = usadas[usadas.length - 1];

  const nextCursor =
    !plano.keyset || !hasMore || ultima === undefined
      ? null
      : {
          orderValue:
            plano.orderColumn === null ? null : (ultima[indiceDe(plano.orderColumn)] ?? null),
          orderValueIsNull:
            plano.orderColumn !== null && (ultima[indiceDe(plano.orderColumn)] ?? null) === null,
          primaryKey: plano.primaryKey.map((col) => ultima[indiceDe(col)] ?? ""),
        };

  return {
    resposta: {
      columns: relation.columns.map((c) => ({
        name: c.name,
        dataTypeId: c.dataTypeId,
        dataTypeName: c.dataType,
      })),
      rows: usadas,
      nextCursor,
      hasMore,
      durationMs: Math.round(performance.now() - inicio),
      keyset: plano.keyset,
      primaryKey: [...plano.primaryKey],
    },
    sql: plano.sql,
    parametros: plano.valores,
  };
}

/**
 * Executa o SQL do usuário, statement a statement, parando no primeiro erro.
 *
 * `escrita` escolhe o handle no worker: `false` (o padrão de uma conexão sem
 * concessão) usa o handle **readonly**, e um `INSERT`/`UPDATE`/`DDL` estoura no
 * próprio SQLite ("attempt to write a readonly database") — a garantia é o
 * handle. `true` (só quando o serviço confirmou concessão) usa o handle r/w.
 */
export async function executar(
  gerente: GerenteSqlite,
  conexao: ResolvedConnection,
  sql: string,
  maxRows: number,
  escrita: boolean,
): Promise<{ results: StatementResult[]; error: (QueryError & { index: number }) | null }> {
  const statements = splitStatements(sql, "sqlite");
  const results: StatementResult[] = [];

  for (const [index, statement] of statements.entries()) {
    const inicio = performance.now();
    try {
      const r = await gerente.consulta(conexao, statement.sql, [], maxRows, escrita);
      const truncated = r.rows.length > maxRows;
      const m = /^\s*([A-Za-z]+)/.exec(statement.sql);
      results.push({
        index,
        sql: statement.sql,
        columns: r.columns.map((name, i) => ({ name, dataTypeId: i, dataTypeName: "" })),
        rows: truncated ? r.rows.slice(0, maxRows) : r.rows,
        rowCount: r.rows.length,
        truncated,
        durationMs: Math.round(performance.now() - inicio),
        command: m?.[1] === undefined ? null : m[1].toUpperCase(),
        viaCursor: false,
      });
    } catch (err: unknown) {
      return {
        results,
        error: {
          code: "sqlite_error",
          message: err instanceof Error ? err.message : String(err),
          position: null,
          detail: null,
          hint: null,
          index,
        },
      };
    }
  }

  return { results, error: null };
}
