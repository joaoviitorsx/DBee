import { Elysia, t } from "elysia";

import { CopyTableRequest, CopyTableResponse, ErrorResponse } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { CopiaTabelaService } from "../services/copiaTabela.service";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/** "Copiar tabela para…": devolve script, não executa (ADR 018). */
export const copiaTabelaRoutes = (service: CopiaTabelaService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    .use(sessionContext(users))
    .post(
      "/:id/tables/:schema/:table/copy-script",
      async ({ params, body, sessao, status }) => {
        const r = await service.gerar(params.id, params.schema, params.table, body, exigirAtor(sessao));
        if (r.ok) return r.value;
        const { status: code, body: payload } = FAILURES[r.failure];
        return status(code, r.detail === undefined ? payload : { ...payload, message: r.detail });
      },
      {
        params: t.Object({ id: t.String(), schema: t.String(), table: t.String() }),
        body: CopyTableRequest,
        response: {
          200: CopyTableResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
