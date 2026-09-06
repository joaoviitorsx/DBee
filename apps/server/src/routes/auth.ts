import { Elysia, t } from "elysia";

import {
  ChangePasswordRequest,
  ErrorResponse,
  LocaleRequest,
  LoginRequest,
  LogoutResponse,
  MeResponse,
  SESSION_COOKIE,
  SetupRequest,
  SetupStatus,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { AuthService } from "../services/auth.service";
import { AUTH_FAILURES } from "./failures";
import { sessionContext } from "./guard";

/**
 * Rotas de autenticação (DBee.md §7).
 *
 * `POST /auth/login` é a única rota aberta além do healthcheck — a lista vive
 * em `guard.ts` e o teste de varredura confere que é exatamente ela.
 */

/**
 * Atributos do cookie de sessão.
 *
 * - `httpOnly` — JavaScript da página não lê. Sem isso, um XSS rouba a sessão.
 * - `sameSite: "strict"` — o cookie não viaja em requisição vinda de outro
 *   site, o que dispensa token de CSRF para as rotas com efeito.
 * - `path: "/"` — vale para `/api` e para o front servido na raiz.
 *
 * O `secure` **não** mora aqui: era `true` incondicional, e o navegador
 * **descarta** um cookie `Secure` recebido sobre `http://`. No acesso por IP da
 * tailnet (`http://100.x.x.x:3001`, o caminho documentado sem domínio/TLS) o
 * login autenticava, o cookie era jogado fora, e a tela voltava para o login —
 * sessão impossível. O `secure` passou a ser resolvido por requisição em
 * `cookieSecuro` (DBee.md §11.44). `httpOnly` e `sameSite` seguem inegociáveis.
 */
const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "strict",
  path: "/",
} as const;

/**
 * Marca o cookie `Secure` **só quando faz sentido** — senão o navegador o
 * descarta e não há sessão.
 *
 * - `DBEE_COOKIE_SECURE` explícito vence: `true`/`1` força `Secure`, `false`/`0`
 *   desliga. É o botão para o TLS que **termina no proxy** (Traefik/Dokploy): o
 *   app vê `http` internamente, mas o usuário está em `https`, então o operador
 *   declara `DBEE_COOKIE_SECURE=true`.
 * - Sem a env, segue o **protocolo da requisição**: `https` direto ⇒ `Secure`;
 *   `http` (tailnet por IP, sem TLS) ⇒ sem `Secure`. Default seguro quando há
 *   TLS de ponta a ponta, e funcional quando não há.
 *
 * `X-Forwarded-Proto` **não** é consultado: o app não confia em cabeçalho de
 * proxy não configurado (mesma postura do rate limit com o IP). Quem termina TLS
 * no proxy usa a env.
 */
function cookieSecuro(request: Request): boolean {
  const bruto = process.env["DBEE_COOKIE_SECURE"]?.trim().toLowerCase();
  if (bruto === "true" || bruto === "1") return true;
  if (bruto === "false" || bruto === "0") return false;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export const authRoutes = (service: AuthService, users: UsersRepository) =>
  new Elysia({ prefix: "/auth" })
    // O guard já derivou a sessão globalmente; o `use` aqui é para o **tipo**
    // dela chegar nestes handlers. O Elysia deduplica por `name`, então não há
    // segunda consulta ao SQLite.
    .use(sessionContext(users))
    // Aberta: diz se o app está em modo setup (nenhuma conta ainda). O front
    // decide entre a tela de setup e a de login sem precisar de sessão.
    .get("/setup", () => ({ setupRequired: service.setupRequerido() }), {
      response: { 200: SetupStatus },
    })
    // Aberta: cria a primeira conta com o token do volume. A trava contra uma
    // "segunda primeira conta" é o `setup_done` (409) no serviço, não o guard.
    .post(
      "/setup",
      async ({ body, cookie, status, server, request }) => {
        const origem = server?.requestIP(request)?.address ?? "desconhecida";
        const resultado = await service.concluirSetup(body, origem);
        if (!resultado.ok) {
          const { status: code, body: payload } = AUTH_FAILURES[resultado.failure];
          return status(
            code,
            resultado.detail === undefined ? payload : { ...payload, message: resultado.detail },
          );
        }
        const { user, token, expiraEm } = resultado.value;
        cookie[SESSION_COOKIE]?.set({ ...COOKIE_BASE, secure: cookieSecuro(request), value: token, expires: expiraEm });
        return { user };
      },
      {
        body: SetupRequest,
        response: {
          200: MeResponse,
          401: ErrorResponse,
          409: ErrorResponse,
          429: ErrorResponse,
        },
      },
    )
    .post(
      "/login",
      async ({ body, cookie, status, server, request }) => {
        // Chave de origem do rate limit. Sem proxy confiável configurado, o IP
        // do socket é o que existe — e `X-Forwarded-For` vindo do cliente é
        // controlado pelo atacante, então **não** é usado aqui.
        const origem = server?.requestIP(request)?.address ?? "desconhecida";

        const resultado = await service.login(body, origem);
        if (!resultado.ok) {
          const { status: code, body: payload } = AUTH_FAILURES[resultado.failure];
          return status(
            code,
            resultado.detail === undefined
              ? payload
              : { ...payload, message: `${payload.message} — ${resultado.detail}` },
          );
        }

        const { user, token, expiraEm } = resultado.value;
        cookie[SESSION_COOKIE]?.set({ ...COOKIE_BASE, secure: cookieSecuro(request), value: token, expires: expiraEm });
        return { user };
      },
      {
        body: LoginRequest,
        response: { 200: MeResponse, 401: ErrorResponse, 429: ErrorResponse },
      },
    )

    .post(
      "/logout",
      ({ sessao, cookie }) => {
        // A ordem importa pouco, mas as duas partes importam: apagar só o
        // cookie deixaria o token válido para quem tiver uma cópia dele.
        if (sessao !== null) service.logout(sessao.tokenHash);
        cookie[SESSION_COOKIE]?.remove();
        return { ok: true } as const;
      },
      { response: { 200: LogoutResponse, 401: ErrorResponse, 403: ErrorResponse } },
    )

    .get("/me", ({ sessao, status }) => {
      if (sessao === null) {
        const { status: code, body } = AUTH_FAILURES.unauthenticated;
        return status(code, body);
      }
      return { user: sessao.user };
    }, {
      response: { 200: MeResponse, 401: ErrorResponse, 403: ErrorResponse },
    })

    .post(
      "/password",
      async ({ sessao, body, cookie, status }) => {
        if (sessao === null) {
          const { status: code, body: payload } = AUTH_FAILURES.unauthenticated;
          return status(code, payload);
        }

        const resultado = await service.trocarSenha(
          sessao.user.id,
          body.currentPassword,
          body.newPassword,
        );
        if (!resultado.ok) {
          const { status: code, body: payload } = AUTH_FAILURES[resultado.failure];
          return status(
            code,
            resultado.detail === undefined
              ? payload
              : { ...payload, message: resultado.detail },
          );
        }

        // A troca derrubou **todas** as sessões, inclusive esta. Deixar o
        // cookie no navegador apontaria para uma sessão que já não existe, e a
        // próxima requisição daria 401 sem explicação.
        cookie[SESSION_COOKIE]?.remove();
        return { user: resultado.value };
      },
      {
        body: ChangePasswordRequest,
        response: {
          200: MeResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          422: t.Object({ code: t.String(), message: t.String() }),
          429: ErrorResponse,
        },
      },
    )

    /**
     * Troca o idioma da UI. Preferência, não segredo: não derruba sessão nem
     * mexe em cookie. Devolve o usuário atualizado para o front reidratar.
     */
    .patch(
      "/locale",
      ({ sessao, body, status }) => {
        if (sessao === null) {
          const { status: code, body: payload } = AUTH_FAILURES.unauthenticated;
          return status(code, payload);
        }
        const resultado = service.definirIdioma(sessao.user.id, body.locale);
        if (!resultado.ok) {
          const { status: code, body: payload } = AUTH_FAILURES[resultado.failure];
          return status(code, payload);
        }
        return { user: resultado.value };
      },
      {
        body: LocaleRequest,
        response: { 200: MeResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    );
