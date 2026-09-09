import { describe, expect, it } from "bun:test";

import { uuidV4 } from "./navegador";

/**
 * O `queryId` da consulta.
 *
 * Ele identifica a query a cancelar. Um id malformado ou repetido não quebra
 * nada visível — cancela a consulta de outra pessoa, que é pior que quebrar.
 */
describe("uuidV4", () => {
  const FORMATO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("tem o formato de um UUID v4", () => {
    for (let i = 0; i < 200; i += 1) expect(uuidV4()).toMatch(FORMATO);
  });

  it("não repete", () => {
    const vistos = new Set(Array.from({ length: 5000 }, () => uuidV4()));
    expect(vistos.size).toBe(5000);
  });

  /**
   * O caminho que a produção usa: sem contexto seguro, `crypto.randomUUID` não
   * existe. É este ramo que precisa estar certo — o outro é o do navegador que
   * nunca teve o problema.
   */
  it("sem randomUUID, o fallback ainda produz UUID v4 válido e único", () => {
    const original = globalThis.crypto;
    const semRandomUUID = {
      getRandomValues: original.getRandomValues.bind(original),
    } as unknown as Crypto;
    Object.defineProperty(globalThis, "crypto", { value: semRandomUUID, configurable: true });
    try {
      const ids = Array.from({ length: 2000 }, () => uuidV4());
      for (const id of ids) expect(id).toMatch(FORMATO);
      expect(new Set(ids).size).toBe(2000);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });

  it("sem crypto nenhum, falha alto em vez de devolver id previsível", () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(() => uuidV4()).toThrow("getRandomValues");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});
