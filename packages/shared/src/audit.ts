import { t, type Static } from "elysia";

import { QueryLogEntry } from "./query";

/**
 * Auditoria — o `query_log` pesquisável (DBee.md §2.4, v0.2).
 *
 * "Contexto contábil/fiscal exige isso": não é telemetria, é auditoria — quem
 * rodou o quê, quando, com que resultado. A tela existe para responder essa
 * pergunta depois, então precisa filtrar por texto do SQL, por status, por
 * conexão e por autor, e paginar por keyset (o log cresce sem teto).
 *
 * Os filtros chegam como query string, então tudo é `string` na entrada e o
 * servidor normaliza. `limit` e `cursor` idem — keyset sobre (executed_at, id),
 * o mesmo padrão de `rows`.
 */

export const AuditStatus = t.Union([
  t.Literal("ok"),
  t.Literal("error"),
  t.Literal("cancelled"),
]);
export type AuditStatus = Static<typeof AuditStatus>;

export const AuditQuery = t.Object({
  /** Texto procurado dentro do SQL (LIKE, case-insensitive). */
  q: t.Optional(t.String({ maxLength: 200 })),
  status: t.Optional(AuditStatus),
  connectionId: t.Optional(t.String()),
  actor: t.Optional(t.String({ maxLength: 64 })),
  /** Query string → número no servidor; teto para não varrer o log inteiro. */
  limit: t.Optional(t.String()),
  /** Cursor keyset opaco: `executedAt|id` da última linha da página anterior. */
  cursor: t.Optional(t.String()),
});
export type AuditQuery = Static<typeof AuditQuery>;

export const AuditPage = t.Object({
  entries: t.Array(QueryLogEntry),
  /** `null` quando não há mais páginas. */
  nextCursor: t.Union([t.String(), t.Null()]),
});
export type AuditPage = Static<typeof AuditPage>;

/** Teto de linhas por página — o mesmo espírito do `maxRows` do executor. */
export const AUDIT_PAGE_SIZE = 50;
