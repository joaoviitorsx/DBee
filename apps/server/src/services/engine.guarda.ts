import { capacidadesDe, type Engine } from "@dbee/shared/puro";

import { fail, type ServiceResult } from "./result";

/**
 * A recusa explícita de um recurso que aquela engine não tem.
 *
 * ## Por que existe
 *
 * Exportação, DDL, mutação, atividade e visão geral falam com `pg/` direto —
 * eles leem catálogo do Postgres e abrem transação com o modo declarado no
 * `BEGIN`, e nenhuma das duas coisas existe no MySQL do mesmo jeito. Sem esta
 * guarda, uma conexão MySQL chegando lá faria o `PoolManager` do Postgres
 * tentar falar protocolo de Postgres com a porta 3306: o erro seria de handshake
 * ou tempo esgotado, e não teria nada a ver com a verdade, que é "isto não
 * existe aqui".
 *
 * A mensagem nomeia **o recurso** e **a engine**, porque um erro que não diz o
 * que falta vira ticket.
 */
export function exigirPostgres<T>(engine: Engine, recurso: string): ServiceResult<T> | null {
  if (engine === "postgres") return null;

  /*
   * Dois casos diferentes, e a primeira versão desta função os misturava:
   * ela prometia "esta conexão suporta leitura" até para engine que o DBee não
   * fala de jeito nenhum. Uma conexão `sqlite` não lê nada — dizer que ela lê
   * seria a segunda promessa falsa dentro da mensagem que existe justamente
   * para desfazer a primeira.
   */
  if (capacidadesDe(engine) === null) {
    return fail<T>("bad_request", `o DBee ainda não fala ${engine}.`);
  }

  return fail<T>(
    "bad_request",
    `${recurso} não existe em ${engine} no DBee. ` +
      "Esta conexão suporta leitura: navegar a árvore e executar consultas.",
  );
}

/**
 * Campos que a engine não tem, recusados na entrada.
 *
 * ## Por que o servidor precisa disto, e não só a tela
 *
 * `capacidadesDe(engine).campos` é o que decide o que o formulário desenha. Ele
 * **não** decidia o que a rota aceita, e a diferença foi medida: `POST
 * /api/connections` com `engine: "mysql", writeEnabled: true` devolvia `201` e
 * gravava `writeEnabled: true`.
 *
 * O estrago era duplo. A árvore pinta a tarja âmbar de perigo só por
 * `connection.writeEnabled`, sem consultar a engine — então a conexão aparecia
 * como gravável. E o interruptor não é desenhado para MySQL, porque a
 * capacidade diz que ele não existe ali — então **não havia como desligar pela
 * tela**. Uma conexão pintada de perigosa, sem botão para despintá-la, e cuja
 * escrita explícita falha com 502.
 *
 * É a forma que este projeto chama de mass assignment: o schema é um só para
 * as sete engines, por desenho, e sem esta checagem qualquer campo de qualquer
 * engine entra em qualquer conexão.
 *
 * Campos fora de `CampoConexao` — `name`, `color`, `engine` — valem para todas
 * e não passam por aqui.
 */
export function recusarCamposDaOutraEngine<T>(
  engine: Engine,
  corpo: Readonly<Record<string, unknown>>,
): ServiceResult<T> | null {
  const capacidades = capacidadesDe(engine);
  // Engine sem capacidade declarada não chega aqui: a criação já a recusou.
  if (capacidades === null) return null;

  const permitidos = new Set<string>(capacidades.campos);
  const intrusos = TODOS_OS_CAMPOS.filter(
    (campo) => !permitidos.has(campo) && corpo[campo] !== undefined,
  );
  if (intrusos.length === 0) return null;

  return fail<T>(
    "bad_request",
    `${intrusos.join(", ")} não ${intrusos.length === 1 ? "existe" : "existem"} em ${engine}. ` +
      "Este campo foi recusado em vez de guardado, porque uma conexão que o carrega " +
      "aparece na tela afirmando algo que a engine não faz.",
  );
}

/**
 * Todos os campos específicos de conexão que alguma engine tem.
 *
 * Escrito à mão e não derivado de uma engine, porque derivar de uma faria os
 * campos exclusivos das outras passarem despercebidos — que é exatamente o
 * defeito que esta função existe para fechar.
 */
const TODOS_OS_CAMPOS: readonly string[] = [
  "host",
  "port",
  "database",
  "username",
  "password",
  "sslMode",
  "timezone",
  "statementTimeoutMs",
  "writeEnabled",
];
