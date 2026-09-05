import { t, type Static } from "elysia";

/** Metadado de coluna do resultado (DBee.md §5). */
export const ResultColumn = t.Object({
  name: t.String(),
  dataTypeId: t.Integer(),
  /** Nome canônico do tipo — a UI decide alinhamento e formatação por ele. */
  dataTypeName: t.String(),
});
export type ResultColumn = Static<typeof ResultColumn>;

/**
 * Erro do Postgres, inteiro (CLAUDE.md).
 *
 * `position` já vem **corrigida** para o SQL do usuário: o executor embrulha o
 * statement num `DECLARE ... CURSOR FOR`, e a posição crua do driver aponta
 * para a string embrulhada (DBee.md §11.12).
 */
export const QueryError = t.Object({
  code: t.Union([t.String(), t.Null()]),
  message: t.String(),
  /** 1-based no SQL original, incluindo o deslocamento do statement. */
  position: t.Union([t.Integer(), t.Null()]),
  detail: t.Union([t.String(), t.Null()]),
  hint: t.Union([t.String(), t.Null()]),
});
export type QueryError = Static<typeof QueryError>;

/** Resultado de um statement. Um por statement, na ordem de execução. */
export const StatementResult = t.Object({
  /** Índice do statement no SQL enviado, base 0. */
  index: t.Integer(),
  sql: t.String(),
  columns: t.Array(ResultColumn),
  /** Toda célula é string; `null` é SQL NULL (DBee.md §6). */
  rows: t.Array(t.Array(t.Union([t.String(), t.Null()]))),
  rowCount: t.Integer(),
  /** `true` quando havia mais linhas do que `maxRows`. */
  truncated: t.Boolean(),
  durationMs: t.Integer(),
  /** `null` quando o statement não devolve linhas (UPDATE, DDL, SET…). */
  command: t.Union([t.String(), t.Null()]),
  /** `true` quando foi executado por cursor. */
  viaCursor: t.Boolean(),
});
export type StatementResult = Static<typeof StatementResult>;

export const QueryRequest = t.Object({
  sql: t.String({ minLength: 1, maxLength: 1_000_000 }),
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  maxRows: t.Optional(t.Integer({ minimum: 1, maximum: 100_000 })),
  /**
   * Força leitura mesmo numa conexão gravável. **Não** permite escrita numa
   * conexão read-only: `false` aqui não desliga a proteção da conexão.
   */
  readOnly: t.Optional(t.Boolean()),
});
export type QueryRequest = Static<typeof QueryRequest>;

export const QueryResponse = t.Object({
  results: t.Array(StatementResult),
  /** Erro do primeiro statement que falhou; os seguintes não rodam. */
  error: t.Union([t.Intersect([QueryError, t.Object({ index: t.Integer() })]), t.Null()]),
  totalDurationMs: t.Integer(),
  /** Modo em que a transação foi aberta — a UI mostra isso sem ambiguidade. */
  readOnly: t.Boolean(),
});
export type QueryResponse = Static<typeof QueryResponse>;

/** Uma linha do `query_log` (DBee.md §4). */
export const QueryLogEntry = t.Object({
  id: t.String(),
  connectionId: t.String(),
  database: t.String(),
  sql: t.String(),
  status: t.Union([t.Literal("ok"), t.Literal("error"), t.Literal("cancelled")]),
  error: t.Union([t.String(), t.Null()]),
  rowCount: t.Union([t.Integer(), t.Null()]),
  durationMs: t.Union([t.Integer(), t.Null()]),
  readOnly: t.Boolean(),
  actor: t.String(),
  executedAt: t.String(),
});
export type QueryLogEntry = Static<typeof QueryLogEntry>;
