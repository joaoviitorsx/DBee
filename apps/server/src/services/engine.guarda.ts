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
