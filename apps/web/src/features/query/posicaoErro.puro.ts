/**
 * Onde o erro aponta (ui-detalhes §3.6). Puro, testado sem editor.
 *
 * `position` é 1-based **no SQL enviado** (já corrigida pelo servidor, §11.12).
 * O SQL enviado pode ser só um trecho do editor (statement sob o cursor,
 * seleção), então o chamador soma o deslocamento desse trecho.
 */
export interface LocalErro {
  readonly linha: number;
  readonly coluna: number;
  readonly texto: string;
}

/** Converte a posição 1-based em linha, coluna e o texto daquela linha. */
export function localizar(sql: string, position: number): LocalErro {
  const antes = sql.slice(0, Math.max(0, position - 1));
  const linhas = antes.split("\n");
  const linha = linhas.length;
  const coluna = (linhas.at(-1)?.length ?? 0) + 1;
  return { linha, coluna, texto: sql.split("\n")[linha - 1] ?? "" };
}

/**
 * O trecho a sublinhar: o "token" que começa no deslocamento `de` (0-based no
 * documento). Palavra, número ou identificador citado; senão, um caractere.
 * Nunca vazio enquanto houver texto — um sublinhado de largura zero não se vê.
 */
export function trechoDoErro(doc: string, de: number): { de: number; ate: number } | null {
  if (doc.length === 0) return null;
  const inicio = Math.min(Math.max(0, de), doc.length - 1);
  const resto = doc.slice(inicio);
  const m = /^("[^"\n]*"?|'[^'\n]*'?|[\p{L}\p{N}_$.]+)/u.exec(resto);
  const tamanho = m === null ? 1 : Math.min(m[0].length, 200);
  return { de: inicio, ate: inicio + tamanho };
}
