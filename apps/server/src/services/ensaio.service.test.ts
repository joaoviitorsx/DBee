import { describe, expect, it } from "bun:test";

import type { StatementResult } from "@dbee/shared";

import { amostrar, divergencia } from "./ensaio.service";

const r = (rowCount: number, linhas = 0): StatementResult => ({
  index: 0, sql: "x", columns: [], rows: Array.from({ length: linhas }, () => ["1"]),
  rowCount, truncated: false, durationMs: 0, command: "UPDATE", viaCursor: false,
});

describe("divergencia (ADR 021)", () => {
  it("null quando cada rowCount bate", () => {
    expect(divergencia([3, 0], [r(3), r(0)])).toBeNull();
  });
  it("aponta o statement que divergiu, 1-based", () => {
    expect(divergencia([3, 1], [r(3), r(2)])).toBe("statement 2: ensaio 1, agora 2");
  });
  it("quantidade de statements diferente diverge", () => {
    expect(divergencia([1], [r(1), r(1)])).toContain("1 statement(s)");
  });
});

describe("amostrar", () => {
  it("corta em 50 e marca truncated sem mexer no rowCount", () => {
    const [a] = amostrar([r(200, 200)]);
    expect(a?.rows.length).toBe(50);
    expect(a?.truncated).toBe(true);
    expect(a?.rowCount).toBe(200);
  });
  it("deixa intacto o que cabe", () => {
    expect(amostrar([r(2, 2)])[0]?.truncated).toBe(false);
  });
});
