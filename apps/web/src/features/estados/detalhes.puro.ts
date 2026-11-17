/**
 * Texto de "copiar detalhes" da `FronteiraDeErro` (ui-detalhes §3.7), sem
 * credencial (CLAUDE.md regra 5).
 *
 * A mensagem de uma exceção de render pode carregar o que estava em memória:
 * uma URI `postgres://user:senha@host`, um `password=…` de connection string,
 * um token `Bearer`. A fronteira não sabe de onde o erro veio, então o texto
 * que vai para a área de transferência — e daí para um chat ou issue — passa
 * por aqui. Mascara o valor e mantém a chave: "havia uma senha aqui" ainda é
 * informação útil para depurar.
 */

const MASCARA = "***";

const REGRAS: readonly (readonly [RegExp, string])[] = [
  // esquema://usuario:senha@host → esquema://usuario:***@host. A senha vai até
  // o ÚLTIMO `@` antes do host (senha pode conter `@` e `/`).
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)\S*@(?=[^\s@]*(?:\s|$))/gi, `$1${MASCARA}@`],
  // password='s3gr3do' / password="x" (forma citada do libpq e JSON): valor inteiro entre aspas
  [/\b(password|passwd|pwd|senha|secret|token|api[_-]?key)("?\s*[:=]\s*)(['"])(?:\\.|(?!\3).)*\3/gi, `$1$2$3${MASCARA}$3`],
  // password=…, pwd: …, senha=…, secret/token/apikey sem aspas (connection string, header)
  [/\b(password|passwd|pwd|senha|secret|token|api[_-]?key)("?\s*[:=]\s*)(?!['"]|\*\*\*)[^\s,;&]+/gi, `$1$2${MASCARA}`],
  // Authorization: Bearer xxx
  [/\b(bearer)\s+[a-z0-9._~+/=-]+/gi, `$1 ${MASCARA}`],
  // cookie de sessão do próprio DBee
  [/(dbee_session=)[^\s;]+/gi, `$1${MASCARA}`],
];

export function semCredencial(texto: string): string {
  return REGRAS.reduce((acc, [re, troca]) => acc.replace(re, troca), texto);
}

/**
 * Monta o texto copiado. Inclui versão do navegador e o caminho (sem `hash` nem
 * `search`: o hash de um link compartilhável carrega filtros com valores de
 * dados — ADR 020 — e não precisa ir junto num relato de erro).
 */
export function detalhesDoErro(e: {
  nome: string;
  mensagem: string;
  pilha: string | null;
  pilhaComponente: string | null;
  caminho: string;
  agente: string;
}): string {
  return semCredencial(
    [
      `${e.nome}: ${e.mensagem}`,
      `em ${e.caminho} · ${e.agente}`,
      "",
      e.pilha ?? "",
      e.pilhaComponente ?? "",
    ].join("\n").trim(),
  );
}
