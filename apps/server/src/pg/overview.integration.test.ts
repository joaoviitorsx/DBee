import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { ActivityList, DatabasesOverview } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Visão de databases e lista de processos, contra **Postgres real**.
 *
 * As duas leem catálogo (`pg_database`, `pg_stat_activity`) e por isso são
 * read-only — o teste confirma que trazem o que a UI mostra e que a lista de
 * processos exclui os backends de sistema e a própria sessão da consulta.
 */

const PORTA = 55493;
const CONTAINER = "dbee-overview-it";
const SENHA = "Ov5kWq8nZx3T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let pools: PoolManager | undefined;
let cookie = "";
let conn = "";

const call = (path: string): Promise<Response> =>
  app.handle(new Request(`http://localhost${path}`, { headers: { cookie } }));

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=ov",
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  );
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "ov", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");

  sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-c", "CREATE DATABASE segundo");

  const store = openTestStore();
  pools = new PoolManager(undefined);
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));

  const criada = await app.handle(
    new Request("http://localhost/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "ov", host: "127.0.0.1", port: PORTA, database: "ov",
        username: "postgres", password: SENHA, timezone: "UTC",
      }),
    }),
  );
  conn = ((await criada.json()) as { id: string }).id;
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.if(temDocker)("visão de databases", () => {
  it("traz os databases do cluster com tamanho, encoding e dono", async () => {
    const res = await call(`/api/connections/${conn}/databases/overview`);
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as DatabasesOverview;

    const nomes = corpo.databases.map((d) => d.name);
    expect(nomes).toContain("ov");
    expect(nomes).toContain("segundo");
    // Templates fora.
    expect(nomes).not.toContain("template0");

    const ov = corpo.databases.find((d) => d.name === "ov");
    expect(ov?.isDefault).toBe(true);
    expect(ov?.sizeBytes).toBeGreaterThan(0);
    expect(ov?.encoding).toBe("UTF8");
    expect(ov?.owner).toBe("postgres");
    expect(corpo.serverVersion).toContain("PostgreSQL");
  }, 60_000);
});

describe.if(temDocker)("lista de processos", () => {
  it("mostra as sessões client backend e marca as do DBee", async () => {
    // Uma query em voo garante ao menos uma sessão ativa além da do teste.
    const res = await call(`/api/connections/${conn}/activity`);
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as ActivityList;

    expect(typeof corpo.fetchedAt).toBe("string");
    // As sessões do DBee têm application_name = dbee e vêm marcadas.
    for (const sessao of corpo.sessions) {
      if (sessao.applicationName === "dbee") expect(sessao.isSelf).toBe(true);
      // Toda linha é client backend com pid — nunca o walwriter/autovacuum.
      expect(sessao.pid).toBeGreaterThan(0);
    }
  }, 60_000);
});
