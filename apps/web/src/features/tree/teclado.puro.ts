/**
 * Modelo de teclado da árvore (`role=tree`, ui-detalhes §3.4; WAI-ARIA APG
 * "Tree View"). Puro: recebe os itens **visíveis** em ordem de documento e
 * devolve o que fazer — o componente só aplica (foco ou clique).
 *
 * Enter não passa por aqui: o item é um `<button>` e o Enter nativo já clica.
 */
export interface ItemArvore {
  /** 1 = conexão. */
  readonly nivel: number;
  readonly expansivel: boolean;
  readonly expandido: boolean;
  readonly rotulo: string;
}

export type AcaoTeclado =
  | { readonly tipo: "focar"; readonly indice: number }
  | { readonly tipo: "alternar"; readonly indice: number }
  | { readonly tipo: "nada" };

const NADA: AcaoTeclado = { tipo: "nada" };

export function acaoDaTecla(itens: readonly ItemArvore[], atual: number, tecla: string): AcaoTeclado {
  const item = itens[atual];
  if (item === undefined) return itens.length > 0 ? { tipo: "focar", indice: 0 } : NADA;
  switch (tecla) {
    case "ArrowDown":
      return atual + 1 < itens.length ? { tipo: "focar", indice: atual + 1 } : NADA;
    case "ArrowUp":
      return atual > 0 ? { tipo: "focar", indice: atual - 1 } : NADA;
    case "Home":
      return { tipo: "focar", indice: 0 };
    case "End":
      return { tipo: "focar", indice: itens.length - 1 };
    case "ArrowRight":
      if (!item.expansivel) return NADA;
      if (!item.expandido) return { tipo: "alternar", indice: atual };
      // Aberto: desce para o primeiro filho, se já houver um.
      return itens[atual + 1]?.nivel === item.nivel + 1 ? { tipo: "focar", indice: atual + 1 } : NADA;
    case "ArrowLeft": {
      if (item.expansivel && item.expandido) return { tipo: "alternar", indice: atual };
      for (let i = atual - 1; i >= 0; i--) {
        if ((itens[i]?.nivel ?? 0) < item.nivel) return { tipo: "focar", indice: i };
      }
      return NADA;
    }
    default:
      return NADA;
  }
}

/**
 * Type-ahead: o próximo item (a partir do seguinte ao atual, dando a volta)
 * cujo rótulo começa com o prefixo digitado. Mesma regra do `ContextMenu`.
 */
export function buscaPorPrefixo(itens: readonly ItemArvore[], atual: number, prefixo: string): number {
  const p = prefixo.toLowerCase();
  // Prefixo de uma letra só repetida avança; prefixo maior refina a partir do atual.
  const inicio = p.length > 1 ? atual : atual + 1;
  for (let k = 0; k < itens.length; k++) {
    const i = (inicio + k) % itens.length;
    if (itens[i]?.rotulo.toLowerCase().startsWith(p) === true) return i;
  }
  return -1;
}
