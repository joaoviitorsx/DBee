import { Elysia } from "elysia";

import { AuditPage, AuditQuery, ErrorResponse } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { AuditService } from "../services/audit.service";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Auditoria (DBee.md §2.4, v0.2) — leitura do `query_log`.
 *
 * Consultar o log **não** vira linha no log — por isso não há `actor` de
 * escrita aqui. Mas há ator de **leitura**: desde a permissão por conexão
 * (migração 005) o log é recortado ao que a pessoa enxerga, senão um `member`
 * leria o SQL de conexões que nem aparecem na árvore dele.
 *
 * A sessão é exigida pelo guard global (não está em `ROTAS_ABERTAS`), então
 * nenhum handler daqui roda sem usuário.
 */
export const auditRoutes = (service: AuditService, users: UsersRepository) =>
  new Elysia({ prefix: "/audit" })
    .use(sessionContext(users))
    .get("/", ({ query, sessao }) => service.search(query, exigirAtor(sessao)), {
      query: AuditQuery,
      response: { 200: AuditPage, 401: ErrorResponse, 403: ErrorResponse },
    });
