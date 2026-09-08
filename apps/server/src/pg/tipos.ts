/**
 * Desliga a conversão de tipos do driver: **toda célula chega como string**.
 *
 * É a regra 10 do `CLAUDE.md` e o §6 do `DBee.md`. Sem isto o `pg` devolve
 * `numeric` como `number` (e perde precisão), `int8` como string mas `int4`
 * como número, e `date` como `Date` — o valor que aparece na tela deixa de ser
 * o valor que está no banco.
 *
 * Mora aqui, e não em cada arquivo, porque eram três cópias idênticas em
 * `executor`, `exporter` e `bundle`: três lugares onde alguém poderia
 * "consertar" a conversão de um deles e deixar os outros divergirem em
 * silêncio.
 */
export interface TextTypesConfig {
  getTypeParser: () => (value: string) => string;
}

export const TUDO_TEXTO: TextTypesConfig = { getTypeParser: () => (v) => v };
