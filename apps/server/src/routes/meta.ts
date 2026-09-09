import { Elysia } from "elysia";

import {
  ErrorResponse,
  UpdateSettingsRequest,
  UpdateTriggered,
  VersionStatus,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import { UpdateError, type UpdateService } from "../services/update.service";
import { USER_FAILURES } from "./failures";
import { exigirAdmin, exigirAtor, sessionContext } from "./guard";

/**
 * Versão e atualização (DBee.md §5, §8).
 *
 * Sessão exigida pelo guard global — nenhuma destas rotas está em
 * `ROTAS_ABERTAS`. Isso vale inclusive para o `GET`: a versão em execução é
 * informação de inventário, e um app que anuncia "estou na v0.1.2" para quem
 * não fez login entrega meia-volta de trabalho a quem procura uma falha
 * conhecida.
 *
 * **Nenhuma resposta daqui, nem de sucesso nem de erro, contém a URL de
 * deploy.** Ela é credencial: quem a tem redeploya o serviço. O que sai é o
 * booleano `webhookConfigured`.
 */
const STATUS_POR_FALHA = {
  update_not_configured: 409,
  update_too_soon: 429,
  update_failed: 502,
} as const;

export const metaRoutes = (service: UpdateService, users: UsersRepository) =>
  new Elysia({ prefix: "/meta" })
    // Para o **tipo** de `sessao` chegar ao handler. O guard já derivou o valor.
    .use(sessionContext(users))
    .get("/version", () => service.status(), {
      response: { 200: VersionStatus, 401: ErrorResponse, 403: ErrorResponse },
    })
    /*
     * Verificar agora bate na API pública do GitHub. É barato, mas é uma saída
     * de rede disparada por requisição — fica com admin, como o resto de `/meta`.
     */
    .post(
      "/version/check",
      async ({ sessao, status }) => {
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body } = USER_FAILURES.admin_required;
          return status(code, body);
        }
        return await service.verificarAgora();
      },
      { response: { 200: VersionStatus, 401: ErrorResponse, 403: ErrorResponse } },
    )
    .patch(
      "/update-settings",
      async ({ body, sessao, status }) => {
        /*
         * **Admin.** Sem isto, um `member` sobrescrevia a URL de deploy do
         * admin — e como a resposta só devolve o booleano `webhookConfigured`,
         * nada na tela dele denunciava: o botão "Atualizar servidor" passava a
         * bater no destino escolhido por outra pessoa.
         */
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body: payload } = USER_FAILURES.admin_required;
          return status(code, payload);
        }
        try {
          service.salvarAjustes(body);
        } catch (erro) {
          if (erro instanceof UpdateError) {
            return status(400, { code: erro.codigo, message: erro.message });
          }
          throw erro;
        }
        return await service.status();
      },
      {
        body: UpdateSettingsRequest,
        response: {
          200: VersionStatus,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    )
    .post(
      "/update",
      async ({ status, sessao }) => {
        /*
         * **Admin.** Duas razões, e a segunda é a que envelheceu.
         *
         * Trocar o container de produção é ato de operador. E a nota de risco
         * do `update.service.ts` dizia que o SSRF era aceitável porque "quem
         * está autenticado já consegue apontar uma conexão para qualquer
         * host:porta" — isso **deixou de valer** quando criar conexão virou de
         * admin (migração 005). Um `member` perdeu a primitiva de saída, e esta
         * rota era a última que restava: com faixas privadas liberadas de
         * propósito, ela alcança o `dokploy-network` e a tailnet inteira, e o
         * status do erro distingue "porta fechada" de "403".
         */
        const admin = exigirAdmin(sessao);
        if (!admin.ok) {
          const { status: code, body } = USER_FAILURES.admin_required;
          return status(code, body);
        }
        try {
          await service.dispararUpdate(exigirAtor(sessao).id);
        } catch (erro) {
          if (erro instanceof UpdateError) {
            return status(STATUS_POR_FALHA[erro.codigo], {
              code: erro.codigo,
              message: erro.message,
            });
          }
          throw erro;
        }
        return { triggered: true } as const;
      },
      {
        response: {
          200: UpdateTriggered,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
          429: ErrorResponse,
          502: ErrorResponse,
        },
      },
    );
