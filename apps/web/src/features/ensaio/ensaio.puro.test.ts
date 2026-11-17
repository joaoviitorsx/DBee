import { describe, expect, test } from "bun:test";

import { contagensEsperadas } from "./ensaio.puro";

const st = (index: number, rowCount: number) => ({
  index, sql: "", rowCount, columns: [], rows: [], truncated: false, durationMs: 1, command: "UPDATE", viaCursor: false,
});

describe("contagensEsperadas", () => {
  test("um rowCount por statement, na ordem", () => {
    expect(contagensEsperadas({ results: [st(0, 3), st(1, 0)], error: null })).toEqual([3, 0]);
  });
  test("ensaio com erro não pode ser aplicado", () => {
    const error = { index: 1, code: "42601", message: "x", position: null, detail: null, hint: null };
    expect(contagensEsperadas({ results: [st(0, 3)], error })).toBeNull();
  });
  test("ensaio vazio não pode ser aplicado", () => {
    expect(contagensEsperadas({ results: [], error: null })).toBeNull();
  });
});
