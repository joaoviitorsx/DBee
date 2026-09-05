import type { AuthFailure, ServiceFailure } from "../services/result";

/** Único ponto que traduz falha de domínio em status HTTP. */
export const FAILURES: Readonly<
  Record<ServiceFailure, { status: 400 | 404 | 500 | 502; body: { code: string; message: string } }>
> = {
  not_found: {
    status: 404,
    body: { code: "connection_not_found", message: "conexão não encontrada" },
  },
  decryption_failed: {
    status: 500,
    body: {
      code: "decryption_failed",
      message:
        "não foi possível decifrar a senha desta conexão — APP_SECRET pode ter mudado (ver DBee.md §11.5)",
    },
  },
  bad_request: {
    status: 400,
    body: { code: "bad_request", message: "entrada inválida" },
  },
  upstream_error: {
    status: 502,
    body: { code: "upstream_error", message: "o banco não respondeu" },
  },
};

/**
 * Falhas de autenticação → status. Mapa separado pela mesma razão do tipo:
 * só as rotas de auth e o guard podem produzir estes status.
 */
/**
 * `as const satisfies` em vez de anotar o tipo: anotar alarga o `status` de
 * cada entrada para a união inteira, e aí `AUTH_FAILURES.unauthenticated.status`
 * passa a ser `401 | 403 | 429`. A rota `/me`, que só pode devolver 401, teria
 * de declarar 429 no `response` — declarar uma resposta impossível.
 */
export const AUTH_FAILURES = {
  unauthenticated: {
    status: 401,
    body: { code: "unauthenticated", message: "faça login para continuar" },
  },
  password_change_required: {
    status: 403,
    body: {
      code: "password_change_required",
      message: "troque a senha antes de continuar",
    },
  },
  invalid_credentials: {
    status: 401,
    // Uma mensagem só para usuário inexistente e para senha errada. Distinguir
    // as duas entrega ao atacante a lista de quem existe (DBee.md §7).
    body: { code: "invalid_credentials", message: "usuário ou senha inválidos" },
  },
  rate_limited: {
    status: 429,
    body: { code: "rate_limited", message: "tentativas demais — espere um pouco" },
  },
} as const satisfies Record<
  AuthFailure,
  { status: 401 | 403 | 429; body: { code: string; message: string } }
>;
