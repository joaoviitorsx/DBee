import { Elysia, t } from "elysia";

import { ErrorResponse, RowsRequest, RowsResponse } from "@dbee/shared";

import type { RowsService } from "../services/rows.service";
import { FAILURES } from "./failures";

/**
 * Linhas de uma relação, com keyset (DBee.md §5).
 *
 * `POST` e não `GET`: o corpo carrega filtros e o cursor, que são estruturas
 * aninhadas. Continua sendo leitura — `BEGIN READ ONLY`, e nada muda no banco.
 */
export const rowsRoutes = (service: RowsService) =>
  new Elysia({ prefix: "/connections" }).post(
    "/:id/tables/:schema/:table/rows",
    async ({ params, body, status }) => {
      const result = await service.read(params.id, params.schema, params.table, body);
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
        404: ErrorResponse,
        500: ErrorResponse,
        502: ErrorResponse,
      },
    },
  );
