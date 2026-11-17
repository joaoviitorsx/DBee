import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "../../lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-[6px] font-medium " +
    "press cursor-pointer select-none " +
    "disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        // Âmbar sólido: o único acento saturado que a interface produz.
        primary: "bg-amber text-accent-ink hover:bg-amber/90 active:bg-amber/80",
        // Ação principal SEM escrita: tinta neutra. Âmbar sólido fica para o
        // que grava (modo escrita) — a cor tem de significar "isto escreve".
        solido: "bg-ink text-surface hover:bg-ink/90 active:bg-ink/80",
        secondary:
          "bg-raised text-ink border border-line hover:bg-accent-soft hover:border-accent-line",
        ghost: "text-muted hover:bg-raised hover:text-ink active:bg-overlay",
        danger: "bg-transparent text-danger border border-danger/35 hover:bg-danger/10",
      },
      /*
       * `max-lg:` amplia o alvo **só no toque**.
       *
       * A densidade de 14 px no desktop é decisão do §2.2 e não muda. Mas
       * medido a 375 px, o app tinha 544 alvos abaixo dos 44×44 que o §9 exige
       * — botão de ícone a 28×28, fechar aba a 16×16. Ampliar aqui, uma vez,
       * cobre a maioria sem tocar em cada tela.
       */
      size: {
        sm: "h-8 px-3 text-xs max-lg:h-10",
        md: "h-10 px-4 text-sm max-lg:h-11",
        icon: "h-9 w-9 max-lg:h-11 max-lg:w-11",
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
      {/*
        As camadas ocupam a mesma célula do grid: a largura do botão é a da
        maior delas, e entrar em "carregando" não pula o layout. Sem
        `loadingLabel`, o spinner ocupa o lugar do rótulo (que fica em
        `opacity-0`, ainda lido pelo leitor de tela); com ele, a camada de
        carregamento existe desde o repouso, invisível, para reservar largura.
      */}
      <span className="grid items-center justify-items-center">
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center gap-2",
            loading && "opacity-0",
          )}
        >
          {children}
        </span>
        {loading || loadingLabel !== undefined ? (
          <span
            aria-hidden={!loading}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2",
              loading ? "motion-fade" : "invisible",
            )}
          >
            <Loader2 aria-hidden className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {loadingLabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}
