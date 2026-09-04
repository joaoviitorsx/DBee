import { Elysia } from "elysia";

import { ConnectionsRepository } from "./db/connections.repo";
import type { Store } from "./db/client";
import { connectionsRoutes } from "./routes/connections";
import { ConnectionsService } from "./services/connections.service";

export interface AppDeps {
  readonly store: Store;
  readonly caCert: string | undefined;
}

/**
 * Composição da API — o único lugar que conhece todas as camadas.
 *
 * Recebe as dependências prontas em vez de abrir o banco por conta própria: é
 * o que permite o teste rodar contra um SQLite em memória.
 *
 *   rota (HTTP)  →  serviço (regra)  →  repositório (SQLite) / pg (Postgres)
 */
export function createApp({ store, caCert }: AppDeps) {
  const repository = new ConnectionsRepository(store.db, store.key);
  const connections = new ConnectionsService({ repository, caCert });

  return new Elysia({ prefix: "/api" })
    .get("/health", () => ({ status: "ok" }))
    .use(connectionsRoutes(connections));
}

/** Tipo consumido pelo Eden Treaty no front (DBee.md §3). */
export type App = ReturnType<typeof createApp>;
