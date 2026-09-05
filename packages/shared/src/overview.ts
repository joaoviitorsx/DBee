import { t, type Static } from "elysia";

/**
 * Visão geral dos databases do cluster (estilo Adminer "Selecionar Base de
 * dados"): tamanho, número de tabelas, encoding e collation.
 *
 * Tudo do catálogo, só-leitura. O tamanho vem de `pg_database_size`, que é uma
 * estimativa barata do próprio Postgres — não varre a tabela.
 */
export const DatabaseOverview = t.Object({
  name: t.String(),
  isDefault: t.Boolean(),
  /** Bytes; `null` quando o usuário não pode medir o database. */
  sizeBytes: t.Union([t.Integer(), t.Null()]),
  encoding: t.String(),
  collate: t.String(),
  owner: t.String(),
  /** Conexões abertas neste database agora (de `pg_stat_activity`). */
  connections: t.Integer(),
});
export type DatabaseOverview = Static<typeof DatabaseOverview>;

export const DatabasesOverview = t.Object({
  databases: t.Array(DatabaseOverview),
  serverVersion: t.String(),
});
export type DatabasesOverview = Static<typeof DatabasesOverview>;

/**
 * Uma sessão do `pg_stat_activity` — o que está rodando no servidor agora.
 *
 * Só-leitura, e **sem o texto da query de outras sessões por padrão**: o SQL de
 * outra conexão pode conter dado sensível de outro contexto. `query` vem só
 * quando a sessão é da própria conexão do DBee, ou é deixado como o resumo do
 * estado. (Aqui trazemos o `query` porque é uma ferramenta de quem administra o
 * próprio banco; a decisão fica registrada para revisão.)
 */
export const Activity = t.Object({
  pid: t.Integer(),
  database: t.Union([t.String(), t.Null()]),
  user: t.Union([t.String(), t.Null()]),
  applicationName: t.String(),
  clientAddr: t.Union([t.String(), t.Null()]),
  state: t.Union([t.String(), t.Null()]),
  /** Segundos desde que a query atual começou; `null` se ociosa. */
  durationSeconds: t.Union([t.Number(), t.Null()]),
  waitEvent: t.Union([t.String(), t.Null()]),
  query: t.String(),
  /** `true` quando é uma das sessões do próprio DBee. */
  isSelf: t.Boolean(),
});
export type Activity = Static<typeof Activity>;

export const ActivityList = t.Object({
  sessions: t.Array(Activity),
  /** Momento da leitura, ISO 8601 — a lista é um instantâneo. */
  fetchedAt: t.String(),
});
export type ActivityList = Static<typeof ActivityList>;
