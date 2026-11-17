import { Elysia, t } from "elysia";

import {
  ErrorResponse,
  ValueSearchCancelRequest,
  ValueSearchCancelResponse,
  ValueSearchRequest,
  ValueSearchResponse,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { BuscaValorService } from "../services/buscaValor.service";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/** Buscar valor no banco (ADR 023). Escopo obrigatório, `READ ONLY`, tetos fixos. */
export const buscaValorRoutes = (service: BuscaValorService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    .use(sessionContext(users))
    .post(
      "/:id/value-search",
      async ({ params, body, sessao, status }) => {
        const r = await service.buscar(params.id, body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, r.detail === undefined ? payload : { ...payload, message: r.detail });
      },
      {
        params: t.Object({ id: t.String() }),
        body: ValueSearchRequest,
        response: {
          200: ValueSearchResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    )
    .post(
      "/:id/value-search/cancel",
      async ({ params, body, sessao, status }) => {
        const r = await service.cancelar(params.id, body.queryId, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, payload);
      },
      {
        params: t.Object({ id: t.String() }),
        body: ValueSearchCancelRequest,
        response: {
          200: ValueSearchCancelResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
