import { useSyncExternalStore } from "react";

/**
 * Assina uma media query.
 *
 * `useSyncExternalStore` e não `useState` + efeito: o valor é lido no mesmo
 * instante da renderização, sem o quadro intermediário em que o layout aparece
 * na largura errada.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => { mql.removeEventListener("change", notify); };
    },
    () => window.matchMedia(query).matches,
    // No servidor (não há SSR hoje) assume a tela larga.
    () => true,
  );
}

/**
 * Abaixo disto, árvore e inspetor viram sobreposição em vez de coluna.
 *
 * Com 1024px de largura sobram ~480px para o centro depois das duas laterais —
 * ainda estreito para uma tabela de estrutura, mas utilizável. Abaixo disso o
 * centro desaparece, que é o que acontecia em 375px.
 */
export const useLayoutLargo = (): boolean => useMediaQuery("(min-width: 1024px)");
