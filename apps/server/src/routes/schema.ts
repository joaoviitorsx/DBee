import { Elysia, t } from "elysia";

import { DatabaseSchema, ErrorResponse } from "@dbee/shared";

import type { SchemaService } from "../services/schema.service";
import { FAILURES } from "./failures";

/**
 * Árvore de schema de um database (DBee.md §5).
 *
 * `?database=X` escolhe o database do cluster; sem ele, usa o da conexão.
 * `?refresh=1` ignora o cache. Toda leitura acontece em `BEGIN READ ONLY`.
 */
export const schemaRoutes = (service: SchemaService) =>
  new Elysia({ prefix: "/connections" }).get(
    "/:id/schema",
    async ({ params, query, status }) => {
      const result = await service.get(params.id, query.database, query.refresh === "1");
      if (result.ok) return result.value;

      const { status: code, body } = FAILURES[result.failure];
      // Erro do Postgres vai inteiro para a UI, não engolido (CLAUDE.md).
      return status(code, result.detail === undefined ? body : { ...body, message: result.detail });
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        refresh: t.Optional(t.Union([t.Literal("1"), t.Literal("0")])),
      }),
      response: {
        200: DatabaseSchema,
        404: ErrorResponse,
        500: ErrorResponse,
        502: ErrorResponse,
      },
    },
  );
