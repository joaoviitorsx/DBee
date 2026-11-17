import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { MCP_MAX_ROWS, type CreateApiTokenResponse, type QueryLogEntry } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { PoolManager } from "../pg/pool";
import { autenticar } from "../test/sessao";

/**
 * MCP contra Postgres real (ADR 015).
 *
 * A pergunta que importa: **`run_query` numa conexão com escrita habilitada,
 * pelo admin (que tem concessão de escrita), não escreve.** Só um banco de
 * verdade responde isso — um mock confirmaria que o `readOnly: true` foi
 * passado, não que o Postgres recusou o INSERT.
 */

const PORTA = 55571;
const CONTAINER = "dbee-mcp-it";
const SENHA_PG = "Mc7pQx2vLr9T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const psql = (sql: string): string =>
  Bun.spawnSync(["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "it", "-tAc", sql])
    .stdout.toString()
    .trim();

let app: ReturnType<typeof createApp>;
let pools: PoolManager | undefined;
let cookie = "";
let userId = "";
let token = "";
let conn = "";

interface ToolResult {
  readonly content: { text: string }[];
  readonly isError: boolean;
}

async function tool(name: string, args: Record<string, unknown>): Promise<{ r: ToolResult; json: unknown }> {
  const res = await app.handle(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  expect(res.status).toBe(200);
  const r = ((await res.json()) as { result: ToolResult }).result;
  return { r, json: JSON.parse(r.content[0]?.text ?? "null") };
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA_PG}`, "-e", "POSTGRES_DB=it",
    "-p", `127.0.0.1:${String(PORTA)}:5432`, "postgres:16",
  );
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "it", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");
  psql(
    "CREATE TABLE t (id int PRIMARY KEY, nome text NOT NULL); " +
      "INSERT INTO t SELECT g, 'n' || g FROM generate_series(1, 800) g;",
  );

  const store = openTestStore();
  const s = await autenticar(store);
  cookie = s.cookie;
  userId = s.userId;
  pools = new PoolManager(undefined);
  app = createApp({ store, caCert: undefined, pools });

  const criada = await app.handle(
    new Request("http://localhost/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "it", host: "127.0.0.1", port: PORTA, database: "it",
        username: "postgres", password: SENHA_PG, timezone: "UTC",
        // Escrita habilitada de propósito: o MCP tem de ignorá-la.
        writeEnabled: true,
      }),
    }),
  );
  expect(criada.status).toBe(201);
  conn = ((await criada.json()) as { id: string; writeEnabled: boolean }).id;

  const tk = await app.handle(
    new Request("http://localhost/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "claude" }),
    }),
  );
  token = ((await tk.json()) as CreateApiTokenResponse).secret;
}, 120_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
});

describe.if(temDocker)("MCP contra Postgres real", () => {
  it("run_query numa conexão com escrita NÃO escreve", async () => {
    const { r, json } = await tool("run_query", {
      connectionId: conn,
      sql: "INSERT INTO t VALUES (9999, 'intruso')",
    });
    expect(r.isError).toBe(true);
    // 25006 = read_only_sql_transaction: foi o Postgres que recusou.
    expect((json as { code: string }).code).toBe("25006");
    expect(psql("SELECT count(*) FROM t WHERE id = 9999")).toBe("0");
  }, 60_000);

  it("nem DDL, nem escrita escondida num CTE", async () => {
    await tool("run_query", { connectionId: conn, sql: "DROP TABLE t" });
    await tool("run_query", { connectionId: conn, sql: "WITH x AS (DELETE FROM t RETURNING 1) SELECT * FROM x" });
    expect(psql("SELECT count(*) FROM t")).toBe("800");
  }, 60_000);

  it("leitura: limite de linhas, valores string, truncated", async () => {
    const { r, json } = await tool("run_query", { connectionId: conn, sql: "SELECT id, nome FROM t ORDER BY id" });
    expect(r.isError).toBe(false);
    const st = (json as { readOnly: boolean; statements: { rows: unknown[][]; truncated: boolean }[] });
    expect(st.readOnly).toBe(true);
    expect(st.statements[0]?.rows.length).toBe(MCP_MAX_ROWS);
    expect(st.statements[0]?.truncated).toBe(true);
    expect(st.statements[0]?.rows[0]).toEqual(["1", "n1"]);
  }, 60_000);

  it("erro de banco vira isError com code/message/position, sem credencial", async () => {
    const { r, json } = await tool("run_query", { connectionId: conn, sql: "SELECT nao_existe FROM t" });
    expect(r.isError).toBe(true);
    const e = json as { code: string; message: string; position: number };
    expect(e.code).toBe("42703");
    expect(e.position).toBe(8);
    expect(r.content[0]?.text).not.toContain(SENHA_PG);
  }, 60_000);

  it("list_schema e describe_table", async () => {
    const { json: schema } = await tool("list_schema", { connectionId: conn });
    expect(JSON.stringify(schema)).toContain("\"t\"");

    const { r, json } = await tool("describe_table", { connectionId: conn, schema: "public", table: "t" });
    expect(r.isError).toBe(false);
    const d = json as { columns: { name: string; isPrimaryKey: boolean }[]; primaryKey: string[] };
    expect(d.columns.map((c) => c.name)).toEqual(["id", "nome"]);
    expect(d.primaryKey).toEqual(["id"]);
  }, 60_000);

  it("query_log grava o actor com a origem mcp", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/connections/${conn}/history?limit=50`, { headers: { cookie } }),
    );
    const log = (await res.json()) as QueryLogEntry[];
    const entrada = log.find((e) => e.sql.includes("intruso"));
    expect(entrada?.actor).toBe(`${userId}#mcp:claude`);
    expect(entrada?.readOnly).toBe(true);
  }, 60_000);
});
