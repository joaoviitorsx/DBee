import { treaty } from "@elysiajs/eden";

import type { App } from "@dbee/server/src/app";

/**
 * Eden Treaty: o front consome a API com os tipos do server, sem codegen e sem
 * client HTTP manual (DBee.md §3, CLAUDE.md). Mudança de rota quebra o build do
 * web — comportamento desejado, não bug a contornar com `any`.
 *
 * `parseDate: false` é **obrigatório** (§11.43). Por padrão o Eden reanalisa o
 * JSON da resposta e converte QUALQUER string que pareça uma data ISO em objeto
 * `Date`. Isso quebra a regra 10 ("todo valor de célula trafega como string"):
 * uma célula `date`/`timestamptz` — ou uma coluna de texto que contenha
 * "2026-08-01" — chegaria como `Date`, o grid renderizaria `[object Date]` e a
 * aba inteira estoura. Com `false`, o valor exato do Postgres (que o servidor já
 * garante como texto) chega intacto.
 */
export const api = treaty<App>(window.location.origin, { parseDate: false });
