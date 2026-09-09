import { describe, expect, it } from "bun:test";

import { chaveTabela, rotuloTabela } from "./chave";

/**
 * A colisão que fazia o export levar tabela não pedida.
 *
 * As duas tabelas deste teste existem: foram criadas num Postgres real para
 * reproduzir o defeito. Marcar uma marcava as duas.
 */
describe("chave de tabela no export", () => {
  it("schema com ponto NÃO colide com tabela com ponto", () => {
    expect(chaveTabela("zz_a", "b.c")).not.toBe(chaveTabela("zz_a.b", "c"));
  });

  it("o rótulo pode colidir — ele é para ler, não para identificar", () => {
    expect(rotuloTabela("zz_a", "b.c")).toBe(rotuloTabela("zz_a.b", "c"));
  });

  it("a mesma tabela dá sempre a mesma chave", () => {
    expect(chaveTabela("public", "pedidos")).toBe(chaveTabela("public", "pedidos"));
  });

  /** Nome hostil não pode virar chave de protótipo num objeto literal. */
  it("nomes hostis não produzem chave perigosa", () => {
    for (const [s, t] of [["__proto__", "x"], ["constructor", "prototype"], ["", ""]] as const) {
      expect(chaveTabela(s, t).startsWith("[")).toBe(true);
    }
  });
});
