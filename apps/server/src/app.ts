import { Elysia } from "elysia";

import { HealthResponse } from "@dbee/shared";

import { ConnectionsRepository } from "./db/connections.repo";
import { UsersRepository } from "./db/users.repo";
import { QueryLogRepository } from "./db/queryLog.repo";
import type { Store } from "./db/client";
import { PoolManager } from "./pg/pool";
import { authRoutes } from "./routes/auth";
import { connectionsRoutes } from "./routes/connections";
import { errorHandler } from "./routes/errors";
import { exportRoutes } from "./routes/export";
import { sessionGuard } from "./routes/guard";
import { queryRoutes } from "./routes/query";
import { rowsRoutes } from "./routes/rows";
import { schemaRoutes } from "./routes/schema";
import { AuthService } from "./services/auth.service";
import { ConnectionsService } from "./services/connections.service";
import { ExportService } from "./services/export.service";
import { QueryService } from "./services/query.service";
import { RowsService } from "./services/rows.service";
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
  const users = new UsersRepository(store.db);
  const auth = new AuthService({ users });
  const schema = new SchemaService({ repository, pools });
  const log = new QueryLogRepository(store.db);
  const query = new QueryService({ repository, pools, log });
  const rows = new RowsService({ repository, pools, schema, log });
  const exportar = new ExportService({ repository, pools, schema, log });

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

  return (
    new Elysia({ prefix: "/api" })
      // Antes de qualquer rota: o formato de erro padrão do Elysia ecoa o corpo
      // submetido, senha inclusive.
      .use(errorHandler)
      /*
       * O guard vem **antes de toda rota registrada abaixo**, e a ordem é o
       * mecanismo: hook global do Elysia vale para o que vem depois do `.use()`.
       * Uma rota registrada acima desta linha ficaria aberta sem nada acusar —
       * é por isso que `guard.test.ts` varre `app.routes` em vez de conferir
       * rota a rota.
       *
       * `/health` está registrada depois e mesmo assim responde sem sessão:
       * quem a libera é a lista `ROTAS_ABERTAS`, explícita e testada, não a
       * posição no arquivo.
       */
      .use(sessionGuard(users))
      // Toda rota declara `response`. Não é formalidade: foi a validação de
      // resposta que pegou o `array_agg` devolvendo string crua em vez de array
      // (DBee.md §11.17) — bug que nenhum teste cobria e que teria chegado à UI.
      .get("/health", () => ({ status: "ok" }) as const, { response: { 200: HealthResponse } })
      .use(authRoutes(auth, users))
      .use(connectionsRoutes(connections))
      .use(schemaRoutes(schema))
      .use(queryRoutes(query, users))
      .use(rowsRoutes(rows, users))
      .use(exportRoutes(exportar, users))
  );
}

/** Tipo consumido pelo Eden Treaty no front (DBee.md §3). */
export type App = ReturnType<typeof createApp>;
