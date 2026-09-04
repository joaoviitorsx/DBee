/**
 * Falhas de domínio. Serviço não conhece HTTP: quem traduz para status é a
 * rota. Assim a mesma regra serve a uma CLI ou job sem arrastar Elysia junto.
 */
export type ServiceFailure = "not_found" | "decryption_failed" | "upstream_error";

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ServiceFailure; readonly detail?: string };

export const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });

export const fail = <T>(failure: ServiceFailure, detail?: string): ServiceResult<T> =>
  detail === undefined ? { ok: false, failure } : { ok: false, failure, detail };
