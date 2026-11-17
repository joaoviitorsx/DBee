import { type AnimationEvent, useState } from "react";

/**
 * Deixa um diálogo Radix tocar a animação de SAÍDA antes de desmontar.
 *
 * Os modais do app são montados condicionalmente pelo pai (`{x ? <Modal/> :
 * null}`) e chamam `onClose` direto — o pai desmonta na hora e o `Presence` do
 * Radix nunca chega a ver o `data-state="closed"`. Aqui o fechamento passa
 * primeiro por `open=false` local; o `onClose` real só roda no `animationend`
 * do próprio conteúdo (design-system.md §7, saída em `--motion-fast`). Sob
 * reduced-motion a animação dura 0,01ms e o evento chega igual.
 */
export function useSaidaAnimada(onClose: () => void) {
  const [aberto, setAberto] = useState(true);
  return {
    aberto,
    fechar: (): void => { setAberto(false); },
    onAnimationEnd: (e: AnimationEvent<HTMLDivElement>): void => {
      if (!aberto && e.target === e.currentTarget) onClose();
    },
  };
}
