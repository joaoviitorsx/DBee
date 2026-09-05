import { t, type Static } from "elysia";

/** Direção da ordenação. A PK herda a mesma, para o keyset ser válido. */
export const SortDirection = t.Union([t.Literal("asc"), t.Literal("desc")]);
export type SortDirection = Static<typeof SortDirection>;

/**
 * Operadores de filtro.
 *
 * Lista fechada de propósito: o operador vira SQL, então ele não pode vir do
 * cliente como texto. O **valor** vai por parâmetro ligado.
 */
export const FilterOperator = t.Union([
  t.Literal("eq"),
  t.Literal("ne"),
  t.Literal("lt"),
  t.Literal("lte"),
  t.Literal("gt"),
  t.Literal("gte"),
  t.Literal("contains"),
  t.Literal("startsWith"),
  t.Literal("isNull"),
  t.Literal("isNotNull"),
]);
export type FilterOperator = Static<typeof FilterOperator>;

export const RowFilter = t.Object({
  /** Validado contra o catálogo, nunca escapado à mão. */
  column: t.String({ minLength: 1, maxLength: 63 }),
  operator: FilterOperator,
  /** Ausente para `isNull` / `isNotNull`. */
  value: t.Optional(t.String({ maxLength: 10_000 })),
});
export type RowFilter = Static<typeof RowFilter>;

/**
 * Cursor de keyset.
 *
 * Carrega o valor da coluna de ordenação e os valores da PK da última linha —
 * é o que faz a página 400 custar o mesmo que a página 2. `orderValueIsNull`
 * existe porque NULL quebra comparação de linha: uma vez na região dos NULL, a
 * condição muda de forma.
 */
export const RowCursor = t.Object({
  orderValue: t.Union([t.String(), t.Null()]),
  orderValueIsNull: t.Boolean(),
  primaryKey: t.Array(t.String()),
});
export type RowCursor = Static<typeof RowCursor>;

export const RowsRequest = t.Object({
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 1000 })),
  orderBy: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
  orderDirection: t.Optional(SortDirection),
  filters: t.Optional(t.Array(RowFilter, { maxItems: 20 })),
  after: t.Optional(RowCursor),
  /** Só para tabela SEM chave primária, onde keyset é impossível. */
  offset: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
});
export type RowsRequest = Static<typeof RowsRequest>;

export const RowsResponse = t.Object({
  columns: t.Array(
    t.Object({ name: t.String(), dataTypeId: t.Integer(), dataTypeName: t.String() }),
  ),
  rows: t.Array(t.Array(t.Union([t.String(), t.Null()]))),
  /** Cursor da próxima página. `null` quando acabou ou quando não há PK. */
  nextCursor: t.Union([RowCursor, t.Null()]),
  hasMore: t.Boolean(),
  durationMs: t.Integer(),
  /**
   * `false` quando a relação não tem chave primária.
   *
   * A UI **precisa** dizer isso ao usuário: sem PK a navegação cai para
   * `OFFSET`, que degrada em tabela grande, e a ordem entre páginas pode
   * repetir ou pular linha. Fingir que funciona é pior que avisar.
   */
  keyset: t.Boolean(),
  primaryKey: t.Array(t.String()),
});
export type RowsResponse = Static<typeof RowsResponse>;
