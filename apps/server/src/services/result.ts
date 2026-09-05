/**
 * Falhas de domínio. Serviço não conhece HTTP: quem traduz para status é a
 * rota. Assim a mesma regra serve a uma CLI ou job sem arrastar Elysia junto.
 */
export type ServiceFailure =
  | "not_found"
  | "decryption_failed"
  | "upstream_error"
  /** Entrada que o schema não pega — coluna inexistente, cursor incompatível. */
  | "bad_request";

/**
 * Falhas de autenticação, num tipo à parte.
 *
 * Não entram no `ServiceFailure` porque não são produzíveis pelas outras
 * rotas: obrigar `/query` a declarar `429` no `response` seria declarar uma
 * resposta que ela não tem como devolver, e o contrato deixaria de ser
 * verdadeiro. `unauthenticated` e `password_change_required` nascem no guard,
 * antes de qualquer serviço; as outras duas, só no login.
 */
export type AuthFailure =
  | "unauthenticated"
  | "password_change_required"
  /** Credencial errada. **Nunca** diz qual das duas metades errou. */
  | "invalid_credentials"
  | "rate_limited";

/**
 * Resultado de auth, **parametrizado pelo conjunto de falhas possíveis**.
 *
 * `login` não tem como devolver `password_change_required`, e `/auth/me` não
 * tem como devolver `429`. Sem o parâmetro, toda rota de auth teria de declarar
 * no `response` os quatro status — e o contrato passaria a prometer respostas
 * que aquela rota não produz. O parâmetro faz o tipo dizer a verdade, e o
 * `response` de cada rota fica exato.
 */
export type AuthResult<T, F extends AuthFailure = AuthFailure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: F; readonly detail?: string };

export const authOk = <T>(value: T): AuthResult<T, never> => ({ ok: true, value });

export const authFail = <F extends AuthFailure>(
  failure: F,
  detail?: string,
): AuthResult<never, F> =>
  detail === undefined ? { ok: false, failure } : { ok: false, failure, detail };

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ServiceFailure; readonly detail?: string };

export const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });

export const fail = <T>(failure: ServiceFailure, detail?: string): ServiceResult<T> =>
  detail === undefined ? { ok: false, failure } : { ok: false, failure, detail };
