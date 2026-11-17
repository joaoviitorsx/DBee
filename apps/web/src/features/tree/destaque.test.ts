import { describe, expect, it } from "bun:test";

import { trechos } from "./destaque.puro";

describe("trechos", () => {
  it("sem termo devolve o texto inteiro sem destaque", () => {
    expect(trechos("clientes", " ")).toEqual([{ texto: "clientes", casou: false }]);
  });
  it("destaca o meio", () => {
    expect(trechos("pedidos_itens", "dos")).toEqual([
      { texto: "pedi", casou: false },
      { texto: "dos", casou: true },
      { texto: "_itens", casou: false },
    ]);
  });
  it("ignora caixa e acento e devolve o trecho original", () => {
    expect(trechos("Produção", "producao")).toEqual([{ texto: "Produção", casou: true }]);
    expect(trechos("ação_x", "CAO")).toEqual([
      { texto: "a", casou: false },
      { texto: "ção", casou: true },
      { texto: "_x", casou: false },
    ]);
  });
  it("texto decomposto (NFD) mantém o acento no trecho", () => {
    const nfd = "produção";
    expect(trechos(nfd, "cao").map((p) => p.texto).join("")).toBe(nfd);
    expect(trechos(nfd, "cao").find((p) => p.casou)?.texto).toBe("ção");
  });
  it("sem casamento devolve sem destaque", () => {
    expect(trechos("clientes", "zzz")).toEqual([{ texto: "clientes", casou: false }]);
  });
});

describe("trechos — borda", () => {
  it("acento combinante depois do fim fica com a letra casada", () => {
    expect(trechos("çx", "c")[0]).toEqual({ texto: "ç", casou: true });
  });
});
