import { treaty } from "@elysiajs/eden";

import { EDEN_CONFIG } from "@dbee/shared";
import type { App } from "@dbee/server/src/app";

/**
 * Eden Treaty: o front consome a API com os tipos do server, sem codegen e sem
 * client HTTP manual (DBee.md §3, CLAUDE.md). Mudança de rota quebra o build do
 * web — comportamento desejado, não bug a contornar com `any`.
 *
 * A desserialização é travada por `EDEN_CONFIG` (`@dbee/shared`): `parseDate:
 * false` é obrigatório e provado pelo teste de fronteira — ver §11.43 e o
 * comentário em `packages/shared/src/eden.ts`.
 */
export const api = treaty<App>(window.location.origin, EDEN_CONFIG);
