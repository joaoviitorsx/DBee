import type {
  DatabaseInfo,
  DatabaseTree,
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

  /** Executa o SQL do usuário, statement a statement, parando no primeiro erro. */
  executar(conexao: ResolvedConnection, opcoes: OpcoesExecucao): Promise<ResultadoExecucao>;

  /** Cancela a execução identificada pelo token de `aoIniciar`. */
  cancelar(conexao: ResolvedConnection, database: string, token: number): Promise<boolean>;

  /** Esquece as conexões desta conexão configurada — ela mudou. */
  esquecer(id: string): Promise<void>;

  desligar(): Promise<void>;
}
