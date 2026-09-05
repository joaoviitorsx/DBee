import { tsvLine } from "@dbee/shared";

/**
 * Seleção retangular do grid.
 *
 * Duas células bastam: a âncora (primeiro clique) e o foco (Shift+clique). O
 * retângulo entre elas é a seleção, em qualquer ordem — clicar de baixo para
 * cima seleciona o mesmo que de cima para baixo.
 */
export interface Celula {
  readonly linha: number;
  readonly coluna: number;
}

export interface Faixa {
  readonly linha0: number;
  readonly linha1: number;
  readonly coluna0: number;
  readonly coluna1: number;
}

export function faixaEntre(ancora: Celula | null, foco: Celula | null): Faixa | null {
  if (ancora === null || foco === null) return null;
  return {
    linha0: Math.min(ancora.linha, foco.linha),
    linha1: Math.max(ancora.linha, foco.linha),
    coluna0: Math.min(ancora.coluna, foco.coluna),
    coluna1: Math.max(ancora.coluna, foco.coluna),
  };
}

export const dentro = (f: Faixa | null, linha: number, coluna: number): boolean =>
  f !== null &&
  linha >= f.linha0 && linha <= f.linha1 &&
  coluna >= f.coluna0 && coluna <= f.coluna1;

export const contaCelulas = (f: Faixa): { linhas: number; colunas: number } => ({
  linhas: f.linha1 - f.linha0 + 1,
  colunas: f.coluna1 - f.coluna0 + 1,
});

/**
 * O recorte selecionado como TSV — o formato que cola direto numa planilha.
 *
 * Sem cabeçalho: quem copia três células de dentro de uma tabela quer as três
 * células. O cabeçalho entra quando a seleção começa na primeira linha? Não —
 * isso seria adivinhar. O export é o caminho para o arquivo com cabeçalho.
 *
 * Tabulação e quebra de linha dentro do valor viram espaço: são os separadores
 * do próprio formato, e escapá-los exigiria aspas que a planilha lê como texto.
 */
export function recorteTsv(
  rows: readonly (readonly (string | null)[])[],
  faixa: Faixa,
): string {
  const linhas: string[] = [];
  for (let i = faixa.linha0; i <= faixa.linha1; i++) {
    const linha = rows[i];
    if (linha === undefined) continue;
    linhas.push(tsvLine(linha.slice(faixa.coluna0, faixa.coluna1 + 1)));
  }
  return linhas.join("\n");
}
