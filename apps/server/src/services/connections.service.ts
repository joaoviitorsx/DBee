import type { Connection, CreateConnection, TestConnectionResult, UpdateConnection } from "@dbee/shared";

import type { ConnectionGrant } from "@dbee/shared";

import type { Ator } from "../lib/ator";
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

  /** Só o que este ator enxerga (migração 005). Admin vê tudo. */
  list(ator: Ator): Connection[] {
    return this.#repository.list(ator);
  }

  /**
   * Quem tem acesso a esta conexão, com o nome de cada um.
   *
   * O `username` vem junto porque a tela precisa dele e buscar usuário por
   * usuário no front seria N+1 sobre a rede. O id sozinho não diz nada a
   * ninguém.
   */
  acessos(connectionId: string, usuarios: readonly { id: string; username: string }[]): ConnectionGrant[] {
    const nomePorId = new Map(usuarios.map((u) => [u.id, u.username]));
    return this.#repository
      .acessos(connectionId)
      .map((a) => ({ ...a, username: nomePorId.get(a.userId) ?? a.userId }));
  }

  conceder(connectionId: string, userId: string, canWrite: boolean, por: string): void {
    this.#repository.conceder(connectionId, userId, canWrite, por);
    // O pool guarda a conexão resolvida; a permissão mudou, então o que estava
    // aberto sob a regra antiga tem de cair.
    this.#onChanged(connectionId);
  }

  revogar(connectionId: string, userId: string): void {
    this.#repository.revogar(connectionId, userId);
    this.#onChanged(connectionId);
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
  async test(id: string, ator: Ator): Promise<ServiceResult<TestConnectionResult>> {
    let resolved;
    try {
      resolved = this.#repository.resolve(id, ator);
    } catch {
      return fail("decryption_failed");
    }
    if (resolved === null) return fail("not_found");

    return ok(await testConnection(resolved, this.#caCert));
  }
}
