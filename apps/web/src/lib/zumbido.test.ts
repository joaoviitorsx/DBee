import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { EVENTO_ZUMBIDO, zumbir } from "./zumbido";

const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");

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

/**
 * Trava o "zumbido" como o design-system §7 o descreve: ±1 px, dois ciclos de
 * `--motion-base` (2 × 180 = 360 ms) e nada sob reduced-motion.
 */
describe("zumbido", () => {
  it("dois ciclos de --motion-base, só sem reduced-motion", () => {
    const u = bloco("@utility animate-zumbido");
    expect(u).toMatch(/prefers-reduced-motion:\s*no-preference[\s\S]*animation: dbee-zumbido var\(--motion-base\) ease-in-out 2;/);
    expect(/--motion-base:\s*180ms;/.test(css)).toBe(true);
  });

  it("desloca no máximo 1 px", () => {
    const k = bloco("@keyframes dbee-zumbido");
    const desloc = [...k.matchAll(/translateX\((-?\d+(?:\.\d+)?)px\)/g)].map((m) => Math.abs(Number(m[1])));
    expect(desloc.length).toBeGreaterThan(0);
    expect(Math.max(...desloc)).toBe(1);
  });

  it("zumbir() avisa a janela", () => {
    const alvo = new EventTarget();
    const global = globalThis as { window?: unknown };
    const antes = global.window;
    global.window = alvo;
    let ouviu = 0;
    alvo.addEventListener(EVENTO_ZUMBIDO, () => { ouviu++; });
    zumbir();
    global.window = antes;
    expect(ouviu).toBe(1);
  });
});
