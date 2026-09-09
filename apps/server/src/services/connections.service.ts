import type { Connection, CreateConnection, TestConnectionResult, UpdateConnection } from "@dbee/shared";
import { engineImplementada } from "@dbee/shared";

import type { ConnectionGrant } from "@dbee/shared";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository } from "../db/connections.repo";
import type { Drivers } from "../driver/registro";

import { type ServiceResult, fail, ok } from "./result";

export interface ConnectionsServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly caCert: string | undefined;
  /**
   * Quem sabe falar com cada engine.
   *
   * Opcional para os testes que só exercitam o repositório não precisarem
   * montar driver nenhum; sem ele, `test` recusa em vez de conectar às cegas.
   */
  readonly drivers?: Drivers;
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
  readonly #drivers: Drivers | undefined;
  readonly #onChanged: (id: string) => void;

  constructor({ repository, onConnectionChanged, drivers }: ConnectionsServiceDeps) {
    this.#repository = repository;
    this.#drivers = drivers;
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

  /**
   * Cria a conexão, recusando engine que o DBee ainda não fala.
   *
   * O schema valida a **forma** — `"redis"` é um valor legítimo da união
   * `Engine`, porque a união declara o alvo do plano e não o que está pronto.
   * Quem sabe o que está pronto é `ENGINES_IMPLEMENTADAS`, e essa checagem
   * precisa morar aqui e não no formulário: o seletor da tela só esconde a
   * opção, e esconder não é impedir — `POST /connections` continua alcançável.
   *
   * Sem isto a conexão é guardada e só falha muito depois, quando o driver de
   * Postgres tenta conversar com um Redis, com erro que não explica nada.
   *
   * `?? "postgres"` porque `engine` é opcional na criação (ADR 004 proíbe
   * `default` em schema de entrada), e o repositório resolve o mesmo padrão.
   */
  create(input: CreateConnection): ServiceResult<Connection> {
    if (!engineImplementada(input.engine ?? "postgres")) return fail("engine_not_implemented");
    return ok(this.#repository.create(input));
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

    /*
     * O driver da engine da conexão, e não `pg/` fixo.
     *
     * O que o teste de conexão faz é diferente em cada uma: no Postgres ele
     * abre `BEGIN READ ONLY` e detecta papel privilegiado; no MySQL não há modo
     * de transação para exercitar, e ele olha os privilégios da credencial
     * (`docs/papeis-mysql.md`). Chamar o de Postgres num MySQL falharia no
     * `BEGIN READ ONLY` com erro de sintaxe, escondendo o que importa.
     */
    if (this.#drivers === undefined) return fail("bad_request");
    return ok(await this.#drivers.para(resolved.engine).testarConexao(resolved));
  }
}
