/**
 * Citar identificador para o SQLite/libSQL.
 *
 * ## Por que existe uma função em vez de uma interpolação
 *
 * Achado #10 da auditoria: a `definition` do índice montava as aspas à mão
 * (`` `"${nome}"` ``). Ali o texto é só exibição — não é executado — mas o
 * hábito é o problema: a mesma linha copiada para o planejador de linhas, onde
 * o texto **é** executado, vira injeção por nome de coluna. O MySQL já teve a
 * sua `citar()` pelo mesmo motivo; esta é a de cá.
 *
 * ## A regra
 *
 * O SQLite aceita quatro formas de citar (`"x"`, `[x]`, `` `x` ``, `'x'`), e
 * usar a de aspas duplas é a única que é padrão SQL. O escape é a aspa dobrada.
 * Um nome com `"` no meio — que o SQLite aceita criar — sem o dobramento
 * fecharia o identificador no meio e o resto do nome viraria sintaxe.
 *
 * O byte nulo é recusado em vez de escapado: ele não pode aparecer num nome
 * vindo do catálogo, e se aparecer é sinal de que a origem não é o catálogo.
 */
export function citar(identificador: string): string {
  if (identificador.includes("\0")) {
    throw new Error("identificador com byte nulo não vem do catálogo");
  }
  return `"${identificador.replaceAll('"', '""')}"`;
}
