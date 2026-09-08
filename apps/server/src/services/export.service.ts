import {
  CONTENT_TYPE,
  exportFilename,
  PREVIEW_MAX_BYTES,
  splitStatements,
  sqlIdent,
  type ExportBundleRequest,
  type ExportRequest,
  type Relation,
  type RowsRequest,
} from "@dbee/shared";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { streamBundle, type BundleOptions, type BundleTablePlan } from "../pg/bundle";
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
    ator: Ator,
  ): Promise<ServiceResult<ExportStream>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
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
      const arvore = await this.#schema.get(connectionId, database, false, ator);
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
        actor: ator.id,
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
    ator: Ator,
  ): Promise<ServiceResult<ExportStream>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    const database = request.database ?? connection.database;
    const format = request.format ?? "sql";
    const structure = request.structure ?? "create";
    const dataMode = request.data ?? "insert";
    const output = request.output ?? "download";
    const ehSql = format === "sql";

    const arvore = await this.#schema.get(connectionId, database, false, ator);
    if (!arvore.ok) return arvore;

    const planos: BundleTablePlan[] = [];
    const schemasUsados = new Set<string>();

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

      schemasUsados.add(escolha.schema);
      const qualified = tabelaQualificada(escolha.schema, escolha.table);
      const colunas = relation.columns.map((c) => c.name);

      // Estrutura só faz sentido em SQL: um CSV não carrega DDL.
      const querEstrutura = ehSql && escolha.structure && structure !== "none";
      const querDados = escolha.data && dataMode !== "none";

      planos.push({
        schema: escolha.schema,
        table: escolha.table,
        qualified,
        ddl: querEstrutura ? montarCreateTable(escolha.schema, escolha.table, relation) : null,
        extras: querEstrutura
          ? await this.#extrasDaTabela(connection, database, escolha.schema, escolha.table, request)
          : [],
        // Colunas nomeadas, não `SELECT *`: a ordem das linhas tem que casar
        // com a lista de colunas do cabeçalho.
        selectSql: querDados
          ? `SELECT ${colunas.map(sqlIdent).join(", ")} FROM ${qualified}`
          : null,
        columns: colunas,
        dropFirst: structure === "drop-create" && querEstrutura,
      });
    }

    if (planos.length === 0) return fail("bad_request", "nenhuma tabela selecionada");

    const routines =
      ehSql && request.routines === true
        ? await this.#rotinas(connection, database, [...schemasUsados])
        : [];

    const opcoes: BundleOptions = { format, data: ehSql ? dataMode : "none", routines };

    const inicio = performance.now();
    const resumo = planos.map((p) => `${p.schema}.${p.table}`).join(", ");
    const sqlDoLog = `-- export ${format} de ${String(planos.length)} tabela(s): ${resumo}`;

    try {
      const stream = await this.#pools.withStreamingTransaction(
        connection,
        database,
        (client, encerrar) =>
          Promise.resolve(
            streamBundle(client, planos, opcoes, (resultado, erro) => {
              this.#log.record({
                connectionId,
                database,
                sql: sqlDoLog,
                status: erro === null ? "ok" : "error",
                error: erro,
                rowCount: resultado.rows,
                durationMs: Math.round(performance.now() - inicio),
                readOnly: true,
                actor: ator.id,
              });
              encerrar();
            }),
          ),
        "repeatable-read",
      );

      return ok(this.#embrulhar(stream, database, format, output));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#log.record({
        connectionId, database, sql: sqlDoLog, status: "error", error: message,
        rowCount: null, durationMs: Math.round(performance.now() - inicio),
        readOnly: true, actor: ator.id,
      });
      return fail("upstream_error", message);
    }
  }

  /**
   * Decide o invólucro do stream: arquivo, arquivo comprimido, ou prévia.
   *
   * A prévia é cortada em `PREVIEW_MAX_BYTES`. O ponto dela é conferir o começo
   * do arquivo antes de gerar um de 2 GB — mandar o dump inteiro para a aba
   * derrubaria o navegador, que é o oposto do que ela existe para evitar.
   */
  #embrulhar(
    stream: ReadableStream<Uint8Array>,
    database: string,
    format: ExportBundleRequest["format"] & string,
    output: NonNullable<ExportBundleRequest["output"]>,
  ): ExportStream {
    const ehSql = format === "sql";
    const base = `${database}_dump`;
    const extensao = ehSql ? "sql" : "zip";
    const nome = `${exportFilename(base, "sql").replace(/\.sql$/, "")}.${extensao}`;

    if (output === "preview") {
      return {
        stream: cortar(stream, PREVIEW_MAX_BYTES),
        // Prévia é para LER na tela: texto puro, mesmo quando o conteúdo é SQL.
        // `application/sql` faria o navegador oferecer download de novo.
        contentType: "text/plain; charset=utf-8",
        filename: nome,
      };
    }

    if (output === "gzip") {
      // O `CompressionStream` da plataforma declara `WritableStream<BufferSource>`;
      // o nosso stream é de `Uint8Array`, que É um BufferSource. Conversão de
      // borda de tipagem, não de dado.
      const gzip = new CompressionStream("gzip") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >;
      return {
        stream: stream.pipeThrough(gzip),
        contentType: "application/gzip",
        filename: `${nome}.gz`,
      };
    }

    return {
      stream,
      contentType: ehSql ? CONTENT_TYPE.sql : "application/zip",
      filename: nome,
    };
  }

  /**
   * Índices (fora a PK, que já está no CREATE) e triggers da tabela.
   *
   * `pg_get_indexdef`/`pg_get_triggerdef` devolvem o comando pronto — é o mesmo
   * que o `pg_dump` usa, e é SELECT em catálogo, dentro da fronteira (ADR 006).
   */
  async #extrasDaTabela(
    connection: ResolvedConnection,
    database: string,
    schema: string,
    table: string,
    request: ExportBundleRequest,
  ): Promise<string[]> {
    if (request.indexes !== true && request.triggers !== true) return [];

    return await this.#pools.withTransaction(connection, database, true, async (client) => {
      const saida: string[] = [];

      if (request.indexes === true) {
        const r = await client.query<{ def: string }>(
          `SELECT pg_get_indexdef(i.indexrelid) AS def
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2 AND NOT i.indisprimary
            ORDER BY 1`,
          [schema, table],
        );
        saida.push(...r.rows.map((row) => row.def));
      }

      if (request.triggers === true) {
        const r = await client.query<{ def: string }>(
          `SELECT pg_get_triggerdef(t.oid) AS def
             FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal
            ORDER BY 1`,
          [schema, table],
        );
        saida.push(...r.rows.map((row) => row.def));
      }

      return saida;
    });
  }

  /** Funções e procedures dos schemas envolvidos. */
  async #rotinas(
    connection: ResolvedConnection,
    database: string,
    schemas: readonly string[],
  ): Promise<string[]> {
    if (schemas.length === 0) return [];
    return await this.#pools.withTransaction(connection, database, true, async (client) => {
      const r = await client.query<{ def: string }>(
        `SELECT pg_get_functiondef(p.oid) AS def
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = ANY($1)
            AND p.prokind IN ('f', 'p')
          ORDER BY p.proname`,
        [schemas],
      );
      return r.rows.map((row) => row.def);
    });
  }
}

/**
 * Corta o stream em N bytes.
 *
 * Cancela a origem ao atingir o teto — é o que solta a transação do outro lado
 * em vez de deixá-la percorrendo uma tabela cujo resultado ninguém vai ler.
 */
function cortar(origem: ReadableStream<Uint8Array>, teto: number): ReadableStream<Uint8Array> {
  const leitor = origem.getReader();
  let enviados = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (enviados >= teto) {
        await leitor.cancel();
        controller.close();
        return;
      }
      const { done, value } = await leitor.read();
      if (done) {
        controller.close();
        return;
      }
      const resta = teto - enviados;
      const pedaco = value.length > resta ? value.subarray(0, resta) : value;
      enviados += pedaco.length;
      controller.enqueue(pedaco);
    },
    async cancel() {
      await leitor.cancel();
    },
  });
}
