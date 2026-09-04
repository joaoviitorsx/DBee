import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * Selo. Só aparece quando há algo a sinalizar — marcar o estado seguro treina o
 * olho a ignorar o selo (docs/design-system.md §5).
 */
const badge = cva(
  "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-2xs font-semibold",
  {
    variants: {
      tone: {
        write: "bg-amber text-accent-ink",
        ok: "bg-ok/15 text-ok border border-ok/25",
        danger: "bg-danger/15 text-danger border border-danger/25",
        neutral: "bg-raised text-muted border border-line",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

interface BadgeProps extends VariantProps<typeof badge> {
  readonly children: ReactNode;
  readonly className?: string;
  /** Texto completo em tooltip quando o selo trunca — erro longo do Postgres. */
  readonly title?: string;
}

export function Badge({ tone, children, className, title }: BadgeProps) {
  return (
    <span className={cn(badge({ tone }), className)} title={title}>
      {children}
    </span>
  );
}
