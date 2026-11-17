import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");

/**
 * Trava os números da tabela "Tokens de movimento" (design-system.md §7).
 * O doc afirma 120/180/240 ms, press a 0,97 e saída mais curta que a entrada;
 * se o CSS mudar sem o doc, este teste quebra.
 */
function token(nome: string): string {
  const m = new RegExp(`--${nome}:\\s*([^;]+);`).exec(css);
  if (m?.[1] === undefined) throw new Error(`--${nome} não encontrado`);
  return m[1].trim();
}

function bloco(seletor: string): string {
  const i = css.indexOf(seletor);
  if (i === -1) throw new Error(`${seletor} não encontrado`);
  let prof = 0;
  for (let j = css.indexOf("{", i); j < css.length; j++) {
    if (css[j] === "{") prof++;
    if (css[j] === "}" && --prof === 0) return css.slice(i, j);
  }
  throw new Error(`${seletor} sem fechamento`);
}

describe("tokens de movimento", () => {
  it("três durações: 120 / 180 / 240 ms", () => {
    expect(token("motion-fast")).toBe("120ms");
    expect(token("motion-base")).toBe("180ms");
    expect(token("motion-slow")).toBe("240ms");
  });

  it("curvas de entrada e saída", () => {
    expect(token("ease-enter")).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(token("ease-exit")).toBe("cubic-bezier(0.4, 0, 1, 1)");
  });
});

describe("press", () => {
  const press = bloco("@utility press");

  it("encolhe a 0,97 no :active, em motion-fast", () => {
    expect(press).toContain("scale: 0.97");
    expect(press).toContain("var(--motion-fast)");
  });

  it("a escala só existe sem reduced-motion", () => {
    expect(press).toMatch(/prefers-reduced-motion:\s*no-preference[\s\S]*scale: 0\.97/);
  });

  it("não anima propriedade de layout", () => {
    expect(press).not.toMatch(/transition-property:[^;]*(width|height|padding|margin)/);
  });
});

describe("diálogo: entrada em base, saída em fast", () => {
  it("entrada", () => {
    expect(bloco('[role="dialog"][data-state="open"]')).toContain(
      "dbee-pop-in var(--motion-base) var(--ease-enter)",
    );
  });

  it("saída mais curta, com curva de saída", () => {
    expect(bloco('[role="dialog"][data-state="closed"]')).toContain(
      "dbee-pop-out var(--motion-fast) var(--ease-exit)",
    );
  });

  it("véu também sai", () => {
    expect(bloco("@utility motion-overlay")).toContain('[data-state="closed"]');
  });
});

describe("prefers-reduced-motion zera tudo", () => {
  const bloco = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? "";

  it("animação e transição", () => {
    expect(bloco).toContain("animation-duration: 0.01ms !important");
    expect(bloco).toContain("transition-duration: 0.01ms !important");
  });
});

describe("fora da escala de interface", () => {
  it("stagger de 30 ms, travado no 8º item", () => {
    expect(token("motion-stagger")).toBe("30ms");
    expect(bloco("@utility motion-stagger")).toContain("min(var(--i, 0), 8) * var(--motion-stagger)");
  });

  it("o atraso do stagger só existe sem reduced-motion", () => {
    expect(bloco("@utility motion-stagger")).toMatch(/no-preference[\s\S]*animation-delay/);
  });

  it("troca de tema em 1300 ms (poça de mel), mais longa que motion-slow", () => {
    expect(token("motion-tema")).toBe("1300ms");
    expect(Number.parseFloat(token("motion-tema"))).toBeGreaterThan(Number.parseFloat(token("motion-slow")));
  });

  it("a view transition desliga o crossfade padrão (o círculo vem do JS)", () => {
    expect(bloco("::view-transition-old(root)")).toContain("animation: none");
  });
});

describe("pulso da VPN conectada", () => {
  it("ciclo de 2,4 s, sem halo (só opacidade e escala)", () => {
    expect(bloco("@utility motion-pulso")).toContain("dbee-pulso 2.4s");
    expect(bloco("@keyframes dbee-pulso")).not.toContain("box-shadow");
  });
});

describe("cena do login", () => {
  it("entrada encenada de 2,4 s (docs/arte-login.md)", () => {
    expect(token("cena-entrada")).toBe("2400ms");
  });
});

/*
 * Painéis simétricos (ui-detalhes §3.2): todo painel que entra animado também
 * sai animado, e a saída é mais curta (`fast` + `ease-exit`) que a entrada.
 */
describe("painéis: entrada e saída simétricas", () => {
  for (const [util, entrada] of [
    ["@utility motion-gaveta", "--motion-slow"],
    ["@utility motion-veu", "--motion-base"],
    ["@utility veu-dialogo", "--motion-base"],
  ] as const) {
    it(`${util} entra em ${entrada}/enter e sai em fast/exit`, () => {
      const b = bloco(util);
      expect(b).toContain(`var(${entrada}) var(--ease-enter)`);
      const saida = /&\[data-(?:saindo|state="closed")\]\s*\{[^}]*\}/.exec(b)?.[0] ?? "";
      expect(saida).toContain("var(--motion-fast) var(--ease-exit)");
    });
  }

  it("menu de contexto tem saída em fast/exit", () => {
    expect(bloco("@utility motion-pop-out")).toContain("var(--motion-fast) var(--ease-exit)");
  });

  it("indicador de aba desliza em base, só depois de posicionado", () => {
    const b = bloco("@utility indicador-aba");
    expect(b).toContain("&[data-pronto]");
    expect(b).toContain("transform var(--motion-base) var(--ease-enter)");
  });
});
