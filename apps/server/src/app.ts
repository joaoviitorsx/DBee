import { Elysia } from "elysia";

import { HealthResponse } from "@dbee/shared";

import { ConnectionsRepository } from "./db/connections.repo";
import { SettingsRepository } from "./db/settings.repo";
import { UsersRepository } from "./db/users.repo";
import { QueryLogRepository } from "./db/queryLog.repo";
import { SavedQueriesRepository } from "./db/savedQueries.repo";
import { Drivers } from "./driver/registro";
import { MutationService } from "./services/mutation.service";
import { AuditService } from "./services/audit.service";
import type { Store } from "./db/client";
import { PoolManager } from "./pg/pool";
import { auditRoutes } from "./routes/audit";
import { authRoutes } from "./routes/auth";
import { connectionsRoutes } from "./routes/connections";
import { ddlRoutes } from "./routes/ddl";
import { errorHandler } from "./routes/errors";
import { exportRoutes } from "./routes/export";
import { sessionGuard } from "./routes/guard";
import { metaRoutes } from "./routes/meta";
import { mutationRoutes } from "./routes/mutation";
import { queryRoutes } from "./routes/query";
import { rowsRoutes } from "./routes/rows";
import { savedQueriesRoutes } from "./routes/savedQueries";
import { usersRoutes } from "./routes/users";
import { schemaRoutes } from "./routes/schema";
import { AuthService } from "./services/auth.service";
import { ConnectionsService } from "./services/connections.service";
import { ExportService } from "./services/export.service";
import { QueryService } from "./services/query.service";
import { RowsService } from "./services/rows.service";
import { DdlService } from "./services/ddl.service";
import { UsersService } from "./services/users.service";
import { SchemaService } from "./services/schema.service";
import { UpdateService, versaoDoBinario } from "./services/update.service";

export interface AppDeps {
  readonly store: Store;
  readonly caCert: string | undefined;
  readonly pools?: PoolManager;
  /** Diretório de dados — leva o `setup-token` ao `AuthService`. Ver §7. */
  readonly dataDir?: string;
  /**
   * Releases API consultada pelo aviso de versão (§8). Existe para o teste
   * apontar para um servidor local: sem isso a suíte dependeria da
   * api.github.com estar de pé, e um teste que precisa de internet é um teste
   * que falha por motivo errado.
   */
  readonly releasesApi?: string;
}

/**
 * Composição da API — o único lugar que conhece todas as camadas.
 *
 *   rota (HTTP)  →  serviço (regra)  →  repositório (SQLite) / pg (Postgres)
 *
 * Recebe as dependências prontas em vez de abrir o banco por conta própria: é
 * o que permite o teste rodar contra um SQLite em memória.
 */
export function createApp({
  store,
  caCert,
  pools = new PoolManager(caCert),
  dataDir,
  releasesApi,
}: AppDeps) {
  const repository = new ConnectionsRepository(store.db, store.key);
  /*
   * Quem sabe falar com cada engine. Criado uma vez: cada driver é dono do seu
   * pool, e recriá-los por requisição abriria conexão nova a cada clique. O de
   * Postgres recebe o `PoolManager` que já existe, em vez de abrir um segundo.
   */
  const drivers = new Drivers(pools, caCert);
  const users = new UsersRepository(store.db);
  const auth = new AuthService({ users, dataDir });
  const schema = new SchemaService({ repository, pools, drivers });
  const log = new QueryLogRepository(store.db);
  const audit = new AuditService(log);
  const savedQueries = new SavedQueriesRepository(store.db);
  const query = new QueryService({ repository, log, drivers });
  const mutation = new MutationService({ repository, pools, log });
  const rows = new RowsService({ repository, pools, schema, log });
  const exportar = new ExportService({ repository, pools, schema, log });
  const ddl = new DdlService({ repository, pools, log });
  const usuarios = new UsersService(users);
  const update = new UpdateService({
    settings: new SettingsRepository(store.db, store.key),
    current: versaoDoBinario(),
    releasesApi,
  });

  const connections = new ConnectionsService({
    repository,
    caCert,
    drivers,
    // Editar ou apagar conexão invalida a árvore em cache e derruba os pools:
    // host, senha ou timezone mudaram, e o que estava aberto não vale mais.
    onConnectionChanged: (id) => {
      schema.evict(id);
      pools.evict(id);
      // Os drivers têm pools próprios (o de MySQL tem o seu): esquecer só o do
      // Postgres deixaria conexões MySQL falando com o servidor antigo.
      void drivers.esquecer(id);
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
      .use(connectionsRoutes(connections, users))
      .use(schemaRoutes(schema, users))
      .use(queryRoutes(query, users))
      .use(rowsRoutes(rows, users))
      .use(mutationRoutes(mutation, users))
      .use(exportRoutes(exportar, users))
      .use(auditRoutes(audit, users))
      .use(ddlRoutes(ddl, users))
      .use(savedQueriesRoutes(savedQueries))
      .use(usersRoutes(usuarios, users))
      .use(metaRoutes(update, users))
  );
}

/** Tipo consumido pelo Eden Treaty no front (DBee.md §3). */
export type App = ReturnType<typeof createApp>;
