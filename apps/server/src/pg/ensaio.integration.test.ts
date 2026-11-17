import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { QueryLogRepository } from "../db/queryLog.repo";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Ensaio de escrita e aplicação conferida (ADR 021) contra **Postgres real**.
 *
 * Cada teste confere o **estado do banco depois**, por fora do DBee (psql no
 * container): a promessa do ensaio é "nada foi gravado", e só o banco prova.
 */

const PORTA = 55601;
const CONTAINER = "dbee-ensaio-it";
const SENHA = "En5aIoQz2mVx";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let cookie = "";
let connWrite = "";
let connRo = "";
let connProd = "";

const call = (path: string, body: unknown, method = "POST"): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

const valor = (sql: string): string => {
  const r = Bun.spawnSync(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", sql]);
  if (r.exitCode !== 0) throw new Error(`psql falhou: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

interface Lote {
  results: { rowCount: number; command: string | null; rows: (string | null)[][]; truncated: boolean }[];
  error: { code: string | null; message: string; index: number; position: number | null } | null;
  rolledBack?: boolean;
  committed?: boolean;
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=app",
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  );
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");
  valor(`CREATE TABLE itens (id int PRIMARY KEY, status text);
         INSERT INTO itens SELECT g, 'novo' FROM generate_series(1, 120) g;`);

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));
  const criar = async (name: string, writeEnabled: boolean, environment?: string): Promise<string> => {
    const res = await call("/api/connections", {
      name, host: "127.0.0.1", port: PORTA, database: "app",
      username: "postgres", password: SENHA, writeEnabled,
      ...(environment === undefined ? {} : { environment }),
    });
    return ((await res.json()) as { id: string }).id;
  };
  connWrite = await criar("dev", true, "development");
  connRo = await criar("ro", false);
  connProd = await criar("prod-app", true, "production");
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.skipIf(!temDocker)("ensaio de escrita", () => {
  it("devolve o rowCount por statement e NÃO grava", async () => {
    const res = await call(`/api/connections/${connWrite}/query/dry-run`, {
      sql: "UPDATE itens SET status = 'x' WHERE id <= 10; DELETE FROM itens WHERE id > 115",
    });
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as Lote;
    expect(corpo.error).toBeNull();
    expect(corpo.rolledBack).toBe(true);
    expect(corpo.results.map((r) => [r.command, r.rowCount])).toEqual([["UPDATE", 10], ["DELETE", 5]]);
    expect(valor("SELECT count(*) FROM itens WHERE status = 'x'")).toBe("0");
    expect(valor("SELECT count(*) FROM itens")).toBe("120");
  });

  it("RETURNING vira amostra cortada, com o rowCount inteiro", async () => {
    const res = await call(`/api/connections/${connWrite}/query/dry-run`, {
      sql: "UPDATE itens SET status = 'y' RETURNING id, status",
    });
    const corpo = (await res.json()) as Lote;
    const r = corpo.results[0];
    expect(r?.rowCount).toBe(120);
    expect(r?.rows.length).toBe(50);
    expect(r?.truncated).toBe(true);
    expect(r?.rows[0]?.[1]).toBe("y");
    expect(valor("SELECT count(*) FROM itens WHERE status = 'y'")).toBe("0");
  });

  it("COMMIT embutido é recusado pelo servidor e nada é gravado", async () => {
    for (const sql of [
      "UPDATE itens SET status = 'c' WHERE id = 1; COMMIT",
      "UPDATE itens SET status = 'c' WHERE id = 1; COMMIT AND CHAIN; UPDATE itens SET status = 'c' WHERE id = 2",
      "UPDATE itens SET status = 'c' WHERE id = 1; END",
      "UPDATE itens SET status = 'c' WHERE id = 1; ROLLBACK; UPDATE itens SET status = 'c' WHERE id = 2",
    ]) {
      const res = await call(`/api/connections/${connWrite}/query/dry-run`, { sql });
      const corpo = (await res.json()) as Lote;
      expect(corpo.error?.index).toBe(1);
      expect(corpo.error?.message).toContain("o ensaio aceita só comandos DML");
      expect(valor("SELECT count(*) FROM itens WHERE status = 'c'")).toBe("0");
    }
  });

  it("DDL é recusado no ensaio (e o servidor não cria nada)", async () => {
    const res = await call(`/api/connections/${connWrite}/query/dry-run`, { sql: "CREATE TABLE zz (x int)" });
    const corpo = (await res.json()) as Lote;
    expect(corpo.error?.index).toBe(0);
    expect(valor("SELECT count(*) FROM pg_class WHERE relname = 'zz'")).toBe("0");
  });

  it("não deixa prepared statement para trás na sessão do pool", async () => {
    await call(`/api/connections/${connWrite}/query/dry-run`, { sql: "UPDATE itens SET status = 'p' WHERE id = 3" });
    const res = await call(`/api/connections/${connWrite}/query`, {
      sql: "SELECT count(*) FROM pg_prepared_statements",
    });
    const corpo = (await res.json()) as Lote;
    expect(corpo.results[0]?.rows[0]?.[0]).toBe("0");
  });

  it("conexão sem escrita: 403, e o ensaio não existe ali", async () => {
    const res = await call(`/api/connections/${connRo}/query/dry-run`, { sql: "UPDATE itens SET status = 'z'" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("write_forbidden");
  });

  it("o ensaio cai no query_log marcado como ensaio", () => {
    const log = new QueryLogRepository(store.db).list(200, connWrite);
    const ensaio = log.find((e) => e.sql.startsWith("UPDATE itens SET status = 'x'"));
    expect(ensaio?.dryRun).toBe(true);
    expect(ensaio?.readOnly).toBe(false);
  });
});

describe.skipIf(!temDocker)("aplicar conferido", () => {
  it("commita quando o rowCount bate com o ensaio", async () => {
    const res = await call(`/api/connections/${connWrite}/query/apply`, {
      sql: "UPDATE itens SET status = 'ok' WHERE id <= 4", expectedRowCounts: [4],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Lote).committed).toBe(true);
    expect(valor("SELECT count(*) FROM itens WHERE status = 'ok'")).toBe("4");
  });

  it("reverte com 409 dry_run_mismatch quando o banco mudou desde o ensaio", async () => {
    // O ensaio viu 5 linhas; uma segunda sessão acrescenta uma antes do aplicar.
    valor("INSERT INTO itens VALUES (500, 'novo')");
    const res = await call(`/api/connections/${connWrite}/query/apply`, {
      sql: "UPDATE itens SET status = 'mm' WHERE id > 115", expectedRowCounts: [5],
    });
    expect(res.status).toBe(409);
    const corpo = (await res.json()) as { code: string; message: string };
    expect(corpo.code).toBe("dry_run_mismatch");
    expect(corpo.message).toContain("ensaio 5, agora 6");
    expect(valor("SELECT count(*) FROM itens WHERE status = 'mm'")).toBe("0");
  });

  it("quantidade de statements diferente também diverge", async () => {
    const res = await call(`/api/connections/${connWrite}/query/apply`, {
      sql: "UPDATE itens SET status = 'q' WHERE id = 7; UPDATE itens SET status = 'q' WHERE id = 8",
      expectedRowCounts: [1],
    });
    expect(res.status).toBe(409);
    expect(valor("SELECT count(*) FROM itens WHERE status = 'q'")).toBe("0");
  });

  it("erro de SQL no meio: 200 com error, committed false, nada gravado", async () => {
    const res = await call(`/api/connections/${connWrite}/query/apply`, {
      sql: "UPDATE itens SET status = 'e' WHERE id = 9; UPDATE nao_existe SET a = 1",
      expectedRowCounts: [1, 0],
    });
    const corpo = (await res.json()) as Lote;
    expect(corpo.committed).toBe(false);
    expect(corpo.error?.code).toBe("42P01");
    expect(valor("SELECT count(*) FROM itens WHERE status = 'e'")).toBe("0");
  });

  it("produção exige o nome digitado; com o nome, grava", async () => {
    const sem = await call(`/api/connections/${connProd}/query/apply`, {
      sql: "UPDATE itens SET status = 'prod' WHERE id = 11", expectedRowCounts: [1],
    });
    expect(sem.status).toBe(400);
    expect(((await sem.json()) as { code: string }).code).toBe("confirmation_required");
    expect(valor("SELECT count(*) FROM itens WHERE status = 'prod'")).toBe("0");

    const com = await call(`/api/connections/${connProd}/query/apply`, {
      sql: "UPDATE itens SET status = 'prod' WHERE id = 11", expectedRowCounts: [1], confirmName: "prod-app",
    });
    expect(com.status).toBe(200);
    expect(valor("SELECT count(*) FROM itens WHERE status = 'prod'")).toBe("1");
  });

  it("o aplicar entra no query_log como execução real (dryRun false)", () => {
    const log = new QueryLogRepository(store.db).list(200, connWrite);
    const real = log.find((e) => e.sql === "UPDATE itens SET status = 'ok' WHERE id <= 4");
    expect(real?.dryRun).toBe(false);
    expect(real?.status).toBe("ok");
  });
});

describe.skipIf(!temDocker)("estado de sessão não volta ao pool", () => {
  it("advisory lock de sessão pego no ensaio é solto antes de devolver o cliente", async () => {
    await call(`/api/connections/${connWrite}/query/dry-run`, { sql: "SELECT pg_advisory_lock(4242)" });
    expect(valor("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 4242")).toBe("0");
  });
});

/*
 * Revisão de segurança v0.7 (achados 1 e 2): a confirmação de produção vale
 * também no /query de escrita, e estado de sessão de uma consulta de LEITURA
 * não volta ao pool.
 */
describe.skipIf(!temDocker)("revisão de segurança v0.7", () => {
  it("/query de escrita em produção sem o nome é recusado; com o nome, grava", async () => {
    const sem = await call(`/api/connections/${connProd}/query`, {
      sql: "UPDATE itens SET status = 'prodq' WHERE id = 12", readOnly: false,
    });
    expect(sem.status).toBe(400);
    expect(valor("SELECT count(*) FROM itens WHERE status = 'prodq'")).toBe("0");

    const com = await call(`/api/connections/${connProd}/query`, {
      sql: "UPDATE itens SET status = 'prodq' WHERE id = 12", readOnly: false, confirmName: "prod-app",
    });
    expect(com.status).toBe(200);
    expect(valor("SELECT count(*) FROM itens WHERE status = 'prodq'")).toBe("1");
  });

  it("leitura em produção não exige o nome", async () => {
    const r = await call(`/api/connections/${connProd}/query`, { sql: "SELECT 1" });
    expect(r.status).toBe(200);
  });

  it("advisory lock pego numa consulta READ ONLY é solto antes de devolver o cliente", async () => {
    const r = await call(`/api/connections/${connRo}/query`, { sql: "SELECT pg_advisory_lock(5151)" });
    expect(r.status).toBe(200);
    expect(valor("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 5151")).toBe("0");
  });
});
