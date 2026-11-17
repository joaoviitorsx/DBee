import { t, type Static } from "elysia";

import { RelationKind } from "./schema";

/**
 * Busca global (Cmd+K, roadmap-dbeaver item 9): `GET /search?q=&limit=`.
 *
 * Procura por **nome** em schemas, relações e colunas do catálogo **já em
 * cache** no servidor, nas conexões que o ator enxerga. Não consulta banco por
 * tecla: conexão nunca aberta não aparece até alguém expandi-la — e a resposta
 * diz quais conexões acessíveis ainda não têm catálogo (`semCatalogo`), para a
 * paleta oferecer "carregar".
 *
 * Colunas só aparecem de databases cujo catálogo **completo** já foi lido
 * (aba aberta); a árvore leve não tem colunas.
 */
export const SearchHitKind = t.Union([t.Literal("schema"), t.Literal("relation"), t.Literal("column")]);
export type SearchHitKind = Static<typeof SearchHitKind>;

export const SearchHit = t.Object({
  kind: SearchHitKind,
  connectionId: t.String(),
  connectionName: t.String(),
  database: t.String(),
  schema: t.String(),
  /** `null` em hit de schema. */
  relation: t.Union([t.String(), t.Null()]),
  relationKind: t.Union([RelationKind, t.Null()]),
  /** `null` exceto em hit de coluna. */
  column: t.Union([t.String(), t.Null()]),
});
export type SearchHit = Static<typeof SearchHit>;

export const SearchQuery = t.Object({
  q: t.String({ minLength: 1, maxLength: 100 }),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
});
export type SearchQuery = Static<typeof SearchQuery>;

export const SearchResponse = t.Object({
  hits: t.Array(SearchHit),
  /** `true` quando havia mais hits que `limit`. */
  truncated: t.Boolean(),
  /** Conexões acessíveis sem nenhum catálogo em cache. */
  semCatalogo: t.Array(t.Object({ id: t.String(), name: t.String() })),
});
export type SearchResponse = Static<typeof SearchResponse>;
