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

/** Tokens do @theme em index.css, na mesma ordem do design system. */
export const TOKENS = {
  amber: "#f5a623",
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
} as const;
