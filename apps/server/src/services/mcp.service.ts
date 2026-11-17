import { randomUUID } from "node:crypto";

import { MCP_MAX_ROWS, MCP_TIMEOUT_MS, MCP_PROTOCOL_VERSION, type McpToolResult } from "@dbee/shared";
import { capacidadesDe } from "@dbee/shared/puro";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { Ator } from "../lib/ator";
import type { QueryService } from "./query.service";
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
}

export class McpService {
  readonly #repository: ConnectionsRepository;
  readonly #schema: SchemaService;
  readonly #query: QueryService;

  constructor({ repository, schema, query }: McpServiceDeps) {
    this.#repository = repository;
    this.#schema = schema;
    this.#query = query;
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
