import { Elysia, t } from "elysia";

import {
  ChangePasswordRequest,
  ErrorResponse,
  LocaleRequest,
  LoginRequest,
  LogoutResponse,
  MeResponse,
  SESSION_COOKIE,
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
 * - `secure` — o navegador só manda por HTTPS. **Vale também em
 *   `http://localhost`**, que os navegadores tratam como origem confiável
 *   justamente para o desenvolvimento não precisar afrouxar isto. Conferido no
 *   Chrome, não presumido.
 * - `path: "/"` — vale para `/api` e para o front servido na raiz.
 */
const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "strict",
  secure: true,
  path: "/",
} as const;

export const authRoutes = (service: AuthService, users: UsersRepository) =>
  new Elysia({ prefix: "/auth" })
    // O guard já derivou a sessão globalmente; o `use` aqui é para o **tipo**
    // dela chegar nestes handlers. O Elysia deduplica por `name`, então não há
    // segunda consulta ao SQLite.
    .use(sessionContext(users))
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
        cookie[SESSION_COOKIE]?.set({ ...COOKIE_BASE, value: token, expires: expiraEm });
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
