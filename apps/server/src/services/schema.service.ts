import type { DatabaseSchema } from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import { introspect } from "../pg/introspect";
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
  readonly #cache = new Map<string, CacheEntry>();

  constructor({ repository, pools }: SchemaServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
  }

  static key(connectionId: string, database: string): string {
    return `${connectionId} ${database}`;
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
    const cacheKey = SchemaService.key(connectionId, target);

    if (!refresh) {
      const hit = this.#cache.get(cacheKey);
      if (hit !== undefined && hit.expiresAt > now) {
        return ok({ ...hit.value, cached: true });
      }
    }

    // Banco fora do ar, credencial errada, timeout: é falha do upstream, não
    // 500 do DBee. A mensagem do Postgres vai junto (CLAUDE.md) e nunca inclui
    // a senha, que o driver não repete no erro.
    let fresh;
    try {
      fresh = await this.#pools.withReadOnly(connection, target, (client) =>
        introspect(client, target),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      return fail("upstream_error", message);
    }

    this.#cache.set(cacheKey, { value: fresh, expiresAt: now + TTL_MS });
    return ok(fresh);
  }

  /** Invalida o cache de uma conexão — ao editá-la ou apagá-la. */
  evict(connectionId: string): void {
    for (const key of this.#cache.keys()) {
      if (key.startsWith(`${connectionId} `)) this.#cache.delete(key);
    }
  }

  get cacheSize(): number {
    return this.#cache.size;
  }
}
