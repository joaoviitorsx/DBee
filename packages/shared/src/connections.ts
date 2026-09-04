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

/**
 * Campos de entrada — **sem `default` em nenhum**, por decisão de arquitetura
 * (ADR [004](../../../docs/adr/004-defaults-nunca-no-schema-de-entrada.md)).
 *
 * O Elysia materializa `default` durante a validação, e num PATCH isso apaga a
 * diferença entre "campo ausente" e "campo igual ao default": um
 * `PATCH { timezone }` chegava ao repositório com `port: 5432` junto e
 * reapontava a conexão para outro servidor, em silêncio.
 *
 * O valor inicial mora no repositório, aplicado só na criação.
 * `connections.schema.test.ts` falha se algum campo daqui ganhar `default`.
 */
const FIELDS = {
  name: t.String({ minLength: 1, maxLength: 100 }),
  /**
   * Hostname ou IP. Não pode começar com `/`: o `pg` trata host iniciado por
   * barra como **socket unix** (`host + "/.s.PGSQL." + port`) em vez de TCP,
   * o que nunca é caso de uso aqui e transformaria o campo num seletor de
   * caminho no sistema de arquivos do container.
   */
  host: t.String({ minLength: 1, maxLength: 255, pattern: "^[^/\\s][^\\s]*$" }),
  port: t.Integer({ minimum: 1, maximum: 65535 }),
  database: t.String({ minLength: 1, maxLength: 100 }),
  username: t.String({ minLength: 1, maxLength: 100 }),
  password: t.String({ maxLength: 1000 }),
  color: t.Union([t.String({ maxLength: 32 }), t.Null()]),
  sslMode: SslMode,
  writeEnabled: t.Boolean(),
  statementTimeoutMs: t.Integer({ minimum: 1000, maximum: 600000 }),
  /**
   * Nome IANA (`America/Sao_Paulo`) ou `UTC`. Validado no formato porque um
   * valor inválido só falharia lá no `set_config('TimeZone', ...)`, e a rota
   * devolveria 502 "o banco não respondeu" para um erro de configuração do
   * usuário — deixando toda query e toda árvore daquela conexão mortas até ele
   * adivinhar a causa.
   */
  timezone: t.String({
    minLength: 1,
    maxLength: 64,
    pattern: "^(UTC|[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){1,2})$",
  }),
} as const;

/** Criação: o que é obrigatório é obrigatório; o resto o repositório preenche. */
export const CreateConnection = t.Object({
  name: FIELDS.name,
  host: FIELDS.host,
  database: FIELDS.database,
  username: FIELDS.username,
  password: FIELDS.password,
  color: t.Optional(FIELDS.color),
  port: t.Optional(FIELDS.port),
  sslMode: t.Optional(FIELDS.sslMode),
  writeEnabled: t.Optional(FIELDS.writeEnabled),
  statementTimeoutMs: t.Optional(FIELDS.statementTimeoutMs),
  timezone: t.Optional(FIELDS.timezone),
});
export type CreateConnection = Static<typeof CreateConnection>;

/**
 * Atualização: `t.Partial` sobre os campos crus, **não** sobre
 * `CreateConnection`. Derivar de um schema com metadados carregaria os
 * metadados junto — inclusive `default`, se algum dia voltar (ADR 004).
 *
 * `password` ausente significa "não mexe na senha".
 */
export const UpdateConnection = t.Partial(t.Object(FIELDS));
export type UpdateConnection = Static<typeof UpdateConnection>;

/** Exportado para o teste genérico varrer os schemas de atualização. */
export const UPDATE_SCHEMAS = { UpdateConnection } as const;

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
