import { Elysia, t } from "elysia";

import { ErrorResponse, ExplainRequest, ExplainResponse } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { ExplainService } from "../services/explain.service";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * EXPLAIN visual (ADR 017). Erro do Postgres vem no 200 (`error`), como em
 * `/query`; recusa de regra (engine, ANALYZE sem escrita) é 400 com o motivo.
 */
export const explainRoutes = (service: ExplainService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    .use(sessionContext(users))
    .post(
      "/:id/explain",
      async ({ params, body, sessao, status }) => {
        const r = await service.explicar(params.id, body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, r.detail === undefined ? payload : { ...payload, message: r.detail });
      },
      {
        params: t.Object({ id: t.String() }),
        body: ExplainRequest,
        response: {
          200: ExplainResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
