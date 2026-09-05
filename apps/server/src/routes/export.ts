import { Elysia, t } from "elysia";

import { ErrorResponse, ExportRequest } from "@dbee/shared";

import type { ExportService } from "../services/export.service";
import type { UsersRepository } from "../db/users.repo";
import { FAILURES } from "./failures";
import { exigirAtor, sessionContext } from "./guard";

/**
 * Export em stream (DBee.md §5).
 *
 * A resposta é um `Response` cru com `ReadableStream`: o corpo começa a sair
 * antes de a última linha existir, que é o ponto inteiro do streaming. Por isso
 * a rota não declara `response` de schema — o corpo não é JSON validável.
 */
export const exportRoutes = (service: ExportService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    // Para o **tipo** de `sessao` chegar aos handlers. O guard já derivou o
    // valor globalmente e o Elysia deduplica por nome — sem segunda consulta.
    .use(sessionContext(users))
    .post(
    "/:id/export",
    async ({ params, body, status, sessao }) => {
      const result = await service.export(params.id, body, exigirAtor(sessao));

      if (!result.ok) {
        const { status: code, body: payload } = FAILURES[result.failure];
        return status(
          code,
          result.detail === undefined ? payload : { ...payload, message: result.detail },
        );
      }

      return new Response(result.value.stream, {
        headers: {
          "content-type": result.value.contentType,
          "content-disposition": `attachment; filename="${result.value.filename}"`,
          // Sem content-length: o tamanho não é conhecido antes de terminar, e
          // é exatamente isso que permite não materializar tudo antes.
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    },
    {
      params: t.Object({ id: t.String() }),
      body: ExportRequest,
      response: {
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
        502: ErrorResponse,
      },
    },
  );
