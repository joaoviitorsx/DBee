import { describe, expect, it } from "bun:test";

import { statementSobCursor } from "./SqlEditor";

/**
 * O Cmd+Enter manda ao servidor o statement sob o cursor. Se esta escolha
 * divergir do que o servidor separa, o editor destaca um trecho e o banco roda
 * outro — por isso os dois usam `splitStatements` de `packages/shared`.
 */
const sob = (sql: string, cursor: number): string | null =>
  statementSobCursor(sql, cursor)?.sql ?? null;

describe("statement sob o cursor", () => {
  const doc = "SELECT 1;\nSELECT 2;\nSELECT 3";

  it("cursor no primeiro", () => {
    expect(sob(doc, 0)).toBe("SELECT 1");
    expect(sob(doc, 4)).toBe("SELECT 1");
    expect(sob(doc, 8)).toBe("SELECT 1");
  });

  it("cursor no segundo", () => {
    expect(sob(doc, 12)).toBe("SELECT 2");
  });

  it("cursor no último, sem ; no fim", () => {
    expect(sob(doc, doc.length)).toBe("SELECT 3");
  });

  it("documento com um statement só", () => {
    expect(sob("SELECT 1", 3)).toBe("SELECT 1");
  });

  it("documento vazio devolve null", () => {
    expect(sob("", 0)).toBeNull();
    expect(sob("   \n  ", 2)).toBeNull();
  });

  it("cursor entre statements pega o anterior", () => {
    // Logo depois do ";" — é o que a pessoa acabou de escrever.
    const s = "SELECT 1;\n\n\nSELECT 2";
    expect(sob(s, 10)).toBe("SELECT 1");
  });

  it("respeita ; dentro de string, como o servidor", () => {
    const s = "SELECT 'a;b' AS x;\nSELECT 2";
    // Um separador ingênuo cortaria em 'a; e o editor mandaria SQL quebrado.
    expect(sob(s, 8)).toBe("SELECT 'a;b' AS x");
    expect(sob(s, 20)).toBe("SELECT 2");
  });

  it("respeita dollar quoting", () => {
    const s = "SELECT $fn$ um; dois $fn$;\nSELECT 2";
    expect(sob(s, 14)).toBe("SELECT $fn$ um; dois $fn$");
  });

  it("devolve o intervalo para destacar", () => {
    const alvo = statementSobCursor(doc, 12);
    expect(doc.slice(alvo?.de ?? 0, alvo?.ate ?? 0)).toBe("SELECT 2");
  });
});
