import { Elysia, t } from "elysia";

import {
  Connection,
  CreateConnection,
  ErrorResponse,
  TestConnectionResult,
  UpdateConnection,
} from "@dbee/shared";

import type { ConnectionsService } from "../services/connections.service";

import { FAILURES } from "./failures";

const idParam = t.Object({ id: t.String() });

/**
 * Adaptador HTTP do domínio de conexões (DBee.md §5).
 *
 * A rota não abre conexão no Postgres nem toca no SQLite: ela valida entrada,
 * chama o serviço e mapeia o resultado para status. A sessão é exigida pelo
 * guard global, antes de qualquer handler daqui rodar.
 */
export const connectionsRoutes = (service: ConnectionsService) =>
  new Elysia({ prefix: "/connections" })
    .get("/", () => service.list(), {
      response: { 200: t.Array(Connection), 401: ErrorResponse, 403: ErrorResponse },
    })

    .post("/", ({ body, status }) => status(201, service.create(body)), {
      body: CreateConnection,
      response: { 201: Connection, 401: ErrorResponse, 403: ErrorResponse },
    })

    .patch(
      "/:id",
      ({ params, body, status }) => {
        const result = service.update(params.id, body);
        if (result.ok) return result.value;
        const { status: code, body: payload } = FAILURES[result.failure];
        return status(code, payload);
      },
      {
        params: idParam,
        body: UpdateConnection,
        response: {
          200: Connection,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    )

    .delete(
      "/:id",
      ({ params, status }) => {
        const result = service.remove(params.id);
        if (result.ok) return status(204, undefined);
        const { status: code, body: payload } = FAILURES[result.failure];
        return status(code, payload);
      },
      {
        params: idParam,
        response: {
          204: t.Void(),
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    )

    .post(
      "/:id/test",
      async ({ params, status }) => {
        const result = await service.test(params.id);
        if (result.ok) return result.value;
        const { status: code, body: payload } = FAILURES[result.failure];
        return status(code, payload);
      },
      {
        params: idParam,
        // Sem `body` declarado, a rota aceita form-urlencoded — que é *simple
        // request* e não dispara preflight, então uma página qualquer conseguia
        // acioná-la por CSRF. Exigir corpo vazio em JSON fecha isso já, antes
        // de existir cookie de sessão.
        body: t.Optional(t.Object({})),
        response: {
          200: TestConnectionResult,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
