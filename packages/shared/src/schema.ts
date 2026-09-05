import { t, type Static } from "elysia";

/** Espelha `relkind` do `pg_class`, nos tipos que a árvore mostra. */
export const RelationKind = t.Union([
  t.Literal("table"),
  t.Literal("view"),
  t.Literal("materialized_view"),
  t.Literal("partitioned_table"),
  t.Literal("foreign_table"),
]);
export type RelationKind = Static<typeof RelationKind>;

export const Column = t.Object({
  name: t.String(),
  /** Nome canônico do tipo (`format_type`): "timestamp with time zone", "integer[]". */
  dataType: t.String(),
  /** OID do tipo, para a UI casar com o `dataTypeId` do resultado de query. */
  dataTypeId: t.Integer(),
  nullable: t.Boolean(),
  /** Expressão do default, como o Postgres a guarda. `null` se não houver. */
  defaultValue: t.Union([t.String(), t.Null()]),
  position: t.Integer(),
  isPrimaryKey: t.Boolean(),
  comment: t.Union([t.String(), t.Null()]),
});
export type Column = Static<typeof Column>;

export const ForeignKey = t.Object({
  name: t.String(),
  columns: t.Array(t.String()),
  referencedSchema: t.String(),
  referencedTable: t.String(),
  referencedColumns: t.Array(t.String()),
});
export type ForeignKey = Static<typeof ForeignKey>;

export const Index = t.Object({
  name: t.String(),
  columns: t.Array(t.String()),
  isUnique: t.Boolean(),
  isPrimary: t.Boolean(),
  /** `pg_get_indexdef` — a UI mostra literal quando o índice é uma expressão. */
  definition: t.String(),
});
export type Index = Static<typeof Index>;

export const Relation = t.Object({
  name: t.String(),
  kind: RelationKind,
  comment: t.Union([t.String(), t.Null()]),
  /** `reltuples` do planejador: estimativa, nunca `count(*)` — ver §6. */
  estimatedRows: t.Union([t.Integer(), t.Null()]),
  columns: t.Array(Column),
  primaryKey: t.Array(t.String()),
  foreignKeys: t.Array(ForeignKey),
  indexes: t.Array(Index),
});
export type Relation = Static<typeof Relation>;

export const SchemaNode = t.Object({
  name: t.String(),
  relations: t.Array(Relation),
});
export type SchemaNode = Static<typeof SchemaNode>;

export const DatabaseSchema = t.Object({
  database: t.String(),
  schemas: t.Array(SchemaNode),
  /** ISO 8601 de quando a árvore foi lida do banco. */
  fetchedAt: t.String(),
  /** `true` quando veio do cache em memória, sem tocar no Postgres. */
  cached: t.Boolean(),
});
export type DatabaseSchema = Static<typeof DatabaseSchema>;

/**
 * Árvore **leve** de navegação (`GET /connections/:id/schema/tree`).
 *
 * Só o que a árvore desenha: schema → relação (nome, tipo, estimativa). Sem
 * colunas, índices, FKs nem comentários — que são a maior parte do payload e só
 * interessam quando uma tabela é aberta. Num catálogo de 800 relações o `schema`
 * completo passa de 2,6 MB; esta versão fica em dezenas de KB (ATRITO). Os
 * detalhes vêm sob demanda por `GET /schema`.
 */
export const RelationTree = t.Object({
  name: t.String(),
  kind: RelationKind,
  estimatedRows: t.Union([t.Integer(), t.Null()]),
});
export type RelationTree = Static<typeof RelationTree>;

export const SchemaTreeNode = t.Object({
  name: t.String(),
  relations: t.Array(RelationTree),
});
export type SchemaTreeNode = Static<typeof SchemaTreeNode>;

export const DatabaseTree = t.Object({
  database: t.String(),
  schemas: t.Array(SchemaTreeNode),
  fetchedAt: t.String(),
  cached: t.Boolean(),
});
export type DatabaseTree = Static<typeof DatabaseTree>;

/** Um database do cluster (`GET /connections/:id/databases`). */
export const DatabaseInfo = t.Object({
  name: t.String(),
  /** `true` para o database configurado na conexão. */
  isDefault: t.Boolean(),
});
export type DatabaseInfo = Static<typeof DatabaseInfo>;
