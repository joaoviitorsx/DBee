import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  SESSION_COOKIE,
  type DataCompareResponse,
  type ColumnStatsResponse,
  type ExplainResponse,
  type QueryLogEntry,
  type QueryResponse,
  type SchemaCompareResponse,
  type SearchResponse,
} from "@dbee/shared";
import { nomearParametros } from "@dbee/shared/puro";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { ConnectionsRepository } from "../db/connections.repo";
import { UsersRepository } from "../db/users.repo";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Fatias do roadmap-dbeaver contra **Postgres real**: EXPLAIN (e ANALYZE com
 * rollback), variáveis de snippet por bind, origem/FK das colunas do
 * resultado, histórico por escopo, busca global, data e schema compare.
 */

const PORTA = 55581;
const CONTAINER = "dbee-roadmap-it";
const SENHA = "Rm8kQp3wZx5V";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let admin = "";
let membro = "";
let leitura = "";
let escrita = "";
let outroDb = "";

const call = (cookie: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  app.handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

async function json<T>(res: Response, esperado = 200): Promise<T> {
  const texto = await res.text();
  if (res.status !== esperado) throw new Error(`esperava ${String(esperado)}, veio ${String(res.status)}: ${texto}`);
  return JSON.parse(texto) as T;
}

function psql(db: string, sql: string): void {
  const r = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-q", "-v", "ON_ERROR_STOP=1"],
    { stdin: Buffer.from(sql) },
  );
  if (r.exitCode !== 0) throw new Error(`psql falhou: ${r.stderr.toString()}`);
}

async function conexao(nome: string, database: string, writeEnabled: boolean): Promise<string> {
  const res = await call(admin, "/connections", {
    name: nome, host: "127.0.0.1", port: PORTA, database, username: "postgres",
    password: SENHA, timezone: "UTC", writeEnabled,
  });
  return (await json<{ id: string }>(res, 201)).id;
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-e", `POSTGRES_PASSWORD=${SENHA}`,
    "-e", "POSTGRES_DB=app", "-p", `${String(PORTA)}:5432`, "postgres:16");
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");

  psql("app", `
    CREATE TABLE cliente (id int PRIMARY KEY, nome text NOT NULL);
    CREATE TABLE pedido (id int PRIMARY KEY, cliente_id int REFERENCES cliente(id), total numeric(10,2));
    INSERT INTO cliente SELECT g, 'c' || g FROM generate_series(1, 50) g;
    INSERT INTO pedido SELECT g, (g % 50) + 1, g * 1.5 FROM generate_series(1, 2000) g;
    CREATE INDEX ix_pedido_cliente ON pedido (cliente_id);
    ANALYZE;
    CREATE SCHEMA dev;
    CREATE TABLE dev.cliente (id int PRIMARY KEY, nome text NOT NULL, email text);
    CREATE TABLE dev.so_dev (x int);
    CREATE TABLE public.alvo (id int PRIMARY KEY, nome text);
    INSERT INTO public.alvo VALUES (1, 'igual'), (2, 'velho'), (99, 'sobra');
  `);
  psql("postgres", "CREATE DATABASE outro");
  psql("outro", `
    CREATE TABLE cliente (id int PRIMARY KEY, nome text NOT NULL);
    INSERT INTO cliente SELECT g, 'c' || g FROM generate_series(1, 48) g;
    UPDATE cliente SET nome = 'mudou' WHERE id = 7;
    INSERT INTO cliente VALUES (500, 'so no outro');
  `);

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie: admin } = await autenticar(store));
  const users = new UsersRepository(store.db);
  const m = users.criar("membro", await Bun.password.hash("senha-membro-1"), false, "member");
  membro = `${SESSION_COOKIE}=${users.abrirSessao(m.id).token}`;

  leitura = await conexao("leitura", "app", false);
  escrita = await conexao("escrita", "app", true);
  outroDb = await conexao("outro", "outro", false);
  // O membro vê só a de leitura.
  new ConnectionsRepository(store.db, store.key).conceder(leitura, m.id, false, "adm");
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.if(temDocker)("EXPLAIN", () => {
  it("FORMAT JSON em leitura: plano como texto, sem executar", async () => {
    const r = await json<ExplainResponse>(await call(admin, `/connections/${leitura}/explain`, {
      sql: "SELECT * FROM pedido WHERE cliente_id = 3",
    }));
    expect(r.error).toBeNull();
    expect(r.analyzed).toBe(false);
    expect(typeof r.plan).toBe("string");
    const plano = JSON.parse(r.plan ?? "[]") as { Plan: { "Node Type": string } }[];
    expect(plano[0]?.Plan["Node Type"]).toBeDefined();
    expect(r.plan).not.toContain("Actual Rows");
  });

  it("escrita sob EXPLAIN sem ANALYZE não roda; sob ANALYZE em leitura é recusada", async () => {
    const semAnalyze = await json<ExplainResponse>(await call(admin, `/connections/${leitura}/explain`, {
      sql: "DELETE FROM pedido",
    }));
    expect(semAnalyze.error).toBeNull();
    const res = await call(admin, `/connections/${leitura}/explain`, { sql: "DELETE FROM pedido", analyze: true });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("write_forbidden");
  });

  it("ANALYZE na conexão de escrita executa e REVERTE", async () => {
    const r = await json<ExplainResponse>(await call(admin, `/connections/${escrita}/explain`, {
      sql: "DELETE FROM pedido WHERE id <= 10", analyze: true,
    }));
    expect(r.error).toBeNull();
    expect(r.analyzed).toBe(true);
    expect(r.plan).toContain("Actual Rows");
    const conta = await json<QueryResponse>(await call(admin, `/connections/${leitura}/query`, {
      sql: "SELECT count(*) FROM pedido WHERE id <= 10",
    }));
    expect(conta.results[0]?.rows[0]?.[0]).toBe("10");
  });

  it("vários statements e COMMIT embutido são recusados", async () => {
    const res = await call(admin, `/connections/${escrita}/explain`, {
      sql: "SELECT 1; COMMIT; CREATE TABLE fuga(x int)", analyze: true,
    });
    expect(res.status).toBe(400);
  });

  it("erro do Postgres vem com position relativa ao SQL do usuário, e cai no query_log", async () => {
    const r = await json<ExplainResponse>(await call(admin, `/connections/${leitura}/explain`, {
      sql: "SELECT nada FROM pedido",
    }));
    expect(r.error?.code).toBe("42703");
    expect(r.error?.position).toBe(8);
    const hist = await json<QueryLogEntry[]>(await call(admin, `/connections/${leitura}/history?limit=1`));
    expect(hist[0]?.sql).toBe("EXPLAIN (FORMAT JSON) SELECT nada FROM pedido");
  });
});

describe.if(temDocker)("variáveis de snippet (bind)", () => {
  it(":nome vira $n e o valor vai por bind, inclusive malicioso", async () => {
    const { sql } = nomearParametros("SELECT nome FROM cliente WHERE id = :id OR nome = :nome");
    const r = await json<QueryResponse>(await call(admin, `/connections/${leitura}/query`, {
      sql, params: ["3", "x'); DROP TABLE cliente; --"],
    }));
    expect(r.error).toBeNull();
    expect(r.results[0]?.rows).toEqual([["c3"]]);
  });

  it("params com mais de um statement é recusado", async () => {
    const res = await call(admin, `/connections/${leitura}/query`, { sql: "SELECT $1; SELECT 2", params: ["1"] });
    expect(res.status).toBe(400);
  });
});

describe.if(temDocker)("origem das colunas e FK no resultado de query livre", () => {
  it("JOIN com alias: cada coluna aponta para a tabela certa, e a FK alvo vem junto", async () => {
    const r = await json<QueryResponse>(await call(admin, `/connections/${leitura}/query`, {
      sql: "SELECT p.cliente_id AS c, c.nome, p.total * 2 AS dobro FROM pedido p JOIN cliente c ON c.id = p.cliente_id LIMIT 1",
    }));
    const [fk, nome, calc] = r.results[0]?.columns ?? [];
    expect(fk?.origin).toEqual({
      source: { schema: "public", table: "pedido", column: "cliente_id" },
      references: { schema: "public", table: "cliente", column: "id" },
    });
    expect(nome?.origin?.source).toEqual({ schema: "public", table: "cliente", column: "nome" });
    expect(nome?.origin?.references).toBeNull();
    expect(calc?.origin).toBeNull();
  });
});

describe.if(temDocker)("histórico por escopo", () => {
  it("mine traz só o que o ator rodou; team traz todos; cursor pagina", async () => {
    await call(membro, `/connections/${leitura}/query`, { sql: "SELECT 'do membro'" });
    await call(admin, `/connections/${leitura}/query`, { sql: "SELECT 'do admin'" });
    const meu = await json<QueryLogEntry[]>(await call(membro, `/connections/${leitura}/history?scope=mine`));
    expect(meu.map((e) => e.sql)).toEqual(["SELECT 'do membro'"]);
    const time = await json<QueryLogEntry[]>(await call(membro, `/connections/${leitura}/history?scope=team&limit=2`));
    expect(time).toHaveLength(2);
    const ultima = time[1];
    const prox = await json<QueryLogEntry[]>(await call(
      membro,
      `/connections/${leitura}/history?scope=team&limit=2&cursor=${encodeURIComponent(`${ultima?.executedAt ?? ""}|${ultima?.id ?? ""}`)}`,
    ));
    expect(prox.some((e) => time.some((t) => t.id === e.id))).toBe(false);
  });

  it("membro sem concessão: 404", async () => {
    expect((await call(membro, `/connections/${escrita}/history`)).status).toBe(404);
  });
});

describe.if(temDocker)("busca global", () => {
  it("acha no catálogo em cache só das conexões do ator", async () => {
    await call(admin, `/connections/${leitura}/schema`);
    await call(admin, `/connections/${escrita}/schema`);
    const doAdmin = await json<SearchResponse>(await call(admin, "/search?q=cliente_id"));
    expect(doAdmin.hits.filter((h) => h.kind === "column").length).toBeGreaterThanOrEqual(2);
    const doMembro = await json<SearchResponse>(await call(membro, "/search?q=cliente"));
    expect(new Set(doMembro.hits.map((h) => h.connectionName))).toEqual(new Set(["leitura"]));
  });
});

describe.if(temDocker)("data compare", () => {
  it("entre databases: resumo, amostra e SQL como texto — nada aplicado", async () => {
    const r = await json<DataCompareResponse>(await call(admin, "/compare/data", {
      left: { connectionId: leitura, schema: "public", table: "cliente" },
      right: { connectionId: outroDb, schema: "public", table: "cliente" },
      sampleSize: 5,
    }));
    expect([r.onlyLeft, r.onlyRight, r.different, r.equal]).toEqual([2, 1, 1, 47]);
    expect(r.sql).toContain(`UPDATE "public"."cliente" SET "nome" = 'c7' WHERE "id" = '7';`);
    expect(r.sql).toContain(`DELETE FROM "public"."cliente" WHERE "id" = '500';`);
    // Nada mudou no destino.
    const ainda = await json<QueryResponse>(await call(admin, `/connections/${outroDb}/query`, {
      sql: "SELECT nome FROM cliente WHERE id = 7",
    }));
    expect(ainda.results[0]?.rows).toEqual([["mudou"]]);
  });

  it("keyset em páginas: maxRows trunca e avisa", async () => {
    const r = await json<DataCompareResponse>(await call(admin, "/compare/data", {
      left: { connectionId: leitura, schema: "public", table: "pedido" },
      right: { connectionId: escrita, schema: "public", table: "pedido" },
      maxRows: 1500,
    }));
    expect(r.truncated).toBe(true);
    expect(r.equal).toBe(1500);
  });

  it("membro sem acesso a um dos lados: 404", async () => {
    const res = await call(membro, "/compare/data", {
      left: { connectionId: leitura, schema: "public", table: "cliente" },
      right: { connectionId: outroDb, schema: "public", table: "cliente" },
    });
    expect(res.status).toBe(404);
  });
});

describe.if(temDocker)("schema compare", () => {
  it("public × dev: diferenças e DDL sugerido, DROP só comentado", async () => {
    const r = await json<SchemaCompareResponse>(await call(admin, "/compare/schema", {
      left: { connectionId: leitura, schema: "dev" },
      right: { connectionId: leitura, schema: "public" },
    }));
    const kinds = r.differences.map((d) => `${d.kind}:${d.table}:${d.name ?? ""}`);
    expect(kinds).toContain("column_only_left:cliente:email");
    expect(kinds).toContain("table_only_left:so_dev:");
    expect(kinds).toContain("table_only_right:pedido:");
    expect(r.ddl).toContain(`ALTER TABLE "public"."cliente" ADD COLUMN "email" text;`);
    expect(r.ddl).toContain(`-- DROP TABLE "public"."pedido";`);
  });
});

describe.if(temDocker)("estatística de coluna", () => {
  it("total, nulos, distintos, mín/máx e top como string, com filtro parametrizado", async () => {
    const r = await json<ColumnStatsResponse>(await call(admin, `/connections/${leitura}/tables/public/pedido/stats`, {
      column: "cliente_id",
      filters: [{ column: "id", operator: "lte", value: "100" }],
    }));
    expect(r.total).toBe("100");
    expect(r.nulls).toBe("0");
    expect(r.distinct).toBe("50");
    expect([r.min, r.max]).toEqual(["1", "50"]);
    expect(r.top).toHaveLength(5);
    expect(r.top[0]?.count).toBe("2");
  });

  it("coluna inexistente é 400; sem concessão é 404", async () => {
    expect((await call(admin, `/connections/${leitura}/tables/public/pedido/stats`, { column: "x; DROP" })).status).toBe(400);
    expect((await call(membro, `/connections/${escrita}/tables/public/pedido/stats`, { column: "id" })).status).toBe(404);
  });
});

describe.if(temDocker)("copiar como INSERT", () => {
  it("o INSERT gerado, executado num Postgres real, devolve os mesmos valores", async () => {
    psql("app", "CREATE TABLE ida (id int PRIMARY KEY, t text, n numeric(12,3), j jsonb, d timestamptz, b bytea)");
    await call(admin, `/connections/${escrita}/schema?refresh=1`);
    const linhas: (string | null)[][] = [
      ["1", "it's \\ '); DROP TABLE ida; --", "12.500", '{"a": "x\'y"}', "2024-01-02 03:04:05+00", "\\x00ff"],
      ["2", "ção 🐝", null, null, null, null],
    ];
    const r = await json<{ sql: string }>(await call(admin, `/connections/${escrita}/tables/public/ida/insert-sql`, {
      columns: ["id", "t", "n", "j", "d", "b"],
      rows: linhas,
    }));
    const exec = await json<QueryResponse>(await call(admin, `/connections/${escrita}/query`, { sql: r.sql, readOnly: false }));
    expect(exec.error).toBeNull();
    const volta = await json<QueryResponse>(await call(admin, `/connections/${escrita}/query`, {
      sql: "SELECT id, t, n, j, d, b FROM ida ORDER BY id",
    }));
    expect(volta.results[0]?.rows).toEqual(linhas);
  });

  it("coluna fora do catálogo é 400; sem concessão é 404", async () => {
    expect((await call(admin, `/connections/${escrita}/tables/public/ida/insert-sql`, { columns: ["x\"y"], rows: [["1"]] })).status).toBe(400);
    expect((await call(membro, `/connections/${escrita}/tables/public/ida/insert-sql`, { columns: ["id"], rows: [["1"]] })).status).toBe(404);
  });
});
