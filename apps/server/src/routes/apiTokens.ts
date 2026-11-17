import { Elysia, t } from "elysia";

import {
  ApiTokenList,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
  ErrorResponse,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { ApiTokensService } from "../services/apiTokens.service";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Tokens pessoais do MCP (ADR 015). Por **sessão de navegador**: o Bearer não
 * vale aqui (o guard só o aceita em `/api/mcp`), então um token vazado não
 * cria outro token nem desfaz a própria revogação.
 *
 * Cada um vê e cria os seus. Revogar: o dono, ou um admin (token de quem saiu).
 */
export const apiTokensRoutes = (service: ApiTokensService, users: UsersRepository) =>
  new Elysia({ prefix: "/tokens" })
    .use(sessionContext(users))
    .get("/", ({ sessao }) => service.listar(exigirAtor(sessao).id), {
      response: { 200: ApiTokenList, 401: ErrorResponse, 403: ErrorResponse },
    })
    .post("/", ({ body, sessao }) => service.criar(exigirAtor(sessao).id, body.name), {
      body: CreateApiTokenRequest,
      response: { 200: CreateApiTokenResponse, 401: ErrorResponse, 403: ErrorResponse },
    })
    .delete(
      "/:id",
      ({ params, sessao, status }) => {
        if (!service.revogar(params.id, exigirAtor(sessao))) {
          return status(404, { code: "token_not_found", message: "token não encontrado" });
        }
        return { revoked: true as const };
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: t.Object({ revoked: t.Literal(true) }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    );
