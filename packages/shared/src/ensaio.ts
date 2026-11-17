import { t, type Static } from "elysia";

import { QueryError, StatementResult } from "./query";

/**
 * Ensaio de escrita e aplicação conferida (ADR 021).
 *
 * O ensaio executa o SQL em `BEGIN READ WRITE` e **sempre** reverte; devolve,
 * por statement, o `rowCount` e o `command` que o banco informou, e uma amostra
 * das linhas quando houver `RETURNING`. Aplicar reexecuta e só commita se cada
 * `rowCount` bater com o esperado. Só Postgres; só comandos DML (o servidor
 * classifica — ver `pg/ensaio.ts`).
 */

/** Teto da amostra de linhas por statement — o ensaio não é exportação. */
export const AMOSTRA_ENSAIO = 50;

const sql = t.String({ minLength: 1, maxLength: 1_000_000 });
const database = t.Optional(t.String({ minLength: 1, maxLength: 100 }));
/** Mesmo papel do `queryId` de `/query`: permite cancelar enquanto roda. */
const queryId = t.Optional(t.String({ minLength: 1, maxLength: 64 }));

export const DryRunRequest = t.Object({ sql, database, queryId });
export type DryRunRequest = Static<typeof DryRunRequest>;

const ErroDoLote = t.Union([t.Intersect([QueryError, t.Object({ index: t.Integer() })]), t.Null()]);

export const DryRunResponse = t.Object({
  /**
   * Um por statement executado. `rowCount` é o que o banco disse que o comando
   * afetou (ou, com `RETURNING`/`SELECT`, quantas linhas devolveu); `rows` é a
   * amostra, cortada em `AMOSTRA_ENSAIO` com `truncated`.
   */
  results: t.Array(StatementResult),
  error: ErroDoLote,
  totalDurationMs: t.Integer(),
  /** Sempre `true`: o ensaio nunca grava. Está aqui para a tela afirmar isso. */
  rolledBack: t.Literal(true),
});
export type DryRunResponse = Static<typeof DryRunResponse>;

export const ApplyRequest = t.Object({
  sql,
  database,
  queryId,
  /**
   * O `rowCount` de cada statement no ensaio, na ordem. Divergiu em qualquer
   * um (ou a quantidade de statements mudou) → `ROLLBACK` e 409
   * `dry_run_mismatch`.
   */
  expectedRowCounts: t.Array(t.Integer({ minimum: 0 }), { minItems: 1, maxItems: 1000 }),
  /**
   * Nome da conexão, digitado. Exigido pelo servidor quando a conexão está
   * marcada `environment: "production"` (ADR 022); ignorado nas outras.
   */
  confirmName: t.Optional(t.String({ maxLength: 100 })),
});
export type ApplyRequest = Static<typeof ApplyRequest>;

export const ApplyResponse = t.Object({
  results: t.Array(StatementResult),
  /** Erro de SQL num statement: a transação reverteu, `committed: false`. */
  error: ErroDoLote,
  totalDurationMs: t.Integer(),
  committed: t.Boolean(),
});
export type ApplyResponse = Static<typeof ApplyResponse>;
