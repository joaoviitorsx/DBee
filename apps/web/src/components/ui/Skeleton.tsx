import { cn } from "../../lib/cn";

/**
 * Placeholder de carregamento. Reserva a altura real do conteúdo para a lista
 * não pular quando os dados chegam (CLS).
 *
 * O brilho corre no sentido da leitura, uma vez só por ciclo — não pisca.
 */
export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden rounded-[4px] bg-raised", className)}
    >
      <div className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-overlay to-transparent" />
    </div>
  );
}
