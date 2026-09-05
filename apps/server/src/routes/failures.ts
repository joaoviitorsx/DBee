import type { ServiceFailure } from "../services/result";

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
