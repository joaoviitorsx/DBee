import { cn } from "../../lib/cn";
import { AbelhaPlana, type Pose } from "./AbelhaPlana";

/**
 * O mascote: a abelha-cilindro plana numa pose, com movimento opcional.
 *
 * `float` faz a figura flutuar; é opt-in e só vale onde ela é o assunto de uma
 * tela de passagem (espera longa, servidor fora), nunca na tela de trabalho
 * (design-system §4b). Em `voando`, `float` também bate as asas.
 *
 * Sempre decorativo: quem carrega o significado é o texto ao lado.
 */
export function Mascote({
  pose,
  className,
  float = false,
}: {
  readonly pose: Pose;
  readonly className?: string;
  readonly float?: boolean;
}) {
  return (
    <AbelhaPlana
      pose={pose}
      animada={float}
      // O bloco global de reduced-motion no CSS já zera a flutuação.
      className={cn(float && "animate-float", className)}
    />
  );
}
