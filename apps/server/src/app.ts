import { Elysia } from "elysia";

import { HealthResponse } from "@dbee/shared";

import { ConnectionsRepository } from "./db/connections.repo";
import { QueryLogRepository } from "./db/queryLog.repo";
import type { Store } from "./db/client";
import { PoolManager } from "./pg/pool";
import { connectionsRoutes } from "./routes/connections";
import { errorHandler } from "./routes/errors";
import { queryRoutes } from "./routes/query";
import { schemaRoutes } from "./routes/schema";
import { ConnectionsService } from "./services/connections.service";
import { QueryService } from "./services/query.service";
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
  const query = new QueryService({ repository, pools, log: new QueryLogRepository(store.db) });

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
    // Antes de qualquer rota: o formato de erro padrão do Elysia ecoa o corpo
    // submetido, senha inclusive.
    .use(errorHandler)
    // Toda rota declara `response`. Não é formalidade: foi a validação de
    // resposta que pegou o `array_agg` devolvendo string crua em vez de array
    // (DBee.md §11.17) — bug que nenhum teste cobria e que teria chegado à UI.
    .get("/health", () => ({ status: "ok" }) as const, { response: { 200: HealthResponse } })
    .use(connectionsRoutes(connections))
    .use(schemaRoutes(schema))
    .use(queryRoutes(query));
}

/** Tipo consumido pelo Eden Treaty no front (DBee.md §3). */
export type App = ReturnType<typeof createApp>;
