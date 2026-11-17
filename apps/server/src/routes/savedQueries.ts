import { Elysia, t } from "elysia";

import {
  ErrorResponse,
  SaveQueryRequest,
  SavedQuery,
  SavedQueryList,
  UpdateSavedQueryRequest,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { SavedQueriesService } from "../services/savedQueries.service";
import { SAVED_QUERY_FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Queries salvas (DBee.md §5, ADR 016). Dono e visibilidade são regra do
 * serviço; a rota só lê o ator da sessão e traduz a falha.
 */
export const savedQueriesRoutes = (service: SavedQueriesService, users: UsersRepository) =>
  new Elysia({ prefix: "/saved-queries" })
    .use(sessionContext(users))
    .get("/", ({ query, sessao }) => service.listar(exigirAtor(sessao), query.q ?? null), {
      query: t.Object({ q: t.Optional(t.String({ maxLength: 200 })) }),
      response: { 200: SavedQueryList, 401: ErrorResponse, 403: ErrorResponse },
    })
    .get(
      "/:id",
      ({ params, sessao, status }) => {
        const r = service.obter(params.id, exigirAtor(sessao));
        if (r.ok) return r.value;
        const f = SAVED_QUERY_FAILURES[r.failure];
        return status(f.status, f.body);
      },
      {
        params: t.Object({ id: t.String({ maxLength: 64 }) }),
        response: { 200: SavedQuery, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    )
    .post(
      "/",
      ({ body, sessao, status }) => {
        const r = service.criar(body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const f = SAVED_QUERY_FAILURES[r.failure];
        return status(f.status, f.body);
      },
      {
        body: SaveQueryRequest,
        response: { 200: SavedQuery, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    )
    .patch(
      "/:id",
      ({ params, body, sessao, status }) => {
        const r = service.atualizar(params.id, body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const f = SAVED_QUERY_FAILURES[r.failure];
        return status(f.status, f.body);
      },
      {
        params: t.Object({ id: t.String({ maxLength: 64 }) }),
        body: UpdateSavedQueryRequest,
        response: { 200: SavedQuery, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    )
    .delete(
      "/:id",
      ({ params, sessao, status }) => {
        const r = service.excluir(params.id, exigirAtor(sessao));
        if (r.ok) return { ok: true } as const;
        const f = SAVED_QUERY_FAILURES[r.failure];
        return status(f.status, f.body);
      },
      {
        params: t.Object({ id: t.String({ maxLength: 64 }) }),
        response: {
          200: t.Object({ ok: t.Literal(true) }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    );
