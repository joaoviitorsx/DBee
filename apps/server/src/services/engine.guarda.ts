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
 * Recusa a exportação numa engine que não a oferece (Mongo, Redis).
 *
 * O par da `exigirPostgres`, mas pela **capacidade** e não pela engine: as
 * engines SQL (Postgres, MySQL, MariaDB, libSQL, SQLite) exportam; o documento
 * do Mongo e a chave do Redis não viram linha de tabela sem inventar um
 * formato. `capacidadesDe(engine).exportar` é a mesma verdade que a tela lê
 * para mostrar ou esconder o botão — uma regra, não duas.
 */
export function exigirExportacao<T>(engine: Engine): ServiceResult<T> | null {
  const cap = capacidadesDe(engine);
  if (cap === null) return fail<T>("bad_request", `o DBee ainda não fala ${engine}.`);
  if (cap.exportar) return null;
  return fail<T>(
    "bad_request",
    `exportação não existe em ${engine} no DBee. ` +
      "O documento e a chave não viram linha de tabela sem inventar um formato.",
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
  // A credencial de escrita: só as engines de credencial a têm. Sem estar
  // aqui, uma conexão Postgres poderia contrabandear `writePassword` (Postgres
  // grava por transação, não por credencial separada) — atribuição em massa.
  "writeUsername",
  "writePassword",
];

/**
 * Campos que a engine tem e que **não** têm valor padrão razoável.
 *
 * `port`, `sslMode`, `timezone` e `statementTimeoutMs` têm — o repositório os
 * preenche na criação. `host`, `database` e `username` não: inventar um valor
 * para eles seria guardar uma conexão que aponta para lugar nenhum e só falha
 * quando alguém clica.
 *
 * `password` fica de fora de propósito: o schema já o exige, e vazio é um valor
 * legítimo (um servidor libSQL sem `SQLD_AUTH_JWT_KEY` não tem token).
 */
const SEM_PADRAO: readonly string[] = ["host", "database", "username", "filePath"];

/**
 * Recusa a criação que **falta** um campo que a engine tem.
 *
 * O par simétrico de `recusarCamposDaOutraEngine`: aquele barra o campo que
 * sobra, este o que falta. Os dois leem a mesma tabela de capacidades, que é a
 * mesma que decide o que o formulário mostra — uma regra só, em vez de uma no
 * schema, outra na tela e uma terceira aqui.
 *
 * O schema deixou `database` e `username` opcionais porque o libSQL não os tem;
 * sem esta função, uma conexão Postgres poderia nascer sem database e só
 * quebrar na primeira consulta.
 */
export function exigirCamposDaEngine<T>(
  engine: Engine,
  corpo: Readonly<Record<string, unknown>>,
): ServiceResult<T> | null {
  const capacidades = capacidadesDe(engine);
  if (capacidades === null) return null;

  const faltando = SEM_PADRAO.filter(
    (campo) =>
      capacidades.campos.includes(campo as (typeof capacidades.campos)[number]) &&
      (corpo[campo] === undefined || corpo[campo] === ""),
  );
  if (faltando.length === 0) return null;

  return fail<T>(
    "bad_request",
    `${faltando.join(", ")} ${faltando.length === 1 ? "é obrigatório" : "são obrigatórios"} em ${engine}.`,
  );
}

/**
 * Recusa a credencial de escrita que usa o **mesmo usuário** da leitura.
 *
 * ## Por que
 *
 * O pool do MySQL chaveia por `username` (`PoolMysql.chaveDe`), e é essa chave
 * que garante que uma tarefa de leitura nunca receba a conexão gravável. Se a
 * credencial de escrita tiver o mesmo `username` da de leitura, as duas caem no
 * mesmo grupo — e a separação, que é a defesa inteira, deixa de existir.
 *
 * A revisão adversarial marcou isto como defesa em profundidade: em config
 * realista, mesmo usuário significa mesma senha, e aí a credencial de leitura já
 * grava (o aviso `credential_can_write` aparece e o portão bloqueia). Mas o
 * invariante não estava imposto em lugar nenhum, e impor é barato.
 *
 * Vale só onde há `writeUsername` (MySQL/MariaDB). No libSQL a credencial de
 * escrita é só o token, sem usuário — não há o que colidir.
 */
export function recusarCredencialDeEscritaIgual<T>(
  engine: Engine,
  corpo: Readonly<Record<string, unknown>>,
): ServiceResult<T> | null {
  const capacidades = capacidadesDe(engine);
  if (!capacidades?.campos.includes("writeUsername")) return null;

  const usuario = corpo["username"];
  const usuarioEscrita = corpo["writeUsername"];
  if (
    typeof usuario === "string" &&
    typeof usuarioEscrita === "string" &&
    usuario !== "" &&
    usuario === usuarioEscrita
  ) {
    return fail<T>(
      "bad_request",
      "a credencial de escrita precisa de um usuário diferente do de leitura. É o " +
        "usuário distinto que mantém a leitura e a escrita em conexões separadas — " +
        "com o mesmo usuário, a separação que protege a leitura deixa de existir.",
    );
  }
  return null;
}
