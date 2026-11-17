import { Elysia, t } from "elysia";

import { ColumnStatsRequest, ColumnStatsResponse, ErrorResponse } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { StatsService } from "../services/stats.service";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/** Estatística rápida de coluna (clique no cabeçalho da aba Dados). */
export const statsRoutes = (service: StatsService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    .use(sessionContext(users))
    .post(
      "/:id/tables/:schema/:table/stats",
      async ({ params, body, sessao, status }) => {
        const r = await service.coluna(params.id, params.schema, params.table, body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, r.detail === undefined ? payload : { ...payload, message: r.detail });
      },
      {
        params: t.Object({ id: t.String(), schema: t.String(), table: t.String() }),
        body: ColumnStatsRequest,
        response: {
          200: ColumnStatsResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
