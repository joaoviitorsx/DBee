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

/**
 * O fuso da sessão — e o plano B para servidor sem tabelas de fuso.
 *
 * A conexão do DBee guarda um fuso IANA (`America/Bahia`). O MySQL só entende
 * nome se as tabelas `mysql.time_zone*` estiverem carregadas — nas imagens
 * oficiais elas estão (medido: 1795 nomes no MySQL 8.4, 498 no MariaDB 11), mas
 * num servidor instalado à mão é comum não estarem, e aí `SET SESSION
 * time_zone = 'America/Bahia'` falha com **1298**.
 *
 * Falhar a conexão inteira por causa disso seria desproporcional; ignorar o erro
 * seria pior, porque a sessão ficaria no fuso do servidor e as datas
 * apareceriam **silenciosamente erradas** — exatamente o que a regra 10 e o
 * `TUDO_TEXTO` existem para evitar.
 *
 * O plano B é o **deslocamento numérico** do mesmo fuso, que os dois aceitam
 * sempre (medido). Ele tem um limite honesto: é o deslocamento de **agora**, e
 * uma sessão que atravesse uma virada de horário de verão continuaria no
 * deslocamento antigo. Por isso o nome vem primeiro, e o número é a queda.
 */
export const ERRNO_FUSO_DESCONHECIDO = 1298;

/** Se o erro é "este servidor não conhece esse nome de fuso". */
export function ehFusoDesconhecido(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) return false;
  const { errno } = erro as { errno?: unknown };
  return errno === ERRNO_FUSO_DESCONHECIDO;
}

/** `SET SESSION time_zone` com o nome IANA. Primeira tentativa. */
export function sqlDeFusoPorNome(iana: string): string {
  // Aspas simples duplicadas: o valor não pode ir por placeholder (`SET SESSION`
  // não aceita), e um nome de fuso com apóstrofo não existe — mas escapar é
  // barato e a alternativa é confiar num invariante mantido noutra camada.
  return `SET SESSION time_zone = '${iana.replaceAll("'", "''")}'`;
}

/**
 * O deslocamento atual de um fuso IANA, na forma `+HH:MM` que o MySQL aceita.
 *
 * `Intl` devolve `GMT-03:00`, e `GMT` seco para UTC — daí a normalização.
 * Cobre deslocamentos que não são hora cheia (`Asia/Kolkata` é `+05:30`,
 * `Pacific/Chatham` é `+12:45`).
 */
export function deslocamentoDe(iana: string, agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    timeZoneName: "longOffset",
  }).formatToParts(agora);
  const bruto = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const resto = bruto.replace(/^GMT/, "");
  return resto === "" ? "+00:00" : resto;
}

/** `SET SESSION time_zone` com o deslocamento numérico. Plano B. */
export function sqlDeFusoPorDeslocamento(iana: string, agora: Date = new Date()): string {
  return `SET SESSION time_zone = '${deslocamentoDe(iana, agora)}'`;
}
