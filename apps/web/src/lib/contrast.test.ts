import { describe, expect, it } from "bun:test";

import { contrast, deltaE, PALETAS, type Paleta } from "./contrast";

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * As mesmas regras nas **duas** paletas (docs/design-system.md §1.5).
 *
 * Rodar só na escura era o jeito de o tema claro quebrar sem ninguém notar:
 * quem trabalha no escuro nunca vê o texto ilegível que só existe no claro. Um
 * `text-amber` que passasse despercebido numa revisão daria 1,83:1 lá, e a
 * suíte continuaria verde.
 */
describe.each(PALETAS)("contraste dos tokens — tema %s", (_nome: string, P: Paleta) => {
  // WCAG AA: 4.5:1 para texto normal.
  it.each([
    ["ink sobre surface", (p: Paleta) => [p.ink, p.surface]],
    ["ink sobre sunken", (p: Paleta) => [p.ink, p.sunken]],
    ["ink sobre raised", (p: Paleta) => [p.ink, p.raised]],
    ["muted sobre surface", (p: Paleta) => [p.muted, p.surface]],
    ["muted sobre sunken", (p: Paleta) => [p.muted, p.sunken]],
    ["danger sobre surface", (p: Paleta) => [p.danger, p.surface]],
    ["ok sobre surface", (p: Paleta) => [p.ok, p.surface]],
    // `accent` é o âmbar que vira TEXTO: palavra-chave do editor, coluna
    // ordenada, ícone de PK. É o token que o tema claro obriga a escurecer.
    ["accent sobre surface", (p: Paleta) => [p.accent, p.surface]],
    ["accent sobre sunken", (p: Paleta) => [p.accent, p.sunken]],
    ["accent sobre raised", (p: Paleta) => [p.accent, p.raised]],
    ["accent sobre overlay", (p: Paleta) => [p.accent, p.overlay]],
    // `amber` é o PREENCHIMENTO: o que precisa passar é a tinta sobre ele.
    ["accent-ink sobre amber", (p: Paleta) => [p.accentInk, p.amber]],
    // `accent-soft` é o leito âmbar de estados ativos/hover — texto normal cai
    // sobre ele (rótulo de aba ativa, item sob o cursor) e tem que passar AA.
    ["ink sobre accent-soft", (p: Paleta) => [p.ink, p.accentSoft]],
  ])("%s passa AA (>= 4.5:1)", (_label, par) => {
    const [fg, bg] = par(P);
    expect(round(contrast(fg ?? "", bg ?? ""))).toBeGreaterThanOrEqual(4.5);
  });

  // `subtle` e `info` carregam texto de 11–12 px de verdade (contador, dica,
  // `NULL`, link neutro), então passam AA em TODA superfície, inclusive no
  // modal (`overlay`) e no fundo da página (`sunken`). Medir só sobre
  // `surface` foi como os valores da proposta em identidade.md reprovavam no
  // modal (4,0:1) sem ninguém ver.
  it.each(["subtle", "info"] as const)("%s passa AA nas quatro superfícies", (token) => {
    for (const bg of [P.sunken, P.surface, P.raised, P.overlay]) {
      expect(round(contrast(P[token], bg))).toBeGreaterThanOrEqual(4.5);
    }
  });

  // A hierarquia de texto não pode colapsar: `subtle` continua abaixo de
  // `muted`, senão vira sinônimo dele.
  it("subtle fica abaixo de muted", () => {
    expect(contrast(P.subtle, P.surface)).toBeLessThan(contrast(P.muted, P.surface));
  });

  // `info` existe para não ser âmbar (identidade.md: "âmbar é ferrão").
  it("info se distingue do âmbar e do ok", () => {
    expect(deltaE(P.info, P.accent)).toBeGreaterThanOrEqual(0.1);
    expect(deltaE(P.info, P.ok)).toBeGreaterThanOrEqual(0.05);
  });

  // WCAG AA para elemento de interface não textual: 3:1.
  it("o anel de foco se destaca de toda superfície", () => {
    for (const bg of [P.sunken, P.surface, P.raised, P.overlay]) {
      expect(contrast(P.accent, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it("nenhuma superfície é preto puro", () => {
    for (const surface of [P.sunken, P.surface, P.raised, P.overlay]) {
      expect(surface).not.toBe("#000000");
    }
  });

  it("o leito âmbar se distingue da superfície neutra", () => {
    // Se `accent-soft` não fosse perceptivelmente mais âmbar que a superfície,
    // não haveria por que existir — a aba ativa não ganharia cor de marca.
    expect(deltaE(P.accentSoft, P.surface)).toBeGreaterThanOrEqual(0.02);
  });

  it("a borda âmbar se destaca da superfície", () => {
    expect(deltaE(P.accentLine, P.surface)).toBeGreaterThanOrEqual(0.03);
  });

  it("as superfícies se distinguem entre si", () => {
    // Sem isto, um tema "claro" poderia ter surface e raised idênticos e a
    // hierarquia de elevação sumiria — a tela perde a estrutura sem erro nenhum.
    expect(deltaE(P.raised, P.surface)).toBeGreaterThanOrEqual(0.01);
    expect(deltaE(P.sunken, P.surface)).toBeGreaterThanOrEqual(0.005);
  });
});

describe.each(PALETAS)("estado de perigo — tema %s", (_nome: string, P: Paleta) => {
  // O nó inteiro fica em tom de perigo, então o texto normal cai sobre a
  // superfície quente — e continua tendo que passar AA.
  it.each([
    ["ink sobre danger-surface", (p: Paleta) => [p.ink, p.dangerSurface]],
    ["ink sobre danger-raised", (p: Paleta) => [p.ink, p.dangerRaised]],
    ["danger-ink sobre danger-surface", (p: Paleta) => [p.dangerInk, p.dangerSurface]],
    ["danger-ink sobre danger-raised", (p: Paleta) => [p.dangerInk, p.dangerRaised]],
    ["muted sobre danger-surface", (p: Paleta) => [p.muted, p.dangerSurface]],
  ])("%s passa AA (>= 4.5:1)", (_label, par) => {
    const [fg, bg] = par(P);
    expect(round(contrast(fg ?? "", bg ?? ""))).toBeGreaterThanOrEqual(4.5);
  });

  it("a superfície de perigo é perceptivelmente diferente da normal", () => {
    // Razão de contraste NÃO serve aqui: as duas têm luminância parecida de
    // propósito, para o texto continuar legível nas duas. O que muda é o
    // matiz, e quem mede isso é ΔE em OKLab.
    expect(deltaE(P.dangerSurface, P.surface)).toBeGreaterThanOrEqual(0.03);
  });

  it("os dois níveis de superfície de perigo se distinguem entre si", () => {
    expect(deltaE(P.dangerSurface, P.dangerRaised)).toBeGreaterThanOrEqual(0.02);
  });

  it("a borda de perigo se destaca da superfície de perigo", () => {
    expect(deltaE(P.dangerLine, P.dangerSurface)).toBeGreaterThanOrEqual(0.03);
  });

  it("o âmbar continua legível sobre a superfície de perigo", () => {
    // O selo de escrita aparece dentro do nó de perigo.
    expect(round(contrast(P.accentInk, P.amber))).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * `contrast.ts` é espelho escrito à mão do `index.css`. Sem este teste, mudar o
 * hex só no CSS deixaria a suíte medindo a cor antiga e passando.
 */
describe("o espelho de contrast.ts bate com index.css", () => {
  it("subtle e info nos dois temas", async () => {
    const css = await Bun.file(new URL("../index.css", import.meta.url)).text();
    const valores = (token: string): string[] =>
      [...css.matchAll(new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, "gi"))].map((m) => (m[1] ?? "").toLowerCase());
    expect(valores("subtle")).toEqual(PALETAS.map(([, p]) => p.subtle));
    expect(valores("info")).toEqual(PALETAS.map(([, p]) => p.info));
  });
});
