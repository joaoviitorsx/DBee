import type { DatabaseSchema, ForeignKey, RowsResponse } from "@dbee/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Navegação por FK contra **Postgres real** (DBee.md §5).
 *
 * Duas coisas que só o banco de verdade prova: a FK **composta** volta com as
 * colunas na ordem certa (`columns[i]` casa `referencedColumns[i]`), e o salto
 * que ela alimenta — filtrar a tabela referenciada por essas colunas — acha a
 * linha certa. E a FK para uma tabela que o papel **não pode ler** some da
 * introspecção, para o salto não levar a um `permission denied` (a introspecção
 * filtra por `has_table_privilege` da tabela referenciada).
 */

const PORTA = 55493;
const CONTAINER = "dbee-fk-it";
const SENHA = "Fk7pQz2mVx4T";
const SENHA_LEITOR = "Le7pQz2mVx4T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let cookie = "";
let connSuper = "";
let connLeitor = "";

const call = (path: string, body: unknown, method = "POST"): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

/** FKs de uma relação, pela introspecção completa (`/schema`). */
async function fksDe(conn: string, tabela: string): Promise<ForeignKey[]> {
  const res = await call(`/api/connections/${conn}/schema?database=app`, undefined, "GET");
  if (res.status !== 200) throw new Error(`schema ${String(res.status)}: ${await res.text()}`);
  const schema = (await res.json()) as DatabaseSchema;
  const rel = schema.schemas
    .find((s) => s.name === "public")
    ?.relations.find((r) => r.name === tabela);
  return rel?.foreignKeys ?? [];
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
        -- PK composta + FK composta apontando para ela.
        CREATE TABLE pai (a int, b int, nome text, PRIMARY KEY (a, b));
        INSERT INTO pai VALUES (1, 10, 'um'), (2, 20, 'dois');

        CREATE TABLE filho (
          id int PRIMARY KEY, px int, py int,
          FOREIGN KEY (px, py) REFERENCES pai (a, b)
        );
        INSERT INTO filho VALUES (100, 1, 10), (101, 2, 20);

        -- Tabela referenciada que o papel restrito NÃO poderá ler: a FK para ela
        -- tem que sumir da introspecção do papel restrito.
        CREATE TABLE secreto (s int PRIMARY KEY);
        INSERT INTO secreto VALUES (7);
        CREATE TABLE aponta_secreto (id int PRIMARY KEY, sref int REFERENCES secreto (s));
        INSERT INTO aponta_secreto VALUES (1, 7);

        -- Papel de leitura restrito: lê pai/filho/aponta_secreto, NÃO lê secreto.
        CREATE ROLE leitor LOGIN PASSWORD '${SENHA_LEITOR}' NOSUPERUSER;
        GRANT CONNECT ON DATABASE app TO leitor;
        GRANT USAGE ON SCHEMA public TO leitor;
        GRANT SELECT ON pai, filho, aponta_secreto TO leitor;
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));

  const criar = async (name: string, username: string, password: string): Promise<string> => {
    const res = await call("/api/connections", {
      name, host: "127.0.0.1", port: PORTA, database: "app",
      username, password, timezone: "UTC", writeEnabled: false,
    });
    return ((await res.json()) as { id: string }).id;
  };
  connSuper = await criar("super", "postgres", SENHA);
  connLeitor = await criar("leitor", "leitor", SENHA_LEITOR);
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.skipIf(!temDocker)("navegação por FK", () => {
  it("a FK composta volta com as colunas na ordem certa", async () => {
    const fks = await fksDe(connSuper, "filho");
    expect(fks).toHaveLength(1);
    const fk = fks[0];
    expect(fk?.columns).toEqual(["px", "py"]);
    expect(fk?.referencedColumns).toEqual(["a", "b"]);
    expect(fk?.referencedTable).toBe("pai");
    expect(fk?.referencedSchema).toBe("public");
  });

  it("o salto pela FK composta filtra a tabela referenciada e acha a linha", async () => {
    // A linha filho (100, px=1, py=10) referencia pai (a=1, b=10). O salto do
    // grid vira estes filtros (referencedColumns[i] = valor de columns[i]).
    const res = await call(`/api/connections/${connSuper}/tables/public/pai/rows`, {
      filters: [
        { column: "a", operator: "eq", value: "1" },
        { column: "b", operator: "eq", value: "10" },
      ],
      limit: 100,
    });
    expect(res.status).toBe(200);
    const page = (await res.json()) as RowsResponse;
    expect(page.rows).toHaveLength(1);
    const nomeIdx = page.columns.findIndex((c) => c.name === "nome");
    expect(page.rows[0]?.[nomeIdx]).toBe("um");
  });

  it("FK para tabela ilegível pelo papel NÃO aparece — o salto não é oferecido", async () => {
    // O superusuário lê `secreto`, então enxerga a FK.
    expect(await fksDe(connSuper, "aponta_secreto")).toHaveLength(1);
    // O papel restrito não lê `secreto`: a FK some, e a UI não pinta o salto.
    expect(await fksDe(connLeitor, "aponta_secreto")).toHaveLength(0);
  });
});
