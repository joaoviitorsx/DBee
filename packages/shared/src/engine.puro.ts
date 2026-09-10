/**
 * O que cada engine faz — sem TypeBox junto.
 *
 * Separado de `engine.ts` pelo mesmo motivo de `mutation.puro.ts`: o módulo de
 * schema importa `t` da Elysia, que é **runtime**, e o formulário de conexão
 * precisa destas tabelas para decidir o que renderizar. Importar do módulo de
 * schema traria o TypeBox inteiro de volta ao bundle do navegador — 60 kB gzip
 * que já foram removidos uma vez.
 */
import type { DialetoSql } from "./split";
import type { Engine } from "./engine";

/**
 * `Engine` como **tipo**, alcançável por quem importa `@dbee/shared/puro`.
 *
 * A união mora em `engine.ts` porque lá ela também é schema TypeBox. Aqui só o
 * tipo é reexportado, e `export type` some na compilação — o front ganha o tipo
 * sem que a Elysia volte ao bundle, que é a razão de este arquivo existir.
 */
export type { Engine };

/**
 * As que o DBee de fato fala hoje. O resto está declarado, não implementado.
 *
 * MySQL e MariaDB entraram **em leitura**: navegar a árvore e executar
 * consultas. Exportação, DDL e edição de linhas continuam só no Postgres, e os
 * serviços recusam essas engines com mensagem que diz o que falta — a garantia
 * de escrita ali mora na credencial, e sem uma segunda credencial por conexão
 * não há modo de escrita para oferecer (`docs/papeis-mysql.md`).
 */
export const ENGINES_IMPLEMENTADAS: readonly Engine[] = ["postgres", "mysql", "mariadb"];

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
export type EscopoReadOnly = "transacao" | "handle" | "credencial";

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
  /**
   * Como o SQL desta engine é lido para achar onde cada statement termina.
   *
   * Mora aqui, e não numa tabela paralela, porque quem separa statement no
   * front é a tela — e a tela só conhece a engine da conexão. Uma segunda
   * tabela seria uma segunda coisa para esquecer de atualizar.
   */
  readonly dialeto: DialetoSql;
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
export const CAPACIDADES: Readonly<Record<"postgres" | "mysql" | "mariadb", Capacidades>> = {
  postgres: {
    niveis: "conexao/database/schema/tabela",
    escopoReadOnly: "transacao",
    readOnlyCobreDdl: true,
    campos: [
      "host", "port", "database", "username", "password",
      "sslMode", "timezone", "statementTimeoutMs", "writeEnabled",
    ],
    portaPadrao: 5432,
    dialeto: "postgres",
    sqlLivre: true,
    cancelarQuery: true,
    diagramaErd: true,
  },

  /*
   * MySQL e MariaDB — medidos, não deduzidos do Postgres.
   *
   * `campos` **não tem `writeEnabled`**, e é a diferença que mais muda a tela.
   * O interruptor "permitir escrita nesta execução" pressupõe que exista algo
   * por execução para ligar, e aqui não existe: medido, dentro de
   * `START TRANSACTION READ ONLY` o `TRUNCATE` esvazia a tabela e o
   * `CREATE USER` cria usuário. A garantia mora na credencial
   * (`docs/papeis-mysql.md`), e um interruptor que não liga nada é a tela
   * mentindo.
   *
   * `diagramaErd` virou `true` quando a introspecção completa passou a ler
   * chaves estrangeiras de `KEY_COLUMN_USAGE`. Antes disso era `false`, porque
   * a aba abriria vazia — capacidade é o que a engine FAZ, não o que se
   * pretende que ela faça.
   */
  mysql: {
    niveis: "conexao/database/tabela",
    escopoReadOnly: "credencial",
    readOnlyCobreDdl: false,
    campos: [
      "host", "port", "database", "username", "password",
      "sslMode", "timezone", "statementTimeoutMs",
    ],
    portaPadrao: 3306,
    dialeto: "mysql",
    sqlLivre: true,
    cancelarQuery: true,
    diagramaErd: true,
  },

  /*
   * MariaDB tem as mesmas capacidades do MySQL **do ponto de vista da tela**.
   * As divergências medidas entre os dois — nome da variável de timeout, tipo
   * do JSON, `SEQUENCE`, lock de leitura permitido — são todas de driver, e
   * ficam dentro dele. Nenhuma delas muda um campo do formulário.
   */
  mariadb: {
    niveis: "conexao/database/tabela",
    escopoReadOnly: "credencial",
    readOnlyCobreDdl: false,
    campos: [
      "host", "port", "database", "username", "password",
      "sslMode", "timezone", "statementTimeoutMs",
    ],
    portaPadrao: 3306,
    dialeto: "mysql",
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
  return engine === "postgres" || engine === "mysql" || engine === "mariadb"
    ? CAPACIDADES[engine]
    : null;
}

/** Se o DBee fala esta engine hoje. */
export const engineImplementada = (engine: Engine): boolean =>
  ENGINES_IMPLEMENTADAS.includes(engine);

/**
 * O dialeto de uma engine, com o Postgres como padrão do que ainda não existe.
 *
 * O padrão não é palpite: engine não implementada não executa SQL nenhum (o
 * `exigirPostgres` recusa antes), então o valor só chega ao `splitStatements`
 * pelo caminho do editor com uma conexão que a tela nem lista. Escolher um
 * significa escolher o que fazer com texto que ninguém vai executar.
 */
export const dialetoDe = (engine: Engine): DialetoSql => capacidadesDe(engine)?.dialeto ?? "postgres";
