import { describe, expect, it } from "bun:test";

import { acaoDaTecla, buscaPorPrefixo, type ItemArvore } from "./teclado.puro";

const it_ = (nivel: number, rotulo: string, expansivel = false, expandido = false): ItemArvore => ({
  nivel, rotulo, expansivel, expandido,
});
// conexão aberta > db aberto > schema fechado ; conexão fechada
const itens = [
  it_(1, "Catálogo", true, true),
  it_(2, "demo", true, true),
  it_(3, "public", true, false),
  it_(1, "Outra", true, false),
];

describe("acaoDaTecla", () => {
  it("setas movem", () => {
    expect(acaoDaTecla(itens, 0, "ArrowDown")).toEqual({ tipo: "focar", indice: 1 });
    expect(acaoDaTecla(itens, 3, "ArrowDown")).toEqual({ tipo: "nada" });
    expect(acaoDaTecla(itens, 0, "ArrowUp")).toEqual({ tipo: "nada" });
    expect(acaoDaTecla(itens, 2, "End")).toEqual({ tipo: "focar", indice: 3 });
  });
  it("→ expande fechado e desce em aberto", () => {
    expect(acaoDaTecla(itens, 2, "ArrowRight")).toEqual({ tipo: "alternar", indice: 2 });
    expect(acaoDaTecla(itens, 0, "ArrowRight")).toEqual({ tipo: "focar", indice: 1 });
  });
  it("← recolhe aberto e sobe ao pai em fechado", () => {
    expect(acaoDaTecla(itens, 1, "ArrowLeft")).toEqual({ tipo: "alternar", indice: 1 });
    expect(acaoDaTecla(itens, 2, "ArrowLeft")).toEqual({ tipo: "focar", indice: 1 });
    expect(acaoDaTecla(itens, 3, "ArrowLeft")).toEqual({ tipo: "nada" });
  });
  it("folha não expande", () => {
    expect(acaoDaTecla([it_(4, "clientes")], 0, "ArrowRight")).toEqual({ tipo: "nada" });
  });
});

describe("buscaPorPrefixo", () => {
  it("acha o próximo dando a volta", () => {
    expect(buscaPorPrefixo(itens, 0, "o")).toBe(3);
    expect(buscaPorPrefixo(itens, 3, "c")).toBe(0);
    expect(buscaPorPrefixo(itens, 0, "zz")).toBe(-1);
  });
  it("prefixo longo refina a partir do atual", () => {
    expect(buscaPorPrefixo(itens, 1, "de")).toBe(1);
  });
});
