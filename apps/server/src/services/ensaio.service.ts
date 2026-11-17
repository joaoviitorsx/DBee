import {
  AMOSTRA_ENSAIO,
  type ApplyRequest,
  type ApplyResponse,
  type DryRunRequest,
  type DryRunResponse,
  type StatementResult,
} from "@dbee/shared";

import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import { falhaDoResolve } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { type Ator, atorDoLog } from "../lib/ator";
import { executarConferido } from "../pg/ensaio";
import type { ExecutionOutcome } from "../pg/executor";
import type { PoolManager } from "../pg/pool";
import type { QueryService } from "./query.service";
import type { ServiceFailure } from "./result";

/**
 * Ensaio de escrita e aplicação conferida (ADR 021).
 *
 * A decisão de gravar vem do **resultado do banco** (`rowCount`), nunca do texto
 * do SQL (regra 8). O ensaio sempre reverte; aplicar commita só se cada
 * statement afetou exatamente o que o ensaio mostrou.
 */
export type EnsaioFailure =
  | ServiceFailure
  /** Conexão sem escrita para este ator — o ensaio só existe onde a escrita existe. */
  | "write_forbidden"
  /** O `rowCount` divergiu do ensaio: reverteu sem gravar. */
  | "dry_run_mismatch"
  /** Conexão `production` sem o nome digitado (ADR 022). */
  | "confirmation_required";

export type EnsaioResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: EnsaioFailure; readonly detail?: string };

const ok = <T>(value: T): EnsaioResult<T> => ({ ok: true, value });
const fail = <T>(failure: EnsaioFailure, detail?: string): EnsaioResult<T> =>
  detail === undefined ? { ok: false, failure } : { ok: false, failure, detail };

/**
 * `maxRows` da execução. O `rowCount` de um `SELECT` por cursor é limitado a
 * ele — o mesmo valor no ensaio e no aplicar, para a comparação ser justa.
 */
const MAX_ROWS = AMOSTRA_ENSAIO;

export interface EnsaioServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly log: QueryLogRepository;
  /** Dono do mapa de execuções canceláveis. */
  readonly query: QueryService;
}

/** Corta as linhas na amostra; o `rowCount` fica o do banco. */
export function amostrar(results: readonly StatementResult[]): StatementResult[] {
  return results.map((r) =>
    r.rows.length > AMOSTRA_ENSAIO
      ? { ...r, rows: r.rows.slice(0, AMOSTRA_ENSAIO), truncated: true }
      : r,
  );
}

/** Onde o lote divergiu do ensaio, ou `null` se bateu. Pura. */
export function divergencia(
  esperado: readonly number[],
  obtido: readonly StatementResult[],
): string | null {
  if (esperado.length !== obtido.length) {
    return `o ensaio tinha ${String(esperado.length)} statement(s) e a aplicação executou ${String(obtido.length)}`;
  }
  const partes = obtido.flatMap((r, i) =>
    r.rowCount === esperado[i]
      ? []
      : [`statement ${String(i + 1)}: ensaio ${String(esperado[i])}, agora ${String(r.rowCount)}`],
  );
  return partes.length === 0 ? null : partes.join("; ");
}

class QueryIdEmUso extends Error {
  constructor() {
    super("queryId já em uso por outra execução");
  }
}

export class EnsaioService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;
  readonly #query: QueryService;

  constructor({ repository, pools, log, query }: EnsaioServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
    this.#log = log;
    this.#query = query;
  }

  /** Resolve e confere que a escrita existe aqui, para este ator. */
  #alvo(connectionId: string, ator: Ator): EnsaioResult<ResolvedConnection> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch (e) {
      return fail(falhaDoResolve(e));
    }
    if (connection === null) return fail("not_found");
    /*
     * Só Postgres. MySQL/MariaDB têm `ROLLBACK`, mas DDL faz commit implícito e
     * tabela MyISAM ignora a transação: um "ensaio" ali gravaria de verdade e
     * diria que não. Melhor recusar que mentir (ADR 021).
     */
    if (connection.engine !== "postgres") {
      return fail(
        "bad_request",
        `engine_not_supported: o ensaio de escrita só existe no Postgres (${connection.engine})`,
      );
    }
    // `writeEnabled` do `resolve` já é o efetivo: conexão gravável E concessão do ator.
    if (!connection.writeEnabled) return fail("write_forbidden");
    return ok(connection);
  }

  async #executar(
    connection: ResolvedConnection,
    database: string,
    sql: string,
    queryId: string | undefined,
    atorId: string,
    decidir: (outcome: ExecutionOutcome) => boolean,
  ): Promise<ExecutionOutcome> {
    let esquecer = (): void => undefined;
    try {
      return await this.#pools.withWriteDecision(connection, database, async (client) => {
        const registro = this.#query.registrarExecucao(
          queryId,
          (client as unknown as { processID: number }).processID,
          connection,
          database,
          atorId,
        );
        if (registro === null) throw new QueryIdEmUso();
        esquecer = registro;
        let outcome: ExecutionOutcome;
        try {
          outcome = await executarConferido(client, sql, MAX_ROWS);
        } finally {
          // Advisory lock de sessão não é transacional: sobreviveria ao
          // ROLLBACK e voltaria ao pool com o cliente (achado da revisão).
          await client.query("SELECT pg_advisory_unlock_all()").catch(() => undefined);
        }
        return { valor: outcome, commit: outcome.error === null && decidir(outcome) };
      });
    } finally {
      esquecer();
    }
  }

  async ensaiar(
    connectionId: string,
    request: DryRunRequest,
    ator: Ator,
  ): Promise<EnsaioResult<DryRunResponse>> {
    const alvo = this.#alvo(connectionId, ator);
    if (!alvo.ok) return alvo;
    const connection = alvo.value;
    const database = request.database ?? connection.database;
    const inicio = performance.now();

    try {
      // `() => false`: o ensaio NUNCA commita, com ou sem erro.
      const outcome = await this.#executar(connection, database, request.sql, request.queryId, ator.id, () => false);
      const totalDurationMs = Math.round(performance.now() - inicio);
      this.#registrar(connectionId, database, request.sql, ator, outcome, totalDurationMs, true);
      return ok({ results: amostrar(outcome.results), error: outcome.error, totalDurationMs, rolledBack: true });
    } catch (err: unknown) {
      return this.#falhaDeConexao(connectionId, database, request.sql, ator, err, inicio, true);
    }
  }

  async aplicar(
    connectionId: string,
    request: ApplyRequest,
    ator: Ator,
  ): Promise<EnsaioResult<ApplyResponse>> {
    const alvo = this.#alvo(connectionId, ator);
    if (!alvo.ok) return alvo;
    const connection = alvo.value;
    const database = request.database ?? connection.database;

    // Produção pede o nome digitado — anti-acidente, não autorização (ADR 022).
    if (connection.environment === "production" && request.confirmName !== connection.name) {
      return fail("confirmation_required");
    }

    const inicio = performance.now();
    // Objeto, não `let`: o TS não enxerga a atribuição dentro do callback.
    const conferencia: { motivo: string | null } = { motivo: null };
    try {
      const outcome = await this.#executar(connection, database, request.sql, request.queryId, ator.id, (o) => {
        conferencia.motivo = divergencia(request.expectedRowCounts, o.results);
        return conferencia.motivo === null;
      });
      const totalDurationMs = Math.round(performance.now() - inicio);
      const divergiu = conferencia.motivo;

      if (divergiu !== null && outcome.error === null) {
        this.#log.record({
          connectionId,
          database,
          sql: request.sql,
          status: "error",
          error: `dry_run_mismatch: ${divergiu}`,
          rowCount: null,
          durationMs: totalDurationMs,
          readOnly: false,
          actor: atorDoLog(ator),
        });
        return fail("dry_run_mismatch", `nada foi gravado — o resultado mudou desde o ensaio: ${divergiu}`);
      }

      this.#registrar(connectionId, database, request.sql, ator, outcome, totalDurationMs, false);
      return ok({
        results: amostrar(outcome.results),
        error: outcome.error,
        totalDurationMs,
        committed: outcome.error === null,
      });
    } catch (err: unknown) {
      return this.#falhaDeConexao(connectionId, database, request.sql, ator, err, inicio, false);
    }
  }

  #registrar(
    connectionId: string,
    database: string,
    sql: string,
    ator: Ator,
    outcome: ExecutionOutcome,
    durationMs: number,
    dryRun: boolean,
  ): void {
    const cancelada = outcome.error?.code === "57014";
    this.#log.record({
      connectionId,
      database,
      sql,
      status: outcome.error === null ? "ok" : cancelada ? "cancelled" : "error",
      error: outcome.error === null ? null : `${outcome.error.code ?? "?"}: ${outcome.error.message}`,
      rowCount: outcome.error === null ? outcome.results.reduce((s, r) => s + r.rowCount, 0) : null,
      durationMs,
      readOnly: false,
      actor: atorDoLog(ator),
      dryRun,
    });
  }

  #falhaDeConexao<T>(
    connectionId: string,
    database: string,
    sql: string,
    ator: Ator,
    err: unknown,
    inicio: number,
    dryRun: boolean,
  ): EnsaioResult<T> {
    if (err instanceof QueryIdEmUso) return fail("bad_request", err.message);
    const message = err instanceof Error ? err.message : "erro desconhecido";
    this.#log.record({
      connectionId,
      database,
      sql,
      status: "error",
      error: message,
      rowCount: null,
      durationMs: Math.round(performance.now() - inicio),
      readOnly: false,
      actor: atorDoLog(ator),
      dryRun,
    });
    return fail("upstream_error", message);
  }
}
