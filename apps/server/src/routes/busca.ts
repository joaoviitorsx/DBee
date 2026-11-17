import { Elysia } from "elysia";

import { ErrorResponse, SearchQuery, SearchResponse } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { BuscaService } from "../services/busca.service";
import { exigirAtor, sessionContext } from "./guard";

/** Busca global por nome no catálogo em cache (roadmap item 9). Não toca em banco. */
export const buscaRoutes = (service: BuscaService, users: UsersRepository) =>
  new Elysia({ prefix: "/search" })
    .use(sessionContext(users))
    .get("/", ({ query, sessao }) => service.buscar(query.q, query.limit ?? 50, exigirAtor(sessao)), {
      query: SearchQuery,
      response: { 200: SearchResponse, 401: ErrorResponse, 403: ErrorResponse },
    });
