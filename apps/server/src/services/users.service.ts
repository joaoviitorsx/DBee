import type {
  CreateUserRequest,
  Role,
  SessionUser,
  UserSummary,
} from "@dbee/shared";

import type { UsersRepository } from "../db/users.repo";
import { userFail, userOk, type UserResult } from "./result";

/**
 * Administração de contas (DBee.md §9, v0.2).
 *
 * ## Por que as travas moram aqui
 *
 * Todas as regras deste arquivo estão **no serviço**, não na rota e muito menos
 * na UI. É a mesma lição do portão de escrita do DDL: esconder o botão não é
 * controle, e uma requisição direta à API não passa por tela nenhuma. Se um dia
 * existir uma segunda porta — uma CLI, um job — as regras continuam valendo.
 *
 * ## As três travas, e o que cada uma evita
 *
 * 1. **Nunca chegar a zero admins.** Remover ou rebaixar o último administrador
 *    deixaria a instalação sem ninguém que possa criar contas ou administrar
 *    conexões — e o conserto exigiria abrir o SQLite dentro do container à mão,
 *    porque a tela que resolveria é justamente a que exige admin.
 * 2. **Não remover a própria conta.** Vale só para remover — rebaixar a si
 *    mesmo é legítimo (um admin saindo da função porque outro assumiu), e
 *    barrá-lo tornaria a trava 1 inalcançável no `PATCH`.
 * 3. **Nome duplicado vira 409, não 500.** O `UNIQUE` de `users.username`
 *    recusaria de qualquer jeito, mas como exceção do SQLite — e exceção de
 *    banco virando erro genérico é a diferença entre "esse nome já existe" e
 *    "algo deu errado".
 *
 * ## O que este serviço não faz
 *
 * Não gera senha. A provisória é digitada pelo admin e entregue por fora
 * (§7: nenhuma senha é gerada nem impressa). Ela nasce com `mustChangePassword`,
 * então vale para exatamente um login — o `guard.ts` recusa todo o resto até a
 * troca.
 */
export class UsersService {
  readonly #users: UsersRepository;

  constructor(users: UsersRepository) {
    this.#users = users;
  }

  listar(): UserSummary[] {
    return this.#users.listar();
  }

  async criar(entrada: CreateUserRequest): Promise<UserResult<SessionUser>> {
    // A checagem antecipada é para a mensagem, não para a corretude: o `UNIQUE`
    // continua sendo quem garante. Entre esta leitura e o INSERT cabe outra
    // criação com o mesmo nome, e é por isso que o `catch` abaixo existe.
    if (this.#users.comHashPorNome(entrada.username) !== null) {
      return userFail("username_taken");
    }

    const hash = await Bun.password.hash(entrada.temporaryPassword);
    try {
      return userOk(this.#users.criar(entrada.username, hash, true, entrada.role));
    } catch (erro: unknown) {
      if (erro instanceof Error && erro.message.includes("UNIQUE")) {
        return userFail("username_taken");
      }
      throw erro;
    }
  }

  /**
   * Troca o papel — **inclusive o próprio**.
   *
   * Rebaixar a si mesmo é legítimo: é um admin saindo da função porque outro
   * assumiu. Barrar isso seria arbitrário, e teria um efeito pior que o de
   * incomodar — com a trava da própria conta aqui, o `last_admin` viraria
   * **inalcançável**: para rebaixar o último admin seria preciso *ser* ele, e a
   * outra trava dispararia antes. Uma proteção que nunca roda não protege; ela
   * só faz parecer que alguém pensou no caso.
   *
   * Quem segura a linha é o `last_admin`, e ele é alcançável de verdade: o
   * último admin tentando rebaixar a si mesmo.
   */
  definirPapel(alvoId: string, role: Role): UserResult<UserSummary> {
    const alvo = this.#users.porId(alvoId);
    if (alvo === null) return userFail("user_not_found");

    // Só rebaixar pode zerar os admins. Promover nunca.
    if (alvo.role === "admin" && role !== "admin" && this.#users.contarAdmins() <= 1) {
      return userFail("last_admin");
    }

    this.#users.definirPapel(alvoId, role);
    const atualizado = this.#users.listar().find((u) => u.id === alvoId);
    return atualizado === undefined ? userFail("user_not_found") : userOk(atualizado);
  }

  /**
   * Reset administrativo. Vale para a **própria** conta também: um admin que
   * quer forçar a troca da própria senha não está fazendo nada estranho, e a
   * ação não tem como deixar a instalação sem administrador.
   */
  async resetarSenha(alvoId: string, senhaProvisoria: string): Promise<UserResult<UserSummary>> {
    const alvo = this.#users.porId(alvoId);
    if (alvo === null) return userFail("user_not_found");

    const hash = await Bun.password.hash(senhaProvisoria);
    this.#users.resetarSenha(alvoId, hash);

    const atualizado = this.#users.listar().find((u) => u.id === alvoId);
    return atualizado === undefined ? userFail("user_not_found") : userOk(atualizado);
  }

  /**
   * Remove a conta.
   *
   * Aqui a trava da própria conta **fica**: remover-se não é "sair da função", é
   * apagar o próprio acesso para sempre com um clique, e não existe caso de uso
   * para isso — quem quer sair pede a outro admin.
   *
   * O `last_admin` logo abaixo é, hoje, inalcançável por esta rota justamente
   * por causa dela: para remover o último admin seria preciso ser ele. Fica
   * assim mesmo, e não é descuido — é a invariante que realmente importa
   * ("nunca zero admins"), e é ela que continua valendo se a trava de cima for
   * relaxada um dia. Coberta por teste direto no serviço, já que pela API não
   * há como chegar nela.
   */
  remover(alvoId: string, quemPediu: string): UserResult<true> {
    const alvo = this.#users.porId(alvoId);
    if (alvo === null) return userFail("user_not_found");
    if (alvoId === quemPediu) return userFail("self_target");
    if (alvo.role === "admin" && this.#users.contarAdmins() <= 1) {
      return userFail("last_admin");
    }

    this.#users.remover(alvoId);
    return userOk(true);
  }
}
