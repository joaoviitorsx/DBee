import type { QueryResponse } from "@dbee/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { PoolManager } from "./pool";

/**
 * Executor de query contra **Postgres real** (CLAUDE.md, definição de pronto).
 *
 * Os bugs mais graves deste projeto passaram por typecheck, lint e a suíte
 * inteira. `BEGIN READ ONLY`, truncamento, `statement_timeout` e `position` são
 * comportamento do servidor, e nenhum simulacro os verifica de verdade.
 *
 * Sobe um container descartável. Sem Docker, os testes são pulados em vez de
 * falharem por motivo alheio ao código.
 */

const PORTA = 55480;
const CONTAINER = "dbee-exec-it";
const SENHA = "Zx9QvKp7wTn2";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;

let app: ReturnType<typeof createApp>;
let pools: PoolManager | undefined;
let idLeitura = "";
let idEscrita = "";

const sh = (...args: string[]): { ok: boolean; out: string } => {
  const r = Bun.spawnSync(args);
  return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
};

const call = (path: string, init?: RequestInit): Promise<Response> =>
  app.handle(new Request(`http://localhost${path}`, init));

const post = (path: string, body: unknown): Promise<Response> =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function run(id: string, sql: string, extra: object = {}): Promise<QueryResponse> {
  const res = await post(`/api/connections/${id}/query`, { sql, ...extra });
  if (res.status !== 200) throw new Error(`esperava 200, veio ${res.status}: ${await res.text()}`);
  return (await res.json()) as QueryResponse;
}

beforeAll(async () => {
  if (!temDocker) return;

  // Remove sobra de execução interrompida antes de subir.
  sh("docker", "rm", "-f", CONTAINER);
  const up = sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=it",
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  );
  if (!up.ok) throw new Error(`docker run falhou: ${up.out}`);

  for (let i = 0; i < 60; i++) {
    if (sh("docker", "exec", CONTAINER, "pg_isready", "-U", "postgres", "-q").ok) break;
    await Bun.sleep(500);
  }

  const seed = Bun.spawnSync(
    ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "it", "-q", "-v", "ON_ERROR_STOP=1"],
    {
      stdin: Buffer.from(`
        CREATE TABLE grande (id bigint PRIMARY KEY, txt text, num numeric(20,6), ts timestamptz);
        INSERT INTO grande
          SELECT g, 'linha ' || g, g::numeric / 7, timestamptz '2024-01-01 00:00:00+00' + (g||' s')::interval
          FROM generate_series(1, 5000) g;
        CREATE TABLE alvo (id int PRIMARY KEY, v text);
        INSERT INTO alvo VALUES (1, 'original');
        CREATE TABLE escrita_alvo (id int PRIMARY KEY, v text);
        INSERT INTO escrita_alvo VALUES (1, 'a'), (2, 'b');
      `),
    },
  );
  if (seed.exitCode !== 0) throw new Error(`seed falhou: ${seed.stderr.toString()}`);

  pools = new PoolManager(undefined);
  app = createApp({ store: openTestStore(), caCert: undefined, pools });

  const criar = async (nome: string, escrita: boolean): Promise<string> => {
    const res = await post("/api/connections", {
      name: nome,
      host: "127.0.0.1",
      port: PORTA,
      database: "it",
      username: "postgres",
      password: SENHA,
      writeEnabled: escrita,
      statementTimeoutMs: 30_000,
      timezone: "UTC",
    });
    return ((await res.json()) as { id: string }).id;
  };

  idLeitura = await criar("leitura", false);
  idEscrita = await criar("escrita", true);
});

afterAll(async () => {
  if (!temDocker) return;
  // Defensivo: se o beforeAll falhou no meio (container órfão de uma execução
  // interrompida, por exemplo), `pools` fica indefinido e o cleanup do
  // container é justamente o que precisa rodar.
  await pools?.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
});

describe.if(temDocker)("executor contra Postgres real", () => {
  it("SELECT devolve tudo como string, com o tipo real", async () => {
    const r = await run(idLeitura, "SELECT id, txt, num, ts FROM grande ORDER BY id LIMIT 2");

    const [res] = r.results;
    expect(res?.columns.map((c) => c.dataTypeName)).toEqual([
      "bigint", "text", "numeric", "timestamp with time zone",
    ]);
    // Toda célula é string — §6, para o número não aparecer diferente na tela.
    for (const linha of res?.rows ?? []) {
      for (const celula of linha) expect(typeof celula).toBe("string");
    }
    expect(res?.rows[0]).toEqual(["1", "linha 1", "0.142857", "2024-01-01 00:00:01+00"]);
    expect(res?.viaCursor).toBe(true);
    expect(r.readOnly).toBe(true);
  });

  it("NULL chega como null, não como a string 'NULL'", async () => {
    const r = await run(idLeitura, "SELECT NULL::text, 'NULL'::text");
    expect(r.results[0]?.rows[0]).toEqual([null, "NULL"]);
  });
});

describe.if(temDocker)("escrita bloqueada na conexão read-only", () => {
  it.each([
    ["UPDATE", "UPDATE alvo SET v = 'invadido' WHERE id = 1"],
    ["DELETE", "DELETE FROM alvo WHERE id = 1"],
    ["INSERT", "INSERT INTO alvo VALUES (2, 'novo')"],
    ["DDL", "CREATE TABLE nao_deve_existir (x int)"],
    ["TRUNCATE", "TRUNCATE alvo"],
    ["SELECT FOR UPDATE", "SELECT id FROM alvo FOR UPDATE"],
  ])("%s falha com 25006", async (_nome, sql) => {
    const r = await run(idLeitura, sql);
    expect(r.error?.code).toBe("25006");
    expect(r.error?.message).toContain("read-only transaction");
  });

  it("CTE com INSERT — o falso-negativo que regex não pega — também falha", async () => {
    const r = await run(
      idLeitura,
      "WITH x AS (INSERT INTO alvo VALUES (3, 'cte') RETURNING *) SELECT * FROM x",
    );
    expect(r.error?.code).toBe("25006");
  });

  it("nada foi realmente escrito", async () => {
    const r = await run(idLeitura, "SELECT v FROM alvo WHERE id = 1");
    expect(r.results[0]?.rows[0]).toEqual(["original"]);
  });

  it("readOnly: false NÃO libera escrita numa conexão de leitura", async () => {
    // A proteção é da conexão; a requisição só pode ser mais restritiva.
    const r = await run(idLeitura, "UPDATE alvo SET v = 'x' WHERE id = 1", { readOnly: false });
    expect(r.readOnly).toBe(true);
    expect(r.error?.code).toBe("25006");
  });
});

describe.if(temDocker)("conexão de escrita", () => {
  it("UPDATE funciona e é commitado quando a requisição pede escrita", async () => {
    const r = await run(idEscrita, "UPDATE alvo SET v = 'gravado' WHERE id = 1", {
      readOnly: false,
    });
    expect(r.error).toBeNull();
    expect(r.readOnly).toBe(false);
    expect(r.results[0]?.command).toBe("UPDATE");
    expect(r.results[0]?.rowCount).toBe(1);

    const check = await run(idLeitura, "SELECT v FROM alvo WHERE id = 1");
    expect(check.results[0]?.rows[0]).toEqual(["gravado"]);
  });

  it("readOnly: true força leitura mesmo na conexão de escrita", async () => {
    const r = await run(idEscrita, "UPDATE alvo SET v = 'nao' WHERE id = 1", { readOnly: true });
    expect(r.readOnly).toBe(true);
    expect(r.error?.code).toBe("25006");
  });

  it("OMITIR readOnly numa conexão de escrita roda em LEITURA", async () => {
    // Campo ausente tem que significar o estado seguro: uma tela que esqueça
    // de mandar a flag não pode ganhar escrita por acidente em produção.
    const r = await run(idEscrita, "UPDATE alvo SET v = 'acidente' WHERE id = 1");
    expect(r.readOnly).toBe(true);
    expect(r.error?.code).toBe("25006");
  });

  it.each([
    ["DELETE", "DELETE FROM escrita_alvo WHERE id = 1"],
    ["INSERT", "INSERT INTO escrita_alvo VALUES (9, 'novo')"],
    ["DDL", "CREATE TABLE criada_no_teste (x int)"],
    ["TRUNCATE", "TRUNCATE escrita_alvo"],
    ["SELECT FOR UPDATE", "SELECT id FROM escrita_alvo FOR UPDATE"],
  ])("%s é PERMITIDO na conexão de escrita", async (_nome, sql) => {
    const r = await run(idEscrita, sql, { readOnly: false });
    expect({ sql, code: r.error?.code ?? null }).toEqual({ sql, code: null });
  });
});

describe.if(temDocker)("truncamento", () => {
  it("marca truncated quando há mais linhas que maxRows", async () => {
    const r = await run(idLeitura, "SELECT id FROM grande ORDER BY id", { maxRows: 10 });
    expect(r.results[0]?.rowCount).toBe(10);
    expect(r.results[0]?.truncated).toBe(true);
    // A linha extra do FETCH maxRows+1 é descartada, não devolvida.
    expect(r.results[0]?.rows.at(-1)).toEqual(["10"]);
  });

  it("NÃO marca quando o resultado cabe exatamente", async () => {
    const r = await run(idLeitura, "SELECT id FROM grande WHERE id <= 10 ORDER BY id", {
      maxRows: 10,
    });
    expect(r.results[0]?.rowCount).toBe(10);
    expect(r.results[0]?.truncated).toBe(false);
  });

  it("NÃO marca quando sobra espaço", async () => {
    const r = await run(idLeitura, "SELECT id FROM grande WHERE id <= 3", { maxRows: 10 });
    expect(r.results[0]?.truncated).toBe(false);
    expect(r.results[0]?.rowCount).toBe(3);
  });

  it("resultado vazio não é truncado", async () => {
    const r = await run(idLeitura, "SELECT id FROM grande WHERE id < 0");
    expect(r.results[0]?.rowCount).toBe(0);
    expect(r.results[0]?.truncated).toBe(false);
  });
});

describe.if(temDocker)("statement_timeout", () => {
  it("corta a query e devolve 57014", async () => {
    const res = await post("/api/connections", {
      name: "curta",
      host: "127.0.0.1",
      port: PORTA,
      database: "it",
      username: "postgres",
      password: SENHA,
      statementTimeoutMs: 1000,
    });
    const id = ((await res.json()) as { id: string }).id;

    const inicio = performance.now();
    const r = await run(id, "SELECT pg_sleep(10)");
    const gasto = performance.now() - inicio;

    expect(r.error?.code).toBe("57014");
    // Efetivo, não só reportado: cortou em ~1 s, não em 10.
    expect(gasto).toBeLessThan(5000);
  }, 20_000);
});

describe.if(temDocker)("position aponta para a coluna certa do SQL do usuário", () => {
  it("erro de sintaxe num statement só", async () => {
    const sql = "SELECT id FRON grande";
    const r = await run(idLeitura, sql);

    expect(r.error?.code).toBe("42601");
    // 1-based: a posição tem que cair em cima de "grande".
    expect(sql.slice((r.error?.position ?? 1) - 1)).toBe("grande");
  });

  it("coluna inexistente", async () => {
    const sql = "SELECT nao_existe FROM grande";
    const r = await run(idLeitura, sql);

    expect(r.error?.code).toBe("42703");
    expect(sql.slice((r.error?.position ?? 1) - 1)).toStartWith("nao_existe");
  });

  it("erro no SEGUNDO statement aponta para dentro dele, no SQL original", async () => {
    // Aqui mora o deslocamento: a posição do Postgres é relativa ao statement,
    // e a resposta precisa ser relativa ao texto inteiro que o usuário enviou.
    const sql = "SELECT 1;\nSELECT nao_existe FROM grande";
    const r = await run(idLeitura, sql);

    expect(r.error?.index).toBe(1);
    expect(sql.slice((r.error?.position ?? 1) - 1)).toStartWith("nao_existe");
  });

  it("statement fora do cursor não ganha deslocamento", async () => {
    // UPDATE não passa por cursor: a posição vem sem prefixo nenhum.
    const sql = "UPDATE alvo SET nao_existe = 1";
    const r = await run(idEscrita, sql);

    expect(r.error?.code).toBe("42703");
    expect(sql.slice((r.error?.position ?? 1) - 1)).toStartWith("nao_existe");
  });
});

describe.if(temDocker)("múltiplos statements", () => {
  it("executa em sequência, um resultado por statement", async () => {
    const r = await run(idLeitura, "SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c");

    expect(r.error).toBeNull();
    expect(r.results).toHaveLength(3);
    expect(r.results.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(r.results.map((x) => x.columns[0]?.name)).toEqual(["a", "b", "c"]);
    expect(r.results.map((x) => x.rows[0]?.[0])).toEqual(["1", "2", "3"]);
  });

  it("para no primeiro erro e devolve o que já rodou", async () => {
    const r = await run(idLeitura, "SELECT 1; SELECT ERRADO; SELECT 3");

    expect(r.results).toHaveLength(1);
    expect(r.error?.index).toBe(1);
  });

  it("`;` dentro de string não vira dois statements", async () => {
    const r = await run(idLeitura, "SELECT 'a;b' AS x");
    expect(r.results).toHaveLength(1);
    expect(r.results[0]?.rows[0]).toEqual(["a;b"]);
  });

  it("mistura statement com e sem cursor", async () => {
    const r = await run(idEscrita, "SET LOCAL application_name = 'dbee_teste'; SELECT 1");

    expect(r.error).toBeNull();
    expect(r.results[0]?.viaCursor).toBe(false);
    expect(r.results[1]?.viaCursor).toBe(true);
  });
});

describe.if(temDocker)("query_log grava tudo (DBee.md §2.4)", () => {
  it("registra sucesso com linhas e duração", async () => {
    await run(idLeitura, "SELECT id FROM grande LIMIT 5");

    const historico = (await (
      await call(`/api/connections/${idLeitura}/history?limit=1`)
    ).json()) as { sql: string; status: string; rowCount: number | null; readOnly: boolean; durationMs: number | null }[];

    expect(historico[0]?.sql).toBe("SELECT id FROM grande LIMIT 5");
    expect(historico[0]?.status).toBe("ok");
    expect(historico[0]?.rowCount).toBe(5);
    expect(historico[0]?.readOnly).toBe(true);
    expect(historico[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("registra erro, com o código do Postgres na mensagem", async () => {
    await run(idLeitura, "SELECT nada FROM lugar_nenhum");

    const historico = (await (
      await call(`/api/connections/${idLeitura}/history?limit=1`)
    ).json()) as { status: string; error: string | null; rowCount: number | null }[];

    expect(historico[0]?.status).toBe("error");
    expect(historico[0]?.error).toContain("42P01");
    expect(historico[0]?.rowCount).toBeNull();
  });

  it("registra o modo da transação", async () => {
    await run(idEscrita, "SELECT 1", { readOnly: false });

    const historico = (await (
      await call(`/api/connections/${idEscrita}/history?limit=1`)
    ).json()) as { readOnly: boolean }[];

    expect(historico[0]?.readOnly).toBe(false);
  });

  it("nunca registra a senha da conexão", async () => {
    await run(idLeitura, "SELECT 1");
    const bruto = await (await call(`/api/connections/${idLeitura}/history?limit=50`)).text();
    expect(bruto).not.toContain(SENHA);
  });
});
