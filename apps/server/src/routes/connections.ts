import { Elysia, t } from "elysia";

import {
  Connection,
  CreateConnection,
  ErrorResponse,
  TestConnectionResult,
  UpdateConnection,
} from "@dbee/shared";

import type { ConnectionsService, ServiceFailure } from "../services/connections.service";

/** Único ponto que traduz falha de domínio em status HTTP. */
const FAILURES: Record<ServiceFailure, { status: 404 | 500; body: { code: string; message: string } }> = {
  not_found: {
    status: 404,
    body: { code: "connection_not_found", message: "conexão não encontrada" },
  },
  decryption_failed: {
    status: 500,
    body: {
      code: "decryption_failed",
      message:
        "não foi possível decifrar a senha desta conexão — APP_SECRET pode ter mudado (ver DBee.md §11.5)",
    },
  },
};

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
        response: { 200: Connection, 404: ErrorResponse, 500: ErrorResponse },
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
        response: { 204: t.Void(), 404: ErrorResponse, 500: ErrorResponse },
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
        response: { 200: TestConnectionResult, 404: ErrorResponse, 500: ErrorResponse },
      },
    );
