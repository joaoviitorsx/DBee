/**
 * Identidade de uma tabela na tela de export.
 *
 * ## Por que não é `${schema}.${tabela}`
 *
 * Identificador do Postgres aceita ponto quando citado. O schema `zz_a` com a
 * tabela `"b.c"` e o schema `"zz_a.b"` com a tabela `c` são duas tabelas
 * **diferentes** que colapsavam na mesma string `zz_a.b.c`. Consequências
 * medidas, não teóricas:
 *
 * - marcar uma caixa marcava as duas, e o export levava dado de uma tabela que
 *   ninguém pediu;
 * - `key=` duplicado fazia o React reconciliar as duas linhas como uma.
 *
 * `JSON.stringify` de um par é inambíguo — `["zz_a","b.c"] ≠ ["zz_a.b","c"]` —
 * e é a mesma correção que o `nodeId` do diagrama já documenta. O export tinha
 * ficado de fora dela.
 */
export const chaveTabela = (schema: string, tabela: string): string =>
  JSON.stringify([schema, tabela]);

/**
 * O texto que a pessoa lê.
 *
 * Separado da chave de propósito: legível não precisa ser único, e único não
 * precisa ser legível. Misturar os dois papéis foi o que criou a colisão.
 */
export const rotuloTabela = (schema: string, tabela: string): string => `${schema}.${tabela}`;
