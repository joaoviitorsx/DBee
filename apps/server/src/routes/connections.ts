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
 * chama o serviço e mapeia o resultado para status. Sem autenticação ainda.
 */
export const connectionsRoutes = (service: ConnectionsService) =>
  new Elysia({ prefix: "/connections" })
    .get("/", () => service.list(), { response: t.Array(Connection) })

    .post("/", ({ body, status }) => status(201, service.create(body)), {
      body: CreateConnection,
      response: { 201: Connection },
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
        response: { 200: Connection, 404: ErrorResponse, 500: ErrorResponse, 502: ErrorResponse },
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
        response: { 204: t.Void(), 404: ErrorResponse, 500: ErrorResponse, 502: ErrorResponse },
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
        response: { 200: TestConnectionResult, 404: ErrorResponse, 500: ErrorResponse, 502: ErrorResponse },
      },
    );
