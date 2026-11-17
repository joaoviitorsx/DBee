import { describe, expect, it } from "bun:test";

import { quadrosDePoca, raioDeRevelacao } from "./revelacao.puro";

describe("raioDeRevelacao", () => {
  it("do canto superior direito alcança o inferior esquerdo", () => {
    expect(raioDeRevelacao(1440, 0, 1440, 900)).toBeCloseTo(Math.hypot(1440, 900));
  });
  it("do centro alcança qualquer canto", () => {
    expect(raioDeRevelacao(50, 50, 100, 100)).toBeCloseTo(Math.hypot(50, 50));
  });
});

describe("troca de tema: poça de mel", () => {
  const cmds = (s: string) => s.replace(/[^MLCZ]/g, "");
  for (const [nome, gerar] of [["poça", quadrosDePoca]] as const) {
    it(`${nome}: todos os quadros têm a mesma estrutura (interpolável)`, () => {
      const qs = gerar(40, 1400, 20, 1440, 900);
      expect(qs).toHaveLength(41);
      expect(new Set(qs.map((q) => cmds(q.recorte))).size).toBe(1);
    });
    it(`${nome}: a abelha sai da janela`, () => {
      const q = gerar(40, 1400, 20, 1440, 900).at(-1);
      const fora = q !== undefined && (q.x < 0 || q.x > 1440 || q.y < 0 || q.y > 900);
      expect(fora).toBe(true);
    });
  }
  it("poça: no último quadro a borda passa dos quatro cantos da janela", () => {
    const [bx, by, w, h] = [1400, 20, 1440, 900];
    const q = quadrosDePoca(40, bx, by, w, h).at(-1);
    // Âncoras: o "M" e o último par de cada "C", na ordem dos ângulos.
    const ancoras = [...(q?.recorte ?? "").matchAll(/(?:M|\d )(-?[\d.]+),(-?[\d.]+)(?= C| Z)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(ancoras.length).toBeGreaterThanOrEqual(18);
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
      const ang = Math.atan2(cy - by, cx - bx);
      const perto = ancoras.reduce((m, p) => {
        const d = Math.abs(Math.atan2(Math.sin(Math.atan2(p[1] - by, p[0] - bx) - ang), Math.cos(Math.atan2(p[1] - by, p[0] - bx) - ang)));
        return d < m.d ? { d, r: Math.hypot(p[0] - bx, p[1] - by) } : m;
      }, { d: 9, r: 0 });
      expect(perto.r).toBeGreaterThan(Math.hypot(cx - bx, cy - by));
    }
  });
});
