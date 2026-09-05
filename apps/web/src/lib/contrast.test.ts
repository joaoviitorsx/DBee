import { describe, expect, it } from "bun:test";

import { contrast, deltaE, TOKENS } from "./contrast";

const round = (n: number): number => Math.round(n * 10) / 10;

describe("contraste dos tokens (docs/design-system.md §1.5)", () => {
  // WCAG AA: 4.5:1 para texto normal.
  it.each([
    ["ink sobre surface", TOKENS.ink, TOKENS.surface],
    ["ink sobre sunken", TOKENS.ink, TOKENS.sunken],
    ["ink sobre raised", TOKENS.ink, TOKENS.raised],
    ["muted sobre surface", TOKENS.muted, TOKENS.surface],
    ["muted sobre sunken", TOKENS.muted, TOKENS.sunken],
    ["danger sobre surface", TOKENS.danger, TOKENS.surface],
    ["ok sobre surface", TOKENS.ok, TOKENS.surface],
    ["amber sobre surface", TOKENS.amber, TOKENS.surface],
    ["accent-ink sobre amber", TOKENS.accentInk, TOKENS.amber],
  ])("%s passa AA (>= 4.5:1)", (_label, fg, bg) => {
    expect(round(contrast(fg, bg))).toBeGreaterThanOrEqual(4.5);
  });

  // `subtle` é o único token que NÃO passa AA em texto normal. Isso é
  // deliberado e está documentado — o teste trava o limite para o uso dele não
  // escorregar para texto essencial sem alguém perceber.
  it("subtle fica entre 3:1 e 4.5:1 — só texto grande ou desativado", () => {
    const ratio = contrast(TOKENS.subtle, TOKENS.surface);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5);
  });

  // WCAG AA para elemento de interface não textual: 3:1.
  it("o anel de foco se destaca de toda superfície", () => {
    for (const bg of [TOKENS.sunken, TOKENS.surface, TOKENS.raised, TOKENS.overlay]) {
      expect(contrast(TOKENS.amber, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it("nenhuma superfície é preto puro", () => {
    for (const surface of [TOKENS.sunken, TOKENS.surface, TOKENS.raised, TOKENS.overlay]) {
      expect(surface).not.toBe("#000000");
    }
  });
});

describe("estado de perigo (docs/design-system.md §11)", () => {
  // O nó inteiro fica em tom de perigo, então o texto normal cai sobre a
  // superfície quente — e continua tendo que passar AA.
  it.each([
    ["ink sobre danger-surface", TOKENS.ink, TOKENS.dangerSurface],
    ["ink sobre danger-raised", TOKENS.ink, TOKENS.dangerRaised],
    ["danger-ink sobre danger-surface", TOKENS.dangerInk, TOKENS.dangerSurface],
    ["danger-ink sobre danger-raised", TOKENS.dangerInk, TOKENS.dangerRaised],
    ["muted sobre danger-surface", TOKENS.muted, TOKENS.dangerSurface],
  ])("%s passa AA (>= 4.5:1)", (_label, fg, bg) => {
    expect(round(contrast(fg, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("a superfície de perigo é perceptivelmente diferente da normal", () => {
    // Razão de contraste NÃO serve aqui: as duas têm luminância parecida de
    // propósito, para o texto continuar legível nas duas. O que muda é o
    // matiz, e quem mede isso é ΔE em OKLab. Medido: 0.038 — acima do
    // limiar de ~0.02 em que a diferença passa a ser notada.
    expect(deltaE(TOKENS.dangerSurface, TOKENS.surface)).toBeGreaterThanOrEqual(0.03);
  });

  it("os dois níveis de superfície de perigo se distinguem entre si", () => {
    expect(deltaE(TOKENS.dangerSurface, TOKENS.dangerRaised)).toBeGreaterThanOrEqual(0.02);
  });

  it("a borda de perigo se destaca da superfície de perigo", () => {
    expect(deltaE(TOKENS.dangerLine, TOKENS.dangerSurface)).toBeGreaterThanOrEqual(0.03);
  });

  it("o âmbar continua legível sobre a superfície de perigo", () => {
    // O selo de escrita aparece dentro do nó de perigo.
    expect(round(contrast(TOKENS.accentInk, TOKENS.amber))).toBeGreaterThanOrEqual(4.5);
  });
});
