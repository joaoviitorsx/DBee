import { describe, expect, test } from "bun:test";

import { filtrosValidos, lerLink, linkDeSalva, linkDeTabela } from "./links.puro";

describe("links (ADR 020)", () => {
  test("ida e volta da tabela com filtro e ordem", () => {
    const h = linkDeTabela({
      connectionId: "c1",
      database: "demo",
      schema: "public",
      tabela: "clientes/x",
      filtros: [{ column: "nome", operator: "contains", value: "a&b" }],
      ordem: { column: "id", direction: "desc" },
    });
    expect(lerLink(h)).toEqual({
      tipo: "tabela",
      connectionId: "c1",
      database: "demo",
      schema: "public",
      tabela: "clientes/x",
      filtros: [{ column: "nome", operator: "contains", value: "a&b" }],
      ordem: { column: "id", direction: "desc" },
    });
  });
  test("query salva", () => {
    expect(lerLink(linkDeSalva("abc"))).toEqual({ tipo: "salva", id: "abc" });
  });
  test("nunca aceita SQL livre nem formato desconhecido", () => {
    expect(lerLink("#sql/SELECT 1")).toBeNull();
    expect(lerLink("#q/")).toBeNull();
    expect(lerLink("")).toBeNull();
    expect(lerLink("#c/x/t/s")).toBeNull();
  });
  test("filtro adulterado vira sem filtro", () => {
    const l = lerLink("#c/c/t/s/t?f=%5B%7B%22column%22%3A%22a%22%2C%22operator%22%3A%22drop%22%7D%5D");
    expect(l?.tipo === "tabela" ? l.filtros : null).toEqual([]);
    expect(lerLink("#c/c/t/s/t?f=%%%")).not.toBeNull();
  });
  test("filtrosValidos recusa forma errada", () => {
    expect(filtrosValidos("x")).toBeNull();
    expect(filtrosValidos([{ column: "a", operator: "in", values: [1] }])).toBeNull();
    expect(filtrosValidos([{ column: "a", operator: "isNull" }])).toEqual([{ column: "a", operator: "isNull" }]);
  });
});
