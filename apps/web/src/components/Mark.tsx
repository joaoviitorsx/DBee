import { cn } from "../lib/cn";

interface MarkProps {
  readonly className?: string;
  /** Bate as asas e flutua. Use só enquanto algo está de fato acontecendo. */
  readonly flying?: boolean;
}

/**
 * A marca, inline (assets/dbee-mark.svg com a metadata C2PA removida).
 *
 * Inline e não `<img>`: nada de CDN nem de request extra em runtime
 * (CLAUDE.md). As listras são cortes de máscara reais, então o fundo aparece
 * através delas e a marca funciona sobre qualquer superfície.
 *
 * `flying` anima as asas, que já são caminhos separados a 55% de opacidade no
 * arquivo original — é o desenho que existe se movendo, não um efeito colado
 * por cima.
 */
export function Mark({ className, flying = false }: MarkProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={cn(className, flying && "animate-hover")}
      role="img"
      aria-label="DBee"
    >
      <defs>
        <mask id="dbee-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="96">
          <rect width="96" height="96" fill="#fff" />
          <path d="M28,49.5 A20,6.5 0 0 0 68,49.5 L68,53 A20,6.5 0 0 1 28,53 Z" />
          <path d="M28,64 A20,6.5 0 0 0 68,64 L68,67.5 A20,6.5 0 0 1 28,67.5 Z" />
        </mask>
      </defs>
      <g mask="url(#dbee-cut)">
        {/* Asas: os dois caminhos que o arquivo já traz a 55%. */}
        <g fill="currentColor" opacity="0.55">
          <path
            d="M31,37 L8,45.5 L9,54 L31,50 Z"
            className={cn(flying && "animate-wing")}
            style={flying ? { transformOrigin: "31px 44px" } : undefined}
          />
          <path
            d="M65,37 L88,45.5 L87,54 L65,50 Z"
            className={cn(flying && "animate-wing")}
            style={flying ? { transformOrigin: "65px 44px", animationDelay: "-450ms" } : undefined}
          />
        </g>
        <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M44,19 L37.5,13" />
          <path d="M52,19 L58.5,13" />
        </g>
        <g fill="currentColor">
          <path d="M57,24 L52.5,31.8 L43.5,31.8 L39,24 L43.5,16.2 L52.5,16.2 Z" />
          <path d="M28,37 A20,6.5 0 0 1 68,37 L68,80 A20,6.5 0 0 1 28,80 Z" />
        </g>
      </g>
    </svg>
  );
}
