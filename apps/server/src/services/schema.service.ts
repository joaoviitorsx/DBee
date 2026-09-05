import type {
  ActivityList,
  DatabaseInfo,
  DatabaseSchema,
  DatabasesOverview,
} from "@dbee/shared";

import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import { introspect, listActivity, listDatabases, overviewDatabases } from "../pg/introspect";
import type { PoolManager } from "../pg/pool";
import { type ServiceResult, fail, ok } from "./result";

/** TTL do cache em memória (DBee.md §5). */
const TTL_MS = 5 * 60_000;

interface CacheEntry {
  readonly value: DatabaseSchema;
  readonly expiresAt: number;
}

export interface SchemaServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
}

/**
 * Introspecção de schema com cache em memória.
 *
 * O cache é por (conexão, database) e vive só no processo — uma instância só,
 * sem store distribuído (DBee.md §7). Some no restart, que é o comportamento
 * certo: schema mudou e o app reiniciou, ninguém quer ver a árvore velha.
 */
export class SchemaService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  /**
   * `connectionId -> database -> entrada`, aninhado. Mesma razão do
   * PoolManager: chave composta obriga a casar prefixo no evict e depende de um
   * separador que não apareça nos dois lados.
   */
  readonly #cache = new Map<string, Map<string, CacheEntry>>();

  /**
   * Introspecções em voo, por (conexão, database).
   *
   * Sem isto, N requisições simultâneas na mesma chave viram N introspecções
   * completas. Com `max: 3` no pool, as excedentes ficam na fila e morrem por
   * `connectionTimeoutMillis`, virando 502 — o DBee culpando o Postgres por uma
   * fila que ele mesmo criou.
   */
  readonly #emVoo = new Map<string, Promise<DatabaseSchema>>();

  constructor({ repository, pools }: SchemaServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
  }

  async get(
    connectionId: string,
    database: string | undefined,
    refresh: boolean,
    now = Date.now(),
  ): Promise<ServiceResult<DatabaseSchema>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    // Sem `?database`, usa o database da própria conexão.
    const target = database ?? connection.database;

    const emVooKey = `${connectionId}\u001f${target}`;
    const hit = this.#cache.get(connectionId)?.get(target);

    if (!refresh && hit !== undefined) {
      if (hit.expiresAt > now) {
        // Fresco: serve do cache, sem tocar no banco.
        return ok(Object.freeze({ ...hit.value, cached: true }));
      }
      /*
       * Stale-while-revalidate (ATRITO, auditoria de perf).
       *
       * A entrada venceu, mas em vez de **bloquear** a introspeccao (498 ms
       * local / 872 ms com RTT de 20 ms, num momento imprevisivel o dia
       * inteiro), serve o valor vencido na hora e revalida em background. A
       * proxima requisicao pega o fresco. Erro na revalidacao nao derruba esta
       * resposta -- o vencido ainda serve, e o erro reaparece no proximo get
       * que precisar buscar de fato. O botao "Recarregar catalogo" (refresh)
       * continua sendo a garantia de valor fresco para quem quer certeza.
       */
      void this.#revalidar(connectionId, connection, target, emVooKey).catch(() => undefined);
      return ok(Object.freeze({ ...hit.value, cached: true }));
    }

    // Nada em cache, ou refresh explicito: aqui nao ha velho a servir, entao
    // espera o fresco. Falha do upstream (banco fora, credencial errada,
    // timeout) e do upstream, nao 500 do DBee; a mensagem do Postgres vai junto
    // (CLAUDE.md) e nunca inclui a senha, que o driver nao repete no erro.
    let fresh: DatabaseSchema;
    try {
      fresh = await this.#revalidar(connectionId, connection, target, emVooKey);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      return fail("upstream_error", message);
    }
    // Congelado: a mesma referencia e servida a toda requisicao seguinte, e um
    // consumidor que a mutasse envenenaria o cache.
    return ok(Object.freeze({ ...fresh }));
  }

  /**
   * Introspecta com dedup por (conexao, database) e escreve no cache no
   * sucesso. Serve os dois caminhos: o sincrono (miss/refresh, aguardado) e o
   * de background do stale-while-revalidate (disparado sem await).
   */
  #revalidar(
    connectionId: string,
    connection: ResolvedConnection,
    target: string,
    emVooKey: string,
  ): Promise<DatabaseSchema> {
    let voo = this.#emVoo.get(emVooKey);
    if (voo === undefined) {
      voo = this.#pools
        // repeatable-read: as quatro consultas de catalogo precisam ver o mesmo
        // instante, senao um DDL no meio produz relacao sem coluna.
        .withReadOnly(connection, target, (client) => introspect(client, target), "repeatable-read")
        .then((fresh) => {
          let byDatabase = this.#cache.get(connectionId);
          if (byDatabase === undefined) {
            byDatabase = new Map();
            this.#cache.set(connectionId, byDatabase);
          }
          // TTL a partir de AGORA, nao do inicio: introspeccao longa nasceria
          // com a entrada ja vencida.
          byDatabase.set(target, { value: fresh, expiresAt: Date.now() + TTL_MS });
          return fresh;
        })
        .finally(() => {
          this.#emVoo.delete(emVooKey);
        });
      this.#emVoo.set(emVooKey, voo);
    }
    return voo;
  }

  /**
   * Databases do cluster. Sem cache: a lista é curta, muda pouco, e é o
   * primeiro nível que o usuário expande — servir um valor velho aqui esconde
   * um database recém-criado justo quando ele é procurado.
   */
  async databases(connectionId: string): Promise<ServiceResult<DatabaseInfo[]>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    try {
      return ok(
        await this.#pools.withReadOnly(connection, connection.database, (client) =>
          listDatabases(client, connection.database),
        ),
      );
    } catch (err: unknown) {
      return fail("upstream_error", err instanceof Error ? err.message : "erro desconhecido");
    }
  }

  /**
   * Visão geral dos databases: tamanho, encoding, dono, conexões. Sem cache,
   * como a lista de databases — é um instantâneo, e servir tamanho velho seria
   * enganar quem está justamente olhando quanto o banco cresceu.
   */
  async databasesOverview(connectionId: string): Promise<ServiceResult<DatabasesOverview>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    try {
      return ok(
        await this.#pools.withReadOnly(connection, connection.database, async (client) => {
          const databases = await overviewDatabases(client, connection.database);
          const versao = await client.query<{ v: string }>("SELECT version() AS v");
          return { databases, serverVersion: versao.rows[0]?.v ?? "desconhecida" };
        }),
      );
    } catch (err: unknown) {
      return fail("upstream_error", err instanceof Error ? err.message : "erro desconhecido");
    }
  }

  /**
   * O que está rodando no servidor agora (`pg_stat_activity`). Um instantâneo,
   * relido a cada chamada — o front decide se atualiza sozinho.
   */
  async activity(connectionId: string): Promise<ServiceResult<ActivityList>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    try {
      return ok(
        await this.#pools.withReadOnly(connection, connection.database, async (client) => ({
          sessions: await listActivity(client),
          fetchedAt: new Date().toISOString(),
        })),
      );
    } catch (err: unknown) {
      return fail("upstream_error", err instanceof Error ? err.message : "erro desconhecido");
    }
  }

  /** Invalida o cache de uma conexão — ao editá-la ou apagá-la. */
  evict(connectionId: string): void {
    this.#cache.delete(connectionId);
  }

  /** Introspecções em voo — para teste e diagnóstico. */
  get inFlight(): number {
    return this.#emVoo.size;
  }

  /** Entradas em cache, somando todos os databases de todas as conexões. */
  get cacheSize(): number {
    let total = 0;
    for (const byDatabase of this.#cache.values()) total += byDatabase.size;
    return total;
  }
}
