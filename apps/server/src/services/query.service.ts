import type { CancelResponse, QueryRequest, QueryResponse } from "@dbee/shared";

import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
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

export interface QueryServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly log: QueryLogRepository;
}

export class QueryService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;
  /**
   * Queries em execução, por `queryId`, com o backend PID e o suficiente para
   * abrir a conexão de cancelamento. Em memória, uma instância só (DBee.md §7):
   * some no restart, que é o comportamento certo — nada está rodando depois.
   */
  readonly #emExecucao = new Map<
    string,
    { readonly pid: number; readonly connection: ResolvedConnection; readonly database: string }
  >();

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
    /**
     * Quem executou, para o `query_log` (DBee.md §2.4, §7).
     *
     * Chega como parâmetro vindo da sessão, e **não** tem valor padrão: um padrão
     * aqui seria o caminho por onde uma rota nova grava auditoria anônima sem
     * ninguém notar. Sem sessão a requisição nem chega ao serviço — o guard barra
     * antes.
     */
    actor: string,
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
      const outcome = await this.#pools.withTransaction(connection, database, readOnly, async (client) => {
        // `processID` é o backend PID, disponível assim que o cliente conecta.
        // Registra sob o `queryId` para o cancelamento achar o backend certo, e
        // desregistra no fim — a janela cancelável é exatamente a da execução.
        const pid = (client as unknown as { processID: number }).processID;
        if (request.queryId !== undefined) {
          this.#emExecucao.set(request.queryId, { pid, connection, database });
        }
        try {
          return await execute(client, request.sql, maxRows);
        } finally {
          if (request.queryId !== undefined) this.#emExecucao.delete(request.queryId);
        }
      });

      const totalDurationMs = Math.round(performance.now() - inicio);
      const linhas = outcome.results.reduce((soma, r) => soma + r.rowCount, 0);
      // `57014` = "canceling statement due to user request": o cancelamento
      // pedido, não um erro de SQL. Vira status próprio no log.
      const cancelada = outcome.error !== null && outcome.error.code === "57014";

      this.#log.record({
        connectionId,
        database,
        sql: request.sql,
        status: outcome.error === null ? "ok" : cancelada ? "cancelled" : "error",
        error:
          outcome.error === null
            ? null
            : `${outcome.error.code ?? "?"}: ${outcome.error.message}`,
        rowCount: outcome.error === null ? linhas : null,
        durationMs: totalDurationMs,
        readOnly,
        actor,
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
        actor,
      });

      return fail("upstream_error", message);
    }
  }

  /**
   * Cancela uma query em execução pelo `queryId`.
   *
   * Não resolve conexão nem toca no `query_log`: usa o backend PID já
   * registrado por `run`, e o cancelamento faz a query original voltar com
   * `57014`, que `run` grava como `cancelled`. Se o `queryId` não está em
   * execução (já terminou, ou nunca existiu), devolve `cancelled: false` — não é
   * erro, é o cancelamento chegando tarde. O `connectionId` do caminho tem que
   * bater com o registrado: um id não impede cancelar a query de outra conexão.
   */
  async cancelar(connectionId: string, queryId: string): Promise<CancelResponse> {
    const reg = this.#emExecucao.get(queryId);
    // `undefined` (já terminou) e conexão diferente caem no mesmo lugar: nada a
    // cancelar sob este id nesta conexão.
    if (reg?.connection.id !== connectionId) return { cancelled: false };
    try {
      const cancelled = await this.#pools.cancelBackend(reg.connection, reg.database, reg.pid);
      return { cancelled };
    } catch {
      return { cancelled: false };
    }
  }

  history(limit: number, connectionId?: string) {
    return this.#log.list(limit, connectionId);
  }
}
