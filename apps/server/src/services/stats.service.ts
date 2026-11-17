import type { ColumnStatsRequest, ColumnStatsResponse } from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import { falhaDoResolve } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { RowsError } from "../driver/erros";
import { type Ator, atorDoLog } from "../lib/ator";
import type { PoolManager } from "../pg/pool";
import { STATS_TIMEOUT_MS, columnStats, planStats } from "../pg/stats";
import { type ServiceResult, fail, ok } from "./result";
import type { SchemaService } from "./schema.service";

/**
 * Estatística rápida de coluna. Permissão pelo `resolve`, relação e coluna
 * pelo catálogo, `BEGIN READ ONLY` com timeout de 5 s, registro no
 * `query_log`. Só Postgres no primeiro corte.
 */
export class StatsService {
  constructor(
    private readonly deps: {
      repository: ConnectionsRepository;
      schema: SchemaService;
      pools: PoolManager;
      log: QueryLogRepository;
    },
  ) {}

  async coluna(
    connectionId: string,
    schemaName: string,
    tabela: string,
    req: ColumnStatsRequest,
    ator: Ator,
  ): Promise<ServiceResult<ColumnStatsResponse>> {
    let connection;
    try {
      connection = this.deps.repository.resolve(connectionId, ator);
    } catch (e) {
      return fail(falhaDoResolve(e));
    }
    if (connection === null) return fail("not_found");
    if (connection.engine !== "postgres") {
      return fail("bad_request", `engine_not_supported: estatística de coluna só no Postgres por enquanto (${connection.engine})`);
    }
    const database = req.database ?? connection.database;
    const arvore = await this.deps.schema.get(connectionId, database, false, ator);
    if (!arvore.ok) return arvore;
    const relation = arvore.value.schemas.find((s) => s.name === schemaName)?.relations.find((r) => r.name === tabela);
    if (relation === undefined) return fail("not_found", `${schemaName}.${tabela} não existe neste database`);

    let plano;
    try {
      plano = planStats(relation, schemaName, req.column, req.filters ?? []);
    } catch (e) {
      if (e instanceof RowsError) return fail("bad_request", e.message);
      throw e;
    }

    const inicio = performance.now();
    const registrar = (status: "ok" | "error", error: string | null) =>
      this.deps.log.record({
        connectionId, database, // As três consultas que de fato rodam — auditoria completa, não só a contagem.
        sql: `${plano.contagem};\n${plano.extremos};\n${plano.top};\n-- args: ${JSON.stringify(plano.valores)}`,
        status, error, rowCount: null, durationMs: Math.round(performance.now() - inicio),
        readOnly: true, actor: atorDoLog(ator),
      });
    try {
      const r = await this.deps.pools.withReadOnly(connection, database, (client) => columnStats(client, plano));
      registrar("ok", null);
      return ok({ ...r, durationMs: Math.round(performance.now() - inicio) });
    } catch (e: unknown) {
      const cancelada = (e as { code?: unknown }).code === "57014";
      const message = cancelada
        ? `a estatística passou de ${String(STATS_TIMEOUT_MS / 1000)} s e foi cancelada — filtre a aba antes`
        : e instanceof Error ? e.message : "erro desconhecido";
      registrar("error", message);
      return fail(cancelada ? "bad_request" : "upstream_error", message);
    }
  }
}
