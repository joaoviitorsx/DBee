import { Elysia } from "elysia";

import { AuditPage, AuditQuery, ErrorResponse } from "@dbee/shared";

import type { AuditService } from "../services/audit.service";

/**
 * Auditoria (DBee.md §2.4, v0.2) — leitura do `query_log`.
 *
 * Só-leitura, sem `actor`: consultar o log não vira linha no log. A sessão é
 * exigida pelo guard global (não está em `ROTAS_ABERTAS`), então nenhum handler
 * daqui roda sem usuário.
 */
export const auditRoutes = (service: AuditService) =>
  new Elysia({ prefix: "/audit" }).get("/", ({ query }) => service.search(query), {
    query: AuditQuery,
    response: { 200: AuditPage, 401: ErrorResponse, 403: ErrorResponse },
  });
