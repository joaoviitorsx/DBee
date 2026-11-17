import { normalize } from "./filter";

/**
 * Corta um nome no trecho que casou com a busca (ui-detalhes §3.4).
 *
 * O casamento ignora acento e caixa (mesma regra do `filter.ts`), então o
 * índice tem que ser achado no texto **normalizado** e mapeado de volta para o
 * original: "Produção" casando "producao" destaca "Produção" inteiro, não um
 * pedaço deslocado. Cada caractere original vira 0 ou mais caracteres
 * normalizados; o mapa guarda onde cada um começa.
 */
export interface Trecho {
  readonly texto: string;
  readonly casou: boolean;
}

export function trechos(texto: string, termo: string): readonly Trecho[] {
  const agulha = normalize(termo.trim());
  if (agulha === "") return [{ texto, casou: false }];

  const chars = Array.from(texto);
  let normal = "";
  // inicio[i] = posição em `normal` onde começa o caractere original i.
  const inicio: number[] = [];
  for (const c of chars) {
    inicio.push(normal.length);
    normal += normalize(c);
  }
  inicio.push(normal.length);

  const achado = normal.indexOf(agulha);
  if (achado < 0) return [{ texto, casou: false }];
  const fim = achado + agulha.length;

  // Primeiro caractere original cujo começo alcança `achado`, e o primeiro
  // que começa em ou depois de `fim`.
  const de = inicio.findIndex((p, i) => i < chars.length && p + normalize(chars[i] ?? "").length > achado);
  // Pula marcas combinantes (largura zero normalizada): o acento fica com a
  // letra dele, não começa o trecho seguinte.
  const ate = inicio.findIndex(
    (p, i) => p >= fim && (i === chars.length || normalize(chars[i] ?? "") !== ""),
  );
  const a = chars.slice(0, de).join("");
  const b = chars.slice(de, ate).join("");
  const c = chars.slice(ate).join("");
  return [
    ...(a === "" ? [] : [{ texto: a, casou: false }]),
    { texto: b, casou: true },
    ...(c === "" ? [] : [{ texto: c, casou: false }]),
  ];
}
