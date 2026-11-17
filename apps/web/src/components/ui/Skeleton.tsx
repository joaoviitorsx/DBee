import { cn } from "../../lib/cn";

/**
 * Placeholder de carregamento. Reserva a altura real do conteúdo para a lista
 * não pular quando os dados chegam (CLS).
 *
 * Pulso de opacidade, não brilho em gradiente: mais quieto, e o bloco global
 * de `prefers-reduced-motion` o zera sem código extra.
 */
export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-[4px] bg-raised", className)}
    />
  );
}
