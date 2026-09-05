import { t, type Static } from "elysia";

/**
 * Autenticação com identidade real (DBee.md §7).
 *
 * A razão de existir não é proteger a porta — o DBee já roda atrás da tailnet.
 * É o `actor` do `query_log`: um log de auditoria cujo `actor` é a mesma string
 * para todo mundo **não distingue pessoas**, e em contexto fiscal isso dá
 * aparência de controle sem controle.
 */

/**
 * Nome de usuário.
 *
 * Sem e-mail: convite por e-mail é v0.2, e um campo de e-mail sem fluxo de
 * verificação é um campo que mente. Minúsculas por normalização — `Joao` e
 * `joao` seriam duas pessoas na auditoria.
 */
export const Username = t.String({
  minLength: 3,
  maxLength: 32,
  pattern: "^[a-z0-9][a-z0-9._-]*$",
});

/**
 * Senha.
 *
 * Mínimo 12, sem regra de composição. Exigir maiúscula-número-símbolo produz
 * `Senha@123` e a mesma senha em todo lugar; comprimento é a única medida que
 * resiste. O teto de 200 existe porque argon2id sobre entrada ilimitada é um
 * caminho de negação de serviço.
 */
export const Password = t.String({ minLength: 12, maxLength: 200 });

export const LoginRequest = t.Object({
  username: t.String({ minLength: 1, maxLength: 32 }),
  password: t.String({ minLength: 1, maxLength: 200 }),
});
export type LoginRequest = Static<typeof LoginRequest>;

export const ChangePasswordRequest = t.Object({
  currentPassword: t.String({ minLength: 1, maxLength: 200 }),
  newPassword: Password,
});
export type ChangePasswordRequest = Static<typeof ChangePasswordRequest>;

/**
 * Primeiro acesso (DBee.md §7). Enquanto não existe nenhuma conta, o app está em
 * modo setup: o boot grava um token aleatório em `<dataDir>/setup-token` — nunca
 * no log — e o operador o lê do volume para criar a primeira conta. Senha em log
 * seria senha visível no painel do Dokploy; o token no arquivo troca "quem leu o
 * log" por "quem tem acesso ao volume", que já é quem tem o SQLite inteiro.
 */
export const SetupStatus = t.Object({ setupRequired: t.Boolean() });
export type SetupStatus = Static<typeof SetupStatus>;

export const SetupRequest = t.Object({
  token: t.String({ minLength: 1, maxLength: 200 }),
  username: Username,
  password: Password,
});
export type SetupRequest = Static<typeof SetupRequest>;

/**
 * Idioma da UI. Dois valores fechados — o `t()` do front tem dicionário para
 * exatamente estes, e o `CHECK` da migração 003 recusa qualquer outro.
 */
export const Locale = t.Union([t.Literal("pt"), t.Literal("en")], { default: "pt" });
export type Locale = Static<typeof Locale>;

export const LocaleRequest = t.Object({ locale: Locale });
export type LocaleRequest = Static<typeof LocaleRequest>;

/** O usuário da sessão. **Nunca** carrega hash de senha. */
export const SessionUser = t.Object({
  id: t.String(),
  username: t.String(),
  /**
   * Enquanto for `true`, a API recusa tudo que não seja trocar a senha. Não
   * nasce mais no primeiro acesso (a conta é criada pela tela de setup, com a
   * senha que o operador escolhe); fica para um reset administrativo futuro.
   */
  mustChangePassword: t.Boolean(),
  /** Idioma escolhido, servido no login e no `/me` para o front hidratar o `t()`. */
  locale: Locale,
  createdAt: t.String(),
});
export type SessionUser = Static<typeof SessionUser>;

export const MeResponse = t.Object({ user: SessionUser });
export type MeResponse = Static<typeof MeResponse>;

export const LogoutResponse = t.Object({ ok: t.Literal(true) });
export type LogoutResponse = Static<typeof LogoutResponse>;

/** Nome do cookie de sessão. Um lugar só — server e testes leem daqui. */
export const SESSION_COOKIE = "dbee_session";

/**
 * Duração da sessão.
 *
 * 12 horas cobre um turno de trabalho sem relogin no meio de uma conferência,
 * e expira antes do dia seguinte — um notebook esquecido aberto não volta
 * autenticado na manhã seguinte.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
