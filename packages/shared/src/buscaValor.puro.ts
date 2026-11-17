/**
 * Lógica pura da busca de valor (ADR 023). Sem I/O, sem TypeBox.
 */

/** Teto de tabelas varridas por busca — o que segura o teste 3 (ADR 023). */
export const BUSCA_VALOR_MAX_TABELAS = 200;
/** Teto de ocorrências devolvidas por tabela. */
export const BUSCA_VALOR_MAX_POR_TABELA = 20;
/** `statement_timeout` de cada tabela, em ms. */
export const BUSCA_VALOR_TIMEOUT_TABELA_MS = 3000;

/**
 * Escapa `%`, `_` e `\` para o valor virar literal dentro de um `ILIKE`
 * (o `ESCAPE` padrão do Postgres é `\`). O padrão vai como parâmetro — isto não
 * é proteção contra injeção, é para "50%" procurar "50%" e não "50<qualquer>".
 */
export function padraoContem(valor: string): string {
  return `%${valor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * O valor pode casar com coluna numérica? Só número decimal simples — o que o
 * cast `::numeric` aceita sem surpresa. `1e3`, `NaN` e `Infinity` ficam de fora
 * de propósito: a busca é por valor digitado, não por expressão.
 */
export function ehNumero(valor: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(valor.trim());
}
