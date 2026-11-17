import { cn } from "../../lib/cn";

/**
 * Ícone do MCP: um agente (nó cheio à esquerda) ligado por dois fios a dois
 * nós quadrados — os bancos que ele alcança pelo DBee. Desenho próprio, no traço
 * de 2 px do lucide para conviver com os outros ícones da barra. Os fios usam
 * `motion-fio`: no hover do botão, se redesenham do agente até os nós.
 */
export function IconeMcp({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-3.5 w-3.5", className)}
    >
      <circle cx="5" cy="12" r="2.5" fill="currentColor" />
      <path pathLength={1} className="motion-fio" d="M7.5 12 C 12 12, 12 6, 16.5 6" />
      <path pathLength={1} className="motion-fio" d="M7.5 12 C 12 12, 12 18, 16.5 18" />
      <rect x="16.5" y="3.5" width="5" height="5" rx="1.25" />
      <rect x="16.5" y="15.5" width="5" height="5" rx="1.25" />
    </svg>
  );
}
