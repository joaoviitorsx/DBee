import { describe, expect, it } from "bun:test";

import { ALVO_ICONE, deslocamentoFlip, LARGURA_TRILHO, PASSO_TRILHO, posicoesDoTrilho } from "./trilho.puro";

describe("trilho: geometria compacta", () => {
  it("passo fixo, sem vão, independente de quantas conexões e de expansões", () => {
    const p = posicoesDoTrilho(6);
    for (let i = 1; i < p.length; i++) {
      expect((p[i]?.y ?? 0) - (p[i - 1]?.y ?? 0)).toBe(PASSO_TRILHO);
    }
  });

  it("ícones centrados na largura do trilho", () => {
    for (const { x } of posicoesDoTrilho(3)) {
      expect(x + ALVO_ICONE / 2).toBe(LARGURA_TRILHO / 2);
    }
  });

  it("FLIP parte do centro medido na árvore; sem medida, aparece no lugar", () => {
    const alvo = posicoesDoTrilho(1)[0] ?? { x: 0, y: 0 };
    expect(deslocamentoFlip({ x: 54, y: 300 }, alvo)).toEqual({ x: 54 - 22, y: 300 - (alvo.y + 14) });
    expect(deslocamentoFlip(undefined, alvo)).toEqual({ x: 0, y: 0 });
  });
});
