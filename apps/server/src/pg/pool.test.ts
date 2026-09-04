import type { Pool } from "pg";
import { describe, expect, it } from "bun:test";

import { PoolManager } from "./pool";

/**
 * Política de ciclo de vida. Nada aqui abre conexão de verdade — o caminho que
 * fala com o Postgres é verificado à mão contra banco real.
 */

/** Pool falso: só precisa registrar se `end()` foi chamado. */
function fakePool(): Pool & { ended: boolean } {
  const p = {
    ended: false,
    end(): Promise<void> {
      p.ended = true;
      return Promise.resolve();
    },
  };
  return p as unknown as Pool & { ended: boolean };
}

const TTL = 10 * 60_000;

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

describe("PoolManager — sweep respeita transação aberta", () => {
  it("derruba pool ocioso além do TTL", () => {
    const pools = new PoolManager(undefined);
    const pool = fakePool();
    const agora = Date.now();
    pools.seedForTest("c1", "db", pool, agora - TTL - 1);

    expect(pools.sweep(agora)).toBe(1);
    expect(pools.size).toBe(0);
    expect(pool.ended).toBe(true);
  });

  it("NÃO derruba pool com cliente emprestado, por mais antigo que seja", () => {
    // O cenário concreto: statement_timeout vai até 600 s e o TTL é 10 min.
    // Uma query longa passaria do TTL e perderia o pool no meio da transação.
    const pools = new PoolManager(undefined);
    const pool = fakePool();
    const agora = Date.now();
    pools.seedForTest("c1", "db", pool, agora - TTL * 10, 1);

    expect(pools.sweep(agora)).toBe(0);
    expect(pools.size).toBe(1);
    expect(pool.ended).toBe(false);
  });

  it("derruba na passada seguinte, depois que o empréstimo acaba", () => {
    const pools = new PoolManager(undefined);
    const pool = fakePool();
    const agora = Date.now();
    pools.seedForTest("c1", "db", pool, agora - TTL - 1, 1);

    expect(pools.sweep(agora)).toBe(0);

    // Empréstimo devolvido; o relógio de ocioso reinicia (é o que o finally
    // do withReadOnly faz), então ainda não expira.
    pools.seedForTest("c1", "db", pool, agora, 0);
    expect(pools.sweep(agora)).toBe(0);

    // Passado o TTL a partir da devolução, aí sim.
    expect(pools.sweep(agora + TTL + 1)).toBe(1);
    expect(pool.ended).toBe(true);
  });

  it("não derruba pool dentro do TTL", () => {
    const pools = new PoolManager(undefined);
    const agora = Date.now();
    pools.seedForTest("c1", "db", fakePool(), agora - TTL + 1_000);

    expect(pools.sweep(agora)).toBe(0);
    expect(pools.size).toBe(1);
  });

  it("varre só os expirados, deixando os demais", () => {
    const pools = new PoolManager(undefined);
    const agora = Date.now();
    const velho = fakePool();
    const novo = fakePool();
    pools.seedForTest("c1", "db", velho, agora - TTL - 1);
    pools.seedForTest("c2", "db", novo, agora);

    expect(pools.sweep(agora)).toBe(1);
    expect(pools.size).toBe(1);
    expect(velho.ended).toBe(true);
    expect(novo.ended).toBe(false);
  });
});

describe("PoolManager — evict", () => {
  it("derruba todos os databases da conexão indicada", () => {
    const pools = new PoolManager(undefined);
    const a = fakePool();
    const b = fakePool();
    const outra = fakePool();
    pools.seedForTest("c1", "um", a, Date.now());
    pools.seedForTest("c1", "dois", b, Date.now());
    pools.seedForTest("c2", "um", outra, Date.now());

    pools.evict("c1");

    expect(pools.size).toBe(1);
    expect(a.ended).toBe(true);
    expect(b.ended).toBe(true);
    expect(outra.ended).toBe(false);
  });

  it("não confunde conexão cujo id é prefixo de outro", () => {
    // Com chave composta isso dependia de o separador estar certo — e um byte
    // NUL invisível numa edição já quebrou exatamente essa comparação. O mapa
    // aninhado não compara prefixo nenhum.
    const pools = new PoolManager(undefined);
    const curto = fakePool();
    const longo = fakePool();
    pools.seedForTest("abc", "db", curto, Date.now());
    pools.seedForTest("abcdef", "db", longo, Date.now());

    pools.evict("abc");

    expect(curto.ended).toBe(true);
    expect(longo.ended).toBe(false);
    expect(pools.size).toBe(1);
  });

  it("evict não confunde databases de conexões diferentes com o mesmo nome", () => {
    const pools = new PoolManager(undefined);
    const a = fakePool();
    const b = fakePool();
    pools.seedForTest("c1", "app", a, Date.now());
    pools.seedForTest("c2", "app", b, Date.now());

    pools.evict("c1");

    expect(a.ended).toBe(true);
    expect(b.ended).toBe(false);
    expect(pools.size).toBe(1);
  });
});

describe("PoolManager — evict com transação em voo", () => {
  it("não encerra pool com cliente emprestado; sai do mapa e morre depois", () => {
    // Encerrar na hora abandonaria quem está na fila do connect(): o pedido só
    // falharia 10 s depois, por connectionTimeoutMillis, e a rota devolveria
    // 502 culpando o Postgres por uma fila do próprio DBee.
    const pools = new PoolManager(undefined);
    const pool = fakePool();
    pools.seedForTest("c1", "db", pool, Date.now(), 1);

    pools.evict("c1");

    expect(pools.size).toBe(0); // fora do mapa: ninguém novo o pega
    expect(pool.ended).toBe(false); // mas ainda vivo para a transação terminar
  });

  it("encerra na hora quando não há empréstimo", () => {
    const pools = new PoolManager(undefined);
    const pool = fakePool();
    pools.seedForTest("c1", "db", pool, Date.now(), 0);

    pools.evict("c1");

    expect(pools.size).toBe(0);
    expect(pool.ended).toBe(true);
  });
});

describe("PoolManager — start depois de shutdown", () => {
  it("volta a funcionar", async () => {
    // shutdown não zerava #sweeper, então um start() posterior era no-op.
    const pools = new PoolManager(undefined);
    pools.start();
    await pools.shutdown();
    pools.start();
    await pools.shutdown();
    expect(pools.size).toBe(0);
  });
});
