import { Elysia, t } from "elysia";

import {
  CreateUserRequest,
  DeleteUserResponse,
  ErrorResponse,
  ResetPasswordRequest,
  SessionUser,
  UpdateUserRequest,
  UserList,
  UserSummary,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { UsersService } from "../services/users.service";

import { exigirAdmin } from "./guard";
import { sessionContext } from "./guard";
import { USER_FAILURES } from "./failures";

const idParam = t.Object({ id: t.String() });

/**
 * Administração de contas (DBee.md §9, v0.2).
 *
 * **Toda rota daqui é de administrador**, verificado no servidor por
 * `exigirAdmin`. O guard global já garantiu que existe sessão viva e que a
 * senha não está pendente de troca; o que falta é o papel.
 *
 * Não há `GET /:id`: a tela lista todo mundo de uma vez, e uma rota de detalhe
 * seria superfície nova sem consumidor.
 *
 * **Nenhuma resposta daqui carrega senha nem hash** — nem a de criação, que
 * devolve o usuário criado sem a provisória que veio no corpo. O `response`
 * declarado em cada rota é o que trava isso: um campo novo no serviço não
 * atravessa sem alguém mexer no schema.
 */
export const usersRoutes = (service: UsersService, users: UsersRepository) =>
  new Elysia({ prefix: "/users" })
    // Para o **tipo** da sessão chegar aos handlers; o guard já derivou o valor.
    .use(sessionContext(users))

    .get(
      "/",
      ({ sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body } = USER_FAILURES.admin_required;
          return status(code, body);
        }
        return service.listar();
      },
      { response: { 200: UserList, 401: ErrorResponse, 403: ErrorResponse } },
    )

    .post(
      "/",
      async ({ body, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        const resultado = await service.criar(body);
        if (resultado.ok) return status(201, resultado.value);
        const { status: code, body: payload } = USER_FAILURES[resultado.failure];
        return status(code, payload);
      },
      {
        body: CreateUserRequest,
        response: {
          201: SessionUser,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    )

    .patch(
      "/:id",
      ({ params, body, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        const resultado = service.definirPapel(params.id, body.role);
        if (resultado.ok) return resultado.value;
        const { status: code, body: payload } = USER_FAILURES[resultado.failure];
        return status(code, payload);
      },
      {
        params: idParam,
        body: UpdateUserRequest,
        response: {
          200: UserSummary,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    )

    .post(
      "/:id/password",
      async ({ params, body, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        const resultado = await service.resetarSenha(params.id, body.temporaryPassword);
        if (resultado.ok) return resultado.value;
        const { status: code, body: payload } = USER_FAILURES[resultado.failure];
        return status(code, payload);
      },
      {
        params: idParam,
        body: ResetPasswordRequest,
        response: {
          200: UserSummary,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    )

    .delete(
      "/:id",
      ({ params, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        const resultado = service.remover(params.id, admin.atorId);
        if (resultado.ok) return { ok: true } as const;
        const { status: code, body: payload } = USER_FAILURES[resultado.failure];
        return status(code, payload);
      },
      {
        params: idParam,
        response: {
          200: DeleteUserResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    );
