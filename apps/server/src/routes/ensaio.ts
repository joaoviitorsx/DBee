import { Elysia, t } from "elysia";

import { ApplyRequest, ApplyResponse, DryRunRequest, DryRunResponse, ErrorResponse } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { EnsaioService } from "../services/ensaio.service";
import { ENSAIO_FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Ensaio de escrita e aplicação conferida (ADR 021). Como em `/query`, erro de
 * SQL volta no 200 (é resultado da execução); 409 é a divergência do ensaio.
 */

export const ensaioRoutes = (service: EnsaioService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    .use(sessionContext(users))
    .post(
      "/:id/query/dry-run",
      async ({ params, body, status, sessao }) => {
        const result = await service.ensaiar(params.id, body, exigirAtor(sessao));
        if (result.ok) return result.value;
        const { status: code, body: payload } = ENSAIO_FAILURES[result.failure];
        return status(code, result.detail === undefined ? payload : { ...payload, message: result.detail });
      },
      {
        params: t.Object({ id: t.String() }),
        body: DryRunRequest,
        response: {
          200: DryRunResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    )
    .post(
      "/:id/query/apply",
      async ({ params, body, status, sessao }) => {
        const result = await service.aplicar(params.id, body, exigirAtor(sessao));
        if (result.ok) return result.value;
        const { status: code, body: payload } = ENSAIO_FAILURES[result.failure];
        return status(code, result.detail === undefined ? payload : { ...payload, message: result.detail });
      },
      {
        params: t.Object({ id: t.String() }),
        body: ApplyRequest,
        response: {
          200: ApplyResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
