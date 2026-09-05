import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { QueryLogRepository } from "../db/queryLog.repo";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Edição de linha contra **Postgres real** (v0.2).
 *
 * Os defeitos desta fatia só aparecem com dado de verdade e com uma segunda
 * sessão mexendo no meio: linha alterada por terceiro entre a leitura e a
 * aplicação, `WHERE` que casaria duas linhas, escrita numa conexão de leitura.
 * Cada um tem um teste, e cada um confere o **estado do banco depois**, não só o
 * status HTTP — a garantia é que nada foi gravado quando não devia.
 */

const PORTA = 55491;
const CONTAINER = "dbee-mutation-it";
const SENHA = "Mu7pQz2mVx4T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let cookie = "";
let userId = "";
let connWrite = "";
let connReadOnly = "";

const call = (path: string, body: unknown, method = "POST"): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

/** Executa SQL cru no container, fora do DBee — simula a segunda sessão. */
const psql = (sql: string): void => {
  const r = Bun.spawnSync([
    "docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app",
    "-tAc", sql,
  ]);
  if (r.exitCode !== 0) throw new Error(`psql falhou: ${r.stderr.toString()}`);
};

const valorDireto = (sql: string): string => {
  const r = Bun.spawnSync([
    "docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", sql,
  ]);
  return r.stdout.toString().trim();
};

const alvo = { database: "app", schema: "public", readOnly: false as const };

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

  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        CREATE TABLE pessoas (id int PRIMARY KEY, nome text, apelido text);
        INSERT INTO pessoas VALUES (1,'Ana',NULL),(2,'Beto','bt'),(3,'Cadu','cd');

        -- Coluna NÃO única, para forçar o WHERE a casar duas linhas.
        CREATE TABLE dupes (id int PRIMARY KEY, k text, v text);
        INSERT INTO dupes VALUES (1,'same','a'),(2,'same','a'),(3,'other','a');
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie, userId } = await autenticar(store));

  const criar = async (name: string, writeEnabled: boolean): Promise<string> => {
    const res = await call("/api/connections", {
      name, host: "127.0.0.1", port: PORTA, database: "app",
      username: "postgres", password: SENHA, timezone: "UTC", writeEnabled,
    });
    return ((await res.json()) as { id: string }).id;
  };
  connWrite = await criar("write", true);
  connReadOnly = await criar("ro", false);
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.skipIf(!temDocker)("edição de linha — UPDATE", () => {
  it("aplica quando a linha não mudou, afetando exatamente uma", async () => {
    const res = await call(`/api/connections/${connWrite}/rows/update`, {
      ...alvo, table: "pessoas",
      pk: [{ column: "id", value: "1" }],
      changes: [{ column: "nome", from: "Ana", to: "Ana Maria" }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rowCount: number }).rowCount).toBe(1);
    expect(valorDireto("SELECT nome FROM pessoas WHERE id = 1")).toBe("Ana Maria");
  });

  it("aborta com row_changed se um terceiro alterou a linha antes", async () => {
    // Lemos apelido='cd'. Antes de aplicar, outra sessão muda para 'zz'.
    psql("UPDATE pessoas SET apelido = 'zz' WHERE id = 3");

    const res = await call(`/api/connections/${connWrite}/rows/update`, {
      ...alvo, table: "pessoas",
      pk: [{ column: "id", value: "3" }],
      changes: [{ column: "apelido", from: "cd", to: "novo" }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("row_changed");
    // Nada sobrescrito: continua o valor que o terceiro gravou.
    expect(valorDireto("SELECT apelido FROM pessoas WHERE id = 3")).toBe("zz");
  });

  it("um UPDATE que casaria duas linhas nunca commita", async () => {
    const res = await call(`/api/connections/${connWrite}/rows/update`, {
      ...alvo, table: "dupes",
      pk: [{ column: "k", value: "same" }], // não é PK real: casa id 1 e 2
      changes: [{ column: "v", from: "a", to: "b" }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("ambiguous_row");
    // Reverteu: as duas linhas continuam 'a'.
    expect(valorDireto("SELECT count(*) FROM dupes WHERE k='same' AND v='a'")).toBe("2");
  });

  it("recusa sem write_enabled na conexão", async () => {
    const res = await call(`/api/connections/${connReadOnly}/rows/update`, {
      ...alvo, table: "pessoas",
      pk: [{ column: "id", value: "2" }],
      changes: [{ column: "nome", from: "Beto", to: "X" }],
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("write_forbidden");
    expect(valorDireto("SELECT nome FROM pessoas WHERE id = 2")).toBe("Beto");
  });

  it("recusa quando readOnly é omitido (validação)", async () => {
    const res = await call(`/api/connections/${connWrite}/rows/update`, {
      database: "app", schema: "public", table: "pessoas",
      pk: [{ column: "id", value: "2" }],
      changes: [{ column: "nome", from: "Beto", to: "X" }],
      // readOnly ausente de propósito
    });
    expect(res.status).toBe(422);
    expect(valorDireto("SELECT nome FROM pessoas WHERE id = 2")).toBe("Beto");
  });

  it("grava o SQL literal e o actor no query_log", () => {
    const log = new QueryLogRepository(store.db);
    const entradas = log.list(50);
    const upd = entradas.find(
      (e) => e.status === "ok" && e.sql.startsWith('UPDATE "public"."pessoas"'),
    );
    expect(upd).toBeDefined();
    expect(upd?.sql).toContain(`SET "nome" = 'Ana Maria'`);
    expect(upd?.sql).toContain(`"nome" = 'Ana'`); // a guarda otimista, literal
    expect(upd?.actor).toBe(userId);
    expect(upd?.readOnly).toBe(false);
  });
});

describe.skipIf(!temDocker)("edição de linha — DELETE", () => {
  it("apaga exatamente uma linha pela PK", async () => {
    const res = await call(`/api/connections/${connWrite}/rows/delete`, {
      ...alvo, table: "pessoas",
      pk: [{ column: "id", value: "2" }],
    });
    expect(res.status).toBe(200);
    expect(valorDireto("SELECT count(*) FROM pessoas WHERE id = 2")).toBe("0");
  });

  it("um DELETE que casaria duas linhas nunca commita", async () => {
    const res = await call(`/api/connections/${connWrite}/rows/delete`, {
      ...alvo, table: "dupes",
      pk: [{ column: "k", value: "same" }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("ambiguous_row");
    expect(valorDireto("SELECT count(*) FROM dupes WHERE k='same'")).toBe("2");
  });

  it("recusa sem write_enabled", async () => {
    const res = await call(`/api/connections/${connReadOnly}/rows/delete`, {
      ...alvo, table: "pessoas",
      pk: [{ column: "id", value: "3" }],
    });
    expect(res.status).toBe(403);
    expect(valorDireto("SELECT count(*) FROM pessoas WHERE id = 3")).toBe("1");
  });
});
