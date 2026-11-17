import { Elysia, t } from "elysia";

import { ErrorResponse, JsonRpcRequest, JsonRpcResponse, type JsonRpcId } from "@dbee/shared";

import type { McpService } from "../services/mcp.service";
import { AUTH_FAILURES } from "./failures";
import { autenticacaoMcp } from "./guard";

/**
 * MCP Streamable HTTP, resposta JSON simples (ADR 015).
 *
 * Quem autentica é o guard (`onRequest`), por Bearer; aqui só se lê o
 * resultado. Requisição sem autenticação registrada no guard é recusada —
 * fecha em falha mesmo se um caminho alternativo (barra final, outro método)
 * chegar aqui sem passar pelo ramo Bearer.
 *
 * Erro de protocolo (método desconhecido, params inválidos) é erro JSON-RPC;
 * erro de banco é **resultado** da tool com `isError` — é informação para o
 * agente corrigir o SQL, não falha do transporte.
 */
const resposta = (id: JsonRpcId, result: Record<string, unknown>) => ({ jsonrpc: "2.0" as const, id, result });
const erroRpc = (id: JsonRpcId | null, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message },
});

export const mcpRoutes = (service: McpService) =>
  new Elysia()
    .post(
      "/mcp",
      async ({ body, request, status }) => {
        const auth = autenticacaoMcp(request);
        if (auth === null) {
          const { status: code, body: payload } = AUTH_FAILURES.unauthenticated;
          return status(code, payload);
        }
        // Notificação (sem `id`): não tem resposta. `notifications/initialized`
        // e `notifications/cancelled` caem aqui.
        if (body.id === undefined) return status(202, "");
        const id = body.id;

        switch (body.method) {
          case "initialize":
            return resposta(id, service.initialize());
          case "ping":
            return resposta(id, {});
          case "tools/list":
            return resposta(id, service.listTools());
          case "tools/call": {
            const params: Readonly<Record<string, unknown>> = body.params ?? {};
            const nome = params["name"];
            const args = params["arguments"] ?? {};
            if (typeof nome !== "string" || typeof args !== "object" || Array.isArray(args)) {
              return erroRpc(id, -32602, "params inválidos: esperado { name, arguments }");
            }
            const ator = {
              id: auth.user.id,
              role: auth.user.role,
              origem: `mcp:${auth.tokenName}`,
            };
            const r = await service.call(nome, args as Readonly<Record<string, unknown>>, ator);
            if (r === null) return erroRpc(id, -32602, `tool desconhecida: ${nome}`);
            return resposta(id, r);
          }
          default:
            return erroRpc(id, -32601, `método não suportado: ${body.method}`);
        }
      },
      {
        body: JsonRpcRequest,
        response: { 200: JsonRpcResponse, 202: t.Literal(""), 401: ErrorResponse },
      },
    )
    // Sem stream SSE do servidor: a especificação pede 405 no GET.
    .get(
      "/mcp",
      ({ status }) => status(405, { code: "method_not_allowed", message: "o MCP do DBee não abre stream SSE" }),
      { response: { 405: ErrorResponse } },
    );
