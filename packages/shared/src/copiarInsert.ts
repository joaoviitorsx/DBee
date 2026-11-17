import { t, type Static } from "elysia";

/**
 * "Copiar como INSERT": `POST /connections/:id/tables/:schema/:table/insert-sql`.
 * Devolve o **texto** dos INSERTs no dialeto da engine; não executa nada.
 * Colunas conferidas no catálogo; no Postgres cada literal leva cast para o
 * tipo da coluna. `null` no array = SQL NULL (regra 10).
 */
export const INSERT_SQL_MAX_ROWS = 1000;

export const InsertSqlRequest = t.Object({
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  columns: t.Array(t.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 500 }),
  rows: t.Array(t.Array(t.Union([t.String({ maxLength: 1_000_000 }), t.Null()]), { maxItems: 500 }), {
    minItems: 1,
    maxItems: INSERT_SQL_MAX_ROWS,
  }),
});
export type InsertSqlRequest = Static<typeof InsertSqlRequest>;

export const InsertSqlResponse = t.Object({ sql: t.String() });
export type InsertSqlResponse = Static<typeof InsertSqlResponse>;
