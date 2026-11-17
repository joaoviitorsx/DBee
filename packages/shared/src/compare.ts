import { t, type Static } from "elysia";

/**
 * Data compare e schema compare (ADR 018). **Só leitura; o SQL sai como
 * texto** para o editor — o DBee nunca aplica (teste 4 da fronteira, ADR 006).
 * Permissão por conexão nos dois lados: cada lado é resolvido pelo ator.
 */

// ── Data compare ────────────────────────────────────────────────────────────

export const DataCompareSide = t.Object({
  connectionId: t.String({ minLength: 1, maxLength: 64 }),
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  schema: t.String({ minLength: 1, maxLength: 128 }),
  table: t.String({ minLength: 1, maxLength: 128 }),
});
export type DataCompareSide = Static<typeof DataCompareSide>;

/** Teto de linhas lidas por lado. Passou disso, a resposta diz `truncated`. */
export const DATA_COMPARE_MAX_ROWS = 50_000;

export const DataCompareRequest = t.Object({
  /** A referência: o SQL gerado leva `right` a ficar igual a `left`. */
  left: DataCompareSide,
  right: DataCompareSide,
  maxRows: t.Optional(t.Integer({ minimum: 1, maximum: DATA_COMPARE_MAX_ROWS })),
  sampleSize: t.Optional(t.Integer({ minimum: 0, maximum: 500 })),
});
export type DataCompareRequest = Static<typeof DataCompareRequest>;

export const DataCompareKind = t.Union([t.Literal("only_left"), t.Literal("only_right"), t.Literal("different")]);
export type DataCompareKind = Static<typeof DataCompareKind>;

const Linha = t.Array(t.Union([t.String(), t.Null()]));

export const DataCompareSample = t.Object({
  kind: DataCompareKind,
  /** Valores da PK, na ordem de `primaryKey`. */
  key: t.Array(t.Union([t.String(), t.Null()])),
  /** Na ordem de `columns`; `null` no lado onde a linha não existe. */
  left: t.Union([Linha, t.Null()]),
  right: t.Union([Linha, t.Null()]),
  changedColumns: t.Array(t.String()),
});
export type DataCompareSample = Static<typeof DataCompareSample>;

export const DataCompareResponse = t.Object({
  primaryKey: t.Array(t.String()),
  /** Colunas comparadas: as que existem nos dois lados. */
  columns: t.Array(t.String()),
  /** Colunas presentes num lado só — não comparadas, ditas para não enganar. */
  ignoredColumns: t.Array(t.String()),
  onlyLeft: t.Integer(),
  onlyRight: t.Integer(),
  different: t.Integer(),
  equal: t.Integer(),
  /** Algum lado tinha mais que `maxRows`: as contagens são parciais. */
  truncated: t.Boolean(),
  samples: t.Array(DataCompareSample),
  /** INSERT/UPDATE/DELETE no dialeto de `right`, como TEXTO. Nunca executado. */
  sql: t.String(),
});
export type DataCompareResponse = Static<typeof DataCompareResponse>;

// ── Schema compare ──────────────────────────────────────────────────────────

export const SchemaCompareSide = t.Object({
  connectionId: t.String({ minLength: 1, maxLength: 64 }),
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  schema: t.String({ minLength: 1, maxLength: 128 }),
});
export type SchemaCompareSide = Static<typeof SchemaCompareSide>;

export const SchemaCompareRequest = t.Object({
  left: SchemaCompareSide,
  right: SchemaCompareSide,
});
export type SchemaCompareRequest = Static<typeof SchemaCompareRequest>;

export const SchemaDiffKind = t.Union([
  t.Literal("table_only_left"),
  t.Literal("table_only_right"),
  t.Literal("column_only_left"),
  t.Literal("column_only_right"),
  t.Literal("column_type"),
  t.Literal("column_nullable"),
  t.Literal("column_default"),
  t.Literal("index_only_left"),
  t.Literal("index_only_right"),
  t.Literal("fk_only_left"),
  t.Literal("fk_only_right"),
]);
export type SchemaDiffKind = Static<typeof SchemaDiffKind>;

export const SchemaDiff = t.Object({
  kind: SchemaDiffKind,
  table: t.String(),
  /** Coluna, índice ou FK; `null` em diferença de tabela. */
  name: t.Union([t.String(), t.Null()]),
  left: t.Union([t.String(), t.Null()]),
  right: t.Union([t.String(), t.Null()]),
});
export type SchemaDiff = Static<typeof SchemaDiff>;

export const SchemaCompareResponse = t.Object({
  differences: t.Array(SchemaDiff),
  /**
   * DDL sugerido (Postgres) para levar `right` a `left`, como TEXTO. Remoções
   * (DROP) saem **comentadas** — destrutivo nunca vem pronto para rodar (ADR 010).
   */
  ddl: t.String(),
});
export type SchemaCompareResponse = Static<typeof SchemaCompareResponse>;
