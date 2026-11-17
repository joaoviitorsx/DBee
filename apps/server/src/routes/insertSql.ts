import { Elysia, t } from "elysia";

import { ErrorResponse, InsertSqlRequest, InsertSqlResponse } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { InsertSqlService } from "../services/insertSql.service";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/** "Copiar como INSERT": devolve texto, não executa. */
export const insertSqlRoutes = (service: InsertSqlService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    .use(sessionContext(users))
    .post(
      "/:id/tables/:schema/:table/insert-sql",
      async ({ params, body, sessao, status }) => {
        const r = await service.gerar(params.id, params.schema, params.table, body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, r.detail === undefined ? payload : { ...payload, message: r.detail });
      },
      {
        params: t.Object({ id: t.String(), schema: t.String(), table: t.String() }),
        body: InsertSqlRequest,
        response: {
          200: InsertSqlResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
