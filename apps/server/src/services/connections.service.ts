import type { Connection, CreateConnection, TestConnectionResult, UpdateConnection } from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import { testConnection } from "../pg/test-connection";

import { type ServiceResult, fail, ok } from "./result";

export interface ConnectionsServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly caCert: string | undefined;
  /** Avisa quem mantém cache ou pool que aquela conexão mudou de forma. */
  readonly onConnectionChanged?: (id: string) => void;
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
  readonly #onChanged: (id: string) => void;

  constructor({ repository, caCert, onConnectionChanged }: ConnectionsServiceDeps) {
    this.#repository = repository;
    this.#caCert = caCert;
    this.#onChanged = onConnectionChanged ?? ((): void => undefined);
  }

  list(): Connection[] {
    return this.#repository.list();
  }

  create(input: CreateConnection): Connection {
    return this.#repository.create(input);
  }

  update(id: string, patch: UpdateConnection): ServiceResult<Connection> {
    const updated = this.#repository.update(id, patch);
    if (updated === null) return fail("not_found");
    this.#onChanged(id);
    return ok(updated);
  }

  remove(id: string): ServiceResult<void> {
    if (!this.#repository.delete(id)) return fail("not_found");
    this.#onChanged(id);
    return ok(undefined);
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
