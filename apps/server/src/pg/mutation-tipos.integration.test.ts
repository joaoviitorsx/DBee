import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Edição e exclusão de linha em tabelas "não comuns", contra **PostGIS real**
 * (ideias-comunidade I7 — o bug famoso dos outros clientes: DBeaver #9964,
 * edição com PK uuid; crash com PostGIS).
 *
 * Cada teste lê a linha **pela mesma rota que a grade usa** (`/rows`), manda
 * os valores lidos de volta como `from`/`guard` — é o ida-e-volta que a tela
 * faz — e confere o estado do banco depois, por fora do DBee:
 *
 * - só a linha-alvo mudou (contagem antes/depois e as vizinhas intactas);
 * - os valores não editados voltam idênticos, caractere a caractere (regra 10);
 * - um terceiro mexendo na linha no meio dispara `row_changed`;
 * - tabela sem PK é recusada com erro claro, nunca editada por aproximação.
 */

const PORTA = 55604;
const CONTAINER = "dbee-mutation-tipos-it";
const SENHA = "Tp4mQz9nVx2W";

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

const psql = (sql: string): string => {
  const r = Bun.spawnSync([
    "docker", "exec", "-i", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "app", "-tAc", sql,
  ]);
  if (r.exitCode !== 0) throw new Error(`psql falhou: ${r.stderr.toString()}`);
  return r.stdout.toString().replace(/\n$/, "");
};

/** Fotografia textual da tabela inteira, ordenada — para "as outras não mudaram". */
const foto = (tabela: string, ordem: string): string =>
  psql(`SELECT string_agg(t::text, E'\\n' ORDER BY ${ordem}) FROM ${tabela} t`);

type Cell = string | null;
interface Lidas { columns: { name: string }[]; rows: Cell[][]; primaryKey: string[] }

/** Lê pela rota da grade — os valores exatamente como a tela os recebe. */
async function ler(tabela: string): Promise<Lidas> {
  const res = await call(`/api/connections/${conn}/tables/public/${tabela}/rows`, {
    database: "app", limit: 1000,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Lidas;
}

/** A linha cuja coluna `col` vale `valor`, como objeto nome → célula. */
function linha(l: Lidas, col: string, valor: string): Record<string, Cell> {
  const i = l.columns.findIndex((c) => c.name === col);
  const achada = l.rows.find((r) => r[i] === valor);
  if (achada === undefined) throw new Error(`linha ${col}=${valor} não encontrada`);
  return Object.fromEntries(l.columns.map((c, j) => [c.name, achada[j] ?? null]));
}

const alvo = (table: string) => ({ database: "app", schema: "public", table, readOnly: false as const });

const pkDe = (l: Lidas, r: Record<string, Cell>) =>
  l.primaryKey.map((c) => ({ column: c, value: r[c] ?? "" }));

const guardaDe = (l: Lidas, r: Record<string, Cell>) =>
  l.columns.filter((c) => !l.primaryKey.includes(c.name)).map((c) => ({ column: c.name, value: r[c.name] ?? null }));

async function codigo(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=app",
    "-p", `${String(PORTA)}:5432`, "postgis/postgis:16-3.4",
  );
  let pronto = false;
  for (let i = 0; i < 160; i++) {
    // A imagem do PostGIS reinicia o servidor depois do init: espera a
    // extensão existir, não só o primeiro SELECT 1.
    if (sh("docker", "exec", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "app", "-tAc",
      "CREATE EXTENSION IF NOT EXISTS postgis")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("PostGIS do teste não ficou pronto");

  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "app", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        CREATE TABLE por_uuid (id uuid PRIMARY KEY, nome text);
        INSERT INTO por_uuid VALUES
          ('0f8fad5b-d9cb-469f-a165-70867728950e','um'),
          ('7c9e6679-7425-40de-944b-e07fc1f90ae7','dois'),
          ('7c9e6679-7425-40de-944b-e07fc1f90ae8','tres');

        CREATE TABLE composta2 (a text, b int, v text, PRIMARY KEY (a, b));
        INSERT INTO composta2 VALUES ('x',1,'x1'),('x',2,'x2'),('y',1,'y1');

        CREATE TABLE composta3 (a text, b int, c timestamptz, v text, PRIMARY KEY (a, b, c));
        -- Duas linhas que só diferem no microssegundo da PK.
        INSERT INTO composta3 VALUES
          ('k',1,'2026-01-01 10:00:00.123456+00','a'),
          ('k',1,'2026-01-01 10:00:00.123457+00','b'),
          ('k',2,'2026-01-01 10:00:00.123456+00','c');

        CREATE TABLE ricos (
          id int PRIMARY KEY,
          geo geometry(Point, 4326),
          area geometry,
          jb jsonb,
          arr text[],
          num numeric(40, 20),
          ts timestamptz,
          txt text,
          obs text
        );
        INSERT INTO ricos
          SELECT g, ST_SetSRID(ST_MakePoint(-46.633308, -23.550520), 4326),
                 ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))'),
                 '{"b": [1, 2.50], "a": {"x": null}}',
                 ARRAY['com espaço ', NULL, 'a,b', '"q"'],
                 12345678901234567890.12345678901234567890,
                 '2026-03-01 12:34:56.789012+00',
                 'fim com espaço  ',
                 'o' || g
            FROM generate_series(1, 3) g;

        CREATE TABLE sem_pk (k text, v text);
        INSERT INTO sem_pk VALUES ('u','1'),('d','1'),('d','1');
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));
  const res = await call("/api/connections", {
    name: "w", host: "127.0.0.1", port: PORTA, database: "app",
    username: "postgres", password: SENHA, timezone: "UTC", writeEnabled: true,
  });
  conn = ((await res.json()) as { id: string }).id;
}, 240_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.skipIf(!temDocker)("edição com PK uuid", () => {
  it("edita só a linha-alvo, mesmo com uuid vizinho quase igual", async () => {
    const l = await ler("por_uuid");
    expect(l.primaryKey).toEqual(["id"]);
    const r = linha(l, "nome", "dois");
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("por_uuid"), pk: pkDe(l, r), changes: [{ column: "nome", from: "dois", to: "DOIS" }],
    });
    expect(res.status).toBe(200);
    expect(psql("SELECT string_agg(nome, ',' ORDER BY nome) FROM por_uuid")).toBe("DOIS,tres,um");
  });

  it("exclui só a linha-alvo e row_changed com terceiro no meio", async () => {
    const l = await ler("por_uuid");
    const r = linha(l, "nome", "tres");
    psql("UPDATE por_uuid SET nome = 'tres*' WHERE nome = 'tres'");
    const velho = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("por_uuid"), pk: pkDe(l, r), guard: guardaDe(l, r),
    });
    expect(velho.status).toBe(409);
    expect(await codigo(velho)).toBe("row_changed");
    expect(psql("SELECT count(*) FROM por_uuid")).toBe("3");

    const l2 = await ler("por_uuid");
    const r2 = linha(l2, "nome", "tres*");
    const ok = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("por_uuid"), pk: pkDe(l2, r2), guard: guardaDe(l2, r2),
    });
    expect(ok.status).toBe(200);
    expect(psql("SELECT string_agg(nome, ',' ORDER BY nome) FROM por_uuid")).toBe("DOIS,um");
  });
});

describe.skipIf(!temDocker)("edição com PK composta", () => {
  it("2 colunas: só (x,2) muda; (x,1) e (y,1) intactas", async () => {
    const l = await ler("composta2");
    expect(l.primaryKey).toEqual(["a", "b"]);
    const r = linha(l, "v", "x2");
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("composta2"), pk: pkDe(l, r), changes: [{ column: "v", from: "x2", to: "X2" }],
    });
    expect(res.status).toBe(200);
    expect(foto("composta2", "a, b")).toBe("(x,1,x1)\n(x,2,X2)\n(y,1,y1)");
  });

  it("2 colunas: PK parcial nunca casa duas linhas", async () => {
    const l = await ler("composta2");
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("composta2"), pk: [{ column: "a", value: "x" }],
      changes: [{ column: "v", from: "x1", to: "zz" }],
    });
    expect(res.status).toBe(409);
    expect(foto("composta2", "a, b")).toBe("(x,1,x1)\n(x,2,X2)\n(y,1,y1)");
    expect(l.rows.length).toBe(3);
  });

  it("3 colunas text+int+timestamptz: o microssegundo da PK separa as linhas", async () => {
    const l = await ler("composta3");
    expect(l.primaryKey).toEqual(["a", "b", "c"]);
    const r = linha(l, "v", "b");
    // O valor que a grade devolve tem os 6 dígitos — perder um apagaria a vizinha.
    expect(r["c"]).toBe("2026-01-01 10:00:00.123457+00");
    const antes = foto("composta3", "a, b, c");

    const res = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("composta3"), pk: pkDe(l, r), guard: guardaDe(l, r),
    });
    expect(res.status).toBe(200);
    expect(psql("SELECT count(*) FROM composta3")).toBe("2");
    expect(foto("composta3", "a, b, c")).toBe(
      antes.split("\n").filter((x) => !x.endsWith(",b)")).join("\n"),
    );
  });

  it("3 colunas: terceiro muda a linha no meio → row_changed, nada apagado", async () => {
    const l = await ler("composta3");
    const r = linha(l, "v", "c");
    psql("UPDATE composta3 SET v = 'c*' WHERE v = 'c'");
    const res = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("composta3"), pk: pkDe(l, r), guard: guardaDe(l, r),
    });
    expect(res.status).toBe(409);
    expect(await codigo(res)).toBe("row_changed");
    expect(psql("SELECT count(*) FROM composta3")).toBe("2");
  });
});

describe.skipIf(!temDocker)("linha com geometry, jsonb, array, numeric, timestamptz µs e espaço no fim", () => {
  it("editar uma coluna devolve as outras idênticas e não toca as vizinhas", async () => {
    const antes = psql("SELECT t::text FROM ricos t WHERE id = 2");
    const vizinhas = psql("SELECT string_agg(t::text, E'\\n' ORDER BY id) FROM ricos t WHERE id <> 2");
    const l = await ler("ricos");
    const r = linha(l, "id", "2");
    // Regra 10: o que a grade mostra é o texto do Postgres, sem arredondar.
    expect(r["num"]).toBe("12345678901234567890.12345678901234567890");
    expect(r["ts"]).toBe("2026-03-01 12:34:56.789012+00");
    expect(r["txt"]).toBe("fim com espaço  ");

    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("ricos"), pk: pkDe(l, r), changes: [{ column: "obs", from: "o2", to: "O2" }],
    });
    expect(res.status).toBe(200);
    expect(psql("SELECT t::text FROM ricos t WHERE id = 2")).toBe(antes.replace(",o2)", ",O2)"));
    expect(psql("SELECT string_agg(t::text, E'\\n' ORDER BY id) FROM ricos t WHERE id <> 2")).toBe(vizinhas);
  });

  it("editar as colunas difíceis com o valor lido como from — guarda casa e grava", async () => {
    const l = await ler("ricos");
    const r = linha(l, "id", "1");
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("ricos"), pk: pkDe(l, r),
      changes: [
        { column: "geo", from: r["geo"] ?? null, to: "SRID=4326;POINT(1 2)" },
        { column: "jb", from: r["jb"] ?? null, to: '{"z": 1}' },
        { column: "arr", from: r["arr"] ?? null, to: "{a}" },
        { column: "num", from: r["num"] ?? null, to: "0.00000000000000000001" },
        { column: "ts", from: r["ts"] ?? null, to: "2026-03-01 12:34:56.000001+00" },
        { column: "txt", from: r["txt"] ?? null, to: "novo  " },
      ],
    });
    expect(res.status).toBe(200);
    expect(psql("SELECT ST_AsText(geo) || '|' || jb::text || '|' || arr::text || '|' || num::text || '|' || ts::text || '|' || txt || '#' FROM ricos WHERE id = 1"))
      .toBe("POINT(1 2)|{\"z\": 1}|{a}|0.00000000000000000001|2026-03-01 12:34:56.000001+00|novo  #");
  });

  it("guarda com o texto sem o espaço do fim NÃO casa (não confunde 'x' com 'x  ')", async () => {
    const l = await ler("ricos");
    const r = linha(l, "id", "3");
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("ricos"), pk: pkDe(l, r), changes: [{ column: "txt", from: "fim com espaço", to: "x" }],
    });
    expect(res.status).toBe(409);
    expect(await codigo(res)).toBe("row_changed");
    expect(psql("SELECT txt || '#' FROM ricos WHERE id = 3")).toBe("fim com espaço  #");
  });

  it("exclui a linha com geometry pela guarda completa; terceiro no meio → row_changed", async () => {
    const l = await ler("ricos");
    const r = linha(l, "id", "3");
    psql("UPDATE ricos SET geo = ST_SetSRID(ST_MakePoint(0, 0), 4326) WHERE id = 3");
    const velho = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("ricos"), pk: pkDe(l, r), guard: guardaDe(l, r),
    });
    expect(velho.status).toBe(409);
    expect(await codigo(velho)).toBe("row_changed");

    const l2 = await ler("ricos");
    const r2 = linha(l2, "id", "3");
    const ok = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("ricos"), pk: pkDe(l2, r2), guard: guardaDe(l2, r2),
    });
    expect(ok.status).toBe(200);
    expect(psql("SELECT string_agg(id::text, ',' ORDER BY id) FROM ricos")).toBe("1,2");
  });
});

describe.skipIf(!temDocker)("tabela sem PK", () => {
  it("a grade avisa que não há PK", async () => {
    const l = await ler("sem_pk");
    expect(l.primaryKey).toEqual([]);
  });

  it("UPDATE por coluna que identifica uma linha só é recusado mesmo assim", async () => {
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("sem_pk"), pk: [{ column: "k", value: "u" }], changes: [{ column: "v", from: "1", to: "2" }],
    });
    expect(res.status).toBe(409);
    const corpo = (await res.json()) as { code: string; message: string };
    expect(corpo.code).toBe("not_primary_key");
    expect(corpo.message).toContain("chave primária");
    expect(foto("sem_pk", "k, v")).toBe("(d,1)\n(d,1)\n(u,1)");
  });

  it("DELETE de linha duplicada é recusado e nada é apagado", async () => {
    const res = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("sem_pk"), pk: [{ column: "k", value: "d" }], guard: [{ column: "v", value: "1" }],
    });
    expect(res.status).toBe(409);
    expect(await codigo(res)).toBe("not_primary_key");
    expect(psql("SELECT count(*) FROM sem_pk")).toBe("3");
  });

  it("numa tabela COM PK, mandar coluna que não é a PK também é recusado", async () => {
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("composta2"), pk: [{ column: "v", value: "y1" }], changes: [{ column: "v", from: "y1", to: "q" }],
    });
    expect(res.status).toBe(409);
    expect(await codigo(res)).toBe("not_primary_key");
    expect(psql("SELECT v FROM composta2 WHERE a = 'y'")).toBe("y1");
  });
});
