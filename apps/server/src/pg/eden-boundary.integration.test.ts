import { treaty } from "@elysiajs/eden";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EDEN_CONFIG } from "@dbee/shared";

import { createApp } from "../app";
import type { App } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * A fronteira cliente/servidor, atravessada pelo Eden (DBee.md §11.43).
 *
 * O servidor garante que todo valor de célula é **string** (regra 10). O que
 * este teste prova é que o Eden não desfaz isso no caminho de volta: por padrão
 * ele converte qualquer string que pareça data ISO em `Date`. Com `EDEN_CONFIG`
 * (`parseDate: false`), `date`, `timestamptz` e até uma coluna de **texto** cujo
 * valor pareça data chegam string. O teste importa o **mesmo** `EDEN_CONFIG` que
 * o `lib/api.ts` usa — invertê-lo numa atualização de dependência falha aqui.
 *
 * Há também o controle: com o Eden **padrão** (sem `parseDate: false`), a coluna
 * `date` chega como `Date`. É o que torna a configuração necessária, e o que
 * prova que este teste testa o que diz testar.
 */

const PORTA = 55494;
const CONTAINER = "dbee-eden-it";
const SENHA = "Ed7pQz2mVx4T";
const NOTA_TEXTO = "2026-01-01 é o prazo"; // TEXTO que começa como data ISO

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

/** Lê `prazos` pelo cliente Eden, com a config passada. Devolve a 1ª linha. */
async function lerViaEden(config: Record<string, unknown>): Promise<(unknown)[]> {
  const client = treaty<App>(app, { ...config, headers: { cookie } });
  const { data, error } = await client.api
    .connections({ id: conn })
    .tables({ schema: "public" })({ table: "prazos" })
    .rows.post({ database: "app", limit: 10 });
  if (error !== null) throw new Error(`rows falhou: ${String(error.status)}`);
  const linha = data.rows[0];
  if (linha === undefined) throw new Error("sem linhas");
  return linha;
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

  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        CREATE TABLE prazos (
          id      int PRIMARY KEY,
          quando  date,
          criado  timestamptz,
          nota    text
        );
        INSERT INTO prazos VALUES
          (1, '2026-01-01', '2026-01-01 09:30:00+00', '${NOTA_TEXTO}');
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));

  const res = await call("/api/connections", {
    name: "eden", host: "127.0.0.1", port: PORTA, database: "app",
    username: "postgres", password: SENHA, timezone: "UTC", writeEnabled: false,
  });
  conn = ((await res.json()) as { id: string }).id;
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.skipIf(!temDocker)("fronteira Eden — parseDate", () => {
  it("com EDEN_CONFIG, date/timestamptz/texto-que-parece-data chegam STRING", async () => {
    // colunas: id, quando (date), criado (timestamptz), nota (text)
    const [id, quando, criado, nota] = await lerViaEden(EDEN_CONFIG);
    for (const [nome, v] of [["quando", quando], ["criado", criado], ["nota", nota], ["id", id]] as const) {
      expect(typeof v, `${nome} deveria ser string`).toBe("string");
      expect(v instanceof Date, `${nome} não pode ser Date`).toBe(false);
    }
    // O texto que começa como data ISO chega inteiro, sem virar Date nem perder o resto.
    expect(nota).toBe(NOTA_TEXTO);
    // O valor exato do Postgres, preservado (não a formatação de um Date do JS).
    expect(quando).toBe("2026-01-01");
  });

  it("controle: com o Eden PADRÃO, a coluna date chega como Date", async () => {
    // Sem `parseDate: false`. Se um dia o Eden parar de converter por padrão,
    // este controle falha — e aí `parseDate: false` pode ter virado redundante.
    const [, quando] = await lerViaEden({});
    expect(quando instanceof Date).toBe(true);
  });
});
