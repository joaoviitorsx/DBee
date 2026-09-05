import { Elysia } from "elysia";

import { SESSION_COOKIE, type SessionUser } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import { AUTH_FAILURES } from "./failures";

/**
 * Guard de sessão — **toda rota da API, sem exceção declarada aqui**.
 *
 * É um hook global, não um wrapper por rota, porque wrapper por rota depende de
 * alguém lembrar de aplicá-lo na próxima. A rota de export é o caso concreto:
 * ela devolve um `Response` cru com stream e não passa pelo caminho normal de
 * serialização — é fácil de esquecer justamente por ser diferente. Aqui ela não
 * tem como escapar, e o teste de varredura em `guard.test.ts` falha se uma rota
 * nova aparecer sem cobertura.
 *
 * ## Por que `onRequest`, e não `onBeforeHandle`
 *
 * A ordem dos hooks do Elysia 1.4.30, **medida, não presumida**:
 *
 *     onRequest → onParse → onTransform → derive → validação → onBeforeHandle
 *
 * A validação do corpo roda **antes** do `onBeforeHandle`. Com o guard ali, uma
 * requisição sem sessão e com corpo inválido recebia **422 em vez de 401** — e
 * o problema não é o status: é que o corpo do atacante foi lido, parseado e
 * validado antes de qualquer autenticação. O `sql` do export aceita 1 MB, então
 * isso é `JSON.parse` + TypeBox de 1 MB aberto a quem alcançar a porta.
 *
 * Em `onRequest` nada disso acontece: a requisição sem sessão morre antes de o
 * corpo ser lido. O preço é ler o cookie do cabeçalho cru, porque nesse estágio
 * o Elysia ainda não parseou cookies.
 *
 * **`{ as: "global" }` é obrigatório** nos hooks de plugin. Hook de plugin é
 * local por padrão; sem isso o guard protegeria zero rotas e nada acusaria —
 * foi exatamente assim que o `onError` deixou a senha vazar antes (§11.19).
 */

/**
 * Lê um cookie do cabeçalho cru.
 *
 * Em `onRequest` o `cookie` do contexto ainda não existe. Cabeçalho `Cookie` é
 * uma lista `nome=valor` separada por `; ` — sem aspas e sem escape, porque o
 * token é base64url.
 */
function cookieDoCabecalho(header: string | null, nome: string): string | null {
  if (header === null) return null;
  for (const parte of header.split(";")) {
    const igual = parte.indexOf("=");
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() !== nome) continue;
    const valor = parte.slice(igual + 1).trim();
    return valor === "" ? null : valor;
  }
  return null;
}

/**
 * As únicas rotas abertas, e o motivo de cada uma:
 *
 * - `GET /api/health` — o healthcheck do container não tem sessão (§8). A
 *   resposta é `{status:"ok"}` e não revela nada.
 * - `POST /api/auth/login` — é como a sessão nasce.
 *
 * Qualquer acréscimo aqui é decisão de segurança e precisa de justificativa
 * escrita. O teste confere que esta lista é exatamente esta.
 */
export const ROTAS_ABERTAS: ReadonlySet<string> = new Set([
  "GET /api/health",
  "POST /api/auth/login",
]);

/**
 * Rotas permitidas quando a senha precisa ser trocada.
 *
 * A senha do primeiro boot foi impressa no log — é conhecida por quem leu o
 * log. Enquanto ela não muda, a sessão existe mas não serve para nada além de
 * trocá-la e de sair.
 */
const PERMITIDAS_SEM_TROCAR: ReadonlySet<string> = new Set([
  "GET /api/auth/me",
  "POST /api/auth/password",
  "POST /api/auth/logout",
]);

export interface Sessao {
  readonly user: SessionUser;
  readonly tokenHash: string;
}

/**
 * O contexto que o guard injeta. `null` só chega a handler de rota aberta.
 *
 * `type` e não `interface`: o `derive` do Elysia exige um tipo com assinatura
 * de índice implícita, e `interface` não satisfaz essa restrição em TypeScript
 * (declaração aberta a extensão não pode ser provada compatível). É regra do
 * TS, não do Elysia.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- ver acima: `interface` não compila aqui
export type ComSessao = {
  readonly sessao: Sessao | null;
};

/**
 * Resolve o cookie em sessão e injeta no contexto.
 *
 * Plugin separado do hook de propósito: o valor derivado só entra na tipagem
 * do `onBeforeHandle` quando chega por `.use()`. Na mesma instância ele existe
 * em runtime mas não no tipo, e a saída seria um cast — pior de ler e sem
 * garantia nenhuma.
 */
export const sessionContext = (users: UsersRepository) =>
  new Elysia({ name: "session-context" }).derive(
    { as: "global" },
    ({ cookie }): ComSessao => {
      const token = cookie[SESSION_COOKIE]?.value;
      if (typeof token !== "string" || token === "") return { sessao: null };
      return { sessao: users.resolverSessao(token) };
    },
  );

export const sessionGuard = (users: UsersRepository) =>
  new Elysia({ name: "session-guard" })
    .use(sessionContext(users))
    // `onRequest` roda **antes do roteamento**, então já vale para o app
    // inteiro e não aceita `{ as }` — diferente dos outros hooks, em que o
    // escopo local é o padrão que precisa ser desfeito.
    .onRequest(({ request, status }) => {
      // Em `onRequest` não há `path` do roteador ainda; o pathname da URL é o
      // mesmo valor e já vem com o prefixo `/api`. A chave é o par
      // método+caminho porque `POST /auth/login` ser aberta não pode abrir um
      // `GET` no mesmo caminho.
      const chave = `${request.method} ${new URL(request.url).pathname}`;
      if (ROTAS_ABERTAS.has(chave)) return;

      const token = cookieDoCabecalho(request.headers.get("cookie"), SESSION_COOKIE);
      const sessao = token === null ? null : users.resolverSessao(token);

      if (sessao === null) {
        const { status: code, body } = AUTH_FAILURES.unauthenticated;
        return status(code, body);
      }

      if (sessao.user.mustChangePassword && !PERMITIDAS_SEM_TROCAR.has(chave)) {
        const { status: code, body } = AUTH_FAILURES.password_change_required;
        return status(code, body);
      }
      return;
    });

/**
 * O id de quem está executando, para a auditoria.
 *
 * Estoura em vez de devolver string vazia. O guard garante que estas rotas só
 * rodam com sessão, então isto é inalcançável hoje — e é justamente por isso
 * que precisa ser barulhento: se alguém puser uma rota de execução em
 * `ROTAS_ABERTAS`, o que não pode acontecer é o `query_log` ganhar linhas com
 * `actor` vazio, que é auditoria com aparência de auditoria.
 */
export function exigirAtor(sessao: Sessao | null): string {
  if (sessao === null) {
    throw new Error("rota de execução sem sessão: o guard foi contornado");
  }
  return sessao.user.id;
}
