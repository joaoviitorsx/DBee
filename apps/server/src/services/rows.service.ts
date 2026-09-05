import type { RowsRequest, RowsResponse } from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { PoolManager } from "../pg/pool";
import { RowsError, fetchRows, planRows } from "../pg/rows";
import type { SchemaService } from "./schema.service";
import { type ServiceResult, fail, ok } from "./result";

const ACTOR = "unauthenticated";

export interface RowsServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly schema: SchemaService;
  readonly log: QueryLogRepository;
}

/**
 * Leitura de linhas de uma relação.
 *
 * A relação e as colunas vêm do **catálogo já introspectado**, não da
 * requisição: é isso que torna seguro montar `ORDER BY` e `WHERE` com nome de
 * coluna, que não é parametrizável em SQL.
 *
 * Roda em `BEGIN READ ONLY` com o mesmo TimeZone e `statement_timeout` da
 * conexão, e grava no `query_log` como qualquer execução — "abrir a tabela e
 * olhar" é leitura de dado de cliente e entra na auditoria igual (§2.4).
 */
export class RowsService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #schema: SchemaService;
  readonly #log: QueryLogRepository;

  constructor({ repository, pools, schema, log }: RowsServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
    this.#schema = schema;
    this.#log = log;
  }

  async read(
    connectionId: string,
    schemaName: string,
    tableName: string,
    request: RowsRequest,
  ): Promise<ServiceResult<RowsResponse>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    const database = request.database ?? connection.database;

    // A árvore do catálogo é a fonte da verdade sobre o que existe.
    const arvore = await this.#schema.get(connectionId, database, false);
    if (!arvore.ok) return arvore;

    const relation = arvore.value.schemas
      .find((s) => s.name === schemaName)
      ?.relations.find((r) => r.name === tableName);

    if (relation === undefined) {
      return fail("not_found", `${schemaName}.${tableName} não existe neste database`);
    }

    const inicio = performance.now();
    let sqlExecutado = "";

    try {
      sqlExecutado = planRows(relation, schemaName, request).sql;

      const parcial = await this.#pools.withTransaction(connection, database, true, (client) =>
        fetchRows(client, relation, schemaName, request),
      );

      const durationMs = Math.round(performance.now() - inicio);
      this.#log.record({
        connectionId,
        database,
        sql: sqlExecutado,
        status: "ok",
        error: null,
        rowCount: parcial.rows.length,
        durationMs,
        readOnly: true,
        actor: ACTOR,
      });

      return ok({ ...parcial, durationMs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";

      this.#log.record({
        connectionId,
        database,
        sql: sqlExecutado === "" ? `${schemaName}.${tableName}` : sqlExecutado,
        status: "error",
        error: message,
        rowCount: null,
        durationMs: Math.round(performance.now() - inicio),
        readOnly: true,
        actor: ACTOR,
      });

      // Coluna inexistente ou cursor inválido é erro de entrada, não do banco.
      if (err instanceof RowsError) return fail("bad_request", message);
      return fail("upstream_error", message);
    }
  }
}
