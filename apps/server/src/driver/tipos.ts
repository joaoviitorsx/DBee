import type {
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  Relation,
  RowsRequest,
  RowsResponse,
  Engine,
  QueryError,
  StatementResult,
  TestConnectionResult,
} from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";

/**
 * A fronteira entre os serviços e a engine — **de leitura**.
 *
 * ## Por que só agora, e por que só leitura
 *
 * O plano previa extrair esta interface antes da segunda engine. Ela foi adiada
 * de propósito (`docs/multi-engine-progresso.md`): a forma certa de uma
 * abstração aparece com o **segundo caso**, não com o primeiro imaginado.
 * Agora existem dois drivers reais, e o que está aqui é o que os dois de fato
 * fazem — não uma lista de intenções.
 *
 * E é só leitura porque só a leitura é comum. Exportação, DDL e mutação existem
 * no Postgres e **não existem** no MySQL desta fase: a garantia de escrita ali
 * mora na credencial, e sem uma segunda credencial por conexão não há modo de
 * escrita para oferecer. Um `Driver` único obrigaria o MySQL a declarar oito
 * métodos que ele não implementa — cada um deles uma promessa falsa esperando
 * ser chamada. Quem precisa de mais que leitura continua falando com `pg/`
 * diretamente, e a capacidade da engine é quem diz se aquilo é oferecido.
 */

/** Um pedido de execução, já resolvido pelo serviço. */
export interface OpcoesExecucao {
  readonly sql: string;
  readonly database: string;
  readonly maxRows: number;
  /**
   * A execução é somente leitura.
   *
   * No Postgres isso vira o modo da transação (`BEGIN READ ONLY`, regra 8). No
   * MySQL **não há equivalente** — medido: `TRUNCATE` e `CREATE USER` escapam
   * de `START TRANSACTION READ ONLY`. O driver de MySQL recusa `false` em vez
   * de fingir que ligou alguma coisa.
   */
  readonly somenteLeitura: boolean;
  /**
   * Chamado assim que a execução tem um alvo cancelável.
   *
   * O número é o PID do backend no Postgres e o id da thread no MySQL. Quem
   * chama só precisa guardá-lo e devolvê-lo em `cancelar`.
   */
  readonly aoIniciar?: (token: number) => void;
}

/**
 * A página da grade, e o SQL que a produziu.
 *
 * O SQL sobe junto porque a auditoria o registra: o `query_log` sem o comando
 * que rodou é auditoria pela metade, e o comando agora é montado **dentro** do
 * driver. Ele não entra na resposta da API — o serviço o consome e devolve só a
 * página.
 */
export interface ResultadoLinhas {
  readonly resposta: RowsResponse;
  readonly sql: string;
  /**
   * Os valores ligados aos marcadores do `sql`, na ordem.
   *
   * O SQL da grade é parametrizado — é assim que ele não é injetável — e por
   * isso, sozinho, ele registra `... WHERE "cpf" = $1` e nunca o CPF. A
   * auditoria que responde "quem consultou o quê" precisa do valor: sem ele o
   * log diz que alguém filtrou uma coluna, não *o que* a pessoa procurou.
   *
   * Já vem em texto porque é assim que ele vai para o log; converter no serviço
   * exigiria dele conhecer o tipo do valor de cada driver.
   */
  readonly parametros: readonly (string | null)[];
}

export interface ResultadoExecucao {
  readonly results: StatementResult[];
  readonly error: (QueryError & { index: number }) | null;
}

export interface DriverLeitura {
  readonly engine: Engine;

  /** Abre, verifica e diz o que aquela conexão **não** garante. */
  testarConexao(conexao: ResolvedConnection): Promise<TestConnectionResult>;

  /** Os databases que aquela credencial enxerga. */
  listarDatabases(conexao: ResolvedConnection, database: string): Promise<DatabaseInfo[]>;

  /** A árvore leve de navegação de um database. */
  arvore(conexao: ResolvedConnection, database: string): Promise<DatabaseTree>;

  /**
   * O catálogo completo: colunas, chave primária, índices e chaves
   * estrangeiras. É o que alimenta o inspetor e o diagrama.
   */
  esquema(conexao: ResolvedConnection, database: string): Promise<DatabaseSchema>;

  /**
   * Uma página da grade de linhas, com filtro, ordenação e cursor.
   *
   * A relação vem do catálogo, e é ela que autoriza cada nome de coluna que o
   * pedido menciona — nome vindo do usuário nunca entra no SQL sem passar por
   * ali.
   */
  linhas(
    conexao: ResolvedConnection,
    database: string,
    /**
     * O schema da relação.
     *
     * No Postgres é o schema de verdade. No MySQL não existe nível de schema, e
     * o driver de lá o ignora — o database já qualifica a tabela. O parâmetro
     * existe porque **o Postgres precisa dele**, e escondê-lo dentro do pedido
     * (que não o declara) seria contrabando.
     */
    schema: string,
    relacao: Relation,
    pedido: RowsRequest,
  ): Promise<ResultadoLinhas>;

  /** Executa o SQL do usuário, statement a statement, parando no primeiro erro. */
  executar(conexao: ResolvedConnection, opcoes: OpcoesExecucao): Promise<ResultadoExecucao>;

  /**
   * A **credencial** desta conexão pode escrever no servidor?
   *
   * Só engines cuja garantia é a credencial respondem — nas outras a pergunta
   * não existe, porque a proteção é a transação e não depende do que a
   * credencial pode. Por isso é opcional, e não um método que o Postgres
   * precisaria implementar devolvendo algo sem sentido.
   *
   * É o que permite ao serviço distinguir "conexão de leitura" de "conexão que
   * a tela chama de leitura". Sem isso, uma concessão `canWrite: false` numa
   * conexão MySQL com credencial gravável não impede nada — medido: um `member`
   * sem escrita fez `INSERT` e `DROP TABLE`.
   */
  credencialGrava?: (conexao: ResolvedConnection) => Promise<boolean>;

  /** Cancela a execução identificada pelo token de `aoIniciar`. */
  cancelar(conexao: ResolvedConnection, database: string, token: number): Promise<boolean>;

  /** Esquece as conexões desta conexão configurada — ela mudou. */
  esquecer(id: string): Promise<void>;

  desligar(): Promise<void>;
}
