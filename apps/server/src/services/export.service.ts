import {
  CONTENT_TYPE,
  exportFilename,
  splitStatements,
  sqlIdent,
  type ExportBundleRequest,
  type ExportRequest,
  type Relation,
  type RowsRequest,
} from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { streamBundle, type BundleTablePlan } from "../pg/bundle";
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

/** Nome qualificado e citado da tabela: `"public"."pedidos"`. */
function tabelaQualificada(schema: string, table: string): string {
  return `${sqlIdent(schema)}.${sqlIdent(table)}`;
}

/**
 * `CREATE TABLE` de referência para o export `.sql`, montado da introspecção.
 *
 * É **referência, não fidelidade total**: colunas com tipo, nulidade e default,
 * mais a PRIMARY KEY. Fica de fora o que a fronteira (ADR 006) não modela por
 * uma tabela — FKs, índices não-PK, checks, ownership, storage. O arquivo abre
 * a tabela num banco vazio e recebe os INSERTs; não é um `pg_dump`, e o
 * cabeçalho diz isso. `dataType` e `defaultValue` já vêm do Postgres como
 * `format_type`/`pg_get_expr` — expressões SQL válidas, usadas literais.
 */
/**
 * Colunas `serial` voltam da introspecção como o que elas realmente são:
 * `integer NOT NULL DEFAULT nextval('t_id_seq'::regclass)`. Copiar isso para o
 * dump gera um arquivo que **não recarrega** — a sequência não existe no banco
 * vazio, e o `psql` para em `relation "t_id_seq" does not exist`.
 *
 * Escrever `serial` de volta faz o Postgres criar a sequência junto com a
 * tabela. Achado pelo teste que recarrega o dump, não por leitura do código: o
 * arquivo parecia perfeito.
 */
const SERIAL_POR_TIPO: Readonly<Record<string, string>> = {
  smallint: "smallserial",
  integer: "serial",
  bigint: "bigserial",
};

function ehSequenciaPropria(defaultValue: string | null): boolean {
  return defaultValue?.startsWith("nextval(") === true;
}

function montarCreateTable(schema: string, table: string, relation: Relation): string {
  const alvo = tabelaQualificada(schema, table);
  const linhas = relation.columns.map((c) => {
    const serial = ehSequenciaPropria(c.defaultValue) ? SERIAL_POR_TIPO[c.dataType] : undefined;
    if (serial !== undefined) {
      // `serial` já implica NOT NULL e traz o próprio default.
      return `  ${sqlIdent(c.name)} ${serial}`;
    }
    const partes = [`  ${sqlIdent(c.name)} ${c.dataType}`];
    if (!c.nullable) partes.push("NOT NULL");
    if (c.defaultValue !== null) partes.push(`DEFAULT ${c.defaultValue}`);
    return partes.join(" ");
  });

  if (relation.primaryKey.length > 0) {
    const cols = relation.primaryKey.map(sqlIdent).join(", ");
    linhas.push(`  PRIMARY KEY (${cols})`);
  }

  return (
    `-- tabela: ${schema}.${table}\n` +
    `-- gerado pelo DBee — CREATE TABLE de referência (colunas, defaults, PK).\n` +
    `-- FKs, índices, checks e grants ficam de fora; não é um pg_dump.\n` +
    `CREATE TABLE ${alvo} (\n${linhas.join(",\n")}\n);\n`
  );
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
    let sqlTable: string | undefined;
    let sqlPrelude: string | undefined;

    if (request.source.kind === "query") {
      if (request.format === "sql") {
        // Sem tabela de destino, não há para onde os INSERTs irem. A UI só
        // oferece `.sql` na aba Dados; isto barra o caminho por API.
        return fail("bad_request", "exportar como .sql só vale para uma tabela, não uma consulta");
      }
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

      if (request.format === "sql") {
        sqlTable = tabelaQualificada(schemaName, table);
        sqlPrelude = montarCreateTable(schemaName, table, relation);
      }
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
              ...(sqlTable === undefined ? {} : { sqlTable }),
              ...(sqlPrelude === undefined ? {} : { sqlPrelude }),
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
  /**
   * Dump `.sql` de várias tabelas (§5).
   *
   * Um snapshot só (`REPEATABLE READ`) para o arquivo recarregar: tabelas lidas
   * em instantes diferentes podem discordar entre si. O gzip é o
   * `CompressionStream` da plataforma — sem binário externo, o que manteria o
   * recurso fora da fronteira pelo teste 2 do ADR 006.
   */
  async exportBundle(
    connectionId: string,
    request: ExportBundleRequest,
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
    const arvore = await this.#schema.get(connectionId, database, false);
    if (!arvore.ok) return arvore;

    const planos: BundleTablePlan[] = [];
    for (const escolha of request.tables) {
      // Uma tabela sem estrutura nem dados não é erro — é uma linha desmarcada
      // que veio junto. Pular é o que a UI espera.
      if (!escolha.structure && !escolha.data) continue;

      const relation = arvore.value.schemas
        .find((sc) => sc.name === escolha.schema)
        ?.relations.find((r) => r.name === escolha.table);
      if (relation === undefined) {
        return fail("not_found", `${escolha.schema}.${escolha.table} não existe neste database`);
      }

      const qualified = tabelaQualificada(escolha.schema, escolha.table);
      const colunas = relation.columns.map((c) => c.name);
      planos.push({
        schema: escolha.schema,
        table: escolha.table,
        qualified,
        ddl: escolha.structure ? montarCreateTable(escolha.schema, escolha.table, relation) : null,
        // Colunas nomeadas, não `SELECT *`: a ordem do `INSERT` tem que casar
        // com a lista de colunas que o cabeçalho escreveu.
        selectSql: escolha.data
          ? `SELECT ${colunas.map(sqlIdent).join(", ")} FROM ${qualified}`
          : null,
        columns: colunas,
        // A opção é do dump inteiro (como no Adminer), não por tabela.
        dropFirst: request.dropFirst === true && escolha.structure,
      });
    }

    if (planos.length === 0) return fail("bad_request", "nenhuma tabela selecionada");

    const inicio = performance.now();
    const resumo = planos.map((p) => `${p.schema}.${p.table}`).join(", ");
    const sqlDoLog = `-- export de ${String(planos.length)} tabela(s): ${resumo}`;

    try {
      const stream = await this.#pools.withStreamingTransaction(
        connection,
        database,
        (client, encerrar) =>
          Promise.resolve(
            streamBundle(client, planos, (resultado, erro) => {
              this.#log.record({
                connectionId,
                database,
                sql: sqlDoLog,
                status: erro === null ? "ok" : "error",
                error: erro,
                rowCount: resultado.rows,
                durationMs: Math.round(performance.now() - inicio),
                readOnly: true,
                actor,
              });
              encerrar();
            }),
          ),
        "repeatable-read",
      );

      const comprimir = request.gzip === true;
      // O `CompressionStream` da lib da plataforma declara `WritableStream<BufferSource>`;
      // o nosso stream é de `Uint8Array`, que É um BufferSource. A conversão é
      // só de tipagem da borda, não de dado.
      const gzip = new CompressionStream("gzip") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >;
      const nome = exportFilename(`${database}_dump`, "sql");
      return ok({
        stream: comprimir ? stream.pipeThrough(gzip) : stream,
        contentType: comprimir ? "application/gzip" : CONTENT_TYPE.sql,
        filename: comprimir ? `${nome}.gz` : nome,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#log.record({
        connectionId, database, sql: sqlDoLog, status: "error", error: message,
        rowCount: null, durationMs: Math.round(performance.now() - inicio),
        readOnly: true, actor,
      });
      return fail("upstream_error", message);
    }
  }
}
