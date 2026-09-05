import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "../../lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-[6px] font-medium " +
    "transition-colors duration-150 cursor-pointer select-none " +
    "disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        // Âmbar sólido: o único acento saturado que a interface produz.
        primary: "bg-amber text-accent-ink hover:bg-amber/90 active:bg-amber/80",
        secondary:
          "bg-raised text-ink border border-line hover:bg-accent-soft hover:border-accent-line",
        ghost: "text-muted hover:bg-accent-soft hover:text-accent",
        danger: "bg-transparent text-danger border border-danger/35 hover:bg-danger/10",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** Troca o rótulo pelo estado e preserva a largura, sem pular layout. */
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  loadingLabel,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(button({ variant, size }), className)}
      disabled={disabled === true || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
