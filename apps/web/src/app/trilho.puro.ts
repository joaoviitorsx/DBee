/**
 * Geometria do trilho da árvore recolhida (ui-detalhes §3.2).
 *
 * O trilho é uma lista PRÓPRIA e compacta: só as conexões, com passo fixo,
 * centradas na largura do trilho. Não herda a geometria da árvore aberta —
 * conexão expandida não abre vão entre os ícones. A ilusão de "mesmo objeto"
 * vem do FLIP: cada ícone parte do deslocamento até onde estava na árvore e
 * anima até a posição compacta.
 */

export const LARGURA_TRILHO = 44;
/** Alvo de 28 px por ícone, 4 px de respiro: passo de 32 px. */
export const PASSO_TRILHO = 32;
export const TOPO_TRILHO = 12;
export const ALVO_ICONE = 28;

export interface Ponto {
  readonly x: number;
  readonly y: number;
}

/** Canto superior esquerdo do alvo de cada ícone, na ordem das conexões. */
export function posicoesDoTrilho(n: number): Ponto[] {
  const x = (LARGURA_TRILHO - ALVO_ICONE) / 2;
  return Array.from({ length: n }, (_, i) => ({ x, y: TOPO_TRILHO + i * PASSO_TRILHO }));
}

/**
 * Deslocamento FLIP: de onde o centro do ícone estava na árvore até o centro
 * do alvo compacto. Sem medida (conexão fora da vista), zero — o ícone só
 * aparece no lugar, sem voar de longe.
 */
export function deslocamentoFlip(naArvore: Ponto | undefined, noTrilho: Ponto): Ponto {
  if (naArvore === undefined) return { x: 0, y: 0 };
  const cx = noTrilho.x + ALVO_ICONE / 2;
  const cy = noTrilho.y + ALVO_ICONE / 2;
  return { x: naArvore.x - cx, y: naArvore.y - cy };
}
