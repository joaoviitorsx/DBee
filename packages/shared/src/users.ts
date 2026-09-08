import { t, type Static } from "elysia";

import { Password, Role, Username } from "./auth";

/**
 * Administração de contas (DBee.md §9, v0.2).
 *
 * Existe para distribuir o DBee a um time. Até aqui o sistema era travado em
 * **uma** conta: `POST /auth/setup` recusa com `setup_done` quando já há
 * usuário, e nenhuma outra rota criava conta. A saída alternativa — todo mundo
 * no mesmo login — quebra o `actor` do `query_log`, que é a razão de a auth
 * existir (§7).
 *
 * **Nenhum schema daqui carrega hash nem senha de volta.** Senha só trafega na
 * ida, e o hash não sai da tabela por rota nenhuma.
 */

/** Uma pessoa, na tela de administração. */
export const UserSummary = t.Object({
  id: t.String(),
  username: t.String(),
  role: Role,
  /** Conta criada com senha provisória e que ainda não a trocou. */
  mustChangePassword: t.Boolean(),
  createdAt: t.String(),
  /**
   * Sessões vivas. Serve para o admin ver o efeito de remover alguém ou
   * resetar uma senha — as duas ações derrubam sessão, e sem esse número a
   * consequência fica invisível.
   */
  activeSessions: t.Integer({ minimum: 0 }),
});
export type UserSummary = Static<typeof UserSummary>;

export const UserList = t.Array(UserSummary);
export type UserList = Static<typeof UserList>;

/**
 * Criação de conta pelo admin.
 *
 * A senha provisória é **digitada pelo admin**, não gerada pelo sistema. Gerar
 * exigiria devolvê-la numa resposta para alguém a ler na tela, e §7 é explícito
 * sobre não produzir senha que precise ser exibida ou transportada — foi assim
 * que a senha impressa no log foi removida. Digitada, ela nunca aparece numa
 * resposta: entra na requisição, vira argon2id, e o que volta é só o usuário.
 *
 * A conta nasce com `mustChangePassword`, então a senha que o admin escolheu
 * vale para exatamente um login e a API recusa todo o resto até a troca
 * (`guard.ts`).
 */
export const CreateUserRequest = t.Object({
  username: Username,
  /** Provisória: o dono da conta é obrigado a trocá-la no primeiro acesso. */
  temporaryPassword: Password,
  role: Role,
});
export type CreateUserRequest = Static<typeof CreateUserRequest>;

/** Troca de papel. Único campo mutável de outra conta além da senha. */
export const UpdateUserRequest = t.Object({ role: Role });
export type UpdateUserRequest = Static<typeof UpdateUserRequest>;

/**
 * Reset administrativo. Devolve a conta ao estado "senha provisória": derruba
 * todas as sessões dela e volta a exigir troca no próximo login.
 */
export const ResetPasswordRequest = t.Object({ temporaryPassword: Password });
export type ResetPasswordRequest = Static<typeof ResetPasswordRequest>;

export const DeleteUserResponse = t.Object({ ok: t.Literal(true) });
export type DeleteUserResponse = Static<typeof DeleteUserResponse>;
