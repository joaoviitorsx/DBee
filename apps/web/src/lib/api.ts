import { treaty } from "@elysiajs/eden";

import type { App } from "@dbee/server/src/app";

/**
 * Eden Treaty: o front consome a API com os tipos do server, sem codegen e sem
 * client HTTP manual (DBee.md §3, CLAUDE.md). Mudança de rota quebra o build do
 * web — comportamento desejado, não bug a contornar com `any`.
 */
export const api = treaty<App>(window.location.origin);
