/**
 * Contraste WCAG 2.1. Existe para o design system ser verificável em teste, e
 * não uma afirmação num markdown que ninguém confere (docs/design-system.md §1.5).
 */

/** Luminância relativa de um hex `#rrggbb`. */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (offset: number): number => {
    const srgb = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Razão de contraste entre duas cores, de 1 a 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Canais sRGB linearizados de um hex. */
function linearRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  const canal = (offset: number): number => {
    const srgb = Number.parseInt(v.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [canal(0), canal(2), canal(4)];
}

/**
 * Converte para OKLab.
 *
 * Existe porque **razão de contraste é a métrica errada para "muda de matiz"**.
 * A superfície de perigo é vermelha e a normal é neutra quente; as duas têm
 * luminância parecida de propósito, para o texto continuar legível nas duas. O
 * que precisa ser medido é a diferença perceptual, e é isso que OKLab dá.
 */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Distância perceptual entre duas cores (ΔE em OKLab). ~0.02 é o limiar de "nota-se". */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Tokens do @theme em index.css, na mesma ordem do design system. */
/**
 * As duas paletas, espelhando `index.css`.
 *
 * `amber` é o **preenchimento** e não muda de tema: âmbar cheio com tinta
 * grafite passa nos dois. `accent` é o **traço e o texto** — no claro ele
 * precisa escurecer, porque `#F5A623` sobre `#F7F3EC` dá 1,83:1.
 */
export interface Paleta {
  readonly amber: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly accentLine: string;
  readonly sunken: string;
  readonly surface: string;
  readonly raised: string;
  readonly overlay: string;
  readonly ink: string;
  readonly muted: string;
  readonly subtle: string;
  readonly accentInk: string;
  readonly ok: string;
  readonly danger: string;
  readonly line: string;
  readonly lineStrong: string;
  readonly dangerSurface: string;
  readonly dangerRaised: string;
  readonly dangerLine: string;
  readonly dangerInk: string;
}

export const DARK: Paleta = {
  amber: "#f5a623",
  accent: "#f5a623",
  accentSoft: "#382a14",
  accentLine: "#725322",
  sunken: "#141210",
  surface: "#191612",
  raised: "#221e19",
  overlay: "#2a251f",
  ink: "#f7f3ec",
  muted: "#a79e90",
  subtle: "#7a7166",
  accentInk: "#191612",
  ok: "#5fa777",
  danger: "#e5484d",
  line: "#2e2822",
  lineStrong: "#3d352c",
  dangerSurface: "#2a1614",
  dangerRaised: "#3a1c19",
  dangerLine: "#5c2b26",
  dangerInk: "#ff9d9d",
};

export const LIGHT: Paleta = {
  amber: "#f5a623",
  accent: "#8f5a08",
  accentSoft: "#f8e7cb",
  accentLine: "#d8b171",
  sunken: "#ece5d6",
  surface: "#f8f3eb",
  raised: "#fdfbf6",
  overlay: "#ffffff",
  ink: "#1c1917",
  muted: "#5c5449",
  subtle: "#8a8071",
  accentInk: "#191612",
  ok: "#2f7d4f",
  danger: "#c0272d",
  line: "#dcd3c4",
  lineStrong: "#c5b9a5",
  dangerSurface: "#fbe3e1",
  dangerRaised: "#f7d4d1",
  dangerLine: "#e39c98",
  dangerInk: "#9c1c20",
};

export const PALETAS: readonly (readonly [string, Paleta])[] = [
  ["escuro", DARK],
  ["claro", LIGHT],
];

/** Compatibilidade: o tema escuro é o padrão do produto. */
export const TOKENS = DARK;
