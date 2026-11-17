import { describe, expect, test } from "bun:test";

import { prepararSnippet } from "./snippet.puro";

describe("prepararSnippet", () => {
  test("sem variável executa como está (cast e string não contam)", () => {
    expect(prepararSnippet("SELECT 'a:b', 1::int", "postgres")).toEqual({ tipo: "sem" });
  });
  test("Postgres, um statement: converte para $n", () => {
    expect(prepararSnippet("SELECT * FROM t WHERE a = :x AND b = :y OR a = :x", "postgres")).toEqual({
      tipo: "variaveis",
      sql: "SELECT * FROM t WHERE a = $1 AND b = $2 OR a = $1",
      nomes: ["x", "y"],
    });
  });
  test("recusa em outra engine e com vários statements", () => {
    expect(prepararSnippet("SELECT :x", "mysql")).toEqual({ tipo: "recusa", motivo: "engine" });
    expect(prepararSnippet("SELECT :x; SELECT 1", "postgres")).toEqual({ tipo: "recusa", motivo: "varios" });
  });
});
