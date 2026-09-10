import type {
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  Engine,
  Relation,
  RowsRequest,
  TestConnectionResult,
} from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import type { AlvoLibsql } from "../libsql/cliente";
import { executar } from "../libsql/executor";
import { introspectarArvore, introspectarCompleto, listarDatabases, NOME_PADRAO } from "../libsql/introspect";
import { lerLinhas, planejarLinhas } from "../libsql/rows";
import { testConnectionLibsql, tokenGrava } from "../libsql/test-connection";
import type { DriverLeitura, OpcoesExecucao, ResultadoExecucao, ResultadoLinhas } from "./tipos";

/**
 * Os campos de uma conexão viram o alvo HTTP, e o `sslMode` vira config de TLS.
 *
 * Exportada e pura para o teste travar a tradução dos três modos (ADR 003):
 * cada modo significa o que promete, e é aqui que isso é decidido.
 *
 * - `disable`     → `http`, sem `tls`. Texto claro.
 * - `require`     → `https` com `rejectUnauthorized: false`: cifra, não
 *   autentica o servidor (cai num self-signed sem reclamar — medido).
 * - `verify-full` → `https` com validação de cadeia e identidade (padrão do
 *   `fetch` do Bun). A CA própria entra pelo `ca`.
 */
export function alvoLibsqlDe(conexao: ResolvedConnection, caCert: string | undefined): AlvoLibsql {
  const cifrado = conexao.sslMode !== "disable";
  return {
    url: `${cifrado ? "https" : "http"}://${conexao.host}:${String(conexao.port)}`,
    token: conexao.password === "" ? null : conexao.password,
    ...(cifrado
      ? {
          tls: {
            rejectUnauthorized: conexao.sslMode === "verify-full",
            ...(caCert === undefined ? {} : { ca: caCert }),
          },
        }
      : {}),
    // O limite é da requisição HTTP, não do statement: o protocolo não oferece
    // `statement_timeout`. Por isso a capacidade não expõe o campo.
    timeoutMs: 30_000,
  };
}

/**
 * O driver de libSQL.
 *
 * ## Sem pool, e sem nada para esquecer
 *
 * Os outros dois drivers são donos de um pool porque a conexão carrega estado
 * de sessão — modo de transação, fuso, limite de tempo. Aqui não há sessão:
 * cada `POST /v2/pipeline` é independente e o `fetch` do Bun reusa a conexão
 * TCP por baixo. Por isso `esquecer` e `desligar` não fazem nada, e isso não é
 * um vazio a preencher: é a consequência de a engine não ter estado que o
 * cliente precise guardar.
 *
 * ## A URL sai dos campos que já existem
 *
 * Não há coluna `url` nem coluna `token` — a migração 007 deixou registrado que
 * tornar `host`/`database`/`username` anuláveis exige reconstruir a tabela com
 * três chaves estrangeiras apontando para ela, e que esse dia merece ADR
 * próprio. Enquanto ele não vem, os campos que existem bastam e dizem a mesma
 * coisa:
 *
 * - `host` + `port` → o endereço do `sqld`
 * - `sslMode` → o esquema: `disable` é `http`, os outros dois são `https`
 * - `password` → o **token JWT**, cifrado como qualquer credencial (ADR 005)
 *
 * `username`, `database` e `timezone` não são campos desta engine
 * (`capacidadesDe("libsql").campos`), e o formulário não os mostra.
 */
export class DriverLibsql implements DriverLeitura {
  readonly engine: Engine = "libsql";
  readonly #caCert: string | undefined;

  constructor(caCert?: string) {
    this.#caCert = caCert;
  }

  #alvo(conexao: ResolvedConnection): AlvoLibsql {
    return alvoLibsqlDe(conexao, this.#caCert);
  }

  async testarConexao(conexao: ResolvedConnection): Promise<TestConnectionResult> {
    return await testConnectionLibsql(conexao, this.#alvo(conexao));
  }

  /**
   * Um servidor libSQL expõe **um** banco. A lista tem um item, com o nome que
   * a conexão guardou — a forma da API é a de sempre, e a tela desenha um nó
   * que diz algo verdadeiro em vez de um seletor vazio.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono; aqui não há ida à rede.
  async listarDatabases(conexao: ResolvedConnection): Promise<DatabaseInfo[]> {
    return listarDatabases(conexao.database);
  }

  async arvore(conexao: ResolvedConnection, database: string): Promise<DatabaseTree> {
    return await introspectarArvore(this.#alvo(conexao), database === "" ? NOME_PADRAO : database);
  }

  async esquema(conexao: ResolvedConnection, database: string): Promise<DatabaseSchema> {
    return await introspectarCompleto(this.#alvo(conexao), database === "" ? NOME_PADRAO : database);
  }

  async linhas(
    conexao: ResolvedConnection,
    _database: string,
    // Não há nível de schema: a URL aponta para um banco e dentro dele há
    // tabelas. `FROM "clientes"` é o caminho inteiro.
    _schema: string,
    relacao: Relation,
    pedido: RowsRequest,
  ): Promise<ResultadoLinhas> {
    const alvo = this.#alvo(conexao);
    // Montado antes de executar, como nas outras engines: a auditoria registra
    // o comando mesmo quando a execução falha.
    const plano = planejarLinhas(relacao, pedido);
    return {
      resposta: await lerLinhas(alvo, relacao, pedido),
      sql: plano.sql,
      parametros: plano.valores,
    };
  }

  async executar(conexao: ResolvedConnection, opcoes: OpcoesExecucao): Promise<ResultadoExecucao> {
    if (!opcoes.somenteLeitura) {
      /*
       * Não há modo de escrita por execução aqui, pela mesma razão do MySQL e
       * com uma garantia melhor: quem decide é o **servidor**, pelo claim
       * `"a":"ro"` do token. Um interruptor por execução ligaria algo que não
       * existe — e, diferente do MySQL, aqui a garantia do servidor cobre
       * também DDL (medido).
       */
      throw new Error(
        "o libSQL não tem modo de escrita por execução: quem decide é o token " +
          "(claim \"a\":\"ro\", aplicado pelo servidor). Gere um token com " +
          "escrita se precisa gravar.",
      );
    }
    return await executar(this.#alvo(conexao), opcoes.sql, opcoes.maxRows);
  }

  /**
   * O token grava?
   *
   * Lido do próprio JWT, sem ida à rede e sem cache: `claimsDe` é uma divisão de
   * string e um `JSON.parse` de algumas dezenas de bytes. O MySQL precisa de
   * cache porque a resposta dele custa uma consulta ao servidor; aqui, guardar
   * seria complexidade sem economia.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono; a resposta está no token.
  async credencialGrava(conexao: ResolvedConnection): Promise<boolean> {
    return tokenGrava(conexao.password === "" ? null : conexao.password);
  }

  /**
   * Não há cancelamento no protocolo — e é por isso que
   * `capacidadesDe("libsql").cancelarQuery` é `false`: a tela não oferece o
   * botão, em vez de oferecer um que não faz nada. `false` aqui é a mesma
   * resposta, para quem chamar mesmo assim.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono.
  async cancelar(): Promise<boolean> {
    return false;
  }

  // Sem estado guardado: não há pool, não há sessão, não há cache de
  // privilégio. Os dois métodos existem porque o contrato os pede.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async esquecer(): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async desligar(): Promise<void> {}
}
