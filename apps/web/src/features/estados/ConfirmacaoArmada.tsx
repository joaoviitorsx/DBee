import { useEffect, useState, type ReactNode } from "react";

import { Button } from "../../components/ui";
import { cn } from "../../lib/cn";

/** Tempo de armar (ui-detalhes §3.7/§5 F6). Curto demais para irritar, longo o bastante para barrar o Enter que veio "de carona" do diálogo anterior. */
export const ATRASO_ARMAR_MS = 360;

/**
 * Botão de confirmação destrutiva que só aceita clique depois de armado.
 *
 * O defeito que isto barra: o diálogo abre com o foco no botão e o mesmo Enter
 * (ou duplo clique) que o abriu já confirma — DROP sem ter lido. Durante os
 * 360 ms o botão está `disabled` e um traço embaixo enche da esquerda para a
 * direita (só `transform`, design-system §7). Com reduced-motion o traço
 * aparece cheio no fim, mas **o atraso continua**: ele é proteção, não enfeite.
 *
 * Remonta (prop `key`) para rearmar quando o alvo da confirmação muda.
 */
export function ConfirmacaoArmada({
  onConfirmar,
  children,
  carregando = false,
  className,
}: {
  readonly onConfirmar: () => void;
  readonly children: ReactNode;
  readonly carregando?: boolean;
  readonly className?: string;
}) {
  const [armado, setArmado] = useState(false);
  const [enchendo, setEnchendo] = useState(false);

  useEffect(() => {
    // Um quadro antes de mudar o transform, para a transição ter de onde partir.
    const quadro = requestAnimationFrame(() => { setEnchendo(true); });
    const timer = setTimeout(() => { setArmado(true); }, ATRASO_ARMAR_MS);
    return () => {
      cancelAnimationFrame(quadro);
      clearTimeout(timer);
    };
  }, []);

  return (
    <Button
      variant="danger"
      size="sm"
      disabled={!armado}
      loading={carregando}
      onClick={() => { if (armado) onConfirmar(); }}
      className={cn("relative overflow-hidden disabled:opacity-70", className)}
    >
      {children}
      <span
        aria-hidden
        data-armado={armado}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-danger motion-reduce:transition-none"
        style={{
          transform: enchendo ? "scaleX(1)" : "scaleX(0)",
          transition: `transform ${String(ATRASO_ARMAR_MS)}ms linear`,
        }}
      />
    </Button>
  );
}
