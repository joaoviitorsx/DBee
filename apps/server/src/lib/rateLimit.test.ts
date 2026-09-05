import { describe, expect, it } from "bun:test";

import { RateLimiter } from "./rateLimit";

const CONFIG = { tentativas: 3, janelaMs: 60_000 };

describe("rate limit do login", () => {
  it("permite até o limite e bloqueia depois", () => {
    const rl = new RateLimiter(CONFIG);
    const t = 1_000_000;

    expect(rl.registrar("joao", t).permitido).toBe(true);
    expect(rl.registrar("joao", t).permitido).toBe(true);
    // A terceira consome a última ficha: ela passa, mas não sobra nenhuma.
    expect(rl.registrar("joao", t)).toMatchObject({ permitido: false, restantes: 0 });
    expect(rl.consultar("joao", t).permitido).toBe(false);
  });

  it("a janela vira e o contador recomeça", () => {
    const rl = new RateLimiter(CONFIG);
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) rl.registrar("joao", t);
    expect(rl.consultar("joao", t).permitido).toBe(false);
    expect(rl.consultar("joao", t + 60_001).permitido).toBe(true);
  });

  it("chaves não se contaminam", () => {
    const rl = new RateLimiter(CONFIG);
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) rl.registrar("joao", t);
    expect(rl.consultar("joao", t).permitido).toBe(false);
    expect(rl.consultar("maria", t).permitido).toBe(true);
  });

  it("login certo zera o contador", () => {
    const rl = new RateLimiter(CONFIG);
    const t = 1_000_000;
    rl.registrar("joao", t);
    rl.registrar("joao", t);
    rl.limpar("joao");
    expect(rl.consultar("joao", t).restantes).toBe(3);
  });

  it("informa quantos segundos faltam, nunca zero", () => {
    const rl = new RateLimiter(CONFIG);
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) rl.registrar("joao", t);
    // 1 ms antes de virar ainda é "espere 1 s", não "espere 0".
    expect(rl.consultar("joao", t + 59_999).esperarSegundos).toBe(1);
  });

  it("chave nova não faz o mapa crescer sem teto", () => {
    // Um atacante variando o nome de usuário é o caminho de DoS pela porta dos
    // fundos: sem poda, cada nome inventado vira uma entrada permanente.
    const rl = new RateLimiter(CONFIG);
    for (let i = 0; i < 1000; i++) rl.registrar(`bot${String(i)}`, 1_000_000);
    expect(rl.tamanho).toBe(1000);

    rl.registrar("depois", 1_000_000 + 60_001);
    expect(rl.tamanho).toBe(1);
  });
});
