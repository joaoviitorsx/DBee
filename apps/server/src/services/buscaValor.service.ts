import type { ValueSearchRequest, ValueSearchResponse } from "@dbee/shared";
import { ehNumero } from "@dbee/shared/puro";

import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import { falhaDoResolve } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { type Ator, atorDoLog } from "../lib/ator";
import { buscarValor } from "../pg/buscaValor";
import type { PoolManager } from "../pg/pool";
import { type ServiceResult, fail, ok } from "./result";

interface EmExecucao {
  readonly pid: number;
  readonly connection: ResolvedConnection;
  readonly database: string;
  /** Quem iniciou: só ele cancela. */
  readonly atorId: string;
  cancelada: boolean;
}

/**
 * Buscar valor no banco (ADR 023). Só Postgres, sempre `BEGIN READ ONLY`,
 * escopo obrigatório e tetos fixos — é o que a faz passar no teste 3 da
 * fronteira. Cada busca vira **uma** linha no `query_log`, com o escopo e o
 * valor procurado (auditoria responde "quem procurou o quê").
 */
export class BuscaValorService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;
  /** Em memória, como no `QueryService`: some no restart, que é o certo. */
  readonly #emExecucao = new Map<string, EmExecucao>();

  constructor(deps: { repository: ConnectionsRepository; pools: PoolManager; log: QueryLogRepository }) {
    this.#repository = deps.repository;
    this.#pools = deps.pools;
    this.#log = deps.log;
  }

  async buscar(
    connectionId: string,
    req: ValueSearchRequest,
    ator: Ator,
  ): Promise<ServiceResult<ValueSearchResponse>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch (e) {
      return fail(falhaDoResolve(e));
    }
    if (connection === null) return fail("not_found");
    if (connection.engine !== "postgres") {
      return fail("bad_request", `engine_not_supported: busca de valor só no Postgres (${connection.engine})`);
    }
    if (req.queryId !== undefined && this.#emExecucao.has(req.queryId)) {
      return fail("bad_request", "queryId já em uso");
    }

    const database = req.database ?? connection.database;
    const modo = req.mode ?? "contains";
    const inicio = performance.now();
    const sqlLog = descreverParaLog(req, modo);
    const registro: { atual: EmExecucao | null } = { atual: null };

    try {
      const r = await this.#pools.withReadOnly(connection, database, async (client) => {
        const pid = (client as unknown as { processID: number }).processID;
        if (req.queryId !== undefined) {
          registro.atual = { pid, connection, database, atorId: ator.id, cancelada: false };
          this.#emExecucao.set(req.queryId, registro.atual);
        }
        return await buscarValor(client, req.scope, req.value, modo, ehNumero(req.value), () =>
          registro.atual?.cancelada === true,
        );
      });
      const durationMs = Math.round(performance.now() - inicio);
      this.#log.record({
        connectionId,
        database,
        sql: sqlLog,
        status: r.cancelled ? "cancelled" : "ok",
        error: null,
        rowCount: r.hits.length,
        durationMs,
        readOnly: true,
        actor: atorDoLog(ator),
      });
      return ok({ ...r, durationMs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#log.record({
        connectionId,
        database,
        sql: sqlLog,
        status: "error",
        error: message,
        rowCount: null,
        durationMs: Math.round(performance.now() - inicio),
        readOnly: true,
        actor: atorDoLog(ator),
      });
      return fail("upstream_error", message);
    } finally {
      // A entrada guarda a conexão resolvida — com senha. Sai em todo caminho.
      if (req.queryId !== undefined && registro.atual !== null) this.#emExecucao.delete(req.queryId);
    }
  }

  /** Mesmo contrato do cancelamento de `/query`: 404 sem acesso, `false` se já acabou. */
  async cancelar(connectionId: string, queryId: string, ator: Ator): Promise<ServiceResult<{ cancelled: boolean }>> {
    if (this.#repository.find(connectionId, ator) === null) return fail("not_found");
    const reg = this.#emExecucao.get(queryId);
    if (reg?.connection.id !== connectionId || reg.atorId !== ator.id) return ok({ cancelled: false });
    reg.cancelada = true;
    try {
      await this.#pools.cancelBackend(reg.connection, reg.database, reg.pid);
    } catch {
      // A flag já para o laço na próxima tabela, mesmo sem o cancel no backend.
    }
    return ok({ cancelled: true });
  }
}

/**
 * O texto da auditoria. Não é SQL executável — a busca roda um `SELECT` por
 * tabela —, é a descrição do pedido, com o valor procurado.
 */
export function descreverParaLog(req: ValueSearchRequest, modo: "contains" | "exact"): string {
  const escopo =
    "schema" in req.scope
      ? `schema ${JSON.stringify(req.scope.schema)}`
      : `tabelas ${req.scope.tables.map((t) => JSON.stringify(`${t.schema}.${t.name}`)).join(", ")}`;
  return `-- dbee: busca de valor (${modo}) em ${escopo}: ${JSON.stringify(req.value)}`;
}
