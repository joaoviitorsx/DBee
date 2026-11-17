import type { DataCompareResponse } from "@dbee/shared";
import { describe, expect, test } from "bun:test";

import { gradeDaAmostra, gradeDasDiferencas, sqlComAviso } from "./comparar.puro";

const rot = { tipo: "t", lado: "l", alteradas: "a", kind: { only_left: "só A", only_right: "só B", different: "dif" } };

describe("comparar.puro", () => {
  const r: DataCompareResponse = {
    primaryKey: ["id"],
    columns: ["id", "nome"],
    ignoredColumns: [],
    onlyLeft: 1, onlyRight: 0, different: 1, equal: 3, truncated: false,
    samples: [
      { kind: "different", key: ["1"], left: ["1", "Ana"], right: ["1", "Ana "], changedColumns: ["nome"] },
      { kind: "only_left", key: ["2"], left: ["2", null], right: null, changedColumns: [] },
    ],
    sql: "UPDATE …",
  };

  test("amostra: A e B em linhas separadas com valor cru", () => {
    const g = gradeDaAmostra(r, rot);
    expect(g.columns.map((c) => c.name)).toEqual(["t", "l", "a", "id", "nome"]);
    expect(g.rows).toEqual([
      ["dif", "A", "nome", "1", "Ana"],
      ["dif", "B", "nome", "1", "Ana "],
      ["só A", "A", "", "2", null],
    ]);
  });

  test("diferenças de schema viram linhas", () => {
    const g = gradeDasDiferencas(
      { differences: [{ kind: "column_type", table: "t", name: "c", left: "int", right: "text" }], ddl: "" },
      { tipo: "k", tabela: "tb", nome: "n" },
      (k) => k.toUpperCase(),
    );
    expect(g.rows).toEqual([["COLUMN_TYPE", "t", "c", "int", "text"]]);
  });

  test("aviso entra comentado linha a linha", () => {
    expect(sqlComAviso("DELETE FROM x;", "revise\nantes")).toBe("-- revise\n-- antes\n\nDELETE FROM x;");
  });
});
