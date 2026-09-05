import type { QueryRequest, QueryResponse } from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { execute } from "../pg/executor";
import type { PoolManager } from "../pg/pool";
import { type ServiceResult, fail, ok } from "./result";

/** Default de `maxRows` (DBee.md §6). */
const MAX_ROWS_PADRAO = 1000;

/**
 * Ator do `query_log` enquanto não há autenticação.
 *
 * **Não é "admin".** Chamar de `admin` daria ao registro a aparência de
 * identidade sem ter identidade nenhuma — e um log de auditoria que não
 * distingue pessoas, em contexto fiscal, é pior que não ter log: dá aparência
 * de controle. `unauthenticated` diz a verdade sobre o que se sabe.
 *
 * Vira o id do usuário quando a fatia de autenticação entrar (DBee.md §7).
 */
const ACTOR = "unauthenticated";

export interface QueryServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly log: QueryLogRepository;
}

export class QueryService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;

  constructor({ repository, pools, log }: QueryServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
    this.#log = log;
  }

  /**
   * Executa o SQL do usuário e **sempre** registra no `query_log`.
   *
   * `BEGIN READ WRITE` exige **as duas coisas**: `write_enabled = 1` na conexão
   * **e** `readOnly: false` explícito na requisição.
   *
   * Omitir o campo significa leitura. É deliberado: o padrão de um campo
   * ausente tem que ser o estado seguro, senão uma tela que esqueça de mandar
   * a flag ganha escrita por acidente numa conexão de produção.
   *
   * Mandar `readOnly: false` numa conexão de leitura não libera nada — a
   * proteção é da conexão, e a requisição só pode ser mais restritiva.
   */
  async run(
    connectionId: string,
    request: QueryRequest,
  ): Promise<ServiceResult<QueryResponse>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    const database = request.database ?? connection.database;
    const maxRows = request.maxRows ?? MAX_ROWS_PADRAO;

    // Gravável só quando a conexão permite E a requisição pede escrita.
    const readOnly = !(connection.writeEnabled && request.readOnly === false);

    const inicio = performance.now();

    try {
      const outcome = await this.#pools.withTransaction(connection, database, readOnly, (client) =>
        execute(client, request.sql, maxRows),
      );

      const totalDurationMs = Math.round(performance.now() - inicio);
      const linhas = outcome.results.reduce((soma, r) => soma + r.rowCount, 0);

      this.#log.record({
        connectionId,
        database,
        sql: request.sql,
        status: outcome.error === null ? "ok" : "error",
        error:
          outcome.error === null
            ? null
            : `${outcome.error.code ?? "?"}: ${outcome.error.message}`,
        rowCount: outcome.error === null ? linhas : null,
        durationMs: totalDurationMs,
        readOnly,
        actor: ACTOR,
      });

      return ok({ ...outcome, totalDurationMs, readOnly });
    } catch (err: unknown) {
      // Falha de conexão ou de transação: o statement nem chegou a rodar. O
      // registro acontece do mesmo jeito — auditoria não pode ter buraco só
      // porque o banco estava fora do ar.
      const message = err instanceof Error ? err.message : "erro desconhecido";

      this.#log.record({
        connectionId,
        database,
        sql: request.sql,
        status: "error",
        error: message,
        rowCount: null,
        durationMs: Math.round(performance.now() - inicio),
        readOnly,
        actor: ACTOR,
      });

      return fail("upstream_error", message);
    }
  }

  history(limit: number, connectionId?: string) {
    return this.#log.list(limit, connectionId);
  }
}
