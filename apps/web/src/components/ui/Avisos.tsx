import { Toaster } from "sonner";

/**
 * Canal único de confirmação de ação fora do campo de visão (copiado,
 * exportado, salvo) — docs/ui-detalhes.md §3.1.
 *
 * Erro de banco **nunca** vai para cá: fica no lugar, com `position`, onde dá
 * para agir sobre ele. Sonner sem estilo próprio (`unstyled`) para herdar os
 * tokens; a animação de entrada/saída é a do Sonner, que respeita
 * `prefers-reduced-motion`.
 */
export function Avisos() {
  return (
    <Toaster
      position="bottom-right"
      duration={4000}
      gap={6}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[min(22rem,calc(100vw-2rem))] items-center gap-2 rounded-[6px] border border-line " +
            "bg-overlay px-3 py-2 text-xs text-ink shadow-[0_8px_24px_-12px_rgb(0_0_0/.5)]",
          title: "font-medium",
          description: "text-muted",
          icon: "text-info",
        },
      }}
    />
  );
}
