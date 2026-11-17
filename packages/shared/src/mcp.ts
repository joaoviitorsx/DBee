import { t, type Static } from "elysia";

/**
 * MCP do DBee e tokens pessoais (docs/plano-mcp-vpn.md §1, ADR 015).
 *
 * O transporte é MCP Streamable HTTP com resposta JSON simples — JSON-RPC 2.0
 * sobre `POST /api/mcp`. Sem `@modelcontextprotocol/sdk`: ele depende de Zod
 * (CLAUDE.md, regra 2), e o pedaço de protocolo que o DBee usa cabe aqui.
 */

/** Teto de linhas que `run_query` devolve ao agente. */
export const MCP_MAX_ROWS = 500;
/** Teto de tempo de `run_query`: passou disso, a query é cancelada no servidor. */
export const MCP_TIMEOUT_MS = 30_000;
/** Versão do protocolo MCP que este servidor fala. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

// ── Tokens pessoais ─────────────────────────────────────────────────────────

/** Um token como a lista o mostra. **Sem hash, sem segredo.** */
export const ApiTokenSummary = t.Object({
  id: t.String(),
  name: t.String(),
  /** Parte pública (`dbee_<prefix>_…`) — identifica o token sem revelá-lo. */
  prefix: t.String(),
  createdAt: t.String(),
  lastUsedAt: t.Union([t.String(), t.Null()]),
  revokedAt: t.Union([t.String(), t.Null()]),
});
export type ApiTokenSummary = Static<typeof ApiTokenSummary>;

export const ApiTokenList = t.Array(ApiTokenSummary);
export type ApiTokenList = Static<typeof ApiTokenList>;

export const CreateApiTokenRequest = t.Object({
  // `\\S`: nome só de espaços vira vazio depois do trim no serviço.
  name: t.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
});
export type CreateApiTokenRequest = Static<typeof CreateApiTokenRequest>;

/** Única resposta que carrega o token inteiro — ele não é mostrado de novo. */
export const CreateApiTokenResponse = t.Object({
  token: ApiTokenSummary,
  secret: t.String(),
});
export type CreateApiTokenResponse = Static<typeof CreateApiTokenResponse>;

// ── JSON-RPC 2.0 ────────────────────────────────────────────────────────────

export const JsonRpcId = t.Union([t.String({ maxLength: 200 }), t.Number()]);
export type JsonRpcId = Static<typeof JsonRpcId>;

/**
 * Pedido ou notificação (sem `id`). Lote (array) não é aceito — a revisão
 * 2025-06-18 do MCP removeu batching.
 */
export const JsonRpcRequest = t.Object({
  jsonrpc: t.Literal("2.0"),
  id: t.Optional(JsonRpcId),
  method: t.String({ minLength: 1, maxLength: 200 }),
  params: t.Optional(t.Record(t.String(), t.Unknown())),
});
export type JsonRpcRequest = Static<typeof JsonRpcRequest>;

export const JsonRpcError = t.Object({
  code: t.Integer(),
  message: t.String(),
});
export type JsonRpcError = Static<typeof JsonRpcError>;

export const JsonRpcResponse = t.Object({
  jsonrpc: t.Literal("2.0"),
  id: t.Union([JsonRpcId, t.Null()]),
  result: t.Optional(t.Record(t.String(), t.Unknown())),
  error: t.Optional(JsonRpcError),
});
export type JsonRpcResponse = Static<typeof JsonRpcResponse>;

/** Resultado de `tools/call`: texto (JSON serializado) + flag de erro. */
export const McpToolResult = t.Object({
  content: t.Array(t.Object({ type: t.Literal("text"), text: t.String() })),
  isError: t.Boolean(),
});
export type McpToolResult = Static<typeof McpToolResult>;
