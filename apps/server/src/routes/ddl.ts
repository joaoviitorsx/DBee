import { Elysia, t } from "elysia";

import {
  CreateDatabaseRequest,
  CreateTableRequest,
  DdlResult,
  ErrorResponse,
} from "@dbee/shared";
import type { DdlResult as DdlResultType } from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { FalhaDdl, ResultadoDdl } from "../services/ddl.service";
import type { DdlService } from "../services/ddl.service";
import { exigirAtor, sessionContext } from "./guard";

/**
 * DDL aditivo (DBee.md §5, ADR 010).
 *
 * A rota não monta SQL nem decide política: valida a entrada, chama o serviço e
 * traduz falha em status. O modo escrita é exigido **no serviço**, não aqui —
 * esconder o botão na UI não é controle, e uma segunda checagem na rota seria
 * um segundo lugar para alguém esquecer.
 */
type CodigoDdl = 400 | 403 | 404 | 422 | 502;

const STATUS: Readonly<Record<FalhaDdl, CodigoDdl>> = {
  invalid: 422,
  write_forbidden: 403,
  not_found: 404,
  decryption_failed: 400,
  upstream_error: 502,
};

const MENSAGEM: Readonly<Record<FalhaDdl, string>> = {
  invalid: "os dados do formulário não formam um comando válido",
  write_forbidden: "escrita desligada nesta conexão",
  not_found: "conexão não encontrada",
  decryption_failed: "não foi possível decifrar a senha da conexão",
  upstream_error: "o Postgres recusou o comando",
};

function responder<R>(
  resultado: ResultadoDdl,
  status: (codigo: CodigoDdl, corpo: { code: string; message: string }) => R,
): DdlResultType | R {
  if (resultado.ok) return { ok: true as const, sql: resultado.sql };
  const falha = resultado.failure ?? "upstream_error";
  return status(STATUS[falha], {
    code: falha,
    // O erro do Postgres, quando existe, vale mais que a frase genérica: ele diz
    // "already exists", "permission denied", "invalid locale" (CLAUDE.md).
    message: resultado.message ?? MENSAGEM[falha],
  });
}

export const ddlRoutes = (service: DdlService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    // Para o **tipo** de `sessao` chegar aos handlers. O guard já derivou o valor.
    .use(sessionContext(users))
    .post(
      "/:id/ddl/table",
      async ({ params, body, status, sessao }) =>
        responder(await service.criarTabela(params.id, body, exigirAtor(sessao)), status),
      {
        params: t.Object({ id: t.String() }),
        body: CreateTableRequest,
        response: {
          200: DdlResult,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          422: ErrorResponse,
          502: ErrorResponse,
        },
      },
    )
    .post(
      "/:id/ddl/database",
      async ({ params, body, status, sessao }) =>
        responder(await service.criarDatabase(params.id, body, exigirAtor(sessao)), status),
      {
        params: t.Object({ id: t.String() }),
        body: CreateDatabaseRequest,
        response: {
          200: DdlResult,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          422: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
