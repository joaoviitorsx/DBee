import { Elysia, t } from "elysia";

import {
  CancelRequest,
  CancelResponse,
  ErrorResponse,
  QueryLogEntry,
  QueryRequest,
  QueryResponse,
} from "@dbee/shared";

import type { QueryService } from "../services/query.service";
import type { UsersRepository } from "../db/users.repo";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Execução de query (DBee.md §5, §6).
 *
 * A rota não decide nada sobre o SQL: valida a entrada, chama o serviço e
 * traduz falha em status. Erro do Postgres vem dentro do 200, no corpo — ele é
 * resultado da execução, não falha da API, e a UI precisa dele inteiro para
 * destacar a posição no editor.
 */
export const queryRoutes = (service: QueryService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    // Para o **tipo** de `sessao` chegar aos handlers. O guard já derivou o
    // valor globalmente e o Elysia deduplica por nome — sem segunda consulta.
    .use(sessionContext(users))
    .post(
      "/:id/query",
      async ({ params, body, status, sessao }) => {
        const result = await service.run(params.id, body, exigirAtor(sessao));
        if (result.ok) return result.value;

        const { status: code, body: payload } = FAILURES[result.failure];
        return status(
          code,
          result.detail === undefined ? payload : { ...payload, message: result.detail },
        );
      },
      {
        params: t.Object({ id: t.String() }),
        body: QueryRequest,
        response: {
          200: QueryResponse,
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
      "/:id/query/cancel",
      // Sem `actor`: cancelar não é execução — a query cancelada é que registra
      // seu próprio `cancelled` no log. A sessão vem do guard global.
      ({ params, body }) => service.cancelar(params.id, body.queryId),
      {
        params: t.Object({ id: t.String() }),
        body: CancelRequest,
        response: { 200: CancelResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    )
    .get(
      "/:id/history",
      ({ params, query }) => service.history(query.limit ?? 100, params.id),
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({ limit: t.Optional(t.Integer({ minimum: 1, maximum: 1000 })) }),
        response: { 200: t.Array(QueryLogEntry) },
      },
    );
