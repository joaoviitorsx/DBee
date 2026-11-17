import { t, type Static } from "elysia";

import { QueryError } from "./query";

/**
 * EXPLAIN visual (roadmap-dbeaver item 8, ADR 017):
 * `POST /connections/:id/explain`. Só Postgres.
 *
 * Sem `analyze`: `EXPLAIN (FORMAT JSON)` dentro de `BEGIN READ ONLY` — não
 * executa a query. Com `analyze: true`: **executa** (é o que ANALYZE faz), por
 * isso só passa quando a conexão está em escrita efetiva para o ator, roda em
 * `BEGIN READ WRITE` e termina **sempre** em `ROLLBACK`. Os dois caem no
 * `query_log`.
 */
export const ExplainRequest = t.Object({
  sql: t.String({ minLength: 1, maxLength: 1_000_000 }),
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  /** Bind de `$n`, como em `QueryRequest.params`. */
  params: t.Optional(t.Array(t.Union([t.String({ maxLength: 1_000_000 }), t.Null()]), { maxItems: 100 })),
  /** Ausente = `false`. `true` executa a query (dentro de transação revertida). */
  analyze: t.Optional(t.Boolean()),
});
export type ExplainRequest = Static<typeof ExplainRequest>;

export const ExplainResponse = t.Object({
  /**
   * O JSON do plano **como texto**, exatamente como o Postgres o devolveu
   * (regra 10). A UI faz `JSON.parse`. `null` quando houve erro.
   */
  plan: t.Union([t.String(), t.Null()]),
  /** Erro do Postgres, com `position` relativa ao SQL enviado. */
  error: t.Union([QueryError, t.Null()]),
  analyzed: t.Boolean(),
  durationMs: t.Integer(),
});
export type ExplainResponse = Static<typeof ExplainResponse>;
