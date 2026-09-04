import type { Connection, CreateConnection, TestConnectionResult, UpdateConnection } from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import { testConnection } from "../pg/test-connection";

/**
 * Falhas de domínio. A camada de serviço não conhece HTTP: quem traduz para
 * status é a rota. Assim a mesma regra serve a uma futura CLI ou job sem
 * arrastar Elysia junto.
 */
export type ServiceFailure = "not_found" | "decryption_failed";

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ServiceFailure };

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = <T>(failure: ServiceFailure): ServiceResult<T> => ({ ok: false, failure });

export interface ConnectionsServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly caCert: string | undefined;
}

/**
 * Orquestra persistência (SQLite) e mundo externo (Postgres).
 *
 * A rota acima só traduz HTTP; o repositório abaixo só fala SQL. Toda regra que
 * envolve os dois mora aqui.
 */
export class ConnectionsService {
  readonly #repository: ConnectionsRepository;
  readonly #caCert: string | undefined;

  constructor({ repository, caCert }: ConnectionsServiceDeps) {
    this.#repository = repository;
    this.#caCert = caCert;
  }

  list(): Connection[] {
    return this.#repository.list();
  }

  create(input: CreateConnection): Connection {
    return this.#repository.create(input);
  }

  update(id: string, patch: UpdateConnection): ServiceResult<Connection> {
    const updated = this.#repository.update(id, patch);
    return updated === null ? fail("not_found") : ok(updated);
  }

  remove(id: string): ServiceResult<void> {
    return this.#repository.delete(id) ? ok(undefined) : fail("not_found");
  }

  /**
   * Decifrar a senha pode falhar se o `APP_SECRET` mudou (DBee.md §11.5). Isso
   * é condição esperada, então vira falha tipada em vez de exceção solta.
   */
  async test(id: string): Promise<ServiceResult<TestConnectionResult>> {
    let resolved;
    try {
      resolved = this.#repository.resolve(id);
    } catch {
      return fail("decryption_failed");
    }
    if (resolved === null) return fail("not_found");

    return ok(await testConnection(resolved, this.#caCert));
  }
}
