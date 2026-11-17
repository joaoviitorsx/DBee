import { t, type Static } from "elysia";

/**
 * Buscar valor no banco (ADR 023): `POST /connections/:id/value-search`.
 *
 * Procura um valor nas colunas texto (e numéricas, se o valor for número) das
 * tabelas de um **escopo obrigatório** — um schema inteiro ou uma lista de
 * tabelas. Roda em `BEGIN READ ONLY`, com `statement_timeout` curto por tabela,
 * teto de tabelas e de ocorrências por tabela. Diferente do `/search` (Cmd+K),
 * que casa **nomes** no catálogo em cache sem tocar no banco.
 */
export const ValueSearchScope = t.Union([
  t.Object({ schema: t.String({ minLength: 1, maxLength: 128 }) }),
  t.Object({
    tables: t.Array(
      t.Object({
        schema: t.String({ minLength: 1, maxLength: 128 }),
        name: t.String({ minLength: 1, maxLength: 128 }),
      }),
      { minItems: 1, maxItems: 200 },
    ),
  }),
]);
export type ValueSearchScope = Static<typeof ValueSearchScope>;

export const ValueSearchRequest = t.Object({
  database: t.Optional(t.String({ minLength: 1 })),
  value: t.String({ minLength: 1, maxLength: 200 }),
  /** `contains` (padrão): `ILIKE '%v%'` nas colunas texto. `exact`: igualdade. */
  mode: t.Optional(t.Union([t.Literal("contains"), t.Literal("exact")])),
  scope: ValueSearchScope,
  /** Para `POST .../value-search/cancel`. UUID gerado no cliente. */
  queryId: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
});
export type ValueSearchRequest = Static<typeof ValueSearchRequest>;

export const ValueSearchHit = t.Object({
  schema: t.String(),
  table: t.String(),
  column: t.String(),
  /** Valores da PK da linha (texto), ou `null` se a tabela não tem PK. */
  pk: t.Union([t.Record(t.String(), t.Union([t.String(), t.Null()])), t.Null()]),
  /** O valor da célula, cortado em 200 caracteres. */
  value: t.Union([t.String(), t.Null()]),
});
export type ValueSearchHit = Static<typeof ValueSearchHit>;

export const ValueSearchTableStatus = t.Object({
  schema: t.String(),
  table: t.String(),
  /** `truncated`: bateu no teto de ocorrências da tabela. */
  status: t.Union([
    t.Literal("ok"),
    t.Literal("truncated"),
    t.Literal("timeout"),
    t.Literal("error"),
  ]),
  hits: t.Integer(),
  error: t.Union([t.String(), t.Null()]),
});
export type ValueSearchTableStatus = Static<typeof ValueSearchTableStatus>;

export const ValueSearchResponse = t.Object({
  hits: t.Array(ValueSearchHit),
  /** Só tabelas com ao menos uma coluna compatível. */
  tables: t.Array(ValueSearchTableStatus),
  /** O escopo tinha mais tabelas compatíveis que o teto; as excedentes não foram lidas. */
  tablesSkipped: t.Integer(),
  cancelled: t.Boolean(),
  durationMs: t.Integer(),
});
export type ValueSearchResponse = Static<typeof ValueSearchResponse>;

export const ValueSearchCancelRequest = t.Object({ queryId: t.String({ minLength: 1, maxLength: 64 }) });
export const ValueSearchCancelResponse = t.Object({ cancelled: t.Boolean() });
