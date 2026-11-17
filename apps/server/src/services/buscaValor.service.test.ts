import { describe, expect, it } from "bun:test";

import { descreverParaLog } from "./buscaValor.service";

describe("descreverParaLog", () => {
  it("registra escopo e valor procurado", () => {
    expect(descreverParaLog({ value: "ana", scope: { schema: "public" } }, "contains")).toBe(
      '-- dbee: busca de valor (contains) em schema "public": "ana"',
    );
    expect(
      descreverParaLog({ value: "1", scope: { tables: [{ schema: "a", name: "b" }] } }, "exact"),
    ).toContain('tabelas "a.b"');
  });
  it("quebra de linha no valor não sai do comentário", () => {
    expect(descreverParaLog({ value: "a\nDROP", scope: { schema: "s" } }, "exact")).not.toContain("\n");
  });
});
