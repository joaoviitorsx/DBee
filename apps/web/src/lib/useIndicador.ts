import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Indicador deslizante de aba ativa (ui-detalhes §3.3).
 *
 * Um elemento só, medido a partir do `[aria-selected="true"]` do contêiner e
 * movido por `transform` (`--x`, `--w` lidos pelo utilitário `indicador-aba`).
 * Escreve direto no DOM, sem `setState`: medir e re-renderizar a cada troca
 * custaria um quadro a mais e o indicador chegaria atrasado.
 *
 * Na primeira medição o indicador aparece já no lugar (`data-pronto` ainda
 * ausente desliga a transição); depois disso, desliza. A aba ativa também rola
 * para a vista quando a fila transborda.
 */
export function useIndicador(
  conteiner: RefObject<HTMLElement | null>,
  indicador: RefObject<HTMLElement | null>,
  chave: unknown,
): void {
  const pronto = useRef(false);
  useLayoutEffect(() => {
    const c = conteiner.current;
    const i = indicador.current;
    if (c === null || i === null) return;
    const medir = (): void => {
      const ativa = c.querySelector<HTMLElement>('[aria-selected="true"]');
      const alvo = ativa === null ? null : (ativa.closest<HTMLElement>("[data-aba]") ?? ativa);
      if (alvo === null) {
        i.style.setProperty("opacity", "0");
        return;
      }
      i.style.setProperty("opacity", "1");
      i.style.setProperty("--x", `${String(alvo.offsetLeft)}px`);
      i.style.setProperty("--w", String(alvo.offsetWidth));
      if (!pronto.current) {
        // Próximo quadro: a posição inicial já foi pintada sem transição.
        requestAnimationFrame(() => { i.setAttribute("data-pronto", ""); });
        pronto.current = true;
      }
    };
    // Transbordo medido: as bordas só esmaecem do lado em que há conteúdo
    // escondido. Sem transbordo, nenhuma aba perde nitidez.
    const bordas = (): void => {
      const esq = c.scrollLeft > 1;
      const dir = c.scrollLeft + c.clientWidth < c.scrollWidth - 1;
      c.toggleAttribute("data-mais-esq", esq);
      c.toggleAttribute("data-mais-dir", dir);
    };
    medir();
    bordas();
    c.addEventListener("scroll", bordas, { passive: true });
    const ativa = c.querySelector<HTMLElement>('[aria-selected="true"]');
    ativa?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const obs = new ResizeObserver(() => { medir(); bordas(); });
    obs.observe(c);
    return () => {
      obs.disconnect();
      c.removeEventListener("scroll", bordas);
    };
  }, [conteiner, indicador, chave]);
}
