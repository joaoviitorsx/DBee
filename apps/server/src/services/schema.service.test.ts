import type { DatabaseSchema } from "@dbee/shared";
import { beforeAll, describe, expect, it } from "bun:test";

import { openTestStore, type Store } from "../db/client";
import { ConnectionsRepository } from "../db/connections.repo";
import type { PoolManager } from "../pg/pool";
import { SchemaService } from "./schema.service";

/**
 * PoolManager falso: conta quantas vezes o Postgres seria consultado. É o que
 * prova que o cache não é decoração.
 */
function fakePools(behaviour: { fail?: boolean } = {}) {
  let calls = 0;
  const manager = {
    withReadOnly: <T>(_c: unknown, database: string): Promise<T> => {
      calls++;
      if (behaviour.fail === true) return Promise.reject(new Error("connection refused"));
      const tree: DatabaseSchema = {
        database,
        schemas: [{ name: "public", relations: [] }],
        fetchedAt: new Date().toISOString(),
        cached: false,
      };
      return Promise.resolve(tree as T);
    },
  } as unknown as PoolManager;

  return { manager, calls: () => calls };
}

let store: Store;
let repository: ConnectionsRepository;
let connectionId: string;

beforeAll(() => {
  // Deriva a chave scrypt uma vez para toda a suíte (~700 ms).
  store = openTestStore();
  repository = new ConnectionsRepository(store.db, store.key);
  connectionId = repository.create({
    name: "alvo",
    host: "127.0.0.1",
    database: "app",
    username: "u",
    password: "p",
  }).id;
});

describe("SchemaService — cache", () => {
  it("busca no banco na primeira vez e serve do cache depois", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });

    const first = await service.get(connectionId, undefined, false);
    expect(first.ok && first.value.cached).toBe(false);
    expect(pools.calls()).toBe(1);

    const second = await service.get(connectionId, undefined, false);
    expect(second.ok && second.value.cached).toBe(true);
    expect(pools.calls()).toBe(1); // não voltou ao Postgres
  });

  it("?refresh=1 ignora o cache", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });

    await service.get(connectionId, undefined, false);
    const refreshed = await service.get(connectionId, undefined, true);

    expect(refreshed.ok && refreshed.value.cached).toBe(false);
    expect(pools.calls()).toBe(2);
  });

  it("dentro do TTL de 5 minutos, serve do cache sem tocar no banco", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });
    const t0 = Date.now();

    await service.get(connectionId, undefined, false, t0);

    // Um segundo antes do TTL: ainda fresco, em cache.
    const before = await service.get(connectionId, undefined, false, t0 + 5 * 60_000 - 1_000);
    expect(before.ok && before.value.cached).toBe(true);
    expect(pools.calls()).toBe(1);
  });

  it("vencido: serve o velho na hora e revalida em background (SWR)", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });
    const t0 = Date.now();

    await service.get(connectionId, undefined, false, t0);

    // Entrada vencida: serve o valor velho (cached) SEM bloquear a resposta.
    const stale = await service.get(connectionId, undefined, false, t0 + 5 * 60_000 + 1_000);
    expect(stale.ok && stale.value.cached).toBe(true);

    // ...e a revalidação em background já foi disparada — sem esperar por ela.
    await new Promise((r) => setTimeout(r, 0));
    expect(pools.calls()).toBe(2);

    // O cache foi renovado (TTL a partir de agora): o próximo acesso serve do
    // cache fresco, sem voltar ao banco.
    const next = await service.get(connectionId, undefined, false);
    expect(next.ok && next.value.cached).toBe(true);
    expect(pools.calls()).toBe(2);
  });

  it("cacheia por database, não só por conexão", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });

    await service.get(connectionId, "um", false);
    await service.get(connectionId, "dois", false);
    expect(pools.calls()).toBe(2);
    expect(service.cacheSize).toBe(2);

    const again = await service.get(connectionId, "um", false);
    expect(again.ok && again.value.database).toBe("um");
    expect(pools.calls()).toBe(2);
  });

  it("sem ?database, usa o database da conexão", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });

    const result = await service.get(connectionId, undefined, false);
    expect(result.ok && result.value.database).toBe("app");
  });

  it("evict limpa só a conexão indicada", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });

    await service.get(connectionId, "um", false);
    await service.get(connectionId, "dois", false);
    expect(service.cacheSize).toBe(2);

    service.evict("outra-conexao");
    expect(service.cacheSize).toBe(2);

    service.evict(connectionId);
    expect(service.cacheSize).toBe(0);
  });
});

describe("SchemaService — falhas", () => {
  it("conexão inexistente vira not_found", async () => {
    const pools = fakePools();
    const service = new SchemaService({ repository, pools: pools.manager });

    const result = await service.get("nao-existe", undefined, false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toBe("not_found");
    expect(pools.calls()).toBe(0);
  });

  it("banco fora do ar vira upstream_error com a mensagem do driver", async () => {
    const pools = fakePools({ fail: true });
    const service = new SchemaService({ repository, pools: pools.manager });

    const result = await service.get(connectionId, undefined, false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toBe("upstream_error");
    expect(!result.ok && result.detail).toContain("connection refused");
  });

  it("falha não entra no cache", async () => {
    const pools = fakePools({ fail: true });
    const service = new SchemaService({ repository, pools: pools.manager });

    await service.get(connectionId, undefined, false);
    await service.get(connectionId, undefined, false);

    expect(service.cacheSize).toBe(0);
    expect(pools.calls()).toBe(2); // tentou de novo, não serviu erro do cache
  });

  it("APP_SECRET trocado vira decryption_failed, sem tocar no Postgres", async () => {
    const pools = fakePools();
    const outraChave = new ConnectionsRepository(store.db, {
      __brand: "EncryptionKey",
      bytes: Buffer.alloc(32, 7),
    });
    const service = new SchemaService({ repository: outraChave, pools: pools.manager });

    const result = await service.get(connectionId, undefined, false);
    expect(!result.ok && result.failure).toBe("decryption_failed");
    expect(pools.calls()).toBe(0);
  });
});
