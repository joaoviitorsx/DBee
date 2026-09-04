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
   * completas. Com `max: 5` no pool, as excedentes ficam na fila e morrem por
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

    if (!refresh) {
      const hit = this.#cache.get(connectionId)?.get(target);
      if (hit !== undefined && hit.expiresAt > now) {
        return ok(Object.freeze({ ...hit.value, cached: true }));
      }
    }

    // Banco fora do ar, credencial errada, timeout: é falha do upstream, não
    // 500 do DBee. A mensagem do Postgres vai junto (CLAUDE.md) e nunca inclui
    // a senha, que o driver não repete no erro.
    const emVooKey = `${connectionId}\u001f${target}`;
    let fresh: DatabaseSchema;
    try {
      // Quem chegar enquanto a introspecção roda espera a mesma promessa.
      let voo = this.#emVoo.get(emVooKey);
      if (voo === undefined) {
        voo = this.#pools
          // repeatable-read: as quatro consultas de catálogo precisam ver o
          // mesmo instante, senão um DDL no meio produz relação sem coluna.
          .withReadOnly(
            connection,
            target,
            (client) => introspect(client, target),
            "repeatable-read",
          )
          .finally(() => {
            this.#emVoo.delete(emVooKey);
          });
        this.#emVoo.set(emVooKey, voo);
      }
      fresh = await voo;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      return fail("upstream_error", message);
    }

    let byDatabase = this.#cache.get(connectionId);
    if (byDatabase === undefined) {
      byDatabase = new Map();
      this.#cache.set(connectionId, byDatabase);
    }
    // TTL contado a partir de AGORA, não do início da requisição: uma
    // introspecção longa nasceria com a entrada já expirada, e o cache pararia
    // de funcionar justamente no banco em que ele mais importa.
    byDatabase.set(target, { value: fresh, expiresAt: Date.now() + TTL_MS });

    // Congelado: a mesma referência é servida a toda requisição seguinte, e um
    // consumidor que a mutasse envenenaria o cache.
    return ok(Object.freeze({ ...fresh }));
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
