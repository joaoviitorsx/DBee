import { Elysia, t } from "elysia";

import {
  ErrorResponse,
  PerfilVpn,
  VpnArquivoRequest,
  VpnConectarRequest,
  VpnList,
  VpnTuneisAtivos,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import type { VpnResult, VpnService } from "../services/vpn.service";

import { VPN_FAILURES } from "./failures";
import { exigirAdmin, exigirAtor, sessionContext } from "./guard";

const perfilParam = t.Object({ perfil: PerfilVpn });

const resposta = {
  200: VpnList,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  409: ErrorResponse,
  422: ErrorResponse,
  500: ErrorResponse,
  502: ErrorResponse,
  504: ErrorResponse,
};

/**
 * VPN por pessoa (ADR 014). Cada rota age sobre o túnel e o .ovpn DE QUEM
 * está logado — não há parâmetro de usuário, então não há como mexer no
 * túnel de outra pessoa. A única visão cruzada é `GET /vpn/ativos`, de admin,
 * e ela não traz IP, destino nem credencial.
 *
 * Corpos com senha+TOTP e com o .ovpn não são logados, não voltam na resposta,
 * e o 422 do `errorHandler` não ecoa valor recebido.
 */
export const vpnRoutes = (service: VpnService, users: UsersRepository) => {
  const responder = <S>(
    r: VpnResult<VpnList>,
    status: (codigo: 403 | 404 | 409 | 422 | 500 | 502 | 504, corpo: { code: string; message: string }) => S,
  ): VpnList | S => {
    if (r.ok) return r.value;
    const { status: codigo, body } = VPN_FAILURES[r.failure];
    return status(codigo, r.detail === undefined ? body : { code: body.code, message: r.detail });
  };

  return new Elysia({ prefix: "/vpn" })
    .use(sessionContext(users))
    .get("/", ({ sessao }) => service.listar(exigirAtor(sessao)), {
      response: { 200: VpnList, 401: ErrorResponse, 403: ErrorResponse },
    })
    .get(
      "/ativos",
      ({ sessao, status }) => {
        if (!exigirAdmin(sessao).ok) return status(403, VPN_FAILURES.admin_required.body);
        return service.ativos();
      },
      { response: { 200: VpnTuneisAtivos, 401: ErrorResponse, 403: ErrorResponse } },
    )
    .put(
      "/:perfil/arquivo",
      ({ sessao, params, body, status }) =>
        responder(service.salvarArquivo(exigirAtor(sessao), params.perfil, body.ovpn), status),
      { params: perfilParam, body: VpnArquivoRequest, response: resposta },
    )
    .delete(
      "/:perfil/arquivo",
      async ({ sessao, params, status }) =>
        responder(await service.removerArquivo(exigirAtor(sessao), params.perfil), status),
      { params: perfilParam, response: resposta },
    )
    .post(
      "/:perfil/conectar",
      async ({ sessao, params, body, status }) =>
        responder(await service.conectar(exigirAtor(sessao), params.perfil, body.usuario, body.senha), status),
      { params: perfilParam, body: VpnConectarRequest, response: resposta },
    )
    .post(
      "/:perfil/desconectar",
      async ({ sessao, params, status }) =>
        responder(await service.desconectar(exigirAtor(sessao), params.perfil), status),
      { params: perfilParam, response: resposta },
    );
};
