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
 * Todas as engines declaradas, na ordem do schema.
 *
 * **Nasce aqui, e `engine.ts` a consome** — não o contrário. Reexportar um
 * valor de `engine.ts` traria a Elysia inteira para o bundle do navegador, que
 * é exatamente o que este arquivo existe para evitar (ver `puro.ts`: 79,8 kB
 * gzip contra 0,48).
 *
 * Existe para um teste poder perguntar "e as que **não** estão implementadas?"
 * sem manter uma segunda cópia da lista — cópia que já ficou para trás uma vez,
 * quando o MySQL acendeu e o teste continuou verde afirmando o contrário.
 */
export const ENGINES: readonly Engine[] = [
  "postgres",
  "mysql",
  "mariadb",
  "sqlite",
  "libsql",
  "mongodb",
  "redis",
];

/**
 * As que o DBee de fato fala hoje. O resto está declarado, não implementado.
 *
 * MySQL e MariaDB entraram **em leitura**: navegar a árvore e executar
 * consultas. Exportação, DDL e edição de linhas continuam só no Postgres, e os
 * serviços recusam essas engines com mensagem que diz o que falta — a garantia
 * de escrita ali mora na credencial, e sem uma segunda credencial por conexão
 * não há modo de escrita para oferecer (`docs/papeis-mysql.md`).
 */
export const ENGINES_IMPLEMENTADAS: readonly Engine[] = [
  "postgres",
  "mysql",
  "mariadb",
  "libsql",
  "mongodb",
  "redis",
  "sqlite",
];

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
  /**
   * A engine oferece exportação em stream (CSV/TSV/JSON/NDJSON, e `.sql` nas
   * que têm dialeto SQL de escrita).
   *
   * Falso no Mongo e no Redis: o documento e a chave não viram linha de tabela
   * sem inventar um formato, e inventar em silêncio seria a tela oferecendo um
   * arquivo que não representa o dado. Fica para uma fatia própria desses dois.
   */
  readonly exportar: boolean;
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
  | "writeEnabled"
  | "writeUsername"
  | "writePassword"
  | "authSource"
  | "filePath";

/**
 * As capacidades de cada engine.
 *
 * Só `postgres` está preenchido: é a única implementada. As outras entram na
 * fase que as implementar — declarar capacidade de engine que não existe seria
 * a tabela afirmando o que o app não faz.
 */
export const CAPACIDADES: Readonly<
  Record<
    "postgres" | "mysql" | "mariadb" | "libsql" | "mongodb" | "redis" | "sqlite",
    Capacidades
  >
> = {
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
    exportar: true,
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
      // A credencial de escrita destrava a escrita sem tocar a de leitura.
      "writeUsername", "writePassword",
    ],
    portaPadrao: 3306,
    dialeto: "mysql",
    sqlLivre: true,
    cancelarQuery: true,
    diagramaErd: true,
    exportar: true,
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
      "writeUsername", "writePassword",
    ],
    portaPadrao: 3306,
    dialeto: "mysql",
    sqlLivre: true,
    cancelarQuery: true,
    diagramaErd: true,
    exportar: true,
  },
  mongodb: {
    niveis: "conexao/database/colecao",
    escopoReadOnly: "credencial",
    // Não há transação somente-leitura no Mongo tampouco; a garantia é o papel
    // do usuário (papel `read` contra `readWrite`). Coberto por credencial.
    readOnlyCobreDdl: false,
    /*
     * `authSource` é campo próprio e obrigatório: o database da credencial não
     * é o database dos dados (medido). Sem `timezone` (o Mongo guarda data em
     * UTC, não há fuso de sessão) e sem `statementTimeoutMs` como campo — o
     * limite existe (`maxTimeMS`) mas não é configuração de conexão.
     * `writeUsername`/`writePassword` destravam a escrita como nas outras.
     */
    // Escrita de documento via credencial de escrita, como nas engines SQL de
    // credencial. `writeUsername`/`writePassword` destravam a edição da grade.
    campos: [
      "host", "port", "database", "username", "password", "authSource", "sslMode",
      "writeUsername", "writePassword",
    ],
    portaPadrao: 27017,
    // Não há SQL. A navegação é pela grade de documentos e filtros; o editor de
    // SQL livre não existe nesta engine.
    dialeto: "postgres",
    sqlLivre: false,
    cancelarQuery: false,
    // Sem schema fixo e sem chave estrangeira: não há diagrama ERD.
    diagramaErd: false,
    exportar: false,
  },

  /*
   * Redis — a engine mais distante do que o DBee é. A árvore é conexão → banco
   * numerado (o db 0..N do Redis, não um database nomeado), e a "tabela" é o
   * conjunto de chaves daquele db, navegado por `SCAN`.
   *
   * `campos` é o mais enxuto: host, porta, senha (a credencial do Redis é só
   * senha — o AUTH de usuário existe desde a 6, mas `username` fica para quando
   * alguém precisar), TLS. Sem database (o número vem da árvore), sem username,
   * sem timezone, sem timeout de statement.
   */
  redis: {
    niveis: "conexao/db-numerado",
    escopoReadOnly: "credencial",
    readOnlyCobreDdl: false,
    // `writePassword` (só a senha; o Redis não usa username por padrão)
    // destrava a edição de chave pela credencial de escrita.
    campos: ["host", "port", "password", "sslMode", "writePassword"],
    portaPadrao: 6379,
    dialeto: "postgres",
    sqlLivre: false,
    cancelarQuery: false,
    diagramaErd: false,
    exportar: false,
  },

  /*
   * SQLite local — um arquivo, não um servidor. A garantia de somente-leitura é
   * o **handle**: o arquivo é aberto em modo leitura (`readonly: true`), e o
   * `PRAGMA query_only` (que o usuário poderia desligar) não é a proteção.
   *
   * Roda **fora do event loop** (num Worker): o `bun:sqlite` é síncrono e uma
   * consulta longa travaria o processo inteiro num app multiusuário — medido.
   *
   * `campos` é `filePath` (o caminho no servidor) e `writeEnabled`: a escrita do
   * SQLite é abrir o arquivo em modo r/w (um segundo worker), não uma
   * credencial — por isso `writeEnabled`, como no Postgres, e não
   * `writePassword`.
   *
   * `cancelarQuery: true`: a consulta síncrona não para por sinal, mas o gerente
   * a interrompe **terminando o worker** (e rejeitando a promessa em voo) — o
   * mesmo mecanismo do timeout, acionável também pelo usuário.
   */
  sqlite: {
    niveis: "arquivo/tabela",
    escopoReadOnly: "handle",
    readOnlyCobreDdl: true,
    // `writeEnabled` liga a escrita (abrir o arquivo r/w); o `filePath` é o
    // arquivo. Sem credencial — o SQLite é local.
    campos: ["filePath", "writeEnabled"],
    portaPadrao: null,
    dialeto: "sqlite",
    sqlLivre: true,
    cancelarQuery: true,
    diagramaErd: true,
    exportar: true,
  },

  /*
   * libSQL — a garantia mais forte depois do Postgres, e o formulário mais
   * curto de todos.
   *
   * `escopoReadOnly: "credencial"` porque quem aplica é o **servidor**, pelo
   * claim `"a":"ro"` do JWT — e `readOnlyCobreDdl: true` porque, medido, ele
   * cobre: com token `ro`, `DROP TABLE` e `CREATE TABLE` são bloqueados junto
   * com o DML, e `PRAGMA query_only = OFF` responde `unsupported statement`.
   * É melhor que o MySQL em dois aspectos: não depende de montar `GRANT` certo
   * e alcança DDL.
   *
   * `campos` **não tem `username`, `database` nem `timezone`**:
   *
   * - a credencial é só o token (que vai no campo de senha, cifrado como
   *   qualquer outra credencial — ADR 005);
   * - a URL aponta para **um** banco, não há o que escolher;
   * - não há sessão onde configurar fuso. O SQLite guarda data como texto ou
   *   número e não converte nada; um campo de fuso aqui seria a tela afirmando
   *   uma conversão que não acontece.
   *
   * `cancelarQuery: false` e sem `statementTimeoutMs`: o protocolo não oferece
   * nem um nem outro. O que existe é o limite de tempo da **requisição HTTP**,
   * que é do cliente e não do servidor — e por isso não vira campo que promete
   * "o banco vai parar em N ms".
   */
  libsql: {
    niveis: "conexao/database/tabela",
    escopoReadOnly: "credencial",
    readOnlyCobreDdl: true,
    // `writePassword` é o token JWT gravável; não há `writeUsername` (a
    // credencial do libSQL é só o token).
    campos: ["host", "port", "password", "sslMode", "writePassword"],
    // O `sqld` escuta na 8080 por padrão.
    portaPadrao: 8080,
    dialeto: "sqlite",
    sqlLivre: true,
    cancelarQuery: false,
    diagramaErd: true,
    exportar: true,
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
  // Todas as sete engines declaradas têm capacidade hoje — o `CAPACIDADES` as
  // cobre. O retorno mantém `| null` no tipo (a assinatura que os chamadores já
  // tratam) para o dia em que uma engine nova nascer na união `Engine` sem
  // capacidade ainda; hoje o acesso sempre resolve.
  return CAPACIDADES[engine];
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

/**
 * A engine grava por uma **credencial separada** (não pela transação)?
 *
 * `true` para MySQL, MariaDB e libSQL — onde a garantia é a credencial e a
 * escrita exige uma segunda, gravável. `false` para o Postgres (grava na mesma
 * conexão, via `BEGIN READ WRITE`) e para o que ainda não é implementado.
 *
 * Derivado de `campos`, não uma tabela paralela: se a engine mostra o campo
 * `writePassword`, ela tem a credencial; um segundo lugar seria um segundo
 * lugar para esquecer de atualizar.
 */
export const gravaPorCredencialSeparada = (engine: Engine): boolean =>
  capacidadesDe(engine)?.campos.includes("writePassword") ?? false;
