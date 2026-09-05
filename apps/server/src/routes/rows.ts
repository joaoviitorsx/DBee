import { Elysia, t } from "elysia";

import { ErrorResponse, RowsRequest, RowsResponse } from "@dbee/shared";

import type { RowsService } from "../services/rows.service";
import type { UsersRepository } from "../db/users.repo";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Linhas de uma relação, com keyset (DBee.md §5).
 *
 * `POST` e não `GET`: o corpo carrega filtros e o cursor, que são estruturas
 * aninhadas. Continua sendo leitura — `BEGIN READ ONLY`, e nada muda no banco.
 */
export const rowsRoutes = (service: RowsService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    // Para o **tipo** de `sessao` chegar aos handlers. O guard já derivou o
    // valor globalmente e o Elysia deduplica por nome — sem segunda consulta.
    .use(sessionContext(users))
    .post(
    "/:id/tables/:schema/:table/rows",
    async ({ params, body, status, sessao }) => {
      const result = await service.read(params.id, params.schema, params.table, body, exigirAtor(sessao));
      if (result.ok) return result.value;

      const { status: code, body: payload } = FAILURES[result.failure];
      return status(
        code,
        result.detail === undefined ? payload : { ...payload, message: result.detail },
      );
    },
    {
      params: t.Object({
        id: t.String(),
        // 63 é o limite de identificador do Postgres.
        schema: t.String({ minLength: 1, maxLength: 63 }),
        table: t.String({ minLength: 1, maxLength: 63 }),
      }),
      body: RowsRequest,
      response: {
        200: RowsResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
        502: ErrorResponse,
      },
    },
  );
