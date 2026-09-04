import { t, type Static } from "elysia";

/**
 * Modos de SSL — três, sem negociação (ADR 003).
 *
 * `prefer` e `allow` não existem de propósito: os dois caem para texto claro em
 * silêncio quando o TLS falha, e o usuário não tem como saber.
 */
export const SslMode = t.Union(
  [t.Literal("disable"), t.Literal("require"), t.Literal("verify-full")],
  { description: "disable = texto claro; require = criptografa sem autenticar o servidor; verify-full = criptografa e valida cadeia e hostname" },
);
export type SslMode = Static<typeof SslMode>;

export const SSL_MODES = ["disable", "require", "verify-full"] as const;

/**
 * Conexão como a API devolve. `password_enc` **nunca** aparece aqui — o tipo é
 * a primeira barreira, a segunda é o repositório não selecionar a coluna
 * (DBee.md §5, §7).
 */
export const Connection = t.Object({
  id: t.String(),
  name: t.String(),
  color: t.Union([t.String(), t.Null()]),
  host: t.String(),
  port: t.Integer(),
  database: t.String(),
  username: t.String(),
  sslMode: SslMode,
  writeEnabled: t.Boolean(),
  statementTimeoutMs: t.Integer(),
  timezone: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});
export type Connection = Static<typeof Connection>;

const name = t.String({ minLength: 1, maxLength: 100 });
const host = t.String({ minLength: 1, maxLength: 255 });
const port = t.Integer({ minimum: 1, maximum: 65535, default: 5432 });
const database = t.String({ minLength: 1, maxLength: 100 });
const username = t.String({ minLength: 1, maxLength: 100 });
const password = t.String({ maxLength: 1000 });
const color = t.Union([t.String({ maxLength: 32 }), t.Null()]);
const timezone = t.String({ minLength: 1, maxLength: 64, default: "UTC" });
const statementTimeoutMs = t.Integer({ minimum: 1000, maximum: 600000, default: 30000 });

export const CreateConnection = t.Object({
  name,
  host,
  database,
  username,
  password,
  color: t.Optional(color),
  port: t.Optional(port),
  sslMode: t.Optional(SslMode),
  writeEnabled: t.Optional(t.Boolean({ default: false })),
  statementTimeoutMs: t.Optional(statementTimeoutMs),
  timezone: t.Optional(timezone),
});
export type CreateConnection = Static<typeof CreateConnection>;

/** PATCH: tudo opcional. `password` ausente significa "não mexe na senha". */
export const UpdateConnection = t.Object({
  name: t.Optional(name),
  host: t.Optional(host),
  port: t.Optional(port),
  database: t.Optional(database),
  username: t.Optional(username),
  password: t.Optional(password),
  color: t.Optional(color),
  sslMode: t.Optional(SslMode),
  writeEnabled: t.Optional(t.Boolean()),
  statementTimeoutMs: t.Optional(statementTimeoutMs),
  timezone: t.Optional(timezone),
});
export type UpdateConnection = Static<typeof UpdateConnection>;

/**
 * Resultado do teste de conexão. Erro do Postgres vai inteiro para a UI, com
 * `code` e `message` (CLAUDE.md, "Ao escrever código").
 */
export const TestConnectionResult = t.Union([
  t.Object({
    ok: t.Literal(true),
    serverVersion: t.String(),
    durationMs: t.Integer(),
  }),
  t.Object({
    ok: t.Literal(false),
    code: t.Union([t.String(), t.Null()]),
    message: t.String(),
    durationMs: t.Integer(),
  }),
]);
export type TestConnectionResult = Static<typeof TestConnectionResult>;

export const ErrorResponse = t.Object({
  code: t.String(),
  message: t.String(),
});
export type ErrorResponse = Static<typeof ErrorResponse>;
