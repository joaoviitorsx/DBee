import { describe, expect, it } from "bun:test";

import { agruparHits, emLotes, ehBuscavel, filtrosDaPk, rotuloPk } from "./buscaValor.puro";

const hit = (table: string, column: string, id: string) => ({
  schema: "public", table, column, pk: { id }, value: "x",
});

describe("busca de valor (puro)", () => {
  it("divide em lotes sem perder nem repetir", () => {
    expect(emLotes([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(emLotes([], 5)).toEqual([]);
  });

  it("agrupa por tabela e coluna, com total", () => {
    const g = agruparHits([hit("a", "nome", "1"), hit("b", "x", "2"), hit("a", "nome", "3"), hit("a", "email", "1")]);
    expect(g.map((x) => x.table)).toEqual(["a", "b"]);
    expect(g[0]?.total).toBe(3);
    expect(g[0]?.colunas.map((c) => [c.column, c.hits.length])).toEqual([["nome", 2], ["email", 1]]);
  });

  it("PK vira filtro de igualdade; NULL vira isNull", () => {
    expect(filtrosDaPk({ id: "7", t: null })).toEqual([
      { column: "id", operator: "eq", value: "7" },
      { column: "t", operator: "isNull" },
    ]);
    expect(rotuloPk({ id: "7", t: null })).toBe("id=7, t=NULL");
  });

  it("só tabela e tabela particionada entram no escopo", () => {
    expect(ehBuscavel("table")).toBe(true);
    expect(ehBuscavel("partitioned_table")).toBe(true);
    expect(ehBuscavel("view")).toBe(false);
  });
});
