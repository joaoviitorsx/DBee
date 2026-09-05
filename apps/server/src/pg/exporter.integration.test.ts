import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { autenticar } from "../test/sessao";
import { PoolManager } from "./pool";

/**
 * Export em stream contra **Postgres real**.
 *
 * O teste que justifica esta rota existir é o de memória: exportar 150 mil
 * linhas (~45 MB de corpo) não pode custar mais memória do que exportar 5 mil.
 * Se custar, o cursor não está segurando nada e o processo materializou o
 * resultado inteiro — que é exatamente o que a rota existe para evitar (§11.11).
 *
 * O segundo teste que importa é o do cancelamento: quem fecha a aba no meio do
 * download solta um `cancel` no stream. Sem devolver o cliente ali, cinco
 * downloads abandonados esgotam o pool (`max: 3`) e a conexão morre em silêncio.
 */

const PORTA = 55482;
const CONTAINER = "dbee-export-it";
const SENHA = "Kt3nWq8bZr5X";
const GRANDE = 150_000;
const PEQUENA = 5_000;

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;

let app: ReturnType<typeof createApp>;
// Toda rota exige sessão (§7): sem cookie estes testes mediriam o guard.
let cookie = "";
let pools: PoolManager | undefined;
let conn = "";

const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

const exportar = (body: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/api/connections/${conn}/export`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

const MB = 1024 * 1024;

/** Heap vivo em MB, depois de forçar a coleta — é o conjunto que não pode crescer. */
function heapMB(): number {
  Bun.gc(true);
  return process.memoryUsage().heapUsed / MB;
}

interface Consumo {
  readonly bytes: number;
  readonly linhas: number;
  readonly picoHeapMB: number;
  readonly primeiroChunkMs: number;
  readonly totalMs: number;
}

/**
 * Consome o corpo inteiro **sem acumular**: conta bytes e quebras de linha e
 * descarta o pedaço. Guardar o corpo aqui mediria a memória do teste, não a do
 * servidor, e o número não diria nada.
 */
async function consumir(res: Response): Promise<Consumo> {
  const corpo: ReadableStream<Uint8Array> | null = res.body;
  if (corpo === null) throw new Error("resposta sem corpo");
  const reader = corpo.getReader();

  const base = heapMB();
  const inicio = performance.now();
  let primeiroChunkMs = -1;
  let bytes = 0;
  let linhas = 0;
  let pico = 0;
  let lidos = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (primeiroChunkMs < 0) primeiroChunkMs = performance.now() - inicio;

    bytes += value.byteLength;
    for (const b of value) if (b === 0x0a) linhas++;

    // Amostrar a cada lote é caro (força GC); a cada 20 já pega a curva.
    if (++lidos % 20 === 0) pico = Math.max(pico, heapMB() - base);
  }

  return {
    bytes,
    linhas,
    picoHeapMB: Math.max(pico, heapMB() - base),
    primeiroChunkMs,
    totalMs: performance.now() - inicio,
  };
}

// Subir um Postgres em container passa dos 5 s padrão do `bun test` quando
// vários arquivos de integração disputam o Docker na mesma rodada. Isolado
// passava; no conjunto, não — e um hook que estoura acusa como falha de teste.
beforeAll(async () => {
  if (!temDocker) return;

  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=exp",
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  );

  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "exp", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");

  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "exp", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        -- Linha larga de propósito: ~300 B, para o corpo passar de 40 MB sem
        -- precisar de milhões de linhas.
        CREATE TABLE grande (
          id bigint PRIMARY KEY,
          nome text,
          descricao text,
          valor numeric(12,2)
        );
        INSERT INTO grande
          SELECT g,
                 'cliente numero ' || g,
                 repeat('x', 240),
                 (g % 997)::numeric
          FROM generate_series(1, ${String(GRANDE)}) g;

        CREATE TABLE pequena (LIKE grande INCLUDING ALL);
        INSERT INTO pequena SELECT * FROM grande WHERE id <= ${String(PEQUENA)};

        -- Os casos que o CSV escapa errado quando ninguém olha.
        CREATE TABLE esquisita (id int PRIMARY KEY, texto text);
        INSERT INTO esquisita VALUES
          (1, NULL),
          (2, ''),
          (3, 'com;ponto-e-virgula'),
          (4, 'com "aspas" dentro'),
          (5, E'com\\nquebra'),
          (6, 'acentuação'),
          (7, 'NULL');
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  const store = openTestStore();
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));

  const res = await app.handle(
    new Request("http://localhost/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "exp",
        host: "127.0.0.1",
        port: PORTA,
        database: "exp",
        username: "postgres",
        password: SENHA,
        timezone: "UTC",
      }),
    }),
  );
  conn = ((await res.json()) as { id: string }).id;
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

describe.if(temDocker)("a memória não cresce com o tamanho do resultado", () => {
  it(
    `${String(GRANDE)} linhas não custam mais heap que ${String(PEQUENA)}`,
    async () => {
      const pequeno = await consumir(
        await exportar({ source: { kind: "table", schema: "public", table: "pequena" }, format: "csv" }),
      );
      const grande = await consumir(
        await exportar({ source: { kind: "table", schema: "public", table: "grande" }, format: "csv" }),
      );

      // Registrado no output porque o número é a evidência, não o assert.
      console.log(
        `export ${String(PEQUENA)} linhas: ${(pequeno.bytes / MB).toFixed(1)} MB, pico +${pequeno.picoHeapMB.toFixed(1)} MB\n` +
          `export ${String(GRANDE)} linhas: ${(grande.bytes / MB).toFixed(1)} MB, pico +${grande.picoHeapMB.toFixed(1)} MB, ` +
          `primeiro chunk em ${grande.primeiroChunkMs.toFixed(0)} ms de ${grande.totalMs.toFixed(0)} ms`,
      );

      expect(grande.linhas).toBe(GRANDE + 1); // + cabeçalho
      expect(pequeno.linhas).toBe(PEQUENA + 1);
      expect(grande.bytes).toBeGreaterThan(35 * MB);

      // 30× mais linhas. Se o resultado fosse materializado, o pico subiria com
      // ele; com cursor, o que vive é um lote de 1000 linhas nos dois casos.
      expect(grande.picoHeapMB).toBeLessThan(pequeno.picoHeapMB + 60);
      expect(grande.picoHeapMB).toBeLessThan(grande.bytes / MB);
    },
    120_000,
  );

  it(
    "o corpo começa a sair antes da última linha existir",
    async () => {
      const r = await consumir(
        await exportar({ source: { kind: "table", schema: "public", table: "grande" }, format: "csv" }),
      );
      // Se a rota bufferizasse, o primeiro byte só sairia no fim.
      expect(r.primeiroChunkMs).toBeLessThan(r.totalMs / 3);
    },
    120_000,
  );
});

describe.if(temDocker)("o cliente do pool volta em todos os desfechos", () => {
  it(
    "download abandonado no meio não segura o pool",
    async () => {
      // `max: 3` por (conexão, database): sem devolver no cancel, a quarta trava.
      for (let i = 0; i < 8; i++) {
        const res = await exportar({
          source: { kind: "table", schema: "public", table: "grande" },
          format: "csv",
        });
        const corpo: ReadableStream<Uint8Array> | null = res.body;
        if (corpo === null) throw new Error("resposta sem corpo");
        const reader = corpo.getReader();
        await reader.read();
        await reader.cancel();
      }

      // O que prova a devolução: um export inteiro ainda passa depois.
      const depois = await Promise.race([
        exportar({
          source: { kind: "table", schema: "public", table: "pequena" },
          format: "csv",
        }).then(consumir),
        Bun.sleep(20_000).then(() => {
          throw new Error("pool esgotado: o export depois dos cancelados não completou");
        }),
      ]);
      expect(depois.linhas).toBe(PEQUENA + 1);
    },
    120_000,
  );
});

describe.if(temDocker)("formato", () => {
  /**
   * Lê o corpo em bytes e decodifica **sem** remover o BOM.
   *
   * `Response.text()` faz o decode UTF-8 do padrão, que descarta o BOM
   * silenciosamente — usá-lo aqui esconderia justamente o byte em teste.
   */
  const texto = async (body: unknown): Promise<string> => {
    const res = await exportar(body);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  };

  it("CSV sai com BOM e ';' — os defaults que o Excel pt-BR abre", async () => {
    const csv = await texto({
      source: { kind: "table", schema: "public", table: "esquisita" },
      format: "csv",
    });

    expect(csv.startsWith("﻿")).toBe(true);
    const linhas = csv.slice(1).split("\r\n");
    expect(linhas[0]).toBe("id;texto");
    expect(linhas[1]).toBe("1;"); // NULL
    expect(linhas[2]).toBe("2;"); // string vazia — indistinguível do NULL, por projeto
    expect(linhas[3]).toBe('3;"com;ponto-e-virgula"');
    expect(linhas[4]).toBe('4;"com ""aspas"" dentro"');
    expect(linhas[5]).toBe('5;"com\nquebra"');
    expect(linhas[6]).toBe("6;acentuação");
    expect(linhas[7]).toBe("7;NULL"); // a string "NULL", não o NULL
  });

  it("delimiter e bom são configuráveis para quem consome por script", async () => {
    const csv = await texto({
      source: { kind: "table", schema: "public", table: "esquisita" },
      format: "csv",
      csv: { delimiter: ",", bom: false, header: false },
      maxRows: 1,
    });
    expect(csv.startsWith("﻿")).toBe(false);
    expect(csv).toBe("1,\r\n");
  });

  it("JSON é um array válido, NDJSON é um objeto por linha", async () => {
    const json = await texto({
      source: { kind: "query", sql: "SELECT id, texto FROM esquisita ORDER BY id" },
      format: "json",
      maxRows: 3,
    });
    expect(JSON.parse(json)).toEqual([
      { id: "1", texto: null },
      { id: "2", texto: "" },
      { id: "3", texto: "com;ponto-e-virgula" },
    ]);

    const nd = await texto({
      source: { kind: "query", sql: "SELECT id FROM esquisita ORDER BY id" },
      format: "ndjson",
      maxRows: 2,
    });
    expect(nd).toBe('{"id":"1"}\n{"id":"2"}\n');
  });

  it("resultado vazio ainda traz o cabeçalho", async () => {
    const csv = await texto({
      source: { kind: "query", sql: "SELECT id, texto FROM esquisita WHERE false" },
      format: "csv",
    });
    expect(csv).toBe("﻿id;texto\r\n");
    expect(await texto({
      source: { kind: "query", sql: "SELECT 1 WHERE false" },
      format: "json",
    })).toBe("[]");
  });
});

describe.if(temDocker)("teto e origem", () => {
  it("maxRows corta na linha pedida, sem LIMIT no SQL do usuário", async () => {
    const res = await exportar({
      source: { kind: "query", sql: "SELECT id FROM grande ORDER BY id" },
      format: "ndjson",
      maxRows: 2_500,
    });
    const r = await consumir(res);
    expect(r.linhas).toBe(2_500);
  });

  it("a origem tabela usa os mesmos filtros e ordenação da aba Dados", async () => {
    const res = await exportar({
      source: {
        kind: "table",
        schema: "public",
        table: "grande",
        orderBy: "id",
        orderDirection: "desc",
        filters: [{ column: "id", operator: "lte", value: "10" }],
      },
      format: "ndjson",
    });
    const linhas = (await res.text()).trim().split("\n");
    expect(linhas).toHaveLength(10);
    expect((JSON.parse(linhas[0] ?? "{}") as { id: string }).id).toBe("10");
  });

  it("vários statements num arquivo só é recusado", async () => {
    const res = await exportar({
      source: { kind: "query", sql: "SELECT 1; SELECT 2" },
      format: "csv",
    });
    expect(res.status).toBe(400);
  });

  it("operador de filtro fora da lista é recusado pelo schema", async () => {
    const res = await exportar({
      source: {
        kind: "table", schema: "public", table: "grande",
        filters: [{ column: "id", operator: "<=", value: "10" }],
      },
      format: "csv",
    });
    expect(res.status).toBe(422);
  });

  it("tabela inexistente devolve 404 antes de abrir cursor", async () => {
    const res = await exportar({
      source: { kind: "table", schema: "public", table: "nao_existe" },
      format: "csv",
    });
    expect(res.status).toBe(404);
  });

  it("o nome do arquivo carrega a origem e o carimbo", async () => {
    const res = await exportar({
      source: { kind: "table", schema: "public", table: "esquisita" },
      format: "csv",
    });
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="public.esquisita_\d{4}-\d{2}-\d{2}T[\d-]{8}\.csv"/,
    );
    // Sem content-length: não se sabe o tamanho antes de terminar, e é isso que
    // permite não materializar.
    expect(res.headers.get("content-length")).toBeNull();
    await res.body?.cancel();
  });
});

describe.if(temDocker)("formato sql", () => {
  const texto = async (body: unknown): Promise<string> => {
    const res = await exportar(body);
    expect(res.status).toBe(200);
    return await res.text();
  };

  it("emite CREATE TABLE de referência e um INSERT por linha", async () => {
    const sql = await texto({
      source: { kind: "table", schema: "public", table: "esquisita" },
      format: "sql",
    });

    // Cabeçalho de referência, tabela citada, colunas com tipo e a PK.
    expect(sql).toContain("-- tabela: public.esquisita");
    expect(sql).toContain('CREATE TABLE "public"."esquisita" (');
    expect(sql).toContain('"id" integer NOT NULL');
    expect(sql).toContain('"texto" text');
    expect(sql).toContain('PRIMARY KEY ("id")');

    // NULL vira NULL literal; tudo o mais é string entre aspas simples, com
    // aspas internas dobradas. A célula "NULL" (texto) não vira NULL.
    expect(sql).toContain(`INSERT INTO "public"."esquisita" ("id", "texto") VALUES ('1', NULL);`);
    expect(sql).toContain(`VALUES ('2', '');`);
    expect(sql).toContain(`VALUES ('7', 'NULL');`);
    // Aspas simples dobradas seria o vetor de injeção se não escapasse.
    expect(sql).toMatch(/VALUES \('4', 'com "aspas" dentro'\);/);
  });

  it("o SQL gerado recria a tabela e as linhas num banco vazio", async () => {
    const sql = await texto({
      source: { kind: "table", schema: "public", table: "esquisita" },
      format: "sql",
    });

    // Prova de fidelidade: rodar o arquivo num database limpo tem que produzir
    // a mesma tabela e a mesma contagem — INSERTs válidos, tipos coagidos.
    sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "exp", "-c", "DROP DATABASE IF EXISTS roundtrip");
    expect(sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "exp", "-c", "CREATE DATABASE roundtrip")).toBe(true);

    const rodar = Bun.spawnSync(
      ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "roundtrip", "-q", "-v", "ON_ERROR_STOP=1"],
      { stdin: Buffer.from(sql) },
    );
    expect(rodar.exitCode).toBe(0);

    const contagem = Bun.spawnSync(
      ["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "roundtrip", "-tAc",
       "SELECT count(*), count(*) FILTER (WHERE texto IS NULL) FROM esquisita"],
    );
    expect(contagem.stdout.toString().trim()).toBe("7|1");

    sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "exp", "-c", "DROP DATABASE roundtrip");
  });

  it("origem consulta recusa .sql — não há tabela de destino para o INSERT", async () => {
    const res = await exportar({
      source: { kind: "query", sql: "SELECT id FROM esquisita" },
      format: "sql",
    });
    expect(res.status).toBe(400);
  });

  it("o arquivo .sql carrega a extensão certa", async () => {
    const res = await exportar({
      source: { kind: "table", schema: "public", table: "esquisita" },
      format: "sql",
    });
    expect(res.headers.get("content-type")).toContain("application/sql");
    expect(res.headers.get("content-disposition")).toMatch(/filename="public\.esquisita_[\d-T]+\.sql"/);
    await res.body?.cancel();
  });
});
