import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { Relation, RowsRequest } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { DriverRedis } from "../driver/redis";

/**
 * O driver de Redis contra um Redis real.
 *
 * O que só o servidor prova:
 * - a árvore lista os dbs numerados e a relação `keys`;
 * - a grade traz uma linha por chave, com tipo, ttl e valor **por tipo** em
 *   texto (string crua, hash/list/set/zset em JSON, stream resumido);
 * - o `SCAN` pagina sem repetir ao longo de um ciclo, e o `MATCH` filtra por
 *   nome de chave;
 * - `KEYS` nunca é usado (o teste não consegue provar ausência, mas o código
 *   não o contém — grep no arquivo).
 */

const CONTAINER = "dbee-redis-it";
const PORTA = 55561;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let driver: DriverRedis;
let conexao: ResolvedConnection;
let keys: Relation;

const conn = (): ResolvedConnection => ({
  id: "redis-it", name: "redis", color: null, engine: "redis",
  host: "127.0.0.1", port: PORTA, database: "db0",
  username: "", password: "", sslMode: "disable", timezone: "UTC",
  statementTimeoutMs: 30_000, writeEnabled: false, hasWriteCredential: false,
  authSource: null, filePath: null, createdAt: "", updatedAt: "",
});

const cli = (...cmd: string[]): void => {
  sh("docker", "exec", CONTAINER, "redis-cli", ...cmd);
};

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-p", `${String(PORTA)}:6379`, "redis:7");

  let pronto = false;
  for (let i = 0; i < 60; i++) {
    if (sh("docker", "exec", CONTAINER, "redis-cli", "PING")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Redis não ficou pronto");

  // Um de cada tipo, e chaves com prefixo para o MATCH.
  cli("SET", "user:1", "Ana");
  cli("SET", "user:2", "Bruno");
  cli("HSET", "perfil:1", "nome", "Ana", "idade", "30");
  cli("RPUSH", "fila:1", "a", "b", "c");
  cli("SADD", "tags:1", "vip", "novo");
  cli("ZADD", "ranking:1", "10", "ana", "20", "bruno");
  cli("XADD", "eventos:1", "*", "tipo", "login");
  cli("SET", "session:abc", "token", "EX", "3600");

  driver = new DriverRedis(undefined);
  conexao = conn();

  const esquema = await driver.esquema(conexao, "db0");
  const achada = esquema.schemas[0]?.relations.find((r) => r.name === "keys");
  if (achada === undefined) throw new Error("a relação keys não apareceu");
  keys = achada;
}, 180_000);

afterAll(async () => {
  if (!temDocker) return;
  await driver.desligar();
  sh("docker", "rm", "-f", CONTAINER);
});

const pular = !temDocker;

describe.skipIf(pular)("driver do Redis", () => {
  it("o teste de conexão traz a versão", async () => {
    const r = await driver.testarConexao(conexao);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.serverVersion).toContain("Redis");
  });

  it("lista os dbs numerados, com db0 como padrão", async () => {
    const dbs = await driver.listarDatabases(conexao);
    expect(dbs.length).toBeGreaterThanOrEqual(16);
    expect(dbs[0]).toEqual({ name: "db0", isDefault: true });
    expect(dbs.some((d) => d.name === "db5")).toBe(true);
  });

  it("a árvore traz a relação keys com a contagem", async () => {
    const arvore = await driver.arvore(conexao, "db0");
    const rel = arvore.schemas[0]?.relations.find((r) => r.name === "keys");
    expect(rel?.estimatedRows).toBe(8);
  });

  it("a grade traz uma linha por chave, com as quatro colunas", async () => {
    const r = await driver.linhas(conexao, "db0", "", keys, { limit: 100 });
    expect(r.resposta.columns.map((c) => c.name)).toEqual(["key", "type", "ttl", "value"]);
    expect(r.resposta.rows).toHaveLength(8);
    // Toda célula é texto ou null.
    for (const linha of r.resposta.rows) {
      for (const celula of linha) expect(celula === null || typeof celula === "string").toBe(true);
    }
  });

  it("cada tipo é renderizado como texto na coluna value", async () => {
    const r = await driver.linhas(conexao, "db0", "", keys, { limit: 100 });
    const porChave = new Map(r.resposta.rows.map((l) => [l[0], { type: l[1], value: l[3] }]));
    expect(porChave.get("user:1")).toEqual({ type: "string", value: "Ana" });
    expect(JSON.parse(porChave.get("perfil:1")?.value ?? "{}")).toEqual({ nome: "Ana", idade: "30" });
    expect(JSON.parse(porChave.get("fila:1")?.value ?? "[]")).toEqual(["a", "b", "c"]);
    expect((JSON.parse(porChave.get("tags:1")?.value ?? "[]") as string[]).sort()).toEqual(["novo", "vip"]);
    // zset: pares [membro, score].
    expect(JSON.parse(porChave.get("ranking:1")?.value ?? "[]")).toEqual([["ana", 10], ["bruno", 20]]);
    // stream: resumo com contagem.
    expect(porChave.get("eventos:1")?.value).toContain("1 entradas");
  });

  it("o ttl aparece: -1 sem expiração, positivo com EX", async () => {
    const r = await driver.linhas(conexao, "db0", "", keys, { limit: 100 });
    const porChave = new Map(r.resposta.rows.map((l) => [l[0], l[2]]));
    expect(porChave.get("user:1")).toBe("-1");
    expect(Number(porChave.get("session:abc"))).toBeGreaterThan(0);
  });

  it("MATCH filtra por prefixo de chave", async () => {
    const r = await driver.linhas(conexao, "db0", "", keys, {
      limit: 100,
      filters: [{ column: "key", operator: "startsWith", value: "user:" }],
    });
    expect(r.resposta.rows).toHaveLength(2);
    expect(r.resposta.rows.map((l) => l[0]).sort()).toEqual(["user:1", "user:2"]);
  });

  it("filtro por tipo é aplicado depois da página", async () => {
    const r = await driver.linhas(conexao, "db0", "", keys, {
      limit: 100,
      filters: [{ column: "type", operator: "eq", value: "hash" }],
    });
    expect(r.resposta.rows.map((l) => l[0])).toEqual(["perfil:1"]);
  });

  it("a paginação por SCAN cobre todas as chaves sem repetir", async () => {
    const vistas = new Set<string>();
    let pedido: RowsRequest = { limit: 3 };
    for (let pagina = 0; pagina < 20; pagina++) {
      const r = await driver.linhas(conexao, "db0", "", keys, pedido);
      for (const linha of r.resposta.rows) {
        const k = linha[0] ?? "";
        expect(vistas.has(k), `repetiu ${k}`).toBe(false);
        vistas.add(k);
      }
      if (r.resposta.nextCursor === null) break;
      pedido = { limit: 3, after: r.resposta.nextCursor };
    }
    expect(vistas.size).toBe(8);
  });

  it("coluna que não existe é erro nosso", async () => {
    let erro: unknown;
    try {
      await driver.linhas(conexao, "db0", "", keys, {
        limit: 10, filters: [{ column: "inexistente", operator: "isNull" }],
      });
    } catch (e: unknown) {
      erro = e;
    }
    expect(erro).toBeDefined();
  });
});
