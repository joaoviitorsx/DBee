import { Elysia, t } from "elysia";

import { DatabaseInfo, DatabaseSchema, DatabaseTree, ErrorResponse , ActivityList, DatabasesOverview } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { SchemaService } from "../services/schema.service";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

const idParam = t.Object({ id: t.String() });

/**
 * Introspecção (DBee.md §5). Toda leitura acontece em `BEGIN READ ONLY`.
 *
 * - `/:id/databases` — databases do cluster, primeiro nível da árvore.
 * - `/:id/schema` — árvore do database; `?database=X` escolhe qual (sem ele,
 *   o da conexão), `?refresh=1` ignora o cache.
 */
export const schemaRoutes = (service: SchemaService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    // Para o **tipo** da sessão chegar aos handlers; o guard já derivou o valor.
    // Desde a permissão por conexão (migração 005) a introspecção também
    // precisa saber quem pergunta: um `member` só enxerga o que lhe foi
    // concedido, e é o `resolve` lá embaixo que recusa.
    .use(sessionContext(users))
    .get(
      "/:id/databases",
      async ({ params, sessao, status }) => {
        const result = await service.databases(params.id, exigirAtor(sessao));
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
      async ({ params, sessao, status }) => {
        const result = await service.databasesOverview(params.id, exigirAtor(sessao));
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
      async ({ params, sessao, status }) => {
        const result = await service.activity(params.id, exigirAtor(sessao));
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
      async ({ params, query, sessao, status }) => {
        const result = await service.tree(params.id, query.database, query.refresh === "1", exigirAtor(sessao));
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
      async ({ params, query, sessao, status }) => {
        const result = await service.get(params.id, query.database, query.refresh === "1", exigirAtor(sessao));
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
