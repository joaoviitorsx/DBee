import { useId } from "react";

import { cn } from "../../lib/cn";

export type Pose = "pousada" | "voando" | "dormindo";

/**
 * A abelha-cilindro em SVG, no traço plano da marca (`assets/marca.webp`).
 *
 * Substitui o mascote 3D (identidade.md, direção A: "uma abelha só"). Mesmas
 * peças da marca: corpo-cilindro âmbar com duas listras grafite, tampa mais
 * clara, antenas de ponta redonda, asas ovais translúcidas. Sem rosto.
 *
 * As cores que não são da marca vêm do tema: antenas em `ink` (grafite no
 * claro, osso no escuro) e asas em `muted` translúcido, para a figura ler nas
 * duas paletas. O âmbar do corpo é a marca, não acento de interface — mesma
 * exceção do "Bee" do logotipo (design-system §4b).
 *
 * As poses mudam só ângulos, nunca o desenho:
 * - `pousada`: asas baixas, parada. Estado vazio, vitrine do login.
 * - `voando`: asas erguidas; com `animada`, batem (`animate-wing`).
 * - `dormindo`: tombada, asas e antenas caídas. Servidor que não responde.
 */
export function AbelhaPlana({
  pose = "pousada",
  animada = false,
  className,
  tamanho,
}: {
  readonly pose?: Pose;
  /** Largura/altura em atributo, para quando a abelha mora dentro de outro SVG. */
  readonly tamanho?: number;
  /** Bate as asas. Só faz sentido em `voando`; reduced-motion zera. */
  readonly animada?: boolean;
  readonly className?: string;
}) {
  // Duas abelhas na mesma tela não podem disputar o mesmo id de clipPath.
  const id = useId();
  const corte = `abelha-corpo-${id}`;
  const asa = pose === "voando" ? 26 : pose === "dormindo" ? -20 : 6;
  const bate = animada && pose === "voando";

  return (
    <svg
      viewBox="0 0 96 96"
      width={tamanho}
      height={tamanho}
      aria-hidden
      focusable="false"
      className={cn("select-none", className)}
    >
      <defs>
        <clipPath id={corte}>
          <path d="M30,38 A18,6 0 0 1 66,38 L66,72 A18,6 0 0 1 30,72 Z" />
        </clipPath>
      </defs>
      <g transform={pose === "dormindo" ? "rotate(-12 48 74)" : undefined}>
        {/* Asas atrás do corpo, presas no ombro. */}
        <g className="fill-muted" opacity="0.32">
          <ellipse
            cx="18"
            cy="40"
            rx="14"
            ry="9"
            transform={`rotate(${String(asa)} 31 44)`}
            className={cn(bate && "animate-wing")}
            style={bate ? { transformOrigin: "31px 44px" } : undefined}
          />
          <ellipse
            cx="78"
            cy="40"
            rx="14"
            ry="9"
            transform={`rotate(${String(-asa)} 65 44)`}
            className={cn(bate && "animate-wing")}
            style={bate ? { transformOrigin: "65px 44px", animationDelay: "-450ms" } : undefined}
          />
        </g>

        {/* Antenas. */}
        <g
          className="stroke-ink"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        >
          <path d={pose === "dormindo" ? "M42,33 Q36,27 30,31" : "M42,33 Q39,25 35,20"} />
          <path d={pose === "dormindo" ? "M54,33 Q60,27 66,31" : "M54,33 Q57,25 61,20"} />
        </g>
        <g fill="#f5a623">
          <circle cx={pose === "dormindo" ? 29 : 34} cy={pose === "dormindo" ? 33 : 18} r="4" />
          <circle cx={pose === "dormindo" ? 67 : 62} cy={pose === "dormindo" ? 33 : 18} r="4" />
        </g>

        {/* Corpo-cilindro com as listras recortadas pelo próprio contorno. */}
        <g clipPath={`url(#${corte})`}>
          <rect x="28" y="30" width="40" height="50" fill="#f5a623" />
          <path d="M30,48 A18,6 0 0 0 66,48 L66,54 A18,6 0 0 1 30,54 Z" fill="#1c1917" />
          <path d="M30,60 A18,6 0 0 0 66,60 L66,66 A18,6 0 0 1 30,66 Z" fill="#1c1917" />
        </g>
        <ellipse cx="48" cy="38" rx="18" ry="6" fill="#ffc24d" />
      </g>
    </svg>
  );
}
