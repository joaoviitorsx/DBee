import { describe, expect, test } from "bun:test";
import { faseDe, montarFiltro, rotuloFiltro } from "./carregamento.puro";

describe("faseDe", () => {
  test("limiares 120 ms e 1 s", () => {
    expect(faseDe(0)).toBe("nada");
    expect(faseDe(119)).toBe("nada");
    expect(faseDe(120)).toBe("esqueleto");
    expect(faseDe(999)).toBe("esqueleto");
    expect(faseDe(1000)).toBe("trabalhando");
  });
});

describe("montarFiltro", () => {
  test("sem coluna não filtra", () => { expect(montarFiltro("", "eq", "1")).toBeNull(); });
  test("IS NULL ignora valor", () => {
    expect(montarFiltro("a", "isNull", "x")).toEqual({ column: "a", operator: "isNull" });
  });
  test("IN parte por vírgula e quebra, descarta vazios", () => {
    expect(montarFiltro("a", "in", "1, 2,\n3,, ")).toEqual({ column: "a", operator: "in", values: ["1", "2", "3"] });
    expect(montarFiltro("a", "in", " , ")).toBeNull();
  });
  test("comparação mantém o valor cru (regra 10)", () => {
    expect(montarFiltro("a", "gte", " 10 ")).toEqual({ column: "a", operator: "gte", value: " 10 " });
  });
});

describe("rotuloFiltro", () => {
  test("formas", () => {
    expect(rotuloFiltro({ column: "a", operator: "ne", value: "1" })).toBe("a <> 1");
    expect(rotuloFiltro({ column: "a", operator: "in", values: ["1", "2"] })).toBe("a IN (1, 2)");
    expect(rotuloFiltro({ column: "a", operator: "isNotNull" })).toBe("a IS NOT NULL");
    expect(rotuloFiltro({ column: "a", operator: "contains", value: "x" })).toBe("a ILIKE %x%");
  });
});
