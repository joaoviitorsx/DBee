import { t, type Static } from "elysia";

/**
 * Qual banco está do outro lado da conexão.
 *
 * ## Por que isto existe antes de existir a segunda engine
 *
 * O DBee só fala Postgres. Introduzir `engine` agora, com um valor só, é o que
 * torna barata a fase seguinte: o formulário, o repositório e a resposta da API
 * passam a carregar o campo enquanto ainda é possível verificar que **nada
 * mudou** — a suíte passa sem alteração de teste e os screenshots batem. Fazer
 * isso junto com a primeira engine nova misturaria "o campo existe" com "o
 * campo funciona", e nenhuma das duas ficaria verificável sozinha.
 *
 * ## Imutável depois de criada
 *
 * `engine` entra em `CreateConnection` e **não** entra em `UpdateConnection`.
 * Não é preferência de UI, é o ADR 005: a senha é cifrada com AAD amarrado ao
 * **id**, então um `PATCH` que trocasse a engine mantendo `password_enc`
 * continuaria decifrando e passaria a mandar o segredo para outro tipo de
 * servidor. O ADR 005 aceitou que editar host é operação normal; editar engine
 * não é.
 */
export const Engine = t.Union(
  [
    t.Literal("postgres"),
    t.Literal("mysql"),
    t.Literal("mariadb"),
    t.Literal("sqlite"),
    t.Literal("libsql"),
    t.Literal("mongodb"),
    t.Literal("redis"),
  ],
  { description: "qual banco está do outro lado da conexão" },
);
export type Engine = Static<typeof Engine>;

/** As que o DBee de fato fala hoje. O resto está declarado, não implementado. */
export const ENGINES_IMPLEMENTADAS = ["postgres"] as const satisfies readonly Engine[];

/**
 * Onde mora a garantia de que uma leitura não vira escrita.
 *
 * Medido contra servidor real de cada engine (`docs/multi-engine.md` §1), e o
 * resultado não é o que a documentação delas sugere:
 *
 * - `transacao` — só o PostgreSQL. `BEGIN READ ONLY` recusa DML e DDL, e o SQL
 *   do usuário não desliga.
 * - `handle` — SQLite local. O `PRAGMA query_only` **é desligável pelo próprio
 *   usuário**; o que segura é abrir o arquivo em modo leitura.
 * - `credencial` — MySQL, MariaDB, libSQL, MongoDB, Redis. Não existe transação
 *   somente-leitura que resista: no MySQL o `TRUNCATE` e o `CREATE USER`
 *   escapam de `START TRANSACTION READ ONLY` (medido). O que segura é o papel
 *   do usuário no banco.
 *
 * É a capacidade que mais muda a tela: com `credencial` o interruptor "permitir
 * escrita nesta execução" **não pode existir**, porque não há nada por execução
 * para ligar ou desligar.
 */
export const EscopoReadOnly = t.Union([
  t.Literal("transacao"),
  t.Literal("handle"),
  t.Literal("credencial"),
]);
export type EscopoReadOnly = Static<typeof EscopoReadOnly>;

/**
 * O que uma engine faz — lido pela UI para **esconder** o que ela não faz.
 *
 * Esconder, e não desabilitar: campo desabilitado ainda afirma "isto existe
 * aqui, você só não pode mexer", e para `timezone` no SQLite isso é falso.
 */
export interface Capacidades {
  /** Níveis da árvore. O Postgres tem schema; o MySQL não. */
  readonly niveis:
    | "conexao/database/schema/tabela"
    | "conexao/database/tabela"
    | "arquivo/tabela"
    | "conexao/database/colecao"
    | "conexao/db-numerado";
  readonly escopoReadOnly: EscopoReadOnly;
  /** A garantia cobre DDL? No MySQL não — medido. */
  readonly readOnlyCobreDdl: boolean;
  /** Campos que o formulário mostra. O que não está aqui não é renderizado. */
  readonly campos: readonly CampoConexao[];
  /** Porta convencional, para preencher ao escolher a engine. */
  readonly portaPadrao: number | null;
  readonly sqlLivre: boolean;
  readonly cancelarQuery: boolean;
  readonly diagramaErd: boolean;
}

/**
 * Um campo do formulário de conexão.
 *
 * `host` e `filePath` são mutuamente exclusivos por natureza: um é endereço de
 * rede, o outro é caminho no sistema de arquivos. O `pattern` do `host` recusa
 * caminho de propósito — o `pg` lê host começado por `/` como socket unix.
 */
export type CampoConexao =
  | "host"
  | "port"
  | "database"
  | "username"
  | "password"
  | "sslMode"
  | "timezone"
  | "statementTimeoutMs"
  | "writeEnabled";

/**
 * As capacidades de cada engine.
 *
 * Só `postgres` está preenchido: é a única implementada. As outras entram na
 * fase que as implementar — declarar capacidade de engine que não existe seria
 * a tabela afirmando o que o app não faz.
 */
export const CAPACIDADES: Readonly<Record<"postgres", Capacidades>> = {
  postgres: {
    niveis: "conexao/database/schema/tabela",
    escopoReadOnly: "transacao",
    readOnlyCobreDdl: true,
    campos: [
      "host", "port", "database", "username", "password",
      "sslMode", "timezone", "statementTimeoutMs", "writeEnabled",
    ],
    portaPadrao: 5432,
    sqlLivre: true,
    cancelarQuery: true,
    diagramaErd: true,
  },
};

/**
 * As capacidades de uma engine, ou `null` se ela ainda não é implementada.
 *
 * `null`, e não "as do Postgres": devolver as do Postgres faria a tela oferecer
 * transação somente-leitura para um MySQL, que é exatamente a garantia que ele
 * não tem. Um valor errado aqui vira promessa falsa lá.
 */
export function capacidadesDe(engine: Engine): Capacidades | null {
  return engine === "postgres" ? CAPACIDADES.postgres : null;
}

/** Se o DBee fala esta engine hoje. */
export const engineImplementada = (engine: Engine): boolean =>
  (ENGINES_IMPLEMENTADAS as readonly Engine[]).includes(engine);
