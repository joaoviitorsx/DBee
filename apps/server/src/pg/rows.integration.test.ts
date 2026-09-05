import type { RowsResponse } from "@dbee/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { PoolManager } from "./pool";

/**
 * Leitura paginada contra **Postgres real**.
 *
 * Keyset tem duas armadilhas que só aparecem com dado de verdade: ordenação por
 * coluna não única faz linha repetir ou sumir entre páginas, e NULL na coluna de
 * ordenação quebra a comparação de linha. As duas estão cobertas aqui, com a
 * verificação que importa: **percorrer todas as páginas e conferir que o
 * conjunto é exatamente a tabela, sem repetição e sem buraco.**
 */

const PORTA = 55481;
const CONTAINER = "dbee-rows-it";
const SENHA = "Rw7pQz2mVx4T";
const TOTAL = 250;

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;

let app: ReturnType<typeof createApp>;
let pools: PoolManager | undefined;
let conn = "";

const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

const call = (path: string, body: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

async function ler(
  tabela: string,
  body: object = {},
  schema = "public",
): Promise<RowsResponse> {
  const res = await call(`/api/connections/${conn}/tables/${schema}/${tabela}/rows`, body);
  if (res.status !== 200) throw new Error(`esperava 200, veio ${res.status}: ${await res.text()}`);
  return (await res.json()) as RowsResponse;
}

/** Percorre todas as páginas e devolve as linhas na ordem em que apareceram. */
async function paginarTudo(
  tabela: string,
  body: object,
  limite: number,
): Promise<(string | null)[][]> {
  const todas: (string | null)[][] = [];
  let cursor: RowsResponse["nextCursor"] = null;

  for (let pagina = 0; pagina < 200; pagina++) {
    const r: RowsResponse = await ler(tabela, {
      ...body,
      limit: limite,
      ...(cursor === null ? {} : { after: cursor }),
    });
    todas.push(...r.rows);
    if (!r.hasMore || r.nextCursor === null) return todas;
    cursor = r.nextCursor;
  }
  throw new Error("paginação não terminou em 200 páginas");
}

beforeAll(async () => {
  if (!temDocker) return;

  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=rows",
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  );

  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "rows", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");

  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "rows", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        -- PK simples, coluna de ordenação com MUITAS repetições e com NULL.
        CREATE TABLE itens (
          id bigint PRIMARY KEY,
          grupo text,
          valor numeric(12,2),
          criado timestamptz
        );
        INSERT INTO itens
          SELECT g,
                 CASE WHEN g % 10 = 0 THEN NULL ELSE 'g' || (g % 5) END,
                 (g % 7)::numeric,
                 timestamptz '2024-01-01 00:00:00+00' + (g || ' h')::interval
          FROM generate_series(1, ${String(TOTAL)}) g;

        -- PK composta.
        CREATE TABLE composta (a int, b int, nota text, PRIMARY KEY (a, b));
        INSERT INTO composta SELECT i, j, 'n' || i || '-' || j
          FROM generate_series(1, 12) i, generate_series(1, 10) j;

        -- SEM chave primária.
        CREATE TABLE sem_pk (x int, y text);
        INSERT INTO sem_pk SELECT g, 'v' || g FROM generate_series(1, 60) g;

        -- Identificador com maiúscula, que exige aspas.
        CREATE TABLE "Maiuscula" (id int PRIMARY KEY, "Nome Composto" text);
        INSERT INTO "Maiuscula" VALUES (1, 'um'), (2, 'dois');
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  app = createApp({ store: openTestStore(), caCert: undefined, pools });

  const res = await call("/api/connections", {
    name: "rows",
    host: "127.0.0.1",
    port: PORTA,
    database: "rows",
    username: "postgres",
    password: SENHA,
    timezone: "UTC",
  });
  conn = ((await res.json()) as { id: string }).id;
});

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
});

describe.if(temDocker)("leitura básica", () => {
  it("devolve colunas com o tipo real e células como string", async () => {
    const r = await ler("itens", { limit: 3 });

    expect(r.columns.map((c) => c.dataTypeName)).toEqual([
      "bigint", "text", "numeric", "timestamp with time zone",
    ]);
    expect(r.keyset).toBe(true);
    expect(r.primaryKey).toEqual(["id"]);
    for (const linha of r.rows) {
      for (const celula of linha) expect(celula === null || typeof celula === "string").toBe(true);
    }
  });

  it("NULL vem como null, distinto de string", async () => {
    const r = await ler("itens", { limit: 12 });
    // Linha 10 tem grupo NULL por construção.
    expect(r.rows[9]?.[1]).toBeNull();
    expect(r.rows[0]?.[1]).toBe("g1");
  });

  it("hasMore e nextCursor param quando a tabela acaba", async () => {
    const r = await ler("sem_pk", { limit: 1000 });
    expect(r.hasMore).toBe(false);
    expect(r.nextCursor).toBeNull();
  });

  it("relação inexistente devolve 404", async () => {
    const res = await call(`/api/connections/${conn}/tables/public/nao_existe/rows`, {});
    expect(res.status).toBe(404);
  });

  it("identificador com maiúscula e espaço funciona", async () => {
    const r = await ler("Maiuscula", { limit: 10, orderBy: "Nome Composto" });
    expect(r.rows).toHaveLength(2);
    expect(r.columns.map((c) => c.name)).toEqual(["id", "Nome Composto"]);
  });
});

describe.if(temDocker)("keyset percorre a tabela inteira, sem repetir e sem pular", () => {
  it("ordenação só pela PK", async () => {
    const linhas = await paginarTudo("itens", {}, 37);
    const ids = linhas.map((l) => l[0]);

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(ids[0]).toBe("1");
    expect(ids.at(-1)).toBe(String(TOTAL));
  });

  it("ordenação por coluna NÃO ÚNICA — 5 valores para 250 linhas", async () => {
    // Sem o desempate pela PK, linhas repetiriam ou sumiriam aqui.
    const linhas = await paginarTudo("itens", { orderBy: "valor" }, 17);
    const ids = linhas.map((l) => l[0]);

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it("ordenação por coluna com NULL — os nulos não somem entre páginas", async () => {
    // `grupo` é NULL a cada 10 linhas. Comparação de linha crua devolveria NULL
    // e perderia essas 25 linhas a partir da segunda página.
    const linhas = await paginarTudo("itens", { orderBy: "grupo" }, 13);
    const ids = linhas.map((l) => l[0]);

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);

    const nulos = linhas.filter((l) => l[1] === null);
    expect(nulos).toHaveLength(TOTAL / 10);
  });

  it("NULLS LAST: os nulos vêm por último em ASC", async () => {
    const linhas = await paginarTudo("itens", { orderBy: "grupo" }, 40);
    const primeiroNulo = linhas.findIndex((l) => l[1] === null);
    const ultimoNaoNulo = linhas.findLastIndex((l) => l[1] !== null);
    expect(primeiroNulo).toBeGreaterThan(ultimoNaoNulo);
  });

  it("descendente também percorre tudo", async () => {
    const linhas = await paginarTudo("itens", { orderDirection: "desc" }, 29);
    const ids = linhas.map((l) => l[0]);

    expect(new Set(ids).size).toBe(TOTAL);
    expect(ids[0]).toBe(String(TOTAL));
    expect(ids.at(-1)).toBe("1");
  });

  it("ordenação por timestamp percorre tudo", async () => {
    const linhas = await paginarTudo("itens", { orderBy: "criado" }, 23);
    expect(new Set(linhas.map((l) => l[0])).size).toBe(TOTAL);
  });

  it("chave primária COMPOSTA percorre tudo", async () => {
    const linhas = await paginarTudo("composta", {}, 11);
    const chaves = linhas.map((l) => `${String(l[0])}-${String(l[1])}`);

    expect(chaves).toHaveLength(120);
    expect(new Set(chaves).size).toBe(120);
  });

  it("PK composta com ordenação por coluna repetida", async () => {
    const linhas = await paginarTudo("composta", { orderBy: "b" }, 9);
    expect(new Set(linhas.map((l) => `${String(l[0])}-${String(l[1])}`)).size).toBe(120);
  });

  it("a ordem é estável: paginar de novo dá o mesmo resultado", async () => {
    const a = await paginarTudo("itens", { orderBy: "valor" }, 31);
    const b = await paginarTudo("itens", { orderBy: "valor" }, 31);
    expect(a.map((l) => l[0])).toEqual(b.map((l) => l[0]));
  });
});

describe.if(temDocker)("tabela sem chave primária", () => {
  it("avisa que não há keyset, em vez de fingir que funciona", async () => {
    const r = await ler("sem_pk", { limit: 10 });
    expect(r.keyset).toBe(false);
    expect(r.primaryKey).toEqual([]);
    // Sem cursor: a UI tem que oferecer navegação limitada, não infinita.
    expect(r.nextCursor).toBeNull();
    expect(r.hasMore).toBe(true);
  });

  it("pagina por offset", async () => {
    const p1 = await ler("sem_pk", { limit: 10, offset: 0, orderBy: "x" });
    const p2 = await ler("sem_pk", { limit: 10, offset: 10, orderBy: "x" });

    expect(p1.rows[0]?.[0]).toBe("1");
    expect(p2.rows[0]?.[0]).toBe("11");
  });
});

describe.if(temDocker)("filtros", () => {
  it.each([
    // g % 7 == 3 para g em 1..250: 3, 10, 17, … 248 → 36 linhas.
    ["eq", "valor", "3", 36],
    ["gt", "id", "240", 10],
    ["lte", "id", "5", 5],
    ["ne", "valor", "0", TOTAL - 35],
  ])("%s em %s", async (operator, column, value, esperado) => {
    const r = await ler("itens", { limit: 1000, filters: [{ column, operator, value }] });
    expect(r.rows).toHaveLength(esperado);
  });

  it("isNull acha exatamente os nulos", async () => {
    const r = await ler("itens", {
      limit: 1000,
      filters: [{ column: "grupo", operator: "isNull" }],
    });
    expect(r.rows).toHaveLength(TOTAL / 10);
  });

  it("contains procura texto dentro de coluna numérica", async () => {
    // O cast vai na coluna aqui de propósito: procurar "12" em id.
    const r = await ler("itens", {
      limit: 1000,
      filters: [{ column: "id", operator: "contains", value: "12" }],
    });
    expect(r.rows.length).toBeGreaterThan(0);
    for (const linha of r.rows) expect(String(linha[0])).toContain("12");
  });

  it("comparação numérica NÃO é textual", async () => {
    // O erro clássico: `coluna::text > '9'` faria "10" ser menor que "9".
    const r = await ler("itens", {
      limit: 1000,
      filters: [{ column: "id", operator: "gt", value: "9" }],
    });
    expect(r.rows).toHaveLength(TOTAL - 9);
  });

  it("filtros combinam com AND", async () => {
    const r = await ler("itens", {
      limit: 1000,
      filters: [
        { column: "id", operator: "gt", value: "100" },
        { column: "valor", operator: "eq", value: "3" },
      ],
    });
    expect(r.rows.length).toBeGreaterThan(0);
    for (const linha of r.rows) {
      expect(Number(linha[0])).toBeGreaterThan(100);
      expect(linha[2]).toBe("3.00");
    }
  });

  it("filtro sobrevive à paginação", async () => {
    const linhas = await paginarTudo(
      "itens",
      { filters: [{ column: "valor", operator: "eq", value: "3" }] },
      7,
    );
    expect(new Set(linhas.map((l) => l[0])).size).toBe(36);
  });
});

describe.if(temDocker)("entrada inválida é recusada, não escapada", () => {
  it("coluna inexistente em orderBy devolve 400", async () => {
    const res = await call(`/api/connections/${conn}/tables/public/itens/rows`, {
      orderBy: "nao_existe",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("nao_existe");
  });

  it("coluna inexistente em filtro devolve 400", async () => {
    const res = await call(`/api/connections/${conn}/tables/public/itens/rows`, {
      filters: [{ column: "id; DROP TABLE itens", operator: "eq", value: "1" }],
    });
    expect(res.status).toBe(400);
  });

  it("a tabela continua lá depois da tentativa", async () => {
    const r = await ler("itens", { limit: 1 });
    expect(r.rows).toHaveLength(1);
  });

  it("cursor com chave de tamanho errado devolve 400", async () => {
    const res = await call(`/api/connections/${conn}/tables/public/composta/rows`, {
      after: { orderValue: null, orderValueIsNull: false, primaryKey: ["1"] },
    });
    expect(res.status).toBe(400);
  });

  it("operador fora da lista é recusado pelo schema", async () => {
    const res = await call(`/api/connections/${conn}/tables/public/itens/rows`, {
      filters: [{ column: "id", operator: "; DROP TABLE itens; --", value: "1" }],
    });
    expect(res.status).toBe(422);
  });
});

describe.if(temDocker)("query_log grava a leitura de linhas", () => {
  it("registra como leitura, com contagem", async () => {
    await ler("itens", { limit: 5 });

    const res = await app.handle(
      new Request(`http://localhost/api/connections/${conn}/history?limit=1`),
    );
    const historico = (await res.json()) as {
      sql: string;
      status: string;
      rowCount: number | null;
      readOnly: boolean;
    }[];

    expect(historico[0]?.status).toBe("ok");
    expect(historico[0]?.rowCount).toBe(5);
    expect(historico[0]?.readOnly).toBe(true);
    expect(historico[0]?.sql).toContain("itens");
  });
});
