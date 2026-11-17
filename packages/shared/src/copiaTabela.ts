import { t, type Static } from "elysia";

/**
 * "Copiar tabela para…" (ideia I10): `POST /connections/:id/tables/:schema/:table/copy-script`.
 * Lê estrutura (catálogo) e dados (keyset `READ ONLY`, com teto) da origem e
 * devolve **texto** — `CREATE TABLE` no dialeto do destino + INSERTs — para o
 * editor da conexão de destino. Nada é executado no destino.
 */
export const COPIA_TABELA_MAX_ROWS = 10_000;
export const COPIA_TABELA_ROWS_PADRAO = 1000;

export const CopyTableRequest = t.Object({
  /** Database da origem; padrão: o da conexão. */
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  targetConnectionId: t.String({ minLength: 1, maxLength: 64 }),
  /** Schema no destino. Padrão: o da origem (Postgres), `main` (SQLite/libSQL) ou o database da conexão (MySQL). */
  targetSchema: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  /** Nome da tabela no destino. Padrão: o da origem. */
  targetTable: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  /** Linhas copiadas (0 = só estrutura). Padrão 1000, teto 10 000. */
  maxRows: t.Optional(t.Integer({ minimum: 0, maximum: COPIA_TABELA_MAX_ROWS })),
});
export type CopyTableRequest = Static<typeof CopyTableRequest>;

export const CopyTableResponse = t.Object({
  sql: t.String(),
  targetDialect: t.Union([t.Literal("postgres"), t.Literal("mysql"), t.Literal("sqlite")]),
  rowCount: t.Integer(),
  /** Havia mais linhas que `maxRows`: o script não traz a tabela inteira. */
  truncated: t.Boolean(),
  warnings: t.Array(t.String()),
});
export type CopyTableResponse = Static<typeof CopyTableResponse>;
