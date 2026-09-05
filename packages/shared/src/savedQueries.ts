import { t, type Static } from "elysia";

/**
 * Queries salvas (DBee.md §5, tabela `saved_queries` da migration 001).
 *
 * A tabela existe desde o começo e não tinha consumidor. Uma lista simples:
 * salvar a query da aba com nome, listar/abrir/renomear/excluir, buscar por nome
 * e por conteúdo. Sem pastas, sem compartilhamento entre usuários, sem
 * versionamento — a lista é global (a tabela não tem dono), como já era.
 *
 * `connectionId` viaja junto: abrir a query salva cria uma aba atrelada à
 * conexão de origem. É anulável porque a conexão pode ter sido apagada depois
 * (a FK é `ON DELETE SET NULL`), e uma query salva não deve sumir com ela.
 */
export const SavedQuery = t.Object({
  id: t.String(),
  name: t.String(),
  sql: t.String(),
  connectionId: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});
export type SavedQuery = Static<typeof SavedQuery>;

export const SaveQueryRequest = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  sql: t.String({ minLength: 1, maxLength: 1_000_000 }),
  connectionId: t.Optional(t.Union([t.String(), t.Null()])),
});
export type SaveQueryRequest = Static<typeof SaveQueryRequest>;

/** Renomear (o único campo editável na fatia). */
export const RenameQueryRequest = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
});
export type RenameQueryRequest = Static<typeof RenameQueryRequest>;

export const SavedQueryList = t.Array(SavedQuery);
export type SavedQueryList = Static<typeof SavedQueryList>;
