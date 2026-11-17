import { describe, expect, test } from "bun:test";

import { confirmacaoConfere } from "./ambiente.puro";

describe("confirmacaoConfere", () => {
  test("exige o nome exato", () => {
    expect(confirmacaoConfere("Produção", "Produção")).toBe(true);
    expect(confirmacaoConfere(" Produção ", "Produção")).toBe(false);
    expect(confirmacaoConfere("produção", "Produção")).toBe(false);
    expect(confirmacaoConfere("Prod", "Produção")).toBe(false);
  });
  test("nome vazio nunca confere", () => {
    expect(confirmacaoConfere("", "")).toBe(false);
  });
});
