import { Elysia } from "elysia";

import { ConnectionsRepository } from "./db/connections.repo";
import type { Store } from "./db/client";
import { PoolManager } from "./pg/pool";
import { connectionsRoutes } from "./routes/connections";
import { schemaRoutes } from "./routes/schema";
import { ConnectionsService } from "./services/connections.service";
import { SchemaService } from "./services/schema.service";

export interface AppDeps {
  readonly store: Store;
  readonly caCert: string | undefined;
  readonly pools?: PoolManager;
}

/**
 * Composição da API — o único lugar que conhece todas as camadas.
 *
 *   rota (HTTP)  →  serviço (regra)  →  repositório (SQLite) / pg (Postgres)
 *
 * Recebe as dependências prontas em vez de abrir o banco por conta própria: é
 * o que permite o teste rodar contra um SQLite em memória.
 */
export function createApp({ store, caCert, pools = new PoolManager(caCert) }: AppDeps) {
  const repository = new ConnectionsRepository(store.db, store.key);
  const schema = new SchemaService({ repository, pools });

  const connections = new ConnectionsService({
    repository,
    caCert,
    // Editar ou apagar conexão invalida a árvore em cache e derruba os pools:
    // host, senha ou timezone mudaram, e o que estava aberto não vale mais.
    onConnectionChanged: (id) => {
      schema.evict(id);
      pools.evict(id);
    },
  });

  return new Elysia({ prefix: "/api" })
    .get("/health", () => ({ status: "ok" }))
    .use(connectionsRoutes(connections))
    .use(schemaRoutes(schema));
}

/** Tipo consumido pelo Eden Treaty no front (DBee.md §3). */
export type App = ReturnType<typeof createApp>;
