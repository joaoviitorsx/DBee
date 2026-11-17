import type { ExplainRequest, ExplainResponse, QueryError } from "@dbee/shared";
import { splitStatements } from "@dbee/shared/puro";

import type { ConnectionsRepository } from "../db/connections.repo";
import { falhaDoResolve } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { type Ator, atorDoLog } from "../lib/ator";
import { explicar, prefixoExplain } from "../pg/explain";
import type { PoolManager } from "../pg/pool";
import { type ServiceResult, fail, ok } from "./result";

/**
 * Sentinela para forçar `ROLLBACK` numa transação `READ WRITE`.
 *
 * `withTransaction(readOnly=false)` commita no sucesso. O ANALYZE precisa do
 * contrário: escrever (se a query escreve) e **nunca** commitar. Lançar daqui
 * leva o `PoolManager` ao `ROLLBACK` que ele já sabe fazer, sem abrir um
 * segundo caminho de transação no hub (ADR 017).
 */
class Reverter extends Error {
  constructor(readonly resultado: { plano: string | null; erro: QueryError | null }) {
    super("rollback do EXPLAIN ANALYZE");
  }
}

/**
 * EXPLAIN visual (ADR 017). Só Postgres.
 *
 * - Sem ANALYZE: `BEGIN READ ONLY`, sempre.
 * - Com ANALYZE: só se pedido **explicitamente** e se a conexão tem escrita
 *   efetiva para este ator (`writeEnabled` já dobra a concessão no `resolve`).
 *   `BEGIN READ WRITE` e `ROLLBACK` incondicional.
 */
export class ExplainService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;

  constructor(deps: { repository: ConnectionsRepository; pools: PoolManager; log: QueryLogRepository }) {
    this.#repository = deps.repository;
    this.#pools = deps.pools;
    this.#log = deps.log;
  }

  async explicar(connectionId: string, req: ExplainRequest, ator: Ator): Promise<ServiceResult<ExplainResponse>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch (e) {
      return fail(falhaDoResolve(e));
    }
    if (connection === null) return fail("not_found");
    if (connection.engine !== "postgres") {
      return fail("bad_request", `engine_not_supported: EXPLAIN visual só no Postgres (${connection.engine})`);
    }

    const analyze = req.analyze === true;
    if (analyze && !connection.writeEnabled) {
      return fail(
        "bad_request",
        "write_forbidden: EXPLAIN ANALYZE executa a query — exige conexão com escrita e concessão de escrita",
      );
    }

    const statements = splitStatements(req.sql);
    const unico = statements[0];
    if (statements.length !== 1 || unico === undefined) {
      return fail("bad_request", "EXPLAIN aceita um único statement");
    }

    const database = req.database ?? connection.database;
    const params = req.params ?? [];
    const inicio = performance.now();
    let resultado: { plano: string | null; erro: QueryError | null };
    try {
      if (analyze) {
        resultado = await this.#pools
          .withTransaction(connection, database, false, async (client) => {
            throw new Reverter(await explicar(client, unico.sql, unico.offset, true, params));
          })
          .catch((e: unknown) => {
            if (e instanceof Reverter) return e.resultado;
            throw e;
          });
      } else {
        resultado = await this.#pools.withTransaction(connection, database, true, (client) =>
          explicar(client, unico.sql, unico.offset, false, params),
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#registrar(connectionId, database, analyze, unico.sql, "error", message, inicio, ator, params);
      return fail("upstream_error", message);
    }

    const durationMs = Math.round(performance.now() - inicio);
    const erro = resultado.erro;
    this.#registrar(
      connectionId,
      database,
      analyze,
      unico.sql,
      erro === null ? "ok" : "error",
      erro === null ? null : `${erro.code ?? "?"}: ${erro.message}`,
      inicio,
      ator,
      params,
    );
    return ok({ plan: resultado.plano, error: erro, analyzed: analyze, durationMs });
  }

  #registrar(
    connectionId: string,
    database: string,
    analyze: boolean,
    sql: string,
    status: "ok" | "error",
    error: string | null,
    inicio: number,
    ator: Ator,
    params: readonly (string | null)[],
  ): void {
    this.#log.record({
      connectionId,
      database,
      // O comando que de fato rodou, com o prefixo — ANALYZE fica visível na auditoria.
      // Com bind, os valores entram na auditoria — mesmo padrão do stats: um
      // ANALYZE de `DELETE … WHERE id = $1` roda de verdade (revertido), e o
      // log precisa dizer sobre qual linha.
      sql: prefixoExplain(analyze) + sql + (params.length > 0 ? `\n-- args: ${JSON.stringify(params)}` : ""),
      status,
      error,
      rowCount: null,
      durationMs: Math.round(performance.now() - inicio),
      // ANALYZE roda em READ WRITE (revertida); o log diz a verdade sobre o modo.
      readOnly: !analyze,
      actor: atorDoLog(ator),
    });
  }
}
