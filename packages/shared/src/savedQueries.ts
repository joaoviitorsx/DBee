import { t, type Static } from "elysia";

/**
 * Queries salvas (DBee.md §5; dono e visibilidade: ADR 016, migration 014).
 *
 * `visibility`:
 * - `private` — só o dono vê;
 * - `team` — todo mundo vê, **desde que** enxergue a conexão de origem (a query
 *   de uma conexão sem concessão não aparece: o SQL dela é dado daquele banco).
 *
 * Editar/excluir: o dono, ou admin. `canEdit` já vem calculado para o ator da
 * requisição — a tela não reimplementa a regra.
 *
 * `connectionId` é anulável porque a FK é `ON DELETE SET NULL`. `ownerId` é
 * anulável porque as queries anteriores à migration 014 não têm dono conhecido.
 */
export const SavedQueryVisibility = t.Union([t.Literal("private"), t.Literal("team")]);
export type SavedQueryVisibility = Static<typeof SavedQueryVisibility>;

export const SavedQuery = t.Object({
  id: t.String(),
  name: t.String(),
  sql: t.String(),
  connectionId: t.Union([t.String(), t.Null()]),
  ownerId: t.Union([t.String(), t.Null()]),
  /** `username` do dono, para a lista dizer de quem é. */
  ownerName: t.Union([t.String(), t.Null()]),
  visibility: SavedQueryVisibility,
  canEdit: t.Boolean(),
  createdAt: t.String(),
  updatedAt: t.String(),
});
export type SavedQuery = Static<typeof SavedQuery>;

export const SaveQueryRequest = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  sql: t.String({ minLength: 1, maxLength: 1_000_000 }),
  connectionId: t.Optional(t.Union([t.String(), t.Null()])),
  /** Ausente = `private`: o padrão de campo ausente é o estado que expõe menos (ADR 016). */
  visibility: t.Optional(SavedQueryVisibility),
});
export type SaveQueryRequest = Static<typeof SaveQueryRequest>;

/** Edição parcial: nome, SQL e/ou visibilidade. Ao menos um campo. */
export const UpdateSavedQueryRequest = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    sql: t.Optional(t.String({ minLength: 1, maxLength: 1_000_000 })),
    visibility: t.Optional(SavedQueryVisibility),
  },
  { minProperties: 1 },
);
export type UpdateSavedQueryRequest = Static<typeof UpdateSavedQueryRequest>;

/** Nome antigo, mantido para o front que só renomeia. */
export const RenameQueryRequest = UpdateSavedQueryRequest;
export type RenameQueryRequest = UpdateSavedQueryRequest;

export const SavedQueryList = t.Array(SavedQuery);
export type SavedQueryList = Static<typeof SavedQueryList>;
