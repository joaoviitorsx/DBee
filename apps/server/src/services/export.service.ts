import {
  CONTENT_TYPE,
  EXPORT_BATCH,
  exportFilename,
  PREVIEW_MAX_BYTES,
  splitStatements,
  sqlIdent,
  type DialetoSql,
  type ExportBundleRequest,
  type ExportRequest,
  type Relation,
  type RowCursor,
  type RowsRequest,
} from "@dbee/shared";

import { dialetoDe } from "@dbee/shared/puro";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import type { Drivers } from "../driver/registro";
import { citarIdent, exportarEmStream, type PaginaExport } from "../driver/exportador";
import {
  streamBundleDriver,
  type BundleOpcoesDriver,
  type BundleTablePlanoDriver,
} from "../driver/bundle";
import type { DriverLeitura } from "../driver/tipos";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { streamBundle, type BundleOptions, type BundleTablePlan } from "../pg/bundle";
import { streamExport } from "../pg/exporter";
import type { PoolManager } from "../pg/pool";
import { RowsError, planRows } from "../pg/rows";
import type { SchemaService } from "./schema.service";
import { exigirExportacao } from "./engine.guarda";
import { type ServiceResult, fail, ok } from "./result";


export interface ExportServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly schema: SchemaService;
  readonly log: QueryLogRepository;
  readonly drivers: Drivers;
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
 * `CREATE TABLE` de referência para as engines não-Postgres.
 *
 * Genérico e honesto sobre o que é: colunas com o tipo **nativo** que a
 * introspecção daquela engine devolveu (tipo do MySQL, do SQLite), nulidade e a
 * PRIMARY KEY. Fica de fora o que a fronteira não modela por tabela — FKs,
 * índices, checks. O identificador é citado pelo dialeto (crase no MySQL, aspas
 * duplas no SQLite/libSQL). Não há o caso `serial` do Postgres: as outras
 * engines carregam o auto-incremento no próprio tipo.
 *
 * ## O DEFAULT só entra no SQLite
 *
 * No SQLite o `PRAGMA table_info` devolve o default **como literal SQL já
 * citado** (`'BR'`, `0`, `CURRENT_TIMESTAMP`): dá para reemitir cru e recarrega.
 * No MySQL o `information_schema` devolve o default de string **sem aspas**
 * (`BR`, não `'BR'` — medido em `mysql/introspect-completo`), e `DEFAULT BR`
 * lê `BR` como identificador: o arquivo **não recarrega**. Como não há um único
 * formato que sirva para os dois, e este CREATE TABLE é referência e não
 * fidelidade total, o default é omitido no MySQL em vez de sair inválido.
 */
function montarCreateTableGenerico(alvo: string, relation: Relation, dialeto: DialetoSql): string {
  const linhas = relation.columns.map((c) => {
    const partes = [`  ${citarIdent(c.name, dialeto)} ${c.dataType}`];
    if (!c.nullable) partes.push("NOT NULL");
    // Só o SQLite devolve o default como literal já citado (ver doc acima).
    if (c.defaultValue !== null && dialeto === "sqlite") partes.push(`DEFAULT ${c.defaultValue}`);
    return partes.join(" ");
  });

  if (relation.primaryKey.length > 0) {
    const cols = relation.primaryKey.map((n) => citarIdent(n, dialeto)).join(", ");
    linhas.push(`  PRIMARY KEY (${cols})`);
  }

  return (
    `-- tabela: ${relation.name}\n` +
    `-- gerado pelo DBee — CREATE TABLE de referência (colunas, defaults, PK).\n` +
    `-- FKs, índices e checks ficam de fora.\n` +
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
  readonly #drivers: Drivers;

  constructor({ repository, pools, schema, log, drivers }: ExportServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
    this.#schema = schema;
    this.#log = log;
    this.#drivers = drivers;
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

    /*
     * Exportação existe em todas as engines SQL; só o Mongo e o Redis a
     * recusam (o documento e a chave não viram linha de tabela sem inventar um
     * formato). A guarda lê a capacidade, não a engine.
     */
    const semSuporte = exigirExportacao<ExportStream>(connection.engine);
    if (semSuporte !== null) return semSuporte;

    /*
     * As engines que não são o Postgres não têm o cursor do `pg` (regra 7):
     * exportam pela grade de keyset do driver, no caminho próprio abaixo. O
     * Postgres segue pelo `DECLARE CURSOR` + `FETCH` que é a razão desta rota.
     */
    if (connection.engine !== "postgres") {
      return await this.#exportDriver(connectionId, connection, request, ator);
    }

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
   * Exportação das engines SQL que não são o Postgres (MySQL, MariaDB, libSQL,
   * SQLite).
   *
   * Sem o cursor do `pg`: a origem **tabela** pagina pela grade de keyset do
   * driver (`linhas`), uma página de cada vez; a origem **consulta** roda o
   * `executar` uma vez (limitado por `maxRows`, como qualquer consulta nessas
   * engines). O formato `.sql` cita o identificador pelo dialeto da engine.
   */
  async #exportDriver(
    connectionId: string,
    connection: ResolvedConnection,
    request: ExportRequest,
    ator: Ator,
  ): Promise<ServiceResult<ExportStream>> {
    const database = request.database ?? connection.database;
    const driver = this.#drivers.para(connection.engine);
    const dialeto = dialetoDe(connection.engine);

    let base: string;
    // Mutável: o produtor tabela o reescreve com o SELECT real (com
    // placeholders) assim que a primeira página volta — sem isso o log grava só
    // um comentário e "exportou a tabela inteira" fica indistinguível de
    // "exportou só as linhas de um CNPJ". O Postgres já registra o SELECT real;
    // este é o mesmo registro para as outras engines.
    let sqlAuditado: string;
    let sqlTabela: string | undefined;
    let sqlPrelude: string | undefined;
    let proximaPagina: () => Promise<PaginaExport | null>;

    if (request.source.kind === "query") {
      if (request.format === "sql") {
        return fail("bad_request", "exportar como .sql só vale para uma tabela, não uma consulta");
      }
      const statements = splitStatements(request.source.sql, dialeto);
      if (statements.length === 0) return fail("bad_request", "não há SQL para exportar");
      if (statements.length > 1) return fail("bad_request", "exporte um statement por vez");
      const sql = statements[0]?.sql ?? "";
      base = "consulta";
      sqlAuditado = sql;
      proximaPagina = this.#produtorConsulta(driver, connection, database, sql, request.maxRows);
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

      base = `${schemaName}.${table}`;
      // Comentário só como fallback; o produtor o substitui pelo SELECT real.
      sqlAuditado = `-- export ${request.format} de ${base}`;
      if (request.format === "sql") {
        // Nestas engines a tabela é qualificada pela conexão (banco/arquivo), não
        // por schema: o destino do INSERT é só o nome citado pelo dialeto.
        sqlTabela = citarIdent(table, dialeto);
        sqlPrelude = montarCreateTableGenerico(sqlTabela, relation, dialeto);
      }
      proximaPagina = this.#produtorTabela(
        driver,
        connection,
        database,
        schemaName,
        relation,
        request.source,
        request.maxRows,
        (sql) => { sqlAuditado = sql; },
      );
    }

    const inicio = performance.now();
    const { stream, contentType } = exportarEmStream(
      {
        format: request.format,
        csv: request.csv,
        dialeto,
        ...(sqlTabela === undefined ? {} : { sqlTabela }),
        ...(sqlPrelude === undefined ? {} : { sqlPrelude }),
        proximaPagina,
      },
      (resultado, erro) => {
        this.#log.record({
          connectionId,
          database,
          sql: sqlAuditado,
          status: erro === null ? "ok" : "error",
          error: erro,
          rowCount: resultado.rows,
          durationMs: Math.round(performance.now() - inicio),
          readOnly: true,
          actor: ator.id,
        });
      },
    );

    return ok({ stream, contentType, filename: exportFilename(base, request.format) });
  }

  /**
   * Produtor de páginas da origem **tabela**: pagina pela grade do driver.
   *
   * Com chave primária, avança por keyset (cursor opaco devolvido pela página
   * anterior). Sem PK a grade cai para `OFFSET` — o mesmo caminho degradado que
   * a aba Dados já usa e avisa; aqui o laço acompanha o `keyset: false` da
   * resposta e passa a contar por offset. O teto `maxRows` é aplicado contando
   * as linhas entregues, nunca com `LIMIT` injetado no SQL do usuário.
   *
   * ## Ordem estável no caminho sem PK
   *
   * `OFFSET` sobre um resultado sem `ORDER BY` pode pular ou repetir linha entre
   * páginas — inofensivo na grade (uma página por vez), mas um export costura
   * milhares de linhas num arquivo só que a pessoa vai confiar. Por isso, numa
   * tabela sem PK e sem ordenação pedida, o export ordena pela **primeira
   * coluna** para dar uma ordem determinística. Não é total (valores repetidos
   * na primeira coluna ainda podem reordenar), mas é muito melhor que nenhuma, e
   * a aba Dados continua avisando que sem PK a ordem não é garantida.
   *
   * `aoLerSql` recebe o SELECT real (com placeholders) da primeira página, para
   * a auditoria registrar o que de fato rodou — filtros e tudo.
   */
  #produtorTabela(
    driver: DriverLeitura,
    connection: ResolvedConnection,
    database: string,
    schema: string,
    relation: Relation,
    source: Extract<ExportRequest["source"], { kind: "table" }>,
    maxRows: number | undefined,
    aoLerSql: (sql: string) => void,
  ): () => Promise<PaginaExport | null> {
    let cursor: RowCursor | undefined;
    let offset = 0;
    let semKeyset = false;
    let entregues = 0;
    let acabou = false;
    let primeira = true;

    // Sem PK e sem ordenação pedida: ordena pela primeira coluna (ver doc).
    const ordemPadrao =
      relation.primaryKey.length === 0 && source.orderBy === undefined
        ? relation.columns[0]?.name
        : undefined;
    const orderBy = source.orderBy ?? ordemPadrao;

    return async () => {
      if (acabou) return null;
      const restante =
        maxRows === undefined ? EXPORT_BATCH : Math.min(EXPORT_BATCH, maxRows - entregues);
      if (restante <= 0) {
        acabou = true;
        return null;
      }

      const pedido: RowsRequest = {
        ...(orderBy === undefined ? {} : { orderBy }),
        ...(source.orderDirection === undefined ? {} : { orderDirection: source.orderDirection }),
        ...(source.filters === undefined ? {} : { filters: source.filters }),
        ...(semKeyset ? { offset } : cursor === undefined ? {} : { after: cursor }),
        limit: restante,
      };

      const r = await driver.linhas(connection, database, schema, relation, pedido);
      if (primeira) {
        primeira = false;
        aoLerSql(r.sql);
      }
      // Apara um eventual excesso do driver sobre o `limit` pedido (defesa em
      // profundidade: os drivers respeitam o limite, mas o teto `maxRows` não
      // pode depender disso).
      const rows = r.resposta.rows.length > restante
        ? r.resposta.rows.slice(0, restante)
        : r.resposta.rows;
      entregues += rows.length;
      offset += rows.length;

      if (!r.resposta.keyset) {
        // Sem PK: página parcial (ou vazia) é o fim.
        semKeyset = true;
        if (r.resposta.rows.length < restante) acabou = true;
      } else if (r.resposta.nextCursor === null || !r.resposta.hasMore) {
        acabou = true;
      } else {
        cursor = r.resposta.nextCursor;
      }

      return { columns: r.resposta.columns.map((c) => c.name), rows };
    };
  }

  /**
   * Produtor de páginas da origem **consulta**: uma página só.
   *
   * Estas engines não têm cursor de servidor — o `executar` materializa o
   * resultado (limitado por `maxRows`, como qualquer consulta delas). A
   * formatação continua em stream, mas a leitura é de uma vez.
   */
  #produtorConsulta(
    driver: DriverLeitura,
    connection: ResolvedConnection,
    database: string,
    sql: string,
    maxRows: number | undefined,
  ): () => Promise<PaginaExport | null> {
    let feito = false;
    return async () => {
      if (feito) return null;
      feito = true;
      const r = await driver.executar(connection, {
        sql,
        database,
        maxRows: maxRows ?? 1_000_000_000,
        somenteLeitura: true,
      });
      if (r.error !== null) throw new Error(r.error.message);
      const primeiro = r.results[0];
      if (primeiro === undefined) return { columns: [], rows: [] };
      return { columns: primeiro.columns.map((c) => c.name), rows: primeiro.rows };
    };
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

    /*
     * O dump existe em todas as engines SQL; só o Mongo e o Redis o recusam
     * (o documento e a chave não viram linha de tabela). A guarda lê a
     * capacidade, não a engine — a mesma que o export de uma tabela usa.
     */
    const semSuporte = exigirExportacao<ExportStream>(connection.engine);
    if (semSuporte !== null) return semSuporte;

    /*
     * As engines que não são o Postgres não têm o cursor do `pg` nem a
     * transação `REPEATABLE READ` que dá ao dump do Postgres o instante único
     * (regra 7). Elas paginam pela grade de keyset do driver, no caminho
     * próprio abaixo — que também emite o `CREATE TABLE` no dialeto delas e
     * registra, no cabeçalho, que as tabelas não vêm de um instante único.
     */
    if (connection.engine !== "postgres") {
      return await this.#exportBundleDriver(connectionId, connection, request, ator);
    }

    const database = request.database ?? connection.database;
    const format = request.format ?? "sql";
    const structure = request.structure ?? "create";
    const dataMode = request.data ?? "insert";
    const output = request.output ?? "download";
    const ehSql = format === "sql";

    const arvore = await this.#schema.get(connectionId, database, false, ator);
    if (!arvore.ok) return arvore;

    /*
     * Duas passadas, e não uma.
     *
     * A montagem era um laço só, com `await #extrasDaTabela(...)` DENTRO dele —
     * uma transação por tabela, cada uma pegando e devolvendo um lease do pool.
     * Com 60 tabelas e índices+triggers ligados eram 240 idas ao banco
     * (BEGIN + 2 consultas + COMMIT, sessenta vezes). Medido contra Postgres
     * real em loopback: 86,6 ms; numa conexão remota, que é o caso de uso, o
     * custo é o número de idas, não o trabalho.
     *
     * Agora: a primeira passada valida e junta os alvos, uma única transação
     * busca os extras de TODAS as tabelas, e a segunda passada monta os planos.
     * Quatro idas ao banco, independentemente do número de tabelas.
     */
    // O valor já verificado, num const: dentro de uma função aninhada o
    // estreitamento do `arvore.ok` acima não vale.
    const schemasDaArvore = arvore.value.schemas;
    type Relation = (typeof schemasDaArvore)[number]["relations"][number];

    const acharRelation = (schema: string, table: string): Relation | undefined =>
      schemasDaArvore.find((sc) => sc.name === schema)?.relations.find((r) => r.name === table);

    interface Escolhido {
      readonly escolha: (typeof request.tables)[number];
      readonly relation: Relation;
      readonly qualified: string;
      readonly colunas: string[];
      readonly querEstrutura: boolean;
      readonly querDados: boolean;
    }

    const escolhidos: Escolhido[] = [];
    const schemasUsados = new Set<string>();

    for (const escolha of request.tables) {
      // Uma tabela sem estrutura nem dados não é erro — é uma linha desmarcada
      // que veio junto. Pular é o que a UI espera.
      if (!escolha.structure && !escolha.data) continue;

      const relation = acharRelation(escolha.schema, escolha.table);
      if (relation === undefined) {
        return fail("not_found", `${escolha.schema}.${escolha.table} não existe neste database`);
      }

      schemasUsados.add(escolha.schema);
      escolhidos.push({
        escolha,
        relation,
        qualified: tabelaQualificada(escolha.schema, escolha.table),
        colunas: relation.columns.map((c) => c.name),
        // Estrutura só faz sentido em SQL: um CSV não carrega DDL.
        querEstrutura: ehSql && escolha.structure && structure !== "none",
        querDados: escolha.data && dataMode !== "none",
      });
    }

    const extras = await this.#extrasDasTabelas(
      connection,
      database,
      escolhidos.filter((e) => e.querEstrutura).map((e) => e.escolha),
      request,
    );

    const planos: BundleTablePlan[] = escolhidos.map((e) => ({
      schema: e.escolha.schema,
      table: e.escolha.table,
      qualified: e.qualified,
      ddl: e.querEstrutura
        ? montarCreateTable(e.escolha.schema, e.escolha.table, e.relation)
        : null,
      extras: e.querEstrutura
        ? (extras.get(chaveDeTabela(e.escolha.schema, e.escolha.table)) ?? [])
        : [],
      // Colunas nomeadas, não `SELECT *`: a ordem das linhas tem que casar
      // com a lista de colunas do cabeçalho.
      selectSql: e.querDados
        ? `SELECT ${e.colunas.map(sqlIdent).join(", ")} FROM ${e.qualified}`
        : null,
      columns: e.colunas,
      dropFirst: structure === "drop-create" && e.querEstrutura,
    }));

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
   * Dump de várias tabelas nas engines SQL que não são o Postgres (MySQL,
   * MariaDB, libSQL, SQLite).
   *
   * Ramifica de `exportBundle` como `#exportDriver` ramifica de `export()`, e
   * pela mesma razão: sem o cursor do `pg` e sem a transação `REPEATABLE READ`,
   * cada tabela pagina pela grade de keyset do driver (`#produtorTabela`) e o
   * laço genérico (`streamBundleDriver`) costura as páginas num stream só.
   *
   * ## O que este caminho NÃO tem, e por quê
   *
   * - **Sem snapshot único entre tabelas.** Não há a transação que dá ao
   *   Postgres o instante compartilhado; as tabelas podem refletir instantes
   *   ligeiramente diferentes. Aceitável e honesto — o cabeçalho do `.sql` diz.
   * - **Sem índices, triggers nem rotinas.** São `pg_get_*` do catálogo do
   *   Postgres. As opções `indexes`/`triggers`/`routines` são **ignoradas** aqui
   *   em vez de recusadas: uma linha desmarcada da UI que veio ligada não é erro.
   * - **Sem `COPY` nem `ON CONFLICT`.** O `COPY … FROM stdin` é do Postgres e o
   *   `ON CONFLICT` diverge de dialeto entre estas engines; os dados saem sempre
   *   como `INSERT` simples, o mesmo do export de uma tabela. `data: "none"`
   *   ainda desliga os dados.
   *
   * O que cobre: `CREATE TABLE` de referência no dialeto da engine (via
   * `montarCreateTableGenerico`, com o identificador citado por `citarIdent`) +
   * os `INSERT`s. Os formatos não-`.sql` saem como um arquivo por tabela num
   * `.zip`, o mesmo container do Postgres.
   */
  async #exportBundleDriver(
    connectionId: string,
    connection: ResolvedConnection,
    request: ExportBundleRequest,
    ator: Ator,
  ): Promise<ServiceResult<ExportStream>> {
    const database = request.database ?? connection.database;
    const format = request.format ?? "sql";
    const structure = request.structure ?? "create";
    const dataMode = request.data ?? "insert";
    const output = request.output ?? "download";
    const ehSql = format === "sql";
    const dialeto = dialetoDe(connection.engine);
    const driver = this.#drivers.para(connection.engine);

    const arvore = await this.#schema.get(connectionId, database, false, ator);
    if (!arvore.ok) return arvore;

    const schemasDaArvore = arvore.value.schemas;
    type Rel = (typeof schemasDaArvore)[number]["relations"][number];
    const acharRelation = (schema: string, table: string): Rel | undefined =>
      schemasDaArvore.find((sc) => sc.name === schema)?.relations.find((r) => r.name === table);

    const planos: BundleTablePlanoDriver[] = [];
    for (const escolha of request.tables) {
      // Uma tabela sem estrutura nem dados é uma linha desmarcada que veio
      // junto, não um erro — pular é o que a UI espera.
      if (!escolha.structure && !escolha.data) continue;

      const relation = acharRelation(escolha.schema, escolha.table);
      if (relation === undefined) {
        return fail("not_found", `${escolha.schema}.${escolha.table} não existe neste database`);
      }

      // Estrutura só faz sentido em SQL: um CSV não carrega DDL.
      const querEstrutura = ehSql && escolha.structure && structure !== "none";
      const querDados = escolha.data && dataMode !== "none";
      // Nestas engines a tabela é qualificada pela conexão (banco/arquivo), não
      // por schema: o destino do INSERT é só o nome citado pelo dialeto.
      const qualified = citarIdent(escolha.table, dialeto);

      planos.push({
        schema: escolha.schema,
        table: escolha.table,
        qualified,
        ddl: querEstrutura ? montarCreateTableGenerico(qualified, relation, dialeto) : null,
        columns: relation.columns.map((c) => c.name),
        dropFirst: structure === "drop-create" && querEstrutura,
        proximaPagina: querDados
          ? this.#produtorTabela(
              driver,
              connection,
              database,
              escolha.schema,
              relation,
              { kind: "table", schema: escolha.schema, table: escolha.table },
              // Sem teto: o dump traz a tabela inteira.
              undefined,
              // A auditoria do bundle registra a lista de tabelas, não o SELECT
              // de cada uma — o produtor não precisa reportar o SQL aqui.
              () => {
                /* sem auditoria por tabela no bundle */
              },
            )
          : null,
      });
    }

    if (planos.length === 0) return fail("bad_request", "nenhuma tabela selecionada");

    const opcoes: BundleOpcoesDriver = { format, dialeto };

    const inicio = performance.now();
    const resumo = planos.map((p) => `${p.schema}.${p.table}`).join(", ");
    const sqlDoLog = `-- export ${format} de ${String(planos.length)} tabela(s): ${resumo}`;

    // Sem `withStreamingTransaction`: os drivers devolvem a conexão ao pool a
    // cada página, então não há transação a manter viva enquanto o stream vive.
    const stream = streamBundleDriver(planos, opcoes, (resultado, erro) => {
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
    });

    return ok(this.#embrulhar(stream, database, format, output));
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
   * Índices (fora a PK, que já está no CREATE) e triggers de TODAS as tabelas
   * escolhidas, numa transação só.
   *
   * `pg_get_indexdef`/`pg_get_triggerdef` devolvem o comando pronto — é o mesmo
   * que o `pg_dump` usa, e é SELECT em catálogo, dentro da fronteira (ADR 006).
   *
   * ## Por que no plural
   *
   * A versão anterior era por tabela e abria a própria transação, então o
   * plano do bundle fazia `BEGIN + 2 consultas + COMMIT` **vezes o número de
   * tabelas**: 240 idas ao banco para 60 tabelas, cada uma pegando e devolvendo
   * um lease do pool. O trabalho nunca foi o problema — o número de idas é.
   * Numa conexão remota, que é o caso de uso, cada ida custa a latência
   * inteira.
   *
   * O par `(schema, tabela)` entra por `unnest` de dois arrays paralelos: um
   * único parâmetro por array, nada concatenado, e o `IN` casa o par — não o
   * produto cartesiano de schemas com tabelas, que traria a tabela homônima do
   * schema errado.
   */
  async #extrasDasTabelas(
    connection: ResolvedConnection,
    database: string,
    alvos: readonly { readonly schema: string; readonly table: string }[],
    request: ExportBundleRequest,
  ): Promise<Map<string, string[]>> {
    const vazio = new Map<string, string[]>();
    if (alvos.length === 0) return vazio;
    if (request.indexes !== true && request.triggers !== true) return vazio;

    const schemas = alvos.map((a) => a.schema);
    const tabelas = alvos.map((a) => a.table);

    return await this.#pools.withTransaction(connection, database, true, async (client) => {
      const porTabela = new Map<string, string[]>();
      const juntar = (linhas: readonly { schema: string; tabela: string; def: string }[]): void => {
        for (const l of linhas) {
          const chave = chaveDeTabela(l.schema, l.tabela);
          const atual = porTabela.get(chave);
          if (atual === undefined) porTabela.set(chave, [l.def]);
          else atual.push(l.def);
        }
      };

      if (request.indexes === true) {
        const r = await client.query<{ schema: string; tabela: string; def: string }>(
          `SELECT n.nspname AS schema, c.relname AS tabela, pg_get_indexdef(i.indexrelid) AS def
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT i.indisprimary
              AND (n.nspname, c.relname) IN (SELECT * FROM unnest($1::text[], $2::text[]))
            ORDER BY n.nspname, c.relname, 3`,
          [schemas, tabelas],
        );
        juntar(r.rows);
      }

      if (request.triggers === true) {
        const r = await client.query<{ schema: string; tabela: string; def: string }>(
          `SELECT n.nspname AS schema, c.relname AS tabela, pg_get_triggerdef(t.oid) AS def
             FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT t.tgisinternal
              AND (n.nspname, c.relname) IN (SELECT * FROM unnest($1::text[], $2::text[]))
            ORDER BY n.nspname, c.relname, 3`,
          [schemas, tabelas],
        );
        juntar(r.rows);
      }

      return porTabela;
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
 * Identidade de uma tabela num mapa.
 *
 * `JSON.stringify` de um par, e não `schema.tabela`: identificador do Postgres
 * aceita ponto quando citado, então `a` + `"b.c"` e `"a.b"` + `c` colidiriam e
 * uma tabela levaria os índices da outra. É a mesma correção que o `nodeId` do
 * diagrama e a chave do export já carregam.
 */
const chaveDeTabela = (schema: string, table: string): string => JSON.stringify([schema, table]);

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
