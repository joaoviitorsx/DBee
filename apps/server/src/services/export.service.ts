import {
  exportFilename,
  splitStatements,
  type ExportRequest,
  type RowsRequest,
} from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { streamExport } from "../pg/exporter";
import type { PoolManager } from "../pg/pool";
import { RowsError, planRows } from "../pg/rows";
import type { SchemaService } from "./schema.service";
import { type ServiceResult, fail, ok } from "./result";


export interface ExportServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly schema: SchemaService;
  readonly log: QueryLogRepository;
}

export interface ExportStream {
  readonly stream: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly filename: string;
}

/**
 * Export em stream.
 *
 * A transação vive **enquanto o stream vive**: o cursor só existe dentro dela.
 * Por isso o cliente do pool não é devolvido no fim da função, e sim quando o
 * stream fecha ou é cancelado — é a única forma de manter um cursor aberto
 * entre lotes.
 */
export class ExportService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #schema: SchemaService;
  readonly #log: QueryLogRepository;

  constructor({ repository, pools, schema, log }: ExportServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
    this.#schema = schema;
    this.#log = log;
  }

  async export(
    connectionId: string,
    request: ExportRequest,
    /**
     * Quem executou, para o `query_log` (DBee.md §2.4, §7).
     *
     * Chega como parâmetro vindo da sessão, e **não** tem valor padrão: um padrão
     * aqui seria o caminho por onde uma rota nova grava auditoria anônima sem
     * ninguém notar. Sem sessão a requisição nem chega ao serviço — o guard barra
     * antes.
     */
    actor: string,
  ): Promise<ServiceResult<ExportStream>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    const database = request.database ?? connection.database;

    // Monta o SQL: ou o do usuário, ou o da relação com os mesmos filtros da
    // aba Dados — a mesma rota serve os dois.
    let sql: string;
    let values: readonly (string | null)[] = [];
    let base: string;

    if (request.source.kind === "query") {
      const statements = splitStatements(request.source.sql);
      if (statements.length === 0) return fail("bad_request", "não há SQL para exportar");
      if (statements.length > 1) {
        // Exportar vários statements produziria vários formatos concatenados
        // num arquivo só, o que nenhum leitor entende.
        return fail("bad_request", "exporte um statement por vez");
      }
      sql = statements[0]?.sql ?? "";
      base = "consulta";
    } else {
      const arvore = await this.#schema.get(connectionId, database, false);
      if (!arvore.ok) return arvore;

      const { schema: schemaName, table } = request.source;
      const relation = arvore.value.schemas
        .find((s) => s.name === schemaName)
        ?.relations.find((r) => r.name === table);

      if (relation === undefined) {
        return fail("not_found", `${schemaName}.${table} não existe neste database`);
      }

      // Sem `limit` no plano: o teto do export é aplicado contando as linhas
      // entregues, não com LIMIT no SQL.
      const pedido: RowsRequest = {
        ...(request.source.orderBy === undefined ? {} : { orderBy: request.source.orderBy }),
        ...(request.source.orderDirection === undefined
          ? {}
          : { orderDirection: request.source.orderDirection }),
        ...(request.source.filters === undefined ? {} : { filters: request.source.filters }),
        limit: 1_000_000_000,
      };

      try {
        const plano = planRows(relation, schemaName, pedido);
        // O `LIMIT` do plano de linhas não serve aqui: o cursor entrega tudo.
        sql = plano.sql.replace(/\nLIMIT \d+$/, "");
        values = plano.valores;
      } catch (err: unknown) {
        if (err instanceof RowsError) return fail("bad_request", err.message);
        throw err;
      }

      base = `${schemaName}.${table}`;
    }

    const inicio = performance.now();
    const registrar = (rows: number | null, erro: string | null): void => {
      this.#log.record({
        connectionId,
        database,
        sql,
        status: erro === null ? "ok" : "error",
        error: erro,
        rowCount: rows,
        durationMs: Math.round(performance.now() - inicio),
        readOnly: true,
        actor,
      });
    };

    try {
      const { stream, contentType } = await this.#pools.withStreamingTransaction(
        connection,
        database,
        (client, encerrar) =>
          streamExport(
            client,
            {
              sql,
              format: request.format,
              csv: request.csv,
              maxRows: request.maxRows,
              values,
            },
            (outcome, erro) => {
              registrar(outcome.rows, erro);
              encerrar();
            },
          ),
      );

      return ok({ stream, contentType, filename: exportFilename(base, request.format) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      registrar(null, message);
      return fail("upstream_error", message);
    }
  }
}
