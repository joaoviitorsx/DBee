import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SESSION_COOKIE, type QueryLogEntry } from "@dbee/shared";

import { createApp } from "../app";
import { criarPrimeiroUsuario } from "../db/bootstrap";
import { openTestStore } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { PoolManager } from "../pg/pool";

/**
 * O `actor` do `query_log` é o id do usuário (DBee.md §2.4, §7).
 *
 * **É a razão de a autenticação existir**, não um efeito colateral dela: um log
 * de auditoria cujo `actor` é a mesma string para todo mundo dá aparência de
 * controle sem controle, e em contexto contábil isso é pior que não ter log.
 *
 * Contra Postgres real porque o registro só acontece depois da execução — um
 * teste com banco falso confirmaria a intenção, não o efeito.
 */

const PORTA = 55499;
const CONTAINER = "dbee-actor-it";
const SENHA_PG = "Ac9tRq4mZx7B";
const SENHA_USUARIO = "senha-de-teste-123";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let pools: PoolManager | undefined;
let cookie = "";
let userId = "";
let conn = "";

const chamar = (
  metodo: string,
  caminho: string,
  body?: unknown,
  comCookie = true,
): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${caminho}`, {
      method: metodo,
      headers: {
        "content-type": "application/json",
        ...(comCookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

beforeAll(async () => {
  if (!temDocker) return;

  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA_PG}`, "-e", "POSTGRES_DB=aud",
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  );
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "aud", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");

  sh(
    "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "aud", "-q", "-c",
    "CREATE TABLE t (id int PRIMARY KEY, nome text); INSERT INTO t VALUES (1,'um'),(2,'dois');",
  );

  const store = openTestStore();
  const users = new UsersRepository(store.db);
  const primeiro = await criarPrimeiroUsuario(users);
  if (primeiro === null) throw new Error("sem primeiro usuário");
  userId = primeiro.user.id;

  // Sai do estado de troca obrigatória.
  users.trocarSenha(
    userId,
    await Bun.password.hash(SENHA_USUARIO, { algorithm: "argon2id" }),
  );

  pools = new PoolManager(undefined);
  app = createApp({ store, caCert: undefined, pools });

  const login = await chamar(
    "POST", "/api/auth/login",
    { username: "admin", password: SENHA_USUARIO },
    false,
  );
  const token = /dbee_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1];
  if (token === undefined) throw new Error("login não devolveu cookie");
  cookie = `${SESSION_COOKIE}=${token}`;

  const criada = await chamar("POST", "/api/connections", {
    name: "aud", host: "127.0.0.1", port: PORTA, database: "aud",
    username: "postgres", password: SENHA_PG, timezone: "UTC",
  });
  conn = ((await criada.json()) as { id: string }).id;
}, 120_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
});

async function historico(): Promise<QueryLogEntry[]> {
  const res = await chamar("GET", `/api/connections/${conn}/history?limit=50`);
  expect(res.status).toBe(200);
  return (await res.json()) as QueryLogEntry[];
}

describe.if(temDocker)("actor no query_log", () => {
  it("query grava o id do usuário, nunca 'unauthenticated'", async () => {
    const res = await chamar("POST", `/api/connections/${conn}/query`, {
      sql: "SELECT 1 AS auditoria_query",
    });
    expect(res.status).toBe(200);

    const entrada = (await historico()).find((e) => e.sql.includes("auditoria_query"));
    expect(entrada?.actor).toBe(userId);
    expect(entrada?.actor).not.toBe("unauthenticated");
  }, 60_000);

  it("leitura de linhas grava o mesmo actor", async () => {
    const res = await chamar("POST", `/api/connections/${conn}/tables/public/t/rows`, {
      limit: 10,
    });
    expect(res.status).toBe(200);

    const entrada = (await historico()).find((e) => e.sql.includes("FROM \"public\".\"t\""));
    expect(entrada?.actor).toBe(userId);
  }, 60_000);

  it("export — que devolve stream — também grava o actor", async () => {
    // O registro do export acontece no fim do stream, não no fim do handler:
    // se o `actor` não atravessasse o callback, esta linha viria vazia.
    const res = await chamar("POST", `/api/connections/${conn}/export`, {
      source: { kind: "table", schema: "public", table: "t" },
      format: "csv",
    });
    expect(res.status).toBe(200);
    await res.text();

    const entrada = (await historico()).find((e) => e.sql.includes("FROM \"public\".\"t\""));
    expect(entrada?.actor).toBe(userId);
  }, 60_000);

  it("nenhuma linha do log tem actor vazio ou 'unauthenticated'", async () => {
    const todas = await historico();
    expect(todas.length).toBeGreaterThan(0);
    const ruins = todas.filter((e) => e.actor === "" || e.actor === "unauthenticated");
    expect(ruins).toEqual([]);
  }, 60_000);
});
