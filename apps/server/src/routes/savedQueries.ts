import { Elysia, t } from "elysia";

import {
  ErrorResponse,
  RenameQueryRequest,
  SaveQueryRequest,
  SavedQuery,
  SavedQueryList,
} from "@dbee/shared";

import type { SavedQueriesRepository } from "../db/savedQueries.repo";

/**
 * Queries salvas (DBee.md §5). CRUD simples sobre `saved_queries`.
 *
 * A sessão é exigida pelo guard global (não está em `ROTAS_ABERTAS`). Lista
 * global — sem `actor`, sem dono: a fatia é "ligar a tabela que já existe", não
 * introduzir compartilhamento entre usuários.
 */
export const savedQueriesRoutes = (repo: SavedQueriesRepository) =>
  new Elysia({ prefix: "/saved-queries" })
    .get("/", ({ query }) => repo.listar(query.q ?? null), {
      query: t.Object({ q: t.Optional(t.String({ maxLength: 200 })) }),
      response: { 200: SavedQueryList, 401: ErrorResponse, 403: ErrorResponse },
    })
    .post("/", ({ body }) => repo.criar(body.name, body.sql, body.connectionId ?? null), {
      body: SaveQueryRequest,
      response: { 200: SavedQuery, 401: ErrorResponse, 403: ErrorResponse },
    })
    .patch(
      "/:id",
      ({ params, body, status }) => {
        const atualizado = repo.renomear(params.id, body.name);
        if (atualizado === null) {
          return status(404, { code: "not_found", message: "query salva não encontrada" });
        }
        return atualizado;
      },
      {
        params: t.Object({ id: t.String() }),
        body: RenameQueryRequest,
        response: { 200: SavedQuery, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    )
    .delete(
      "/:id",
      ({ params, status }) => {
        if (!repo.excluir(params.id)) {
          return status(404, { code: "not_found", message: "query salva não encontrada" });
        }
        return { ok: true } as const;
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: t.Object({ ok: t.Literal(true) }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    );
