/**
 * O que difere entre MySQL e MariaDB dentro de uma sessão.
 *
 * As duas falam o mesmo protocolo e divergem no que importa. Este arquivo
 * concentra as diferenças medidas, para elas não se espalharem por `if` no
 * meio do driver.
 */

/** Qual dos dois está do outro lado. */
export type Sabor = "mysql" | "mariadb";

/**
 * O sabor, pela string de versão.
 *
 * O MariaDB carrega `MariaDB` em `VERSION()` — medido, `11.8.9-MariaDB-ubu2404`
 * — e é a única marca que aparece nas duas pontas (protocolo, `VERSION()`,
 * `@@version`). Perguntar por uma variável exclusiva seria mais frágil: a
 * consulta falharia com erro 1193 no servidor errado, e um erro no caminho de
 * abertura de sessão é pior que uma comparação de string.
 */
export function saborDaVersao(versao: string): Sabor {
  return versao.toLowerCase().includes("mariadb") ? "mariadb" : "mysql";
}

/**
 * Como limitar o tempo de uma consulta, em cada um.
 *
 * Medido, e as três diferenças importam:
 *
 * | | variável | unidade | erro ao cortar |
 * |---|---|---|---|
 * | MySQL 8.4 | `max_execution_time` | **milissegundos inteiros** | 3024 |
 * | MariaDB 11.8 | `max_statement_time` | **segundos, float** | 1969 |
 *
 * `@@max_execution_time` **não existe** no MariaDB (erro 1193), então não dá
 * para setar as duas e deixar a que valer vencer.
 *
 * O valor vai por parâmetro? **Não pode**: `SET SESSION` não aceita
 * placeholder para o valor de uma variável de sistema. Por isso o número é
 * formatado aqui, e a única defesa possível é ele ser um número mesmo — o
 * `Number.isFinite` abaixo é o que impede uma string chegar até a concatenação.
 */
export function sqlDeTimeout(sabor: Sabor, ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`timeout inválido: ${String(ms)}`);
  }
  if (sabor === "mariadb") {
    // Segundos com casas decimais. `1500 ms` vira `1.5`.
    const segundos = ms / 1000;
    return `SET SESSION max_statement_time = ${segundos.toFixed(3)}`;
  }
  return `SET SESSION max_execution_time = ${String(Math.round(ms))}`;
}

/**
 * Uma consulta interrompida por tempo **pode voltar sem erro**.
 *
 * Medido com o `mysql2`, e os dois servidores erram de formas diferentes:
 *
 * | | `SELECT SLEEP(5)` | consulta pesada real |
 * |---|---|---|
 * | MySQL 8.4 | **sem erro** em 1502 ms, valor `1` | `ER_QUERY_TIMEOUT`, errno 3024 |
 * | MariaDB 11.8 | errno **1969**, `code` **`undefined`** | não cortou (terminou antes) |
 *
 * Duas armadilhas, uma em cada:
 *
 * 1. No MySQL o `SLEEP` cortado **não levanta erro** — devolve `1`, que é como
 *    ele sinaliza interrupção. Um driver que decida "deu certo" pela ausência
 *    de erro relata sucesso numa consulta que não terminou, e o usuário lê um
 *    resultado parcial como se fosse o resultado.
 * 2. No MariaDB o erro **não tem `code`**, só `errno`. Reconhecer o corte pelo
 *    nome do código funcionaria no MySQL e falharia calado no MariaDB — foi
 *    exatamente o que a primeira versão deste arquivo fazia, antes de medir.
 *
 * Por isso a chave é o **errno**, que os dois preenchem.
 */
export const ERRNOS_DE_CORTE_POR_TEMPO: ReadonlySet<number> = new Set([
  3024, // MySQL — ER_QUERY_TIMEOUT
  1969, // MariaDB — sem `code`, só este número
]);

/** Se um erro do driver é "a consulta estourou o tempo". */
export function ehCortePorTempo(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) return false;
  const { errno } = erro as { errno?: unknown };
  return typeof errno === "number" && ERRNOS_DE_CORTE_POR_TEMPO.has(errno);
}
