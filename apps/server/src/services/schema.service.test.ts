import type { DatabaseSchema } from "@dbee/shared";
import { beforeAll, describe, expect, it } from "bun:test";

import { openTestStore, type Store } from "../db/client";
import type { Ator } from "../lib/ator";
import { ConnectionsRepository } from "../db/connections.repo";
import type { PoolManager } from "../pg/pool";
import type { Drivers } from "../driver/registro";
import type { DriverLeitura } from "../driver/tipos";
import { SchemaService } from "./schema.service";

/**
 * Driver falso: conta quantas vezes o servidor seria consultado. É o que prova
 * que o cache não é decoração.
 *
 * Era um `PoolManager` falso até o catálogo passar a ser lido pelo **driver da
 * engine**, e não mais pelo pool do Postgres. O ponto de substituição do teste
 * mudou junto: é o driver que fala com o servidor agora, e falsear o pool
 * deixaria de interceptar qualquer coisa.
 */
function fakeDrivers(behaviour: { fail?: boolean } = {}) {
  let calls = 0;
  const driver = {
    engine: "postgres" as const,
    esquema: (_c: unknown, database: string): Promise<DatabaseSchema> => {
      calls++;
      if (behaviour.fail === true) return Promise.reject(new Error("connection refused"));
      return Promise.resolve({
        database,
        schemas: [{ name: "public", relations: [] }],
        fetchedAt: new Date().toISOString(),
        cached: false,
      });
    },
  } as unknown as DriverLeitura;

  const registro = { para: () => driver } as unknown as Drivers;
  return { registro, calls: () => calls };
}

/** O pool não é mais consultado pelo catálogo, mas o serviço ainda o recebe. */
const poolInerte = {} as unknown as PoolManager;

let store: Store;
/**
 * Este arquivo testa cache e introspecção, não permissão. Um ator `admin`
 * enxerga toda conexão (migração 005), então ele mantém os testes falando do
 * que vieram falar. A permissão tem arquivo próprio.
 */
const ADMIN: Ator = { id: "u-admin", role: "admin" };

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
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    const first = await service.get(connectionId, undefined, false, ADMIN);
    expect(first.ok && first.value.cached).toBe(false);
    expect(drivers.calls()).toBe(1);

    const second = await service.get(connectionId, undefined, false, ADMIN);
    expect(second.ok && second.value.cached).toBe(true);
    expect(drivers.calls()).toBe(1); // não voltou ao Postgres
  });

  it("?refresh=1 ignora o cache", async () => {
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    await service.get(connectionId, undefined, false, ADMIN);
    const refreshed = await service.get(connectionId, undefined, true, ADMIN);

    expect(refreshed.ok && refreshed.value.cached).toBe(false);
    expect(drivers.calls()).toBe(2);
  });

  it("dentro do TTL de 5 minutos, serve do cache sem tocar no banco", async () => {
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });
    const t0 = Date.now();

    await service.get(connectionId, undefined, false, ADMIN, t0);

    // Um segundo antes do TTL: ainda fresco, em cache.
    const before = await service.get(connectionId, undefined, false, ADMIN, t0 + 5 * 60_000 - 1_000);
    expect(before.ok && before.value.cached).toBe(true);
    expect(drivers.calls()).toBe(1);
  });

  it("vencido: serve o velho na hora e revalida em background (SWR)", async () => {
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });
    const t0 = Date.now();

    await service.get(connectionId, undefined, false, ADMIN, t0);

    // Entrada vencida: serve o valor velho (cached) SEM bloquear a resposta.
    const stale = await service.get(connectionId, undefined, false, ADMIN, t0 + 5 * 60_000 + 1_000);
    expect(stale.ok && stale.value.cached).toBe(true);

    // ...e a revalidação em background já foi disparada — sem esperar por ela.
    await new Promise((r) => setTimeout(r, 0));
    expect(drivers.calls()).toBe(2);

    // O cache foi renovado (TTL a partir de agora): o próximo acesso serve do
    // cache fresco, sem voltar ao banco.
    const next = await service.get(connectionId, undefined, false, ADMIN);
    expect(next.ok && next.value.cached).toBe(true);
    expect(drivers.calls()).toBe(2);
  });

  it("cacheia por database, não só por conexão", async () => {
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    await service.get(connectionId, "um", false, ADMIN);
    await service.get(connectionId, "dois", false, ADMIN);
    expect(drivers.calls()).toBe(2);
    expect(service.cacheSize).toBe(2);

    const again = await service.get(connectionId, "um", false, ADMIN);
    expect(again.ok && again.value.database).toBe("um");
    expect(drivers.calls()).toBe(2);
  });

  it("sem ?database, usa o database da conexão", async () => {
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    const result = await service.get(connectionId, undefined, false, ADMIN);
    expect(result.ok && result.value.database).toBe("app");
  });

  it("evict limpa só a conexão indicada", async () => {
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    await service.get(connectionId, "um", false, ADMIN);
    await service.get(connectionId, "dois", false, ADMIN);
    expect(service.cacheSize).toBe(2);

    service.evict("outra-conexao");
    expect(service.cacheSize).toBe(2);

    service.evict(connectionId);
    expect(service.cacheSize).toBe(0);
  });
});

describe("SchemaService — falhas", () => {
  it("conexão inexistente vira not_found", async () => {
    const drivers = fakeDrivers();
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    const result = await service.get("nao-existe", undefined, false, ADMIN);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toBe("not_found");
    expect(drivers.calls()).toBe(0);
  });

  it("banco fora do ar vira upstream_error com a mensagem do driver", async () => {
    const drivers = fakeDrivers({ fail: true });
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    const result = await service.get(connectionId, undefined, false, ADMIN);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toBe("upstream_error");
    expect(!result.ok && result.detail).toContain("connection refused");
  });

  it("falha não entra no cache", async () => {
    const drivers = fakeDrivers({ fail: true });
    const service = new SchemaService({ repository, pools: poolInerte, drivers: drivers.registro });

    await service.get(connectionId, undefined, false, ADMIN);
    await service.get(connectionId, undefined, false, ADMIN);

    expect(service.cacheSize).toBe(0);
    expect(drivers.calls()).toBe(2); // tentou de novo, não serviu erro do cache
  });

  it("APP_SECRET trocado vira decryption_failed, sem tocar no Postgres", async () => {
    const drivers = fakeDrivers();
    const outraChave = new ConnectionsRepository(store.db, {
      __brand: "EncryptionKey",
      bytes: Buffer.alloc(32, 7),
    });
    const service = new SchemaService({ repository: outraChave, pools: poolInerte, drivers: drivers.registro });

    const result = await service.get(connectionId, undefined, false, ADMIN);
    expect(!result.ok && result.failure).toBe("decryption_failed");
    expect(drivers.calls()).toBe(0);
  });
});
