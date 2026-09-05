import { Elysia, t } from "elysia";

import { ErrorResponse, QueryLogEntry, QueryRequest, QueryResponse } from "@dbee/shared";

import type { QueryService } from "../services/query.service";
import { FAILURES } from "./failures";

/**
 * Execução de query (DBee.md §5, §6).
 *
 * A rota não decide nada sobre o SQL: valida a entrada, chama o serviço e
 * traduz falha em status. Erro do Postgres vem dentro do 200, no corpo — ele é
 * resultado da execução, não falha da API, e a UI precisa dele inteiro para
 * destacar a posição no editor.
 */
export const queryRoutes = (service: QueryService) =>
  new Elysia({ prefix: "/connections" })
    .post(
      "/:id/query",
      async ({ params, body, status }) => {
        const result = await service.run(params.id, body);
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
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
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
