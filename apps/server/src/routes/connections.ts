import { Elysia, t } from "elysia";

import {
  Connection,
  ConnectionGrantList,
  CreateConnection,
  ErrorResponse,
  GrantAccessRequest,
  TestConnectionResult,
  UpdateConnection,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { ConnectionsService } from "../services/connections.service";

import { FAILURES, USER_FAILURES } from "./failures";
import { exigirAdmin, exigirAtor, sessionContext } from "./guard";

const idParam = t.Object({ id: t.String() });

/**
 * Adaptador HTTP do domínio de conexões (DBee.md §5).
 *
 * A rota não abre conexão no Postgres nem toca no SQLite: ela valida entrada,
 * chama o serviço e mapeia o resultado para status. A sessão é exigida pelo
 * guard global, antes de qualquer handler daqui rodar.
 */
export const connectionsRoutes = (service: ConnectionsService, users: UsersRepository) =>
  new Elysia({ prefix: "/connections" })
    // Para o **tipo** da sessão chegar aos handlers; o guard já derivou o valor.
    .use(sessionContext(users))

    // A lista é filtrada por acesso (migração 005): admin vê tudo, `member` vê
    // só o que lhe foi concedido. Isso é **metade** do controle — a outra, e a
    // que importa, é o `resolve` recusar por id em todas as outras rotas.
    .get("/", ({ sessao }) => service.list(exigirAtor(sessao)), {
      response: { 200: t.Array(Connection), 401: ErrorResponse, 403: ErrorResponse },
    })

    /*
     * Criar, editar e apagar conexão é **de administrador**.
     *
     * Até a fase 1 isso não tinha como ser dito: só existia uma conta, e ela
     * era dona de tudo. Com o time dentro, deixar aberto significaria um
     * `member` editando o host de uma conexão de produção que ele nem enxerga
     * — a mesma classe do `PATCH` que já reapontou uma conexão para outro
     * servidor neste projeto.
     */
    .post(
      "/",
      ({ body, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        const result = service.create(body);
        if (result.ok) return status(201, result.value);
        /*
         * 400 literal, e não `FAILURES[result.failure].status`.
         *
         * `FAILURES` é anotado como `Record<ServiceFailure, …>`, então indexá-lo
         * alarga o status para a união inteira (`400 | 404 | 500 | 502`) e a
         * rota passaria a declarar respostas que não tem como devolver — é o
         * mesmo alargamento que levou `AUTH_FAILURES` a usar
         * `as const satisfies`. Criar só falha por engine não implementada.
         */
        return status(400, FAILURES.engine_not_implemented.body);
      },
      {
        body: CreateConnection,
        response: {
          201: Connection,
          // 400: engine que o schema aceita e o DBee ainda não fala.
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
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
      ({ params, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
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
      async ({ params, sessao, status }) => {
        const result = await service.test(params.id, exigirAtor(sessao));
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
    )

    /*
     * Quem alcança esta conexão (migração 005). **Só administrador.**
     *
     * A concessão é o controle de acesso em si: quem pode concedê-la pode se
     * conceder tudo. Deixar isso com `member` tornaria a permissão por conexão
     * decorativa.
     */
    .get(
      "/:id/access",
      ({ params, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        return service.acessos(params.id, users.listar());
      },
      {
        params: idParam,
        response: { 200: ConnectionGrantList, 401: ErrorResponse, 403: ErrorResponse },
      },
    )

    .put(
      "/:id/access",
      ({ params, body, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        service.conceder(params.id, body.userId, body.canWrite, admin.atorId);
        return service.acessos(params.id, users.listar());
      },
      {
        params: idParam,
        body: GrantAccessRequest,
        response: { 200: ConnectionGrantList, 401: ErrorResponse, 403: ErrorResponse },
      },
    )

    .delete(
      "/:id/access/:userId",
      ({ params, sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        service.revogar(params.id, params.userId);
        return service.acessos(params.id, users.listar());
      },
      {
        params: t.Object({ id: t.String(), userId: t.String() }),
        response: { 200: ConnectionGrantList, 401: ErrorResponse, 403: ErrorResponse },
      },
    );
