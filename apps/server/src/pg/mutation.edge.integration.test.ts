import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Edição e exclusão de linha em casos difíceis, contra Postgres + PostGIS reais.
 *
 * Para cada caso o teste prova, lendo pela MESMA rota que a grade usa:
 * - a contagem de linhas antes/depois é a esperada;
 * - só a linha alvo mudou — as demais saem idênticas, string a string;
 * - o valor lido de volta é exatamente o que foi enviado (regra 10);
 * - um terceiro mexendo na linha entre a leitura e o apply dispara
 *   `row_changed` e nada é gravado (guarda otimista, ADR 008).
 */

const PORTA = 55791;
const CONTAINER = "dbee-mutation-edge-it";
const SENHA = "Ed9pQz4mVx7T";
const IMAGEM = "postgis/postgis:16-3.4";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let pools: PoolManager | undefined;
let cookie = "";
let conn = "";

type Linha = (string | null)[];
interface Grade { columns: string[]; primaryKey: string[]; rows: Linha[] }

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
    "docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", sql,
  ]);
  if (r.exitCode !== 0) throw new Error(`psql falhou: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

const alvo = (table: string) => ({ database: "app", schema: "public", table, readOnly: false as const });

/** Lê a tabela inteira pela rota da grade (todo valor em texto). */
async function ler(table: string): Promise<Grade> {
  const res = await call(`/api/connections/${conn}/tables/public/${table}/rows`, { limit: 500 });
  if (res.status !== 200) throw new Error(`rows ${table}: ${String(res.status)}`);
  const b = (await res.json()) as { columns: { name: string }[]; primaryKey: string[]; rows: Linha[] };
  return { columns: b.columns.map((c) => c.name), primaryKey: b.primaryKey, rows: b.rows };
}

const col = (g: Grade, nome: string): number => {
  const i = g.columns.indexOf(nome);
  if (i < 0) throw new Error(`coluna ${nome} ausente`);
  return i;
};

/** Valores da PK da linha, na ordem de `g.primaryKey`. */
const pkDe = (g: Grade, l: Linha): { column: string; value: string }[] =>
  g.primaryKey.map((c) => {
    const v = l[col(g, c)];
    if (v === null || v === undefined) throw new Error("PK nula");
    return { column: c, value: v };
  });

const chave = (g: Grade, l: Linha): string => JSON.stringify(pkDe(g, l));

/** As linhas que não são a alvo, ordenadas pela PK, serializadas. */
const demais = (g: Grade, alvoChave: string): string =>
  JSON.stringify(g.rows.filter((l) => chave(g, l) !== alvoChave).sort((a, b) => chave(g, a).localeCompare(chave(g, b))));

function achar(g: Grade, pred: (l: Linha) => boolean): Linha {
  const l = g.rows.find(pred);
  if (l === undefined) throw new Error("linha alvo não encontrada");
  return l;
}

/** UPDATE de uma célula com tudo conferido. */
async function editarConferindo(
  table: string,
  pred: (l: Linha) => boolean,
  coluna: string,
  to: string | null,
): Promise<void> {
  const antes = await ler(table);
  const l = achar(antes, pred);
  const k = chave(antes, l);
  const from = l[col(antes, coluna)] ?? null;
  const res = await call(`/api/connections/${conn}/rows/update`, {
    ...alvo(table), pk: pkDe(antes, l), changes: [{ column: coluna, from, to }],
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { rowCount: number }).rowCount).toBe(1);

  const depois = await ler(table);
  expect(depois.rows.length).toBe(antes.rows.length);
  expect(demais(depois, k)).toBe(demais(antes, k));
  const nova = achar(depois, (x) => chave(depois, x) === k);
  const esperado = [...l];
  esperado[col(antes, coluna)] = to;
  expect(nova).toEqual(esperado);
}

/** Terceiro altera a linha entre a leitura e o apply: UPDATE e DELETE abortam. */
async function concorrenteAborta(
  table: string,
  pred: (l: Linha) => boolean,
  coluna: string,
  to: string,
  sqlTerceiro: string,
): Promise<void> {
  const lida = await ler(table);
  const l = achar(lida, pred);
  const k = chave(lida, l);
  psql(sqlTerceiro);
  const aposTerceiro = await ler(table);

  const upd = await call(`/api/connections/${conn}/rows/update`, {
    ...alvo(table), pk: pkDe(lida, l), changes: [{ column: coluna, from: l[col(lida, coluna)] ?? null, to }],
  });
  expect(upd.status).toBe(409);
  expect(((await upd.json()) as { code: string }).code).toBe("row_changed");

  const guard = lida.columns
    .filter((c) => !lida.primaryKey.includes(c))
    .map((c) => ({ column: c, value: l[col(lida, c)] ?? null }));
  const del = await call(`/api/connections/${conn}/rows/delete`, { ...alvo(table), pk: pkDe(lida, l), guard });
  expect(del.status).toBe(409);
  expect(((await del.json()) as { code: string }).code).toBe("row_changed");

  // Nada gravado: o banco é exatamente o que o terceiro deixou.
  const fim = await ler(table);
  expect(JSON.stringify(fim.rows.map((x) => x).sort())).toBe(JSON.stringify(aposTerceiro.rows.map((x) => x).sort()));
  expect(fim.rows.some((x) => chave(fim, x) === k)).toBe(true);
}

/** DELETE da linha com guarda completa: some só ela. */
async function excluirConferindo(table: string, pred: (l: Linha) => boolean): Promise<void> {
  const antes = await ler(table);
  const l = achar(antes, pred);
  const k = chave(antes, l);
  const guard = antes.columns
    .filter((c) => !antes.primaryKey.includes(c))
    .map((c) => ({ column: c, value: l[col(antes, c)] ?? null }));
  const res = await call(`/api/connections/${conn}/rows/delete`, { ...alvo(table), pk: pkDe(antes, l), guard });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { rowCount: number }).rowCount).toBe(1);
  const depois = await ler(table);
  expect(depois.rows.length).toBe(antes.rows.length - 1);
  expect(depois.rows.some((x) => chave(depois, x) === k)).toBe(false);
  expect(demais(depois, k)).toBe(demais(antes, k));
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=app",
    "-p", `${String(PORTA)}:5432`, IMAGEM,
  );
  // A imagem PostGIS reinicia o servidor depois do init: espera a extensão existir.
  let pronto = false;
  for (let i = 0; i < 160; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc",
      "SELECT 1 FROM pg_extension WHERE extname='postgis'")) {
      await Bun.sleep(1500);
      if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-tAc", "SELECT postgis_version()")) {
        pronto = true;
        break;
      }
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("PostGIS do teste não ficou pronto");

  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "app", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        CREATE TABLE t_uuid (id uuid PRIMARY KEY, v text);
        INSERT INTO t_uuid VALUES
          ('00000000-0000-0000-0000-000000000001','a'),
          ('00000000-0000-0000-0000-000000000002','b'),
          ('ffffffff-ffff-ffff-ffff-ffffffffffff','c');

        CREATE TABLE c2 (a text, b int, v text, PRIMARY KEY (a, b));
        INSERT INTO c2 VALUES ('k',1,'x'),('k',2,'x'),('j',1,'x'),('k ',1,'x');

        -- PK declarada (b, a, c), fora da ordem das colunas; linhas que diferem
        -- só no microssegundo do timestamptz.
        CREATE TABLE c3 (a text, b int, c timestamptz, v text, PRIMARY KEY (b, a, c));
        INSERT INTO c3 VALUES
          ('k',1,'2026-01-01 10:00:00.123456+00','a'),
          ('k',1,'2026-01-01 10:00:00.123457+00','b'),
          ('k',2,'2026-01-01 10:00:00.123456+00','c');

        CREATE TABLE tipos (
          id int PRIMARY KEY,
          g geometry(Point, 4326),
          jb jsonb,
          arr text[],
          n numeric(38,18),
          ts timestamptz,
          t text
        );
        INSERT INTO tipos VALUES
          (1, ST_GeomFromText('POINT(-46.633308 -23.550520)', 4326), '{"b":2,"a":[1,"x"]}',
              '{"a b","c ","",NULL}', 12345678901234567890.123456789012345678,
              '2026-03-01 12:00:00.000001+00', 'fim '),
          (2, ST_GeomFromText('POINT(1 2)', 4326), '{}', '{}', 0, '2026-03-01 12:00:00+00', ''),
          (3, NULL, NULL, NULL, NULL, NULL, NULL);

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
    name: "edge", host: "127.0.0.1", port: PORTA, database: "app",
    username: "postgres", password: SENHA, timezone: "UTC", writeEnabled: true,
  });
  conn = ((await res.json()) as { id: string }).id;
}, 300_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.skipIf(!temDocker)("PK uuid", () => {
  const p = (v: string) => (l: Linha) => l[0] === v;
  it("edita só a linha alvo", async () => {
    await editarConferindo("t_uuid", p("00000000-0000-0000-0000-000000000002"), "v", "B ");
  });
  it("concorrência dispara row_changed", async () => {
    await concorrenteAborta("t_uuid", p("00000000-0000-0000-0000-000000000001"), "v", "z",
      "UPDATE t_uuid SET v='a2' WHERE id='00000000-0000-0000-0000-000000000001'");
  });
  it("exclui só a linha alvo", async () => {
    await excluirConferindo("t_uuid", p("ffffffff-ffff-ffff-ffff-ffffffffffff"));
  });
});

describe.skipIf(!temDocker)("PK composta de 2 colunas (text + int)", () => {
  const p = (a: string, b: string) => (l: Linha) => l[0] === a && l[1] === b;
  it("a grade reporta a PK inteira", async () => {
    expect([...(await ler("c2")).primaryKey].sort()).toEqual(["a", "b"]);
  });
  it("edita só ('k',2), não ('k',1) nem ('k ',1)", async () => {
    await editarConferindo("c2", p("k", "2"), "v", "");
  });
  it("PK parcial é recusada e nada muda", async () => {
    const antes = await ler("c2");
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("c2"), pk: [{ column: "a", value: "j" }], changes: [{ column: "v", from: "x", to: "y" }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("not_primary_key");
    expect(JSON.stringify((await ler("c2")).rows)).toBe(JSON.stringify(antes.rows));
  });
  it("concorrência dispara row_changed", async () => {
    await concorrenteAborta("c2", p("j", "1"), "v", "y", "UPDATE c2 SET v='x2' WHERE a='j' AND b=1");
  });
  it("exclui ('k ',1) — com espaço no fim — e não ('k',1)", async () => {
    await excluirConferindo("c2", p("k ", "1"));
  });
});

describe.skipIf(!temDocker)("PK composta de 3 colunas (int + text + timestamptz µs)", () => {
  const p = (b: string, c: string) => (l: Linha) => l[1] === b && (l[2] ?? "").includes(c);
  it("a grade reporta a PK inteira e o µs em texto", async () => {
    const g = await ler("c3");
    expect([...g.primaryKey].sort()).toEqual(["a", "b", "c"]);
    expect(g.rows.map((r) => r[2])).toContain("2026-01-01 10:00:00.123457+00");
  });
  it("edita só a linha que difere no microssegundo", async () => {
    await editarConferindo("c3", p("1", ".123457"), "v", "B");
  });
  it("concorrência dispara row_changed", async () => {
    await concorrenteAborta("c3", p("1", ".123456"), "v", "z",
      "UPDATE c3 SET v='a2' WHERE b=1 AND c='2026-01-01 10:00:00.123456+00'");
  });
  it("exclui só a linha do .123457", async () => {
    await excluirConferindo("c3", p("1", ".123457"));
  });
});

describe.skipIf(!temDocker)("tipos difíceis (geometry, jsonb, text[], numeric(38,18), timestamptz, text)", () => {
  const p = (v: string) => (l: Linha) => l[0] === v;
  it("geometry: o hex EWKB enviado volta idêntico", async () => {
    const hex = psql("SELECT ST_GeomFromText('POINT(3.123456789012 4.5)', 4326)::text");
    await editarConferindo("tipos", p("2"), "g", hex);
  });
  it("jsonb, text[], numeric(38,18), timestamptz µs voltam idênticos", async () => {
    await editarConferindo("tipos", p("2"), "jb", '{"a": [1, "x"], "b": null}');
    await editarConferindo("tipos", p("2"), "arr", '{"a b","c ","",NULL}');
    await editarConferindo("tipos", p("2"), "n", "-99999999999999999999.000000000000000001");
    await editarConferindo("tipos", p("2"), "ts", "2026-03-01 12:00:00.999999+00");
  });
  it("text: espaço no fim, string vazia e NULL são três valores distintos", async () => {
    await editarConferindo("tipos", p("2"), "t", null); // '' -> NULL
    await editarConferindo("tipos", p("3"), "t", ""); // NULL -> ''
    await editarConferindo("tipos", p("1"), "t", "fim  "); // 'fim ' -> 'fim  '
    expect(psql("SELECT string_agg(id || ':' || coalesce('[' || t || ']', 'NULL'), ',' ORDER BY id) FROM tipos"))
      .toBe("1:[fim  ],2:NULL,3:[]");
  });
  it("guarda pega '' trocado por NULL e espaço do fim removido", async () => {
    await concorrenteAborta("tipos", p("3"), "t", "z", "UPDATE tipos SET t=NULL WHERE id=3");
    await concorrenteAborta("tipos", p("1"), "t", "z", "UPDATE tipos SET t='fim ' WHERE id=1");
  });
  it("guarda pega mudança concorrente em cada tipo difícil", async () => {
    await concorrenteAborta("tipos", p("1"), "jb", "{}", `UPDATE tipos SET jb = jb || '{"c":1}' WHERE id=1`);
    await concorrenteAborta("tipos", p("1"), "arr", "{}", `UPDATE tipos SET arr = '{"a b","c",""}' WHERE id=1`);
    await concorrenteAborta("tipos", p("1"), "n", "0",
      "UPDATE tipos SET n = n + 0.000000000000000001 WHERE id=1");
    await concorrenteAborta("tipos", p("1"), "ts", "2026-01-01 00:00:00+00",
      "UPDATE tipos SET ts = ts + interval '1 microsecond' WHERE id=1");
    await concorrenteAborta("tipos", p("1"), "g", psql("SELECT ST_GeomFromText('POINT(0 0)', 4326)::text"),
      "UPDATE tipos SET g = ST_SetSRID(ST_MakePoint(ST_X(g), ST_Y(g) + 0.5), 4326) WHERE id=1");
  });
  it("guarda pega mudança sub-precisão em geometry (1e-12) e troca de SRID", async () => {
    await concorrenteAborta("tipos", p("1"), "g", psql("SELECT ST_GeomFromText('POINT(0 0)', 4326)::text"),
      "UPDATE tipos SET g = ST_SetSRID(ST_MakePoint(ST_X(g) + 1e-12, ST_Y(g)), 4326) WHERE id=1");
    psql("ALTER TABLE tipos ALTER COLUMN g TYPE geometry(Point) USING g");
    await concorrenteAborta("tipos", p("1"), "g", psql("SELECT ST_GeomFromText('POINT(0 0)', 4326)::text"),
      "UPDATE tipos SET g = ST_SetSRID(g, 3857) WHERE id=1");
  });
  it("exclui a linha com geometry/jsonb/array/numeric — guarda em todas as colunas casa", async () => {
    await excluirConferindo("tipos", p("1"));
    await excluirConferindo("tipos", p("3"));
  });
});

describe.skipIf(!temDocker)("tabela SEM PK", () => {
  it("a grade reporta primaryKey vazia", async () => {
    expect((await ler("sem_pk")).primaryKey).toEqual([]);
  });
  it("UPDATE por coluna que casaria uma linha só é recusado e nada muda", async () => {
    const antes = psql("SELECT string_agg(k||v, ',' ORDER BY k, v) FROM sem_pk");
    const res = await call(`/api/connections/${conn}/rows/update`, {
      ...alvo("sem_pk"), pk: [{ column: "k", value: "u" }], changes: [{ column: "v", from: "1", to: "2" }],
    });
    expect(res.status).toBe(409);
    const b = (await res.json()) as { code: string; message: string };
    expect(b.code).toBe("not_primary_key");
    expect(b.message.length).toBeGreaterThan(0);
    expect(psql("SELECT string_agg(k||v, ',' ORDER BY k, v) FROM sem_pk")).toBe(antes);
  });
  it("DELETE de linhas duplicadas é recusado e nada é apagado", async () => {
    const res = await call(`/api/connections/${conn}/rows/delete`, {
      ...alvo("sem_pk"), pk: [{ column: "k", value: "d" }], guard: [{ column: "v", value: "1" }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("not_primary_key");
    expect(psql("SELECT count(*) FROM sem_pk")).toBe("3");
  });
});
