import type { RowsRequest, RowsResponse } from "@dbee/shared";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { Drivers } from "../driver/registro";
import { RowsError } from "../pg/rows";
import type { SchemaService } from "./schema.service";
import { type ServiceResult, fail, ok } from "./result";


export interface RowsServiceDeps {
  /** Quem sabe falar com cada engine. */
  readonly drivers?: Drivers;
  readonly repository: ConnectionsRepository;
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
  readonly #schema: SchemaService;
  readonly #log: QueryLogRepository;

  readonly #drivers: Drivers | undefined;

  constructor({ repository, schema, log, drivers }: RowsServiceDeps) {
    this.#repository = repository;
    this.#schema = schema;
    this.#drivers = drivers;
    this.#log = log;
  }

  async read(
    connectionId: string,
    schemaName: string,
    tableName: string,
    request: RowsRequest,
    /**
     * Quem executou, para o `query_log` (DBee.md §2.4, §7).
     *
     * Chega como parâmetro vindo da sessão, e **não** tem valor padrão: um padrão
     * aqui seria o caminho por onde uma rota nova grava auditoria anônima sem
     * ninguém notar. Sem sessão a requisição nem chega ao serviço — o guard barra
     * antes.
     */
    ator: Ator,
  ): Promise<ServiceResult<RowsResponse>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    const database = request.database ?? connection.database;

    // A árvore do catálogo é a fonte da verdade sobre o que existe.
    const arvore = await this.#schema.get(connectionId, database, false, ator);
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
      /*
       * O driver da engine monta e executa. O SQL sobe junto porque a auditoria
       * o registra — o `query_log` sem o comando é auditoria pela metade — e
       * ele é montado antes de executar, para a falha também ficar registrada
       * com o comando que teria rodado.
       */
      if (this.#drivers === undefined) return fail("bad_request");
      const { resposta: parcial, sql } = await this.#drivers
        .para(connection.engine)
        .linhas(connection, database, schemaName, relation, request);
      sqlExecutado = sql;

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
        actor: ator.id,
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
        actor: ator.id,
      });

      // Coluna inexistente ou cursor inválido é erro de entrada, não do banco.
      if (err instanceof RowsError) return fail("bad_request", message);
      return fail("upstream_error", message);
    }
  }
}
