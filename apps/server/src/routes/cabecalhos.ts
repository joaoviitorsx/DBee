import { Elysia } from "elysia";

/**
 * Cabeçalhos de segurança em **toda** resposta.
 *
 * ## Por que existe
 *
 * O `docs/DBee.md` §7 afirmava que havia um middleware fazendo isto. Não havia:
 * uma resposta autenticada de `GET /api/connections` saía com
 * `content-type` e mais nada. Documentação afirmando um controle inexistente é
 * pior que a ausência dele, porque quem revisa marca o item como feito.
 *
 * ## O que cada um faz, no cenário deste app
 *
 * O DBee é alcançado pela tailnet e a autenticação é a segunda camada, não a
 * única (§2.3). O risco que sobra não é enquadramento — `SameSite=Strict` já
 * cobre ação autenticada de terceiro — é **exfiltração**: qualquer script que
 * chegue à página (dependência do front comprometida, XSS futuro, arquivo
 * servido do build) tem, hoje, saída livre para a internet levando o resultado
 * das consultas do escritório.
 *
 * `connect-src 'self'` é a peça que transforma "o dado vazou do navegador" em
 * "o navegador recusou o envio".
 *
 * - `default-src 'self'` — nada carrega de fora. É verdade por construção: a
 *   regra 3 do `CLAUDE.md` proíbe CDN em runtime, tudo é bundlado.
 * - `connect-src 'self'` — `fetch`, XHR e WebSocket só para a própria origem.
 * - `img-src 'self' data:` — o `data:` é para os ícones e a marca embutidos.
 * - `style-src 'self' 'unsafe-inline'` — o `unsafe-inline` **não** é descuido:
 *   Radix e a animação da grade escrevem `style` inline em tempo de execução, e
 *   sem ele a tela quebra. Estilo inline não executa código; o vetor que
 *   importa é `script-src`, e esse fica fechado.
 * - `frame-ancestors 'none'` e `base-uri 'none'` — o primeiro substitui o
 *   `X-Frame-Options`, o segundo impede reescrever a base das URLs relativas.
 * - `form-action 'self'` — um formulário injetado não posta para fora.
 *
 * `x-content-type-options: nosniff` impede o navegador adivinhar tipo de
 * conteúdo — relevante porque o app serve arquivo estático do próprio build.
 *
 * `referrer-policy: no-referrer` porque a URL do DBee carrega o **id da
 * conexão** e o nome do database; um link externo clicado a partir dele
 * vazaria isso no `Referer`.
 *
 * ## O que deliberadamente não está aqui
 *
 * Nenhum `Access-Control-Allow-Origin`. O front é servido pelo mesmo processo,
 * então não há requisição cross-origin legítima — e um CORS permissivo é
 * exatamente como um segredo de sessão sai de uma origem confiável. A ausência
 * do cabeçalho é a política restritiva: o navegador recusa sozinho.
 */
export const CABECALHOS_DE_SEGURANCA: Readonly<Record<string, string>> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  // Redundante com `frame-ancestors` nos navegadores atuais, e barato para os
  // que ainda não o implementam.
  "x-frame-options": "DENY",
  // O app é servido por HTTP na tailnet hoje; o cabeçalho só passa a valer
  // quando houver TLS, e mandá-lo antes não quebra nada.
  "cross-origin-opener-policy": "same-origin",
};

/**
 * `onRequest`, não `onAfterHandle`.
 *
 * `onRequest` roda antes do roteamento e já é global por natureza — passar
 * `{ as: "global" }` aqui quebra a composição do Elysia, porque nessa posição o
 * objeto é lido como o próprio handler.
 *
 * O `onRequest` foi escolhido depois do teste: com `onAfterHandle`, a resposta
 * **401 do guard saía sem nenhum cabeçalho** — o hook não roda quando a rota
 * não chega ao handler. O caminho de erro é justamente onde este projeto já
 * vazou uma senha (o 422 do §11.4); ele não pode ser o caminho sem política.
 * Marcando o `set.headers` na entrada, o mesmo objeto acompanha a resposta de
 * sucesso, a de erro e a do `errorHandler`.
 */
export const cabecalhosDeSeguranca = new Elysia({ name: "security-headers" }).onRequest(
  ({ set }) => {
    for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
      set.headers[nome] = valor;
    }
  },
);
