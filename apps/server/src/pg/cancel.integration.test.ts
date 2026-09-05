import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { QueryResponse } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { QueryLogRepository } from "../db/queryLog.repo";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Cancelamento de query contra **Postgres real** (v0.2).
 *
 * A prova que só dado de verdade dá: uma query longa (`pg_sleep`) precisa voltar
 * **antes** do seu tempo quando cancelada, com o código 57014, e cair no
 * `query_log` como `cancelled` — não `error`. E o cancelamento roda por uma
 * conexão à parte, então funciona mesmo com o pool ocupado.
 */
const PORTA = 55492;
const CONTAINER = "dbee-cancel-it";
const SENHA = "Cx7pQz2mVx4T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let cookie = "";
let conn = "";

const call = (path: string, body: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

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

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));

  const res = await call("/api/connections", {
    name: "cancel", host: "127.0.0.1", port: PORTA, database: "app",
    username: "postgres", password: SENHA, timezone: "UTC",
  });
  conn = ((await res.json()) as { id: string }).id;
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.skipIf(!temDocker)("cancelamento de query", () => {
  it("cancela um pg_sleep antes do tempo e grava cancelled", async () => {
    const queryId = "qid-cancel-1";
    const inicio = performance.now();

    // Dispara a query longa sem aguardar.
    const emVoo = call(`/api/connections/${conn}/query`, {
      sql: "SELECT pg_sleep(5)",
      database: "app",
      queryId,
    });

    // Deixa a query registrar o backend PID, depois cancela.
    await Bun.sleep(700);
    const cancelRes = await call(`/api/connections/${conn}/query/cancel`, { queryId });
    expect(cancelRes.status).toBe(200);
    expect(((await cancelRes.json()) as { cancelled: boolean }).cancelled).toBe(true);

    // A query volta agora, não daqui a 5 s, e volta com erro de cancelamento.
    const res = await emVoo;
    const decorrido = performance.now() - inicio;
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as QueryResponse;
    expect(corpo.error).not.toBeNull();
    expect(corpo.error?.code).toBe("57014");
    // Bem menor que os 5 s do sleep: a prova de que cancelou de verdade.
    expect(decorrido).toBeLessThan(4000);

    const log = new QueryLogRepository(store.db);
    const entrada = log.list(10).find((e) => e.sql === "SELECT pg_sleep(5)");
    expect(entrada?.status).toBe("cancelled");
  });

  it("cancelar um queryId que já terminou devolve cancelled: false", async () => {
    const res = await call(`/api/connections/${conn}/query/cancel`, { queryId: "nao-existe" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cancelled: boolean }).cancelled).toBe(false);
  });
});
