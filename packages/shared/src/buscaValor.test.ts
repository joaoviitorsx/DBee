import { describe, expect, it } from "bun:test";

import { ehNumero, padraoContem } from "./buscaValor.puro";

describe("busca de valor (puro)", () => {
  it("escapa curingas do ILIKE", () => {
    expect(padraoContem("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
    expect(padraoContem("ana")).toBe("%ana%");
  });
  it("reconhece número decimal simples e só ele", () => {
    for (const v of ["1", "-12", "3.14", " 7 "]) expect(ehNumero(v)).toBe(true);
    for (const v of ["1e3", "NaN", "Infinity", "1.", ".5", "abc", "1,5", ""]) expect(ehNumero(v)).toBe(false);
  });
});
