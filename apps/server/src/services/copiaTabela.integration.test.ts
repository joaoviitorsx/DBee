import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SESSION_COOKIE, type CopyTableResponse, type CreateApiTokenResponse } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { PoolManager } from "../pg/pool";
import { autenticar } from "../test/sessao";

/**
 * "Copiar tabela para…" e as tools MCP `explain_query`/`describe_schema_compact`
 * contra Postgres real. O que só o banco responde: o script gerado **roda** no
 * destino e reproduz os dados; o EXPLAIN do MCP não executa a query (um
 * `UPDATE` explicado não muda nada); e a permissão por conexão vale nas duas.
 */

const PORTA = 55602;
const CONTAINER = "dbee-copia-it";
const SENHA_PG = "Cp4tQx8vLr2W";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const psql = (db: string, sql: string): { ok: boolean; out: string } => {
  const r = Bun.spawnSync(["docker", "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, "-tA"], {
    stdin: new TextEncoder().encode(sql),
  });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim() + r.stderr.toString() };
};

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let cookie = "";
let cookieMembro = "";
let token = "";
let tokenMembro = "";
let origem = "";
let destino = "";

const api = (path: string, body: unknown, ck = cookie): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ck },
      body: JSON.stringify(body),
    }),
  );

async function tool(name: string, args: Record<string, unknown>, tk = token): Promise<{ text: string; isError: boolean }> {
  const res = await app.handle(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tk}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const r = ((await res.json()) as { result: { content: { text: string }[]; isError: boolean } }).result;
  return { text: r.content[0]?.text ?? "", isError: r.isError };
}

async function criarConexao(nome: string, database: string): Promise<string> {
  const r = await api("/connections", {
    name: nome, host: "127.0.0.1", port: PORTA, database, username: "postgres", password: SENHA_PG,
    timezone: "UTC", writeEnabled: true,
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-e", `POSTGRES_PASSWORD=${SENHA_PG}`, "-e", "POSTGRES_DB=origem",
    "-p", `127.0.0.1:${String(PORTA)}:5432`, "postgres:16");
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (psql("origem", "SELECT 1").ok) { pronto = true; break; }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");
  expect(psql("origem", `
    CREATE TABLE cli (id int PRIMARY KEY);
    INSERT INTO cli VALUES (1);
    CREATE TABLE "pedi""dos" (
      id bigserial PRIMARY KEY,
      nome varchar(40) NOT NULL DEFAULT 'x',
      valor numeric(10,2),
      quando timestamptz,
      tags text[],
      cli int REFERENCES cli(id)
    );
    CREATE INDEX ON "pedi""dos"(nome);
    INSERT INTO "pedi""dos"(nome, valor, quando, tags, cli)
      SELECT 'n' || g || CASE WHEN g = 3 THEN ''' ; DROP TABLE cli; --' ELSE '' END,
             g * 1.5, '2024-01-01T00:00:00Z'::timestamptz + g * interval '1 day', ARRAY['a','b'], 1
      FROM generate_series(1, 2500) g;
    CREATE SCHEMA muitos;
    DO $$ BEGIN FOR i IN 1..40 LOOP EXECUTE format('CREATE TABLE muitos.t%s (id int PRIMARY KEY, a text, b text)', i); END LOOP; END $$;
    CREATE TABLE muitos."linha
forjada" (x int);`).ok).toBe(true);
  expect(psql("origem", "CREATE DATABASE destino").ok).toBe(true);

  store = openTestStore();
  cookie = (await autenticar(store)).cookie;
  pools = new PoolManager(undefined);
  app = createApp({ store, caCert: undefined, pools });
  origem = await criarConexao("origem", "origem");
  destino = await criarConexao("destino", "destino");

  const users = new UsersRepository(store.db);
  const membro = users.criar("membro", await Bun.password.hash("senha-do-membro-1", { algorithm: "argon2id" }), false, "member");
  cookieMembro = `${SESSION_COOKIE}=${users.abrirSessao(membro.id).token}`;
  const tk = async (ck: string) =>
    ((await (await api("/tokens", { name: "t" }, ck)).json()) as CreateApiTokenResponse).secret;
  token = await tk(cookie);
  tokenMembro = await tk(cookieMembro);
}, 120_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
});

describe.if(temDocker)("copiar tabela para… (Postgres real)", () => {
  const caminho = () => `/connections/${origem}/tables/public/${encodeURIComponent('pedi"dos')}/copy-script`;

  it("gera script que roda no destino e reproduz as linhas, sem executar nada lá", async () => {
    const res = await api(caminho(), { targetConnectionId: destino, maxRows: 2000 });
    expect(res.status).toBe(200);
    const r = (await res.json()) as CopyTableResponse;
    expect(r.truncated).toBe(true);
    expect(r.rowCount).toBe(2000);
    expect(r.targetDialect).toBe("postgres");
    // Nada foi criado no destino pelo DBee.
    expect(psql("destino", `SELECT to_regclass('public."pedi""dos"') IS NULL`).out).toBe("t");

    const rodou = psql("destino", r.sql);
    expect(rodou.ok).toBe(true);
    expect(psql("destino", `SELECT count(*), sum(valor), max(quando)::text FROM "pedi""dos"`).out)
      .toBe(psql("origem", `SELECT count(*), sum(valor), max(quando)::text FROM (SELECT * FROM "pedi""dos" ORDER BY id LIMIT 2000) s`).out);
    expect(psql("destino", `SELECT nome, tags::text FROM "pedi""dos" WHERE id = 3`).out).toBe("n3' ; DROP TABLE cli; --|{a,b}");
    // A origem segue intacta (o valor com aspas não injetou nada).
    expect(psql("origem", "SELECT count(*) FROM cli").out).toBe("1");
  });

  it("maxRows 0 = só estrutura; destino MySQL-like não se aplica aqui, mas renomear funciona", async () => {
    const r = (await (await api(caminho(), { targetConnectionId: destino, maxRows: 0, targetTable: "copia" })).json()) as CopyTableResponse;
    expect(r.rowCount).toBe(0);
    expect(r.sql).not.toContain("INSERT");
    expect(psql("destino", r.sql).ok).toBe(true);
  });

  it("cada página lida entra no query_log como leitura", () => {
    const n = store.db.query("SELECT count(*) AS n FROM query_log WHERE connection_id = ? AND read_only = 1").get(origem) as { n: number };
    expect(n.n).toBeGreaterThanOrEqual(2);
  });

  it("member sem concessão: 404 na origem e no destino", async () => {
    expect((await api(caminho(), { targetConnectionId: destino }, cookieMembro)).status).toBe(404);
    expect((await api(caminho(), { targetConnectionId: "inexistente" })).status).toBe(404);
  });
});

describe.if(temDocker)("MCP explain_query e describe_schema_compact (Postgres real)", () => {
  it("explain_query não executa: UPDATE explicado não muda a tabela", async () => {
    const r = await tool("explain_query", { connectionId: origem, sql: `UPDATE "pedi""dos" SET nome = 'mudou'` });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('"Node Type"');
    expect(r.text).not.toContain("Actual Rows");
    expect(psql("origem", `SELECT count(*) FROM "pedi""dos" WHERE nome = 'mudou'`).out).toBe("0");
  });

  it("explain_query ignora pedido de analyze e devolve erro do Postgres com position", async () => {
    const r = await tool("explain_query", { connectionId: origem, sql: "SELECT nao_existe FROM cli", analyze: true });
    expect(r.isError).toBe(true);
    const ok = await tool("explain_query", { connectionId: origem, sql: "SELECT nao_existe FROM cli" });
    expect(ok.isError).toBe(true);
    expect((JSON.parse(ok.text) as { code: string; position: number }).code).toBe("42703");
  });

  it("describe_schema_compact: formato, paginação e filtro", async () => {
    const tudo = await tool("describe_schema_compact", { connectionId: origem, schema: "public" });
    expect(tudo.isError).toBe(false);
    expect(tudo.text).toContain(`public.pedi"dos table`);
    expect(tudo.text).toContain("  id bigint NOT NULL = nextval(");
    expect(tudo.text).toContain("  quando timestamp with time zone\n");
    expect(tudo.text).toContain("  FK (cli) -> public.cli(id)");
    expect(tudo.text).toContain("nextOffset null");
    expect(tudo.text).not.toContain(SENHA_PG);

    const pag = await tool("describe_schema_compact", { connectionId: origem, schema: "muitos", maxChars: 1000, offset: 0 });
    const prox = Number(/nextOffset (\d+)/.exec(pag.text)?.[1]);
    expect(prox).toBeGreaterThan(0);
    const seg = await tool("describe_schema_compact", { connectionId: origem, schema: "muitos", maxChars: 1000, offset: prox });
    expect(seg.text).toContain(`relações ${String(prox)}..`);
    const tudoMuitos = await tool("describe_schema_compact", { connectionId: origem, schema: "muitos", maxChars: 100_000 });
    expect(tudoMuitos.text).toContain('muitos."linha\\nforjada" table');
    expect(tudoMuitos.text).not.toContain("\nforjada");
    expect((await tool("describe_schema_compact", { connectionId: origem, maxChars: 5 })).isError).toBe(true);
  });

  it("member sem concessão não vê a conexão por nenhuma das tools", async () => {
    for (const nome of ["explain_query", "describe_schema_compact"]) {
      const r = await tool(nome, { connectionId: origem, sql: "SELECT 1" }, tokenMembro);
      expect(r.isError).toBe(true);
      expect(r.text).toContain("connection_not_found");
    }
  });
});
