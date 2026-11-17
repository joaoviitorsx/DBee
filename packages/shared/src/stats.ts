import { t, type Static } from "elysia";

import { RowFilter } from "./rows";

/**
 * Estatística rápida de coluna (clique no cabeçalho da aba Dados):
 * `POST /connections/:id/tables/:schema/:table/stats`. Tudo como string
 * (regra 10). `BEGIN READ ONLY`, `statement_timeout` de 5 s, `query_log`.
 * Só Postgres no primeiro corte.
 */
export const ColumnStatsRequest = t.Object({
  column: t.String({ minLength: 1, maxLength: 63 }),
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  /** O filtro atual da aba Dados — mesmo construtor parametrizado. */
  filters: t.Optional(t.Array(RowFilter, { maxItems: 20 })),
});
export type ColumnStatsRequest = Static<typeof ColumnStatsRequest>;

export const ColumnStatsResponse = t.Object({
  total: t.String(),
  nulls: t.String(),
  distinct: t.String(),
  /** `null` quando a coluna está vazia ou o tipo não tem ordem (json, bool…). */
  min: t.Union([t.String(), t.Null()]),
  max: t.Union([t.String(), t.Null()]),
  /** Até 5 valores mais frequentes; vazio quando o tipo não tem igualdade. */
  top: t.Array(t.Object({ value: t.Union([t.String(), t.Null()]), count: t.String() })),
  durationMs: t.Integer(),
});
export type ColumnStatsResponse = Static<typeof ColumnStatsResponse>;
