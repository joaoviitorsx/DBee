import { Elysia, t } from "elysia";

import { ErrorResponse, RowDeleteRequest, RowMutationResult, RowUpdateRequest } from "@dbee/shared";

import type { MutationService } from "../services/mutation.service";
import type { UsersRepository } from "../db/users.repo";
import { MUTATION_FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Edição de linha — UPDATE de célula e DELETE de linha (v0.2).
 *
 * O corpo carrega o alvo (schema, tabela, PK) e a intenção explícita de escrita
 * (`readOnly: false`, exigido pelo schema). O `actor` vem da sessão e vai ao
 * `query_log` no serviço. Nada de DDL por aqui: só DML de uma linha, provada
 * pela cardinalidade antes do commit.
 */
const respostas = {
  200: RowMutationResult,
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  409: ErrorResponse,
  500: ErrorResponse,
  502: ErrorResponse,
} as const;

export const mutationRoutes = (service: MutationService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    .use(sessionContext(users))
    .post(
      "/:id/rows/update",
      async ({ params, body, status, sessao }) => {
        const result = await service.update(params.id, body, exigirAtor(sessao));
        if (result.ok) return result.value;
        const { status: code, body: payload } = MUTATION_FAILURES[result.failure];
        return status(
          code,
          result.detail === undefined ? payload : { ...payload, message: result.detail },
        );
      },
      { params: t.Object({ id: t.String() }), body: RowUpdateRequest, response: respostas },
    )
    .post(
      "/:id/rows/delete",
      async ({ params, body, status, sessao }) => {
        const result = await service.delete(params.id, body, exigirAtor(sessao));
        if (result.ok) return result.value;
        const { status: code, body: payload } = MUTATION_FAILURES[result.failure];
        return status(
          code,
          result.detail === undefined ? payload : { ...payload, message: result.detail },
        );
      },
      { params: t.Object({ id: t.String() }), body: RowDeleteRequest, response: respostas },
    );
