import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { RedisValueEditRequest } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { DriverRedis } from "../driver/redis";

/**
 * Edição estruturada de coleção do Redis (hash/list/set/zset) contra um Redis
 * real, pelo `mutarLinha` do driver — o mesmo caminho que o serviço usa.
 *
 * Prova cada op (`HSET`/`HDEL`, `SADD`/`SREM`, `ZADD`/`ZREM`, `LSET`/`LPUSH`/
 * `LREM`), a guarda otimista (o campo/índice mudou desde a leitura → conflito),
 * e a leitura de volta pelo `redis-cli`.
 */

const CONTAINER = "dbee-redis-valor-it";
const PORTA = 55564;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const cli = (...cmd: string[]): string =>
  Bun.spawnSync(["docker", "exec", CONTAINER, "redis-cli", ...cmd]).stdout.toString().trim();

let driver: DriverRedis;

// Conexão com credencial de escrita (o Redis do teste sobe sem senha; a
// credencial de escrita é o que o `mutarLinha` exige presente).
const conexao: ResolvedConnection = {
  id: "redis-valor-it", name: "redis", color: null, engine: "redis",
  host: "127.0.0.1", port: PORTA, database: "db0",
  username: "", password: "", sslMode: "disable", timezone: "UTC",
  statementTimeoutMs: 30_000, writeEnabled: false, hasWriteCredential: true,
  authSource: null, filePath: null, createdAt: "", updatedAt: "",
  writeCredential: { username: "", password: "" },
};

const editar = (op: RedisValueEditRequest["op"], key: string): Promise<{ rowCount: number; sql: string }> =>
  driver.mutarLinha(conexao, { tipo: "redis-valor", req: { database: "db0", key, op, readOnly: false } });

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-p", `${String(PORTA)}:6379`, "redis:7");
  let pronto = false;
  for (let i = 0; i < 60; i++) {
    if (sh("docker", "exec", CONTAINER, "redis-cli", "PING")) { pronto = true; break; }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Redis não ficou pronto");

  cli("HSET", "perfil:1", "nome", "Ana", "idade", "30");
  cli("RPUSH", "fila:1", "a", "b", "c");
  cli("SADD", "tags:1", "vip");
  cli("ZADD", "ranking:1", "10", "ana");

  driver = new DriverRedis(undefined);
});

afterAll(async () => {
  await driver.desligar();
  if (temDocker) sh("docker", "rm", "-f", CONTAINER);
});

describe.if(temDocker)("edição estruturada do Redis", () => {
  it("hash: HSET novo campo, HSET com guarda, HDEL", async () => {
    const add = await editar({ kind: "hash-set", field: "cidade", value: "SP", from: null }, "perfil:1");
    expect(add.rowCount).toBe(1);
    expect(cli("HGET", "perfil:1", "cidade")).toBe("SP");

    // Guarda certa: o valor atual bate.
    const upd = await editar({ kind: "hash-set", field: "nome", value: "Ana Paula", from: "Ana" }, "perfil:1");
    expect(upd.rowCount).toBe(1);
    expect(cli("HGET", "perfil:1", "nome")).toBe("Ana Paula");

    // Guarda errada: o valor mudou desde a leitura → conflito (rowCount 0).
    const conflito = await editar({ kind: "hash-set", field: "nome", value: "X", from: "Ana" }, "perfil:1");
    expect(conflito.rowCount).toBe(0);
    expect(cli("HGET", "perfil:1", "nome")).toBe("Ana Paula");

    const del = await editar({ kind: "hash-del", field: "idade" }, "perfil:1");
    expect(del.rowCount).toBe(1);
    expect(cli("HEXISTS", "perfil:1", "idade")).toBe("0");
  });

  it("set: SADD e SREM", async () => {
    await editar({ kind: "set-add", member: "novo" }, "tags:1");
    expect(cli("SISMEMBER", "tags:1", "novo")).toBe("1");
    await editar({ kind: "set-del", member: "vip" }, "tags:1");
    expect(cli("SISMEMBER", "tags:1", "vip")).toBe("0");
  });

  it("zset: ZADD com score e ZREM; score inválido é recusado", async () => {
    await editar({ kind: "zset-add", member: "bruno", score: "25.5", from: null }, "ranking:1");
    expect(cli("ZSCORE", "ranking:1", "bruno")).toBe("25.5");
    await editar({ kind: "zset-del", member: "ana" }, "ranking:1");
    expect(cli("ZSCORE", "ranking:1", "ana")).toBe("");

    let pego: unknown;
    try {
      await editar({ kind: "zset-add", member: "x", score: "abc", from: null }, "ranking:1");
    } catch (e: unknown) {
      pego = e;
    }
    expect(pego).toBeInstanceOf(Error);
  });

  it("zset: editar score com guarda errada não sobrescreve", async () => {
    // `ana` foi removida antes; recria com score 10 e edita com from errado.
    await editar({ kind: "zset-add", member: "carla", score: "5", from: null }, "ranking:1");
    const r = await editar({ kind: "zset-add", member: "carla", score: "99", from: "8" }, "ranking:1");
    expect(r.rowCount).toBe(0);
    expect(cli("ZSCORE", "ranking:1", "carla")).toBe("5");
  });

  it("list: LSET com guarda, LPUSH/RPUSH e LREM", async () => {
    // Índice 0 = "a" (guarda certa).
    const set = await editar({ kind: "list-set", index: 0, value: "A", from: "a" }, "fila:1");
    expect(set.rowCount).toBe(1);
    expect(cli("LINDEX", "fila:1", "0")).toBe("A");

    // Guarda errada no índice.
    const conflito = await editar({ kind: "list-set", index: 0, value: "Z", from: "a" }, "fila:1");
    expect(conflito.rowCount).toBe(0);
    expect(cli("LINDEX", "fila:1", "0")).toBe("A");

    await editar({ kind: "list-push", side: "right", value: "d" }, "fila:1");
    expect(cli("LINDEX", "fila:1", "-1")).toBe("d");
    await editar({ kind: "list-push", side: "left", value: "z" }, "fila:1");
    expect(cli("LINDEX", "fila:1", "0")).toBe("z");

    // Lista agora é ["z","A","b","c","d"] — "b" está no índice 2.
    const del = await editar({ kind: "list-del", index: 2, from: "b" }, "fila:1");
    expect(del.rowCount).toBe(1);
    expect(cli("LPOS", "fila:1", "b")).toBe("");

    // Guarda do índice: `from` errado não remove.
    const conflitoDel = await editar({ kind: "list-del", index: 0, from: "b" }, "fila:1");
    expect(conflitoDel.rowCount).toBe(0);
  });
});
