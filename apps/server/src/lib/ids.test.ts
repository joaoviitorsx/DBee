import { describe, expect, it } from "bun:test";

import { ID_ALPHABET, ID_SIZE, nanoid } from "./ids";

describe("nanoid", () => {
  it("tem o comprimento e o alfabeto declarados", () => {
    const id = nanoid();
    expect(id).toHaveLength(ID_SIZE);
    for (const char of id) expect(ID_ALPHABET).toContain(char);
  });

  /**
   * A premissa que torna `b & 63` correto. Se alguém encolher o alfabeto para
   * 62 "para ficar alfanumérico", este teste quebra antes do viés entrar em
   * produção sem ninguém ver.
   */
  it("o alfabeto tem exatamente 64 símbolos — potência de 2, sem viés de módulo", () => {
    expect(ID_ALPHABET).toHaveLength(64);
    expect(Number.isInteger(Math.log2(ID_ALPHABET.length))).toBe(true);
    expect(256 % ID_ALPHABET.length).toBe(0); // 4 bytes por símbolo, sem sobra
  });

  it("não tem símbolo repetido", () => {
    expect(new Set(ID_ALPHABET).size).toBe(64);
  });

  it("distribui os símbolos sem viés detectável", () => {
    // 64 símbolos × 21 chars × 2000 ids ≈ 656 ocorrências esperadas por símbolo.
    // Tolerância de ±25% pega o viés de `% 62` (que daria +25% a 8 símbolos)
    // sem falhar por flutuação estatística normal.
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      for (const char of nanoid()) counts.set(char, (counts.get(char) ?? 0) + 1);
    }

    expect(counts.size).toBe(64); // todo símbolo saiu ao menos uma vez

    const expected = (2000 * ID_SIZE) / 64;
    for (const [char, count] of counts) {
      expect({ char, ratio: count / expected }).toMatchObject({
        char,
        ratio: expect.closeTo(1, 0.25) as number,
      });
    }
  });

  it("não colide em 20 mil gerações", () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => nanoid()));
    expect(ids.size).toBe(20_000);
  });
});
