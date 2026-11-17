import { Elysia } from "elysia";

import {
  DataCompareRequest,
  DataCompareResponse,
  ErrorResponse,
  SchemaCompareRequest,
  SchemaCompareResponse,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { CompareService } from "../services/compare.service";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Data compare e schema compare (ADR 018). Só leitura; o SQL volta como texto.
 * `POST` porque o corpo descreve dois lados — nada é alterado.
 */
export const compareRoutes = (service: CompareService, users: UsersRepository) =>
  new Elysia({ prefix: "/compare" })
    .use(sessionContext(users))
    .post(
      "/data",
      async ({ body, sessao, status }) => {
        const r = await service.dados(body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, r.detail === undefined ? payload : { ...payload, message: r.detail });
      },
      { body: DataCompareRequest, response: {
          200: DataCompareResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        }, },
    )
    .post(
      "/schema",
      async ({ body, sessao, status }) => {
        const r = await service.schemas(body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, r.detail === undefined ? payload : { ...payload, message: r.detail });
      },
      { body: SchemaCompareRequest, response: {
          200: SchemaCompareResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        }, },
    );
