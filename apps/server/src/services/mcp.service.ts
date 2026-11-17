import { randomUUID } from "node:crypto";

import {
  MCP_MAX_ROWS,
  MCP_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  type McpToolResult,
  type SavedQuery,
} from "@dbee/shared";
import {
  SCHEMA_COMPACTO_MAX_CHARS,
  SCHEMA_COMPACTO_TETO_CHARS,
  capacidadesDe,
  formatarSchemaCompacto,
} from "@dbee/shared/puro";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { Ator } from "../lib/ator";
import type { ExplainService } from "./explain.service";
import type { QueryService } from "./query.service";
import type { SavedQueriesService } from "./savedQueries.service";
import type { SchemaService } from "./schema.service";
import { versaoDoBinario } from "./update.service";

/**
 * As tools do MCP (docs/plano-mcp-vpn.md §1, ADR 015).
 *
 * Cada tool é uma fachada fina sobre um serviço que a UI já usa — a mesma
 * permissão por conexão (`resolve` com o ator), o mesmo `query_log`. Nada aqui
 * abre conexão por conta própria.
 *
 * ## `run_query` é sempre leitura
 *
 * O pedido vai com `readOnly: true` explícito, e o `QueryService` só abre
 * `BEGIN READ WRITE` com `readOnly === false` — então nem uma conexão com
 * escrita habilitada e concessão de escrita grava por aqui. E só roda em engine
 * cuja proteção é o **modo da transação** (Postgres): nas engines de
 * credencial (MySQL, libSQL…) "leitura" depende de a credencial não gravar, e o
 * agente não pode herdar essa ressalva.
 *
 * A ressalva §11.37 continua: READ ONLY não barra `COPY … TO PROGRAM` num papel
 * superusuário. O MCP não muda isso — é a mesma garantia da UI.
 */

const TOOLS = [
  {
    name: "list_connections",
    description:
      "Lista as conexões de banco que este usuário pode acessar no DBee (id, nome, engine, database). Nunca inclui credenciais.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_schema",
    description:
      "Lista schemas e relações (tabelas, views) de um database de uma conexão, com estimativa de linhas.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        database: { type: "string", description: "Opcional; padrão: o database da conexão." },
      },
      required: ["connectionId"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_table",
    description: "Colunas (tipo, nulidade, default), chave primária, FKs e índices de uma tabela.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        schema: { type: "string" },
        table: { type: "string" },
        database: { type: "string" },
      },
      required: ["connectionId", "schema", "table"],
      additionalProperties: false,
    },
  },
  {
    name: "run_query",
    description:
      `Executa SQL numa transação READ ONLY (sempre, mesmo em conexão com escrita). ` +
      `Devolve no máximo ${String(MCP_MAX_ROWS)} linhas por statement; valores como string ` +
      `(null = SQL NULL). Cancelada após ${String(MCP_TIMEOUT_MS / 1000)} s. Só Postgres.`,
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        sql: { type: "string" },
        database: { type: "string" },
      },
      required: ["connectionId", "sql"],
      additionalProperties: false,
    },
  },
  {
    name: "explain_query",
    description:
      "Plano de execução (EXPLAIN em JSON, SEM ANALYZE: a query não é executada) de um único statement, " +
      "numa transação READ ONLY. Só Postgres.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        sql: { type: "string" },
        database: { type: "string" },
      },
      required: ["connectionId", "sql"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_schema_compact",
    description:
      "Schema inteiro de um database em texto compacto e estável (uma relação por bloco: colunas com tipo, " +
      "NOT NULL, default e PK; FKs; índices). Paginado por relação: repita com offset = nextOffset até vir null. " +
      `Filtro opcional por schema. maxChars padrão ${String(SCHEMA_COMPACTO_MAX_CHARS)}, teto ${String(SCHEMA_COMPACTO_TETO_CHARS)}.`,
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        database: { type: "string" },
        schema: { type: "string", description: "Opcional; só este schema." },
        offset: { type: "integer", minimum: 0, description: "Índice da primeira relação (nextOffset da página anterior)." },
        maxChars: { type: "integer", minimum: 1000, maximum: SCHEMA_COMPACTO_TETO_CHARS },
      },
      required: ["connectionId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_saved_queries",
    description:
      "Lista as queries salvas que este usuário vê no DBee (as do time e as próprias), com nome, SQL, conexão de origem e dono. " +
      "São consultas que o time já validou: prefira reaproveitá-las. Filtro opcional por texto (nome ou SQL) e por conexão.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Opcional; casa trecho do nome ou do SQL." },
        connectionId: { type: "string", description: "Opcional; só as queries desta conexão." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_saved_query",
    description: "Uma query salva pelo id (mesma regra de visibilidade de list_saved_queries).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
] as const;

type Args = Readonly<Record<string, unknown>>;

/** String obrigatória, não vazia, com teto. */
function str(args: Args, nome: string, max = 200): string | null {
  const v = args[nome];
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** Opcional: ausente → `undefined`; presente e inválido → `null`. */
function strOpt(args: Args, nome: string): string | undefined | null {
  if (args[nome] === undefined) return undefined;
  return str(args, nome, 100);
}

const texto = (valor: unknown, isError = false): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(valor, null, 2) }],
  isError,
});

const erro = (code: string, message: string, position: number | null = null): McpToolResult =>
  texto({ code, message, position }, true);

/** Mensagens das falhas de serviço — nunca o detalhe de decifragem. */
function falha(failure: string, detail: string | undefined): McpToolResult {
  if (failure === "not_found") return erro("connection_not_found", "conexão não encontrada");
  if (failure === "decryption_failed") return erro("decryption_failed", "não foi possível decifrar a credencial desta conexão");
  return erro(failure, detail ?? failure);
}

export interface McpServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly schema: SchemaService;
  readonly query: QueryService;
  readonly savedQueries: SavedQueriesService;
  readonly explain: ExplainService;
}

export class McpService {
  readonly #repository: ConnectionsRepository;
  readonly #schema: SchemaService;
  readonly #query: QueryService;
  readonly #savedQueries: SavedQueriesService;
  readonly #explain: ExplainService;

  constructor({ repository, schema, query, savedQueries, explain }: McpServiceDeps) {
    this.#explain = explain;
    this.#repository = repository;
    this.#schema = schema;
    this.#query = query;
    this.#savedQueries = savedQueries;
  }

  initialize(): Record<string, unknown> {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "dbee", version: versaoDoBinario() },
      instructions:
        "DBee: consulta somente-leitura aos bancos cadastrados. Comece por list_connections.",
    };
  }

  listTools(): Record<string, unknown> {
    return { tools: TOOLS };
  }

  async call(name: string, args: Args, ator: Ator): Promise<McpToolResult | null> {
    switch (name) {
      case "list_connections":
        return this.#listConnections(ator);
      case "list_schema":
        return this.#listSchema(args, ator);
      case "describe_table":
        return this.#describeTable(args, ator);
      case "run_query":
        return this.#runQuery(args, ator);
      case "explain_query":
        return this.#explainQuery(args, ator);
      case "describe_schema_compact":
        return this.#describeSchemaCompact(args, ator);
      case "list_saved_queries":
        return this.#listSavedQueries(args, ator);
      case "get_saved_query":
        return this.#getSavedQuery(args, ator);
      default:
        return null;
    }
  }

  #listConnections(ator: Ator): McpToolResult {
    // Projeção explícita: só o que o agente precisa. Host, usuário e
    // credenciais ficam de fora (regra 5) — `list` já não traz senha, mas a
    // lista positiva é o que impede um campo novo de vazar por aqui.
    const conexoes = this.#repository.list(ator).map((c) => ({
      id: c.id,
      name: c.name,
      engine: c.engine,
      database: c.database,
    }));
    return texto(conexoes);
  }

  /**
   * Mesmo serviço da UI: a visibilidade (time + próprias, conexão acessível) é
   * a do humano dono do token. Projeção explícita, sem `canEdit` — o MCP não
   * altera query salva.
   */
  #listSavedQueries(args: Args, ator: Ator): McpToolResult {
    const q = strOpt(args, "q");
    const connectionId = strOpt(args, "connectionId");
    if (q === null || connectionId === null) return erro("invalid_params", "q e connectionId, se vierem, devem ser strings");
    const lista = this.#savedQueries
      .listar(ator, q ?? null)
      .filter((s) => connectionId === undefined || s.connectionId === connectionId)
      .map(projetarSalva);
    return texto(lista);
  }

  #getSavedQuery(args: Args, ator: Ator): McpToolResult {
    const id = str(args, "id", 64);
    if (id === null) return erro("invalid_params", "id é obrigatório");
    const r = this.#savedQueries.obter(id, ator);
    if (!r.ok) return erro("saved_query_not_found", "query salva não encontrada");
    return texto(projetarSalva(r.value));
  }

  async #listSchema(args: Args, ator: Ator): Promise<McpToolResult> {
    const id = str(args, "connectionId");
    const database = strOpt(args, "database");
    if (id === null || database === null) return erro("invalid_params", "connectionId (e database, se vier) devem ser strings");
    const r = await this.#schema.tree(id, database, false, ator);
    if (!r.ok) return falha(r.failure, r.detail);
    return texto({
      database: r.value.database,
      schemas: r.value.schemas.map((s) => ({
        name: s.name,
        relations: s.relations.map((rel) => ({ name: rel.name, kind: rel.kind, estimatedRows: rel.estimatedRows })),
      })),
    });
  }

  async #describeTable(args: Args, ator: Ator): Promise<McpToolResult> {
    const id = str(args, "connectionId");
    const schema = str(args, "schema");
    const table = str(args, "table");
    const database = strOpt(args, "database");
    if (id === null || schema === null || table === null || database === null) {
      return erro("invalid_params", "connectionId, schema e table são obrigatórios");
    }
    const r = await this.#schema.get(id, database, false, ator);
    if (!r.ok) return falha(r.failure, r.detail);
    const rel = r.value.schemas.find((s) => s.name === schema)?.relations.find((x) => x.name === table);
    if (rel === undefined) return erro("table_not_found", `relação ${schema}.${table} não encontrada`);
    return texto({
      schema,
      name: rel.name,
      kind: rel.kind,
      comment: rel.comment,
      estimatedRows: rel.estimatedRows,
      columns: rel.columns.map((c) => ({
        name: c.name,
        dataType: c.dataType,
        nullable: c.nullable,
        defaultValue: c.defaultValue,
        isPrimaryKey: c.isPrimaryKey,
        comment: c.comment,
      })),
      primaryKey: rel.primaryKey,
      foreignKeys: rel.foreignKeys,
      indexes: rel.indexes,
    });
  }

  /**
   * EXPLAIN pelo mesmo serviço da UI (permissão, `query_log`), com
   * `analyze: false` **fixo**: o agente não tem como pedir ANALYZE, que executa
   * a query (ADR 017). Sem ANALYZE o serviço abre `BEGIN READ ONLY`.
   */
  async #explainQuery(args: Args, ator: Ator): Promise<McpToolResult> {
    const id = str(args, "connectionId");
    const sql = str(args, "sql", 1_000_000);
    const database = strOpt(args, "database");
    if (id === null || sql === null || database === null) {
      return erro("invalid_params", "connectionId e sql são obrigatórios");
    }
    const r = await this.#explain.explicar(
      id,
      { sql, analyze: false, ...(database === undefined ? {} : { database }) },
      ator,
    );
    if (!r.ok) return falha(r.failure, r.detail);
    if (r.value.error !== null) {
      return erro(r.value.error.code ?? "explain_error", r.value.error.message, r.value.error.position);
    }
    // Plano como texto, como o Postgres o devolveu (regra 10).
    return { content: [{ type: "text", text: r.value.plan ?? "null" }], isError: false };
  }

  /** Catálogo do mesmo `SchemaService` (cache, permissão pelo ator), em texto compacto. */
  async #describeSchemaCompact(args: Args, ator: Ator): Promise<McpToolResult> {
    const id = str(args, "connectionId");
    const database = strOpt(args, "database");
    const schema = strOpt(args, "schema");
    const offset = args["offset"] ?? 0;
    const maxChars = args["maxChars"] ?? SCHEMA_COMPACTO_MAX_CHARS;
    if (
      id === null || database === null || schema === null ||
      typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 ||
      typeof maxChars !== "number" || !Number.isInteger(maxChars) || maxChars < 1000 || maxChars > SCHEMA_COMPACTO_TETO_CHARS
    ) {
      return erro("invalid_params", `connectionId obrigatório; offset inteiro ≥ 0; maxChars entre 1000 e ${String(SCHEMA_COMPACTO_TETO_CHARS)}`);
    }
    const r = await this.#schema.get(id, database, false, ator);
    if (!r.ok) return falha(r.failure, r.detail);
    const pagina = formatarSchemaCompacto(r.value.schemas, {
      offset,
      maxChars,
      ...(schema === undefined ? {} : { schema }),
    });
    const cabecalho =
      `# database ${r.value.database}${schema === undefined ? "" : ` schema ${schema}`} · ` +
      `relações ${String(offset)}..${String(offset + pagina.returnedRelations)} de ${String(pagina.totalRelations)} · ` +
      `nextOffset ${pagina.nextOffset === null ? "null" : String(pagina.nextOffset)}`;
    return { content: [{ type: "text", text: `${cabecalho}\n\n${pagina.text}` }], isError: false };
  }

  async #runQuery(args: Args, ator: Ator): Promise<McpToolResult> {
    const id = str(args, "connectionId");
    const sql = str(args, "sql", 1_000_000);
    const database = strOpt(args, "database");
    if (id === null || sql === null || database === null) {
      return erro("invalid_params", "connectionId e sql são obrigatórios");
    }

    const conexao = this.#repository.find(id, ator);
    if (conexao === null) return erro("connection_not_found", "conexão não encontrada");
    if (capacidadesDe(conexao.engine)?.escopoReadOnly !== "transacao") {
      return erro(
        "engine_not_supported",
        `run_query só roda onde a leitura é garantida pelo modo da transação (Postgres); ${conexao.engine} não oferece isso`,
      );
    }

    // Timeout próprio, por cima do `statement_timeout` da conexão: o agente
    // não espera até 600 s. Cancela no servidor pelo mesmo caminho do botão
    // "cancelar" da UI — não é só parar de esperar.
    const queryId = randomUUID();
    const timer = setTimeout(() => {
      void this.#query.cancelar(id, queryId, ator).catch(() => undefined);
    }, MCP_TIMEOUT_MS);
    let r;
    try {
      r = await this.#query.run(
        id,
        {
          sql,
          maxRows: MCP_MAX_ROWS,
          // Explícito, não por omissão: o MCP nunca pede escrita.
          readOnly: true,
          queryId,
          ...(database === undefined ? {} : { database }),
        },
        ator,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) return falha(r.failure, r.detail);

    const { results, error, readOnly } = r.value;
    const statements = results.map((s) => ({
      sql: s.sql,
      command: s.command,
      columns: s.columns.map((c) => ({ name: c.name, type: c.dataTypeName })),
      rows: s.rows,
      rowCount: s.rowCount,
      truncated: s.truncated,
    }));
    if (error !== null) {
      return texto(
        {
          code: error.code,
          message: error.code === "57014" ? `${error.message} (limite do MCP: ${String(MCP_TIMEOUT_MS / 1000)} s)` : error.message,
          position: error.position,
          detail: error.detail,
          hint: error.hint,
          statementIndex: error.index,
          statements,
        },
        true,
      );
    }
    return texto({ readOnly, statements });
  }
}

function projetarSalva(s: SavedQuery): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    sql: s.sql,
    connectionId: s.connectionId,
    owner: s.ownerName,
    visibility: s.visibility,
    updatedAt: s.updatedAt,
  };
}
