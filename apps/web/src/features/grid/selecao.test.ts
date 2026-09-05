import { describe, expect, it } from "bun:test";

import { contaCelulas, dentro, faixaEntre, recorteTsv } from "./selecao";

const GRID: (string | null)[][] = [
  ["1", "ana", null],
  ["2", "bru\tno", ""],
  ["3", "cá\nrol", "x"],
];

describe("faixa", () => {
  it("normaliza a ordem — selecionar de baixo para cima dá o mesmo retângulo", () => {
    const descendo = faixaEntre({ linha: 0, coluna: 0 }, { linha: 2, coluna: 2 });
    const subindo = faixaEntre({ linha: 2, coluna: 2 }, { linha: 0, coluna: 0 });
    expect(descendo).toEqual(subindo);
  });

  it("sem âncora ou sem foco não há faixa", () => {
    expect(faixaEntre(null, { linha: 1, coluna: 1 })).toBeNull();
    expect(faixaEntre({ linha: 1, coluna: 1 }, null)).toBeNull();
  });

  it("dentro respeita as duas bordas", () => {
    const f = faixaEntre({ linha: 1, coluna: 0 }, { linha: 2, coluna: 1 });
    expect(dentro(f, 1, 0)).toBe(true);
    expect(dentro(f, 2, 1)).toBe(true);
    expect(dentro(f, 0, 0)).toBe(false);
    expect(dentro(f, 1, 2)).toBe(false);
    expect(dentro(null, 1, 0)).toBe(false);
  });

  it("conta as células da faixa", () => {
    const f = faixaEntre({ linha: 0, coluna: 0 }, { linha: 2, coluna: 1 });
    expect(f === null ? null : contaCelulas(f)).toEqual({ linhas: 3, colunas: 2 });
  });
});

describe("recorte em TSV", () => {
  it("copia só o retângulo, sem cabeçalho", () => {
    const f = faixaEntre({ linha: 0, coluna: 0 }, { linha: 1, coluna: 1 });
    expect(f === null ? "" : recorteTsv(GRID, f)).toBe("1\tana\n2\tbru no");
  });

  it("NULL e vazio saem os dois como célula vazia — a planilha não separa os dois", () => {
    const f = faixaEntre({ linha: 0, coluna: 2 }, { linha: 1, coluna: 2 });
    expect(f === null ? "" : recorteTsv(GRID, f)).toBe("\n");
  });

  it("tab e quebra dentro do valor viram espaço, senão desalinham a colagem", () => {
    const f = faixaEntre({ linha: 1, coluna: 1 }, { linha: 2, coluna: 1 });
    expect(f === null ? "" : recorteTsv(GRID, f)).toBe("bru no\ncá rol");
  });

  it("faixa além do fim das linhas carregadas não inventa linha vazia", () => {
    const f = faixaEntre({ linha: 2, coluna: 0 }, { linha: 9, coluna: 0 });
    expect(f === null ? "" : recorteTsv(GRID, f)).toBe("3");
  });
});
