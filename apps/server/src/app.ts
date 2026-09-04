import { Elysia } from "elysia";

/**
 * Instância da API. Separada do `index.ts` para que os testes possam usar
 * `app.handle()` sem abrir porta.
 *
 * Um plugin por domínio entra aqui conforme as rotas forem chegando
 * (CLAUDE.md, "Ao escrever código"). No scaffold só existe o healthcheck.
 */
export const app = new Elysia({ prefix: "/api" }).get("/health", () => ({
  status: "ok",
}));

/** Tipo consumido pelo Eden Treaty no front (DBee.md §3). */
export type App = typeof app;
