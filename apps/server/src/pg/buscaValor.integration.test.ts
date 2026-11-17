import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { ValueSearchResponse } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { QueryLogRepository } from "../db/queryLog.repo";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Busca de valor contra **Postgres real** (ADR 023): escopo, tipos, PK,
 * privilégio de coluna, timeout por tabela sem derrubar as outras, valor
 * hostil e cancelamento.
 */

const PORTA = 55603;
const CONTAINER = "dbee-buscavalor-it";
const SENHA = "Bv5kQz9mWx2T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let cookie = "";
let conn = "";
let connLimitado = "";

const call = (path: string, body: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

const psql = (sql: string): string => {
  const r = Bun.spawnSync(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", sql]);
  return r.stdout.toString().trim();
};

const buscar = async (id: string, body: unknown): Promise<{ status: number; json: ValueSearchResponse }> => {
  const res = await call(`/api/connections/${id}/value-search`, body);
  return { status: res.status, json: (await res.json()) as ValueSearchResponse };
};

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=app",
    "-p", `${String(PORTA)}:5432`, "postgres:16");
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");
  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        CREATE TABLE clientes (id int PRIMARY KEY, nome text, cpf char(11), obs varchar(50), saldo numeric(10,2));
        INSERT INTO clientes VALUES (1,'Ana Souza','12345678901','vip 50%',10.50),(2,'Beto','98765432100',NULL,42);
        CREATE TABLE "Pedidos" (pedido int, item int, "Descrição" text, PRIMARY KEY (pedido, item));
        INSERT INTO "Pedidos" VALUES (7,1,'caneta da Ana'),(7,2,'lápis');
        CREATE TABLE sem_pk (x text);
        INSERT INTO sem_pk VALUES ('ana aqui');
        CREATE TABLE so_numero (id int PRIMARY KEY, valor int);
        INSERT INTO so_numero VALUES (1, 42);
        CREATE TABLE lenta (id int PRIMARY KEY, t text);
        INSERT INTO lenta SELECT g, 'x' || g FROM generate_series(1, 300000) g;
        CREATE SCHEMA outro;
        CREATE TABLE outro.segredo (id int PRIMARY KEY, s text);
        INSERT INTO outro.segredo VALUES (1, 'Ana fora do escopo');
        CREATE TABLE sensivel (id int PRIMARY KEY, publico text, oculto text);
        INSERT INTO sensivel VALUES (1, 'nada', 'Ana oculta');
        CREATE ROLE limitado LOGIN PASSWORD 'Li8mQz3nWy5U';
        GRANT USAGE ON SCHEMA public TO limitado;
        GRANT SELECT (id, publico) ON sensivel TO limitado;
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));
  const criar = async (username: string, password: string): Promise<string> => {
    const res = await call("/api/connections", {
      name: username, host: "127.0.0.1", port: PORTA, database: "app", username, password, timezone: "UTC",
    });
    return ((await res.json()) as { id: string }).id;
  };
  conn = await criar("postgres", SENHA);
  connLimitado = await criar("limitado", "Li8mQz3nWy5U");
}, 90_000);

afterAll(async () => {
  await pools?.shutdown();
  if (temDocker) sh("docker", "rm", "-f", CONTAINER);
});

describe.skipIf(!temDocker)("busca de valor (Postgres real)", () => {
  it("acha texto no schema escolhido, com PK simples, composta e sem PK; não sai do escopo", async () => {
    const { status, json } = await buscar(conn, { value: "ana", scope: { schema: "public" } });
    expect(status).toBe(200);
    const achados = json.hits.map((h) => `${h.table}.${h.column}`).sort();
    expect(achados).toEqual(["Pedidos.Descrição", "clientes.nome", "sem_pk.x", "sensivel.oculto"]);
    expect(json.hits.find((h) => h.table === "Pedidos")?.pk).toEqual({ pedido: "7", item: "1" });
    expect(json.hits.find((h) => h.table === "sem_pk")?.pk).toBeNull();
    expect(json.hits.find((h) => h.table === "clientes")?.pk).toEqual({ id: "1" });
    expect(json.hits.some((h) => h.schema === "outro")).toBe(false);
  });

  it("número casa colunas numéricas e texto; curinga do valor é literal", async () => {
    const n = await buscar(conn, { value: "42", mode: "exact", scope: { schema: "public" } });
    expect(n.json.hits.map((h) => `${h.table}.${h.column}`).sort()).toEqual(["clientes.saldo", "lenta.id", "so_numero.valor"]);
    const pct = await buscar(conn, { value: "50%", scope: { tables: [{ schema: "public", name: "clientes" }] } });
    expect(pct.json.hits.map((h) => h.value)).toEqual(["vip 50%"]);
    const curinga = await buscar(conn, { value: "%", scope: { tables: [{ schema: "public", name: "clientes" }] } });
    expect(curinga.json.hits.map((h) => h.value)).toEqual(["vip 50%"]);
  });

  it("valor hostil não executa nada", async () => {
    const { status } = await buscar(conn, { value: "'); DROP TABLE clientes; --", scope: { schema: "public" } });
    expect(status).toBe(200);
    expect(psql("SELECT count(*) FROM clientes")).toBe("2");
  });

  it("lista de tabelas com nome inexistente ou hostil só cai no catálogo, não no SQL", async () => {
    const { status, json } = await buscar(conn, {
      value: "ana",
      scope: { tables: [{ schema: "public", name: 'clientes"; DROP TABLE clientes; --' }, { schema: "outro", name: "segredo" }] },
    });
    expect(status).toBe(200);
    expect(json.hits.map((h) => h.table)).toEqual(["segredo"]);
    expect(psql("SELECT count(*) FROM clientes")).toBe("2");
  });

  it("coluna sem privilégio de SELECT fica de fora, sem derrubar a tabela", async () => {
    const { json } = await buscar(connLimitado, { value: "a", scope: { schema: "public" } });
    expect(json.tables.find((t) => t.table === "sensivel")?.status).toBe("ok");
    expect(json.hits.some((h) => h.column === "oculto")).toBe(false);
    // Tabela sem privilégio nenhum: nem entra no varrido.
    expect(json.tables.some((t) => t.table === "clientes")).toBe(false);
  });

  it("tabela lenta estoura o timeout dela e as outras seguem; tudo no query_log", async () => {
    // Lock exclusivo segura o SELECT da tabela até o statement_timeout dela.
    const bloqueio = Bun.spawn(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app"], { stdin: "pipe" });
    void bloqueio.stdin.write("BEGIN; LOCK TABLE lenta IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8);\n");
    void bloqueio.stdin.flush();
    await Bun.sleep(800);
    const { status, json } = await buscar(conn, { value: "ana", scope: { schema: "public" } });
    bloqueio.kill();
    expect(status).toBe(200);
    expect(json.tables.find((t) => t.table === "lenta")?.status).toBe("timeout");
    expect(json.hits.some((h) => h.table === "clientes")).toBe(true);
    const log = new QueryLogRepository(store.db).search({ connectionId: conn, limit: 50 }).entries;
    const entrada = log.find((e) => e.sql.includes("busca de valor"));
    expect(entrada?.readOnly).toBe(true);
    expect(entrada?.sql).toContain('"ana"');
  }, 30_000);

  it("cancelamento interrompe a busca e devolve cancelled", async () => {
    const bloqueio = Bun.spawn(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app"], { stdin: "pipe" });
    void bloqueio.stdin.write("BEGIN; LOCK TABLE \"Pedidos\" IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8);\n");
    void bloqueio.stdin.flush();
    await Bun.sleep(800);
    const queryId = crypto.randomUUID();
    const pendente = buscar(conn, { value: "ana", scope: { schema: "public" }, queryId });
    await Bun.sleep(400);
    const c = await call(`/api/connections/${conn}/value-search/cancel`, { queryId });
    expect(((await c.json()) as { cancelled: boolean }).cancelled).toBe(true);
    const { json } = await pendente;
    bloqueio.kill();
    expect(json.cancelled).toBe(true);
    expect(json.tables.some((t) => t.table === "sem_pk")).toBe(false);
  }, 30_000);

  it("escopo é obrigatório", async () => {
    const res = await call(`/api/connections/${conn}/value-search`, { value: "ana" });
    expect(res.status).toBe(422);
  });
});
