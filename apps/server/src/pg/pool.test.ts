import { describe, expect, it } from "bun:test";

import { PoolManager } from "./pool";

/**
 * Só a política de ciclo de vida — nada aqui abre conexão de verdade. O
 * caminho que fala com o Postgres é verificado à mão contra banco real.
 */
describe("PoolManager — ciclo de vida", () => {
  it("começa vazio", () => {
    expect(new PoolManager(undefined).size).toBe(0);
  });

  it("sweep não derruba nada quando não há pool", () => {
    expect(new PoolManager(undefined).sweep()).toBe(0);
  });

  it("evict de conexão desconhecida é inofensivo", () => {
    const pools = new PoolManager(undefined);
    expect(() => { pools.evict("nao-existe"); }).not.toThrow();
    expect(pools.size).toBe(0);
  });

  it("shutdown é idempotente", async () => {
    const pools = new PoolManager(undefined);
    pools.start();
    await pools.shutdown();
    await pools.shutdown();
    expect(pools.size).toBe(0);
  });

  it("start duas vezes não cria dois varredores", async () => {
    const pools = new PoolManager(undefined);
    pools.start();
    pools.start();
    await pools.shutdown();
    expect(pools.size).toBe(0);
  });
});
