import { cn } from "../lib/cn";

/**
 * Favo de mel — hexágonos que **tesselam de verdade**, o motivo da abelha.
 *
 * ## A geometria do tile
 *
 * Um favo de hexágonos flat-top encaixa num retângulo de tile cujas medidas
 * saem do lado `s`:
 *
 * - largura do tile = `3·s` (dois passos horizontais de `1.5·s`);
 * - altura do tile  = `√3·s` (a altura de um hexágono flat-top);
 * - a segunda coluna de hexágonos fica deslocada meia altura para baixo.
 *
 * Desenhar **dois** hexágonos por tile (um em `x=0`, outro em `x=1.5s` com meio
 * passo vertical) e repetir o tile cobre o plano sem sobra nem falha — é o que
 * faz o padrão parecer favo, não hexágonos soltos.
 *
 * Traço, não preenchimento: favo é a parede entre as células. `currentColor` +
 * opacidade baixa, para o mesmo componente servir a vitrine do login (âmbar,
 * presente) e um canto do app (um sussurro). Decorativo, `aria-hidden`, nunca
 * captura ponteiro.
 */
export function Honeycomb({
  className,
  size = 22,
  opacity = 0.06,
  strokeWidth = 1,
}: {
  readonly className?: string;
  /** Lado do hexágono, em px. */
  readonly size?: number;
  readonly opacity?: number;
  readonly strokeWidth?: number;
}) {
  const s = size;
  const hSqrt3 = Math.sqrt(3) * s;
  const tileW = 3 * s;
  const tileH = hSqrt3;
  const id = `favo-${String(Math.round(s))}-${String(Math.round(opacity * 1000))}`;

  // Hexágono flat-top centrado em (cx, cy), lado s.
  const hex = (cx: number, cy: number): string => {
    const pts = [
      [cx - s, cy],
      [cx - s / 2, cy - hSqrt3 / 2],
      [cx + s / 2, cy - hSqrt3 / 2],
      [cx + s, cy],
      [cx + s / 2, cy + hSqrt3 / 2],
      [cx - s / 2, cy + hSqrt3 / 2],
    ];
    return `M${pts.map(([x, y]) => `${(x ?? 0).toFixed(2)},${(y ?? 0).toFixed(2)}`).join("L")}Z`;
  };

  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none select-none", className)}
      width="100%"
      height="100%"
      style={{ opacity }}
    >
      <defs>
        <pattern id={id} width={tileW} height={tileH} patternUnits="userSpaceOnUse">
          {/* Coluna alinhada + coluna deslocada meio hexágono, cobrindo o tile. */}
          <path
            d={`${hex(0, tileH / 2)} ${hex(tileW, tileH / 2)} ${hex(1.5 * s, 0)} ${hex(1.5 * s, tileH)}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
