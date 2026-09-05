import { Elysia, t } from "elysia";

import { DatabaseInfo, DatabaseSchema, DatabaseTree, ErrorResponse , ActivityList, DatabasesOverview } from "@dbee/shared";

import type { SchemaService } from "../services/schema.service";
import { FAILURES } from "./failures";

const idParam = t.Object({ id: t.String() });

/**
 * Introspecção (DBee.md §5). Toda leitura acontece em `BEGIN READ ONLY`.
 *
 * - `/:id/databases` — databases do cluster, primeiro nível da árvore.
 * - `/:id/schema` — árvore do database; `?database=X` escolhe qual (sem ele,
 *   o da conexão), `?refresh=1` ignora o cache.
 */
export const schemaRoutes = (service: SchemaService) =>
  new Elysia({ prefix: "/connections" })
    .get(
      "/:id/databases",
      async ({ params, status }) => {
        const result = await service.databases(params.id);
        if (result.ok) return result.value;

        const { status: code, body } = FAILURES[result.failure];
        return status(
          code,
          result.detail === undefined ? body : { ...body, message: result.detail },
        );
      },
      {
        params: idParam,
        response: {
          200: t.Array(DatabaseInfo),
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    )
    .get(
      "/:id/databases/overview",
      async ({ params, status }) => {
        const result = await service.databasesOverview(params.id);
        if (result.ok) return result.value;
        const { status: code, body } = FAILURES[result.failure];
        return status(code, result.detail === undefined ? body : { ...body, message: result.detail });
      },
      {
        params: idParam,
        response: {
          200: DatabasesOverview,
          400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse,
          404: ErrorResponse, 500: ErrorResponse, 502: ErrorResponse,
        },
      },
    )
    .get(
      "/:id/activity",
      async ({ params, status }) => {
        const result = await service.activity(params.id);
        if (result.ok) return result.value;
        const { status: code, body } = FAILURES[result.failure];
        return status(code, result.detail === undefined ? body : { ...body, message: result.detail });
      },
      {
        params: idParam,
        response: {
          200: ActivityList,
          400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse,
          404: ErrorResponse, 500: ErrorResponse, 502: ErrorResponse,
        },
      },
    )
    .get(
      "/:id/schema/tree",
      async ({ params, query, status }) => {
        const result = await service.tree(params.id, query.database, query.refresh === "1");
        if (result.ok) return result.value;
        const { status: code, body } = FAILURES[result.failure];
        return status(
          code,
          result.detail === undefined ? body : { ...body, message: result.detail },
        );
      },
      {
        params: idParam,
        query: t.Object({
          database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          refresh: t.Optional(t.Union([t.Literal("1"), t.Literal("0")])),
        }),
        response: {
          200: DatabaseTree,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    )
    .get(
      "/:id/schema",
      async ({ params, query, status }) => {
        const result = await service.get(params.id, query.database, query.refresh === "1");
        if (result.ok) return result.value;

        const { status: code, body } = FAILURES[result.failure];
        // Erro do Postgres vai inteiro para a UI, não engolido (CLAUDE.md).
        return status(
          code,
          result.detail === undefined ? body : { ...body, message: result.detail },
        );
      },
      {
        params: idParam,
        query: t.Object({
          database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          refresh: t.Optional(t.Union([t.Literal("1"), t.Literal("0")])),
        }),
        response: {
          200: DatabaseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
