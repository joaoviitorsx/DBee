import { ehMetadadoDeNuvem } from "../lib/rede";
import type { CelulaLibsql, ResultadoLibsql } from "./protocolo";

/**
 * Falar com um servidor libSQL por HTTP, sem cliente e sem pool.
 *
 * ## Sem pool, de propósito
 *
 * O Postgres e o MySQL precisam de pool porque a conexão carrega **estado de
 * sessão** — modo da transação, fuso, limite de tempo — e abrir uma por
 * consulta custaria o handshake toda vez. Aqui não há sessão: cada `POST
 * /v2/pipeline` é independente, o `close` no fim do lote descarta o que houver,
 * e o `fetch` do Bun já reusa a conexão TCP por baixo.
 *
 * Isso apaga de uma vez o contrato de descarte, a configuração de sessão e a
 * espera por vaga que o driver de MySQL precisou. Menos peças porque a engine
 * tem menos estado — não porque foi feito com menos cuidado.
 *
 * ## O que ainda não existe aqui
 *
 * Limite de tempo por statement e cancelamento: o protocolo não os oferece.
 * Isso vira capacidade `cancelarQuery: false`, e a tela deixa de oferecer o
 * botão em vez de oferecer um que não faz nada.
 */

/** Como falar TLS com o servidor — o análogo do `MysqlSslConfig`. */
export interface TlsLibsql {
  /**
   * Validar cadeia e identidade do servidor.
   *
   * `true` é `verify-full`; `false` é `require` (cifra, mas não autentica quem
   * está do outro lado). O ADR 003 exige que cada modo signifique o que
   * promete, e é este campo que faz `require` não virar `verify-full` por
   * acidente — o `fetch` do Bun valida por padrão.
   */
  readonly rejectUnauthorized: boolean;
  /** CA própria, quando o certificado do servidor não vem de uma CA pública. */
  readonly ca?: string;
}

/** Para onde ir e com que credencial. */
export interface AlvoLibsql {
  /** `http(s)://host:porta`. O `https` é o que faz o transporte ser cifrado. */
  readonly url: string;
  /** JWT. `null` num servidor sem `SQLD_AUTH_JWT_KEY`. */
  readonly token: string | null;
  /**
   * Config de TLS. `undefined` quando a URL é `http` (`disable`): não há
   * handshake para configurar. Presente nos dois modos `https`, e é o
   * `rejectUnauthorized` dentro dela que separa `require` de `verify-full`.
   */
  readonly tls?: TlsLibsql;
  /** Milissegundos até desistir da requisição inteira. */
  readonly timeoutMs?: number;
}

/** Um argumento ligado, no formato que o protocolo espera. */
export type ArgLibsql =
  | { readonly type: "null" }
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "integer"; readonly value: string };

/**
 * Valor de aplicação virando argumento ligado.
 *
 * **Tudo vira `text`, exceto `null`.** O SQLite tem tipagem dinâmica e converte
 * o texto para o tipo da coluna na comparação, então mandar `"42"` como texto
 * compara igual a mandar como inteiro — e mandar tudo como texto evita decidir,
 * a cada valor, se ele "parece número". Essa decisão é onde nasce o erro de
 * comparar `"9"` com `"10"` como texto.
 */
export function arg(valor: string | null): ArgLibsql {
  return valor === null ? { type: "null" } : { type: "text", value: valor };
}

export interface StatementLibsql {
  readonly sql: string;
  readonly args?: readonly ArgLibsql[];
}

/**
 * A URL do alvo, validada, com a barra final removida.
 *
 * ## Por que a validação mora aqui e não só no formulário
 *
 * Achado #11 da auditoria. Diferente do webhook de deploy, aqui **o corpo da
 * resposta vira a grade na tela**: apontar a conexão para `169.254.169.254` não
 * dispararia uma requisição cega, entregaria o serviço de metadado da nuvem
 * renderizado. O formulário é a primeira barreira; esta é a que vale, porque é
 * a que está no caminho de toda requisição — inclusive as de uma conexão criada
 * antes desta regra existir.
 *
 * Exige `http`/`https` explicitamente: sem isso um `file:` ou um `data:` chegaria
 * ao `fetch`.
 */
export function alvoValidado(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new ErroLibsql("a URL do servidor libSQL não é uma URL válida", "invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ErroLibsql("a URL do servidor libSQL precisa ser http ou https", "invalid_url");
  }
  if (ehMetadadoDeNuvem(u.hostname)) {
    throw new ErroLibsql(
      "esse endereço é um serviço de metadado de nuvem, não um servidor libSQL",
      "blocked_host",
    );
  }
  return u.toString().replace(/\/+$/, "");
}

/** Erro vindo do servidor libSQL, com o código quando ele manda um. */
export class ErroLibsql extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ErroLibsql";
  }
}

interface RespostaPipeline {
  readonly results?: {
    readonly type: "ok" | "error";
    readonly error?: { readonly message?: string; readonly code?: string };
    readonly response?: { readonly result?: ResultadoLibsql };
  }[];
  readonly error?: string;
}

/**
 * Executa statements **em sequência**, parando no primeiro erro.
 *
 * O `close` no fim é o que devolve o estado do servidor ao ponto de partida:
 * sem ele, uma transação aberta por um statement do usuário ficaria pendurada
 * na sessão do lado de lá.
 */
export async function executarSql(
  alvo: AlvoLibsql,
  statements: readonly StatementLibsql[],
): Promise<ResultadoLibsql[]> {
  const requests = [
    ...statements.map((s) => ({
      type: "execute" as const,
      stmt: { sql: s.sql, ...(s.args === undefined ? {} : { args: [...s.args] }) },
    })),
    { type: "close" as const },
  ];

  const controle = new AbortController();
  const prazo = setTimeout(() => { controle.abort(); }, alvo.timeoutMs ?? 30_000);

  const base = alvoValidado(alvo.url);

  let resposta: Response;
  try {
    resposta = await fetch(`${base}/v2/pipeline`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Sem token o cabeçalho não vai — um servidor sem auth recusa
        // `Bearer null` em vez de aceitar a conexão.
        ...(alvo.token === null ? {} : { authorization: `Bearer ${alvo.token}` }),
      },
      body: JSON.stringify({ requests }),
      signal: controle.signal,
      /*
       * A config de TLS por requisição. O `tls` do `fetch` é extensão do Bun
       * (não existe no fetch padrão), e é o que permite `require` cifrar sem
       * validar — o mesmo que o `rejectUnauthorized: false` do MySQL. Em `http`
       * o campo é `undefined` e não há efeito.
       */
      ...(alvo.tls === undefined
        ? {}
        : {
            tls: {
              rejectUnauthorized: alvo.tls.rejectUnauthorized,
              ...(alvo.tls.ca === undefined ? {} : { ca: alvo.tls.ca }),
            },
          }),
      /*
       * O redirecionamento **não** é seguido. Sem isto, um host permitido
       * responde `302 → http://169.254.169.254/...` e o `fetch` refaz a
       * requisição lá — levando o cabeçalho `Authorization` junto — e devolve
       * o corpo, que aqui vira a grade na tela. `manual` transforma isso num
       * erro em vez de numa leitura.
       */
      redirect: "manual",
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ErroLibsql("o servidor libSQL não respondeu no tempo esperado", "timeout");
    }
    throw new ErroLibsql(err instanceof Error ? err.message : String(err), null);
  } finally {
    clearTimeout(prazo);
  }

  /*
   * Com `redirect: "manual"` o status 3xx chega intacto (o Bun devolve o
   * `Response` do redirecionamento em vez de segui-lo). Ele não é resposta do
   * protocolo, e tentar ler JSON dali produziria um erro de parse sem sentido
   * para quem lê a mensagem.
   */
  if (resposta.status >= 300 && resposta.status < 400) {
    throw new ErroLibsql(
      `o servidor libSQL redirecionou (${String(resposta.status)}); ` +
        "o DBee não segue redirecionamento numa conexão de banco",
      "redirect_refused",
    );
  }

  const corpo = (await resposta.json()) as RespostaPipeline;

  /*
   * Erro de autorização vem no corpo com HTTP 200 em alguns caminhos e com 401
   * em outros — os dois entram aqui. A mensagem do servidor sobe inteira: ela
   * diz "Expected authorization header but none given" ou "Current session
   * doesn't have Write permission", e as duas são exatamente o que a pessoa
   * precisa ler.
   */
  if (corpo.error !== undefined) throw new ErroLibsql(corpo.error, null);
  if (!resposta.ok) {
    throw new ErroLibsql(`o servidor libSQL respondeu ${String(resposta.status)}`, null);
  }

  const saidas: ResultadoLibsql[] = [];
  for (const r of corpo.results ?? []) {
    if (r.type === "error") {
      throw new ErroLibsql(r.error?.message ?? "erro sem mensagem", r.error?.code ?? null);
    }
    // O `close` também vem como `ok` e sem `result`: ele não é um statement do
    // usuário e não entra na lista de resultados.
    if (r.response?.result !== undefined) saidas.push(r.response.result);
  }
  return saidas;
}

/** As células de uma linha, na ordem das colunas. */
export type LinhaLibsql = readonly CelulaLibsql[];
