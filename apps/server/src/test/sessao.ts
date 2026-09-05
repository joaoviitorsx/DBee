import { SESSION_COOKIE } from "@dbee/shared";

import { criarPrimeiroUsuario } from "../db/bootstrap";
import type { Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";

/**
 * Sessão pronta para teste.
 *
 * Desde que toda rota exige sessão (DBee.md §7), um teste de API sem cookie
 * mede o guard, não a rota. Este helper existe para o teste voltar a falar do
 * que ele quer testar — e para **não** haver a tentação de abrir uma exceção
 * no guard "só para o teste", que é como uma porta de teste vira uma porta.
 */
export interface SessaoDeTeste {
  readonly cookie: string;
  readonly userId: string;
}

export async function autenticar(store: Store): Promise<SessaoDeTeste> {
  const users = new UsersRepository(store.db);
  const primeiro = await criarPrimeiroUsuario(users);
  if (primeiro === null) throw new Error("store já tinha usuário");

  // Sai do estado de troca obrigatória: ele é assunto de `auth.test.ts`, e
  // aqui só atrapalharia.
  users.trocarSenha(
    primeiro.user.id,
    await Bun.password.hash("senha-de-teste-1234", { algorithm: "argon2id" }),
  );

  const { token } = users.abrirSessao(primeiro.user.id);
  return { cookie: `${SESSION_COOKIE}=${token}`, userId: primeiro.user.id };
}
