import { describe, expect, it } from "bun:test";

import { compararVersoes, haNovaVersao, parseVersao, VERSAO_DEV } from "./semver";

describe("parseVersao", () => {
  it("aceita com e sem o v", () => {
    expect(parseVersao("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: null });
    expect(parseVersao("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: null });
  });

  it("recusa o que não é vX.Y.Z", () => {
    for (const bruta of [VERSAO_DEV, "", "1.2", "v1.2.3.4", "latest", "v1.2.x"]) {
      expect(parseVersao(bruta)).toBeNull();
    }
  });

  it("recusa número fora da faixa segura em vez de virar Infinity", () => {
    expect(parseVersao("v99999999999999999999.0.0")).toBeNull();
  });
});

describe("compararVersoes", () => {
  const cmp = (a: string, b: string): number => {
    const x = parseVersao(a);
    const y = parseVersao(b);
    if (x === null || y === null) throw new Error(`versão de teste ilegível: ${a} / ${b}`);
    return compararVersoes(x, y);
  };

  /**
   * O caso que motiva o arquivo: em ordem de string `"v0.1.10" < "v0.1.9"`, e o
   * badge pararia de avisar exatamente na décima release.
   */
  it("compara por número, não por string", () => {
    expect(cmp("v0.1.10", "v0.1.9")).toBeGreaterThan(0);
    expect(cmp("v0.10.0", "v0.9.0")).toBeGreaterThan(0);
    expect(cmp("v2.0.0", "v10.0.0")).toBeLessThan(0);
  });

  it("release final é maior que pré-release", () => {
    expect(cmp("v1.0.0", "v1.0.0-rc.1")).toBeGreaterThan(0);
    expect(cmp("v1.0.0-rc.1", "v1.0.0-rc.2")).toBeLessThan(0);
    expect(cmp("v1.0.0-alpha", "v1.0.0-alpha.1")).toBeLessThan(0);
    expect(cmp("v1.0.0-alpha.1", "v1.0.0-beta")).toBeLessThan(0);
  });

  it("iguais dão zero", () => {
    expect(cmp("v1.2.3", "1.2.3")).toBe(0);
  });
});

describe("haNovaVersao", () => {
  it("acende só quando latest é estritamente maior", () => {
    expect(haNovaVersao("v0.1.3", "v0.2.0")).toBe(true);
    expect(haNovaVersao("v0.1.9", "v0.1.10")).toBe(true);
  });

  it("não acende em versão igual", () => {
    expect(haNovaVersao("v0.1.3", "v0.1.3")).toBe(false);
  });

  /** Rodar uma versão à frente do publicado é decisão de alguém, não defeito. */
  it("não acende em rollback deliberado", () => {
    expect(haNovaVersao("v0.2.0", "v0.1.3")).toBe(false);
  });

  it("nunca acende em dev", () => {
    expect(haNovaVersao(VERSAO_DEV, "v9.9.9")).toBe(false);
  });

  it("não acende sem latest nem com versão ilegível", () => {
    expect(haNovaVersao("v0.1.3", null)).toBe(false);
    expect(haNovaVersao("v0.1.3", "vem-do-nada")).toBe(false);
  });
});
