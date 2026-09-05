import { cn } from "../lib/cn";

/**
 * Favo de mel **em cacho** — um agrupamento finito de hexágonos, não a
 * tesselação infinita do `Honeycomb`.
 *
 * É o detalhe de canto: um punhado de hexágonos flat-top encaixados, parte
 * preenchidos, parte só contorno, como um pedaço de colmeia largado no canto
 * inferior direito da tela. Mesma geometria flat-top do `Honeycomb` (lado `s`,
 * vizinho à direita em `+1.5s` e meio passo vertical), então os dois casam.
 *
 * Decorativo, `aria-hidden`, nunca captura ponteiro. `currentColor` decide a
 * cor; a opacidade e a máscara de esmaecimento ficam com quem posiciona.
 */

// Colunas do cacho: para cada coluna, as linhas presentes. O desenho é uma
// mancha irregular — mais cheia no meio, afinando nas pontas — como o favo real
// não sai em retângulo perfeito.
const COLUNAS: readonly (readonly number[])[] = [
  [1, 2],
  [0, 1, 2, 3],
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3],
  [1, 2, 3],
  [2],
];

// Preenchido quando `(coluna + linha)` é par: alterna cheio e contorno sem
// virar tabuleiro perfeito, porque as colunas ímpares entram deslocadas.
const preenchido = (coluna: number, linha: number): boolean => (coluna + linha) % 2 === 0;

export function HoneycombCluster({
  className,
  size = 18,
  strokeWidth = 1.25,
}: {
  readonly className?: string;
  /** Lado do hexágono, em px. */
  readonly size?: number;
  readonly strokeWidth?: number;
}) {
  const s = size;
  const h = Math.sqrt(3) * s; // altura do hexágono flat-top
  const base = h / 2;

  const hex = (cx: number, cy: number): string => {
    const pts: readonly (readonly [number, number])[] = [
      [cx - s, cy],
      [cx - s / 2, cy - h / 2],
      [cx + s / 2, cy - h / 2],
      [cx + s, cy],
      [cx + s / 2, cy + h / 2],
      [cx - s / 2, cy + h / 2],
    ];
    return `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
  };

  const cheios: string[] = [];
  const vazios: string[] = [];
  let maxX = 0;
  let maxY = 0;

  COLUNAS.forEach((linhas, coluna) => {
    const cx = s + coluna * 1.5 * s;
    linhas.forEach((linha) => {
      const cy = base + linha * h + (coluna % 2) * (h / 2);
      (preenchido(coluna, linha) ? cheios : vazios).push(hex(cx, cy));
      maxX = Math.max(maxX, cx + s);
      maxY = Math.max(maxY, cy + h / 2);
    });
  });

  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none select-none", className)}
      viewBox={`0 0 ${maxX.toFixed(2)} ${maxY.toFixed(2)}`}
      fill="none"
    >
      {/* Cheios primeiro, contornos por cima para a parede compartilhada aparecer. */}
      <path d={cheios.join(" ")} fill="currentColor" fillOpacity={0.9} />
      <path
        d={vazios.join(" ")}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}
