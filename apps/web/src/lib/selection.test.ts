import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");

/**
 * Regressão visual verificável sem navegador.
 *
 * `::selection` com âmbar sólido e texto escuro usa exatamente os mesmos dois
 * tokens do selo de escrita (`bg-amber text-accent-ink`). O resultado é que
 * selecionar uma palavra a pinta como se fosse um selo sem padding — a tela
 * passa a afirmar um estado de conexão que não existe.
 *
 * Selo é informação, seleção é interação: não podem compartilhar a mesma cor
 * sólida.
 */
function blocoDe(seletor: string): string {
  const i = css.indexOf(seletor);
  if (i === -1) throw new Error(`${seletor} não encontrado no index.css`);
  return css.slice(i, css.indexOf("}", i));
}

describe("::selection não pode parecer um selo", () => {
  const bloco = blocoDe("::selection");

  it("não usa o âmbar sólido do selo de escrita", () => {
    expect(bloco).not.toMatch(/background-color:\s*var\(--color-amber\)\s*;/);
  });

  it("não usa a tinta do selo como cor de texto", () => {
    // `--color-accent-ink` só existe para texto sobre âmbar sólido.
    expect(bloco).not.toContain("var(--color-accent-ink)");
  });

  it("é translúcido, para o texto continuar legível como texto", () => {
    expect(bloco).toMatch(/color-mix|rgb\(|\/\s*\d+%/);
  });
});
