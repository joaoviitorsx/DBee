import type { AuthFailure, MutationFailure, ServiceFailure } from "../services/result";

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
  setup_done: {
    status: 409,
    // Já há conta: o modo setup fechou. O front cai para a tela de login.
    body: { code: "setup_done", message: "o setup já foi concluído — faça login" },
  },
  invalid_token: {
    status: 401,
    body: { code: "invalid_token", message: "token de setup inválido" },
  },
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
  { status: 401 | 403 | 409 | 429; body: { code: string; message: string } }
>;

/**
 * Falhas da edição de linha → status. Separadas de `FAILURES` pela mesma razão
 * de `AUTH_FAILURES`: `409` e `403` só nascem na rota de mutação, e só ela
 * declara esses status no `response`.
 */
export const MUTATION_FAILURES = {
  not_found: {
    status: 404,
    body: { code: "connection_not_found", message: "conexão não encontrada" },
  },
  decryption_failed: {
    status: 500,
    body: { code: "decryption_failed", message: "não foi possível decifrar a senha desta conexão" },
  },
  upstream_error: {
    status: 502,
    body: { code: "upstream_error", message: "o banco não respondeu" },
  },
  write_forbidden: {
    status: 403,
    body: {
      code: "write_forbidden",
      message: "escrita não habilitada nesta conexão",
    },
  },
  row_changed: {
    status: 409,
    body: {
      code: "row_changed",
      message: "a linha mudou desde que você a leu — releia e tente de novo",
    },
  },
  ambiguous_row: {
    status: 409,
    body: {
      code: "ambiguous_row",
      message: "a condição casaria mais de uma linha — nada foi alterado",
    },
  },
} as const satisfies Record<
  MutationFailure,
  { status: 403 | 404 | 409 | 500 | 502; body: { code: string; message: string } }
>;
