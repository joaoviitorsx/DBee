import { t, type Static } from "elysia";

import { MAX_IDENT } from "./ddl.puro";


/**
 * DDL **aditivo** por formulário: criar tabela e criar database (ADR 010).
 *
 * ## A linha é aditivo × destrutivo, não DDL × não-DDL
 *
 * O ADR 006 proibia "DDL por botão", mas o teste que gerou essa regra é o 4 —
 * *a ação é reversível pelo próprio usuário, com o que ele vê na tela?* O
 * exemplo dele é `DROP TABLE`: nada na tela desfaz um DROP. Criar tabela vazia
 * ou database vazio é a metade oposta — some sem levar nada junto, e o que foi
 * criado está visível na árvore. `DROP` e `ALTER` que perde dado continuam
 * gerando SQL para o editor.
 *
 * ## Por que nada aqui aceita SQL livre
 *
 * Estas rotas montam o comando **no servidor** a partir de campos estruturados:
 * identificadores citados, tipos de uma lista fechada, defaults que são literal
 * ou uma expressão de uma lista fechada. Não existe caminho por onde texto do
 * cliente vire cláusula SQL arbitrária.
 *
 * Isso não é zelo excessivo: o `CREATE DATABASE` **não roda dentro de
 * transação** (medido: `ERROR: CREATE DATABASE cannot run inside a transaction
 * block`), então ele precisa de um caminho de execução fora do `BEGIN` do
 * ADR 001 — o único no app. Um caminho assim que aceitasse SQL livre seria uma
 * porta lateral em volta do read-only. Aceitando só um nome e algumas opções
 * fechadas, ele só sabe emitir a forma que foi escrito para emitir.
 */


/**
 * Tipos oferecidos no formulário — lista **fechada**.
 *
 * Não é a lista completa do Postgres, e não deve ser: quem precisa de um tipo
 * exótico escreve o `CREATE TABLE` no editor, que é onde SQL livre pertence.
 * Aqui entra o que cobre uma tabela de trabalho.
 */
export const ColumnType = t.Union([
  t.Literal("bigserial"),
  t.Literal("serial"),
  t.Literal("bigint"),
  t.Literal("integer"),
  t.Literal("smallint"),
  t.Literal("numeric"),
  t.Literal("real"),
  t.Literal("double precision"),
  t.Literal("boolean"),
  t.Literal("text"),
  t.Literal("varchar"),
  t.Literal("char"),
  t.Literal("uuid"),
  t.Literal("date"),
  t.Literal("time"),
  t.Literal("timestamp"),
  t.Literal("timestamptz"),
  t.Literal("json"),
  t.Literal("jsonb"),
  t.Literal("bytea"),
  t.Literal("inet"),
]);
export type ColumnType = Static<typeof ColumnType>;




/**
 * Expressões aceitas como default, além de literal.
 *
 * Lista fechada porque default é a única parte do `CREATE TABLE` que seria uma
 * expressão SQL arbitrária. Quem precisa de outra escreve no editor.
 */
export const DefaultExpression = t.Union([
  t.Literal("now()"),
  t.Literal("current_date"),
  t.Literal("current_timestamp"),
  t.Literal("gen_random_uuid()"),
]);
export type DefaultExpression = Static<typeof DefaultExpression>;

export const NewColumn = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  type: ColumnType,
  /** `varchar(n)` / `char(n)` / `numeric(p, …)`. Ignorado nos demais tipos. */
  length: t.Optional(t.Integer({ minimum: 1, maximum: 10_000 })),
  /** Casas decimais de `numeric(p, s)`. */
  scale: t.Optional(t.Integer({ minimum: 0, maximum: 1000 })),
  notNull: t.Optional(t.Boolean()),
  primaryKey: t.Optional(t.Boolean()),
  unique: t.Optional(t.Boolean()),
  /** Literal — sai entre aspas simples, escapado. */
  defaultValue: t.Optional(t.String({ maxLength: 500 })),
  /** Expressão de lista fechada. Vence o `defaultValue` se os dois vierem. */
  defaultExpression: t.Optional(DefaultExpression),
});
export type NewColumn = Static<typeof NewColumn>;

export const CreateTableRequest = t.Object({
  database: t.String({ minLength: 1, maxLength: 100 }),
  schema: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  name: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  columns: t.Array(NewColumn, { minItems: 1, maxItems: 200 }),
  ifNotExists: t.Optional(t.Boolean()),
  comment: t.Optional(t.String({ maxLength: 1000 })),
});
export type CreateTableRequest = Static<typeof CreateTableRequest>;

/** Codificações oferecidas. `UTF8` é o único que este app recomenda. */
export const DatabaseEncoding = t.Union([
  t.Literal("UTF8"),
  t.Literal("LATIN1"),
  t.Literal("SQL_ASCII"),
]);
export type DatabaseEncoding = Static<typeof DatabaseEncoding>;

export const CreateDatabaseRequest = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  owner: t.Optional(t.String({ maxLength: MAX_IDENT })),
  encoding: t.Optional(DatabaseEncoding),
  /**
   * `template0` é o certo quando a codificação difere da do cluster; o Postgres
   * recusa `template1` nesse caso. Lista fechada.
   */
  template: t.Optional(t.Union([t.Literal("template0"), t.Literal("template1")])),
  lcCollate: t.Optional(t.String({ maxLength: 64 })),
  lcCtype: t.Optional(t.String({ maxLength: 64 })),
});
export type CreateDatabaseRequest = Static<typeof CreateDatabaseRequest>;

export const DdlResult = t.Object({
  ok: t.Literal(true),
  /** O comando exato que rodou — a UI mostra, e ele é o mesmo do `query_log`. */
  sql: t.String(),
});
export type DdlResult = Static<typeof DdlResult>;

export * from "./ddl.puro";
