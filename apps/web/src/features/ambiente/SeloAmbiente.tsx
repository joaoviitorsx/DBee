import type { Environment } from "@dbee/shared";

import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

/**
 * Cor por ambiente (ADR 022). **Nunca âmbar** — âmbar é escrita (CLAUDE.md 4b,
 * design-system §1.4). Produção usa o tom de perigo em versão discreta (traço e
 * texto, fundo de superfície), homologação um neutro-quente, desenvolvimento
 * o `info`.
 */
export const TOM_AMBIENTE: Record<Environment, string> = {
  production: "border-danger-line bg-danger-surface text-danger-ink",
  staging: "border-line-strong bg-raised text-muted",
  development: "border-info/35 bg-info/10 text-info",
};

/**
 * Selo de ambiente da conexão. `null` (não declarado) não pinta nada: marcar o
 * que não foi dito seria a tela inventando (design-system §5).
 */
export function SeloAmbiente({
  environment,
  compacto = false,
  className,
}: {
  readonly environment: Environment | null | undefined;
  /** Árvore e aba: só a sigla, com o nome inteiro no `title`. */
  readonly compacto?: boolean;
  readonly className?: string;
}) {
  const t = useT();
  if (environment === null || environment === undefined) return null;
  const nome = t(`ambiente.${environment}`);
  return (
    <span
      title={nome}
      data-ambiente={environment}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[4px] border font-semibold uppercase leading-none tracking-wide",
        compacto ? "px-1 py-[2px] text-[9px]" : "px-1.5 py-0.5 text-2xs",
        TOM_AMBIENTE[environment],
        className,
      )}
    >
      {compacto ? t(`ambiente.sigla.${environment}`) : nome}
    </span>
  );
}
