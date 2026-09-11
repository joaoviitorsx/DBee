/**
 * A condição de keyset do MySQL e do MariaDB — e por que ela é o **oposto** da
 * do Postgres.
 *
 * ## A forma decide, e cada engine quer a forma contrária
 *
 * `(c, pk) > (v, p)` e `c > v OR (c = v AND pk > p)` selecionam exatamente as
 * mesmas linhas. Os planos não são os mesmos, e as duas engines discordam sobre
 * qual forma é a boa.
 *
 * Medido na página 100 000 de uma tabela de 131 072 linhas, coluna indexada:
 *
 * | | comparação de linha | disjunção com `OR` |
 * |---|---|---|
 * | PostgreSQL (`pg/rows.ts`) | `Index Cond`, **0,25 ms** | `Filter`, 76,4 ms |
 * | MySQL 8.4 | `type=index`, **24 ms** | `type=range`, **1 ms** |
 * | MariaDB 11.8 | `type=index`, 21 ms | `type=range`, **0 ms** |
 *
 * Reusar o planejador do Postgres aqui produziria uma paginação vinte vezes
 * mais lenta **sem erro nenhum** — o resultado é correto, só o plano é ruim.
 *
 * **Cuidado com o `EXPLAIN`:** ele mente na direção contrária. Para a
 * comparação de linha o `rows` estimado foi **50**, e para a disjunção,
 * **63 253** — o inverso do tempo medido. Quem decidir pelo `EXPLAIN` escolhe a
 * forma lenta.
 *
 * ## Os NULL ficam do outro lado
 *
 * Medido: no MySQL e no MariaDB, `ORDER BY v ASC` põe **NULL primeiro**; no
 * Postgres, por último. E `NULLS LAST` **não existe** aqui — é erro de sintaxe
 * nos dois.
 *
 * Forçar a ordem do Postgres exigiria `ORDER BY (v IS NULL), v`, uma expressão
 * que o índice não cobre. Então a ordem nativa é respeitada, e a região dos
 * NULL fica no **começo** em `asc` e no **fim** em `desc`. É a engine falando;
 * a alternativa era mentir para a tela e pagar com varredura.
 *
 * ## O corpo mudou de lugar
 *
 * A montagem em si vive em `driver/keyset-or.ts` desde que o libSQL entrou: ele
 * mede igual (a disjunção não é pior que a comparação de linha) e põe os NULL
 * no mesmo lugar, então as duas engines querem exatamente esta condição. O que
 * fica aqui é o que é do MySQL: a citação com crase.
 */

import {
  condicaoKeysetOr,
  ordenacaoOr,
  type Condicao,
  type CursorKeyset,
  type Direcao,
} from "../driver/keyset-or";

export type { Condicao, CursorKeyset, Direcao };

/**
 * Identificador entre crases, com crase interna duplicada.
 *
 * O MySQL cita com crase, não com aspas duplas. O nome vem sempre do catálogo,
 * nunca do usuário — mas escapar é barato, e a alternativa é a segurança
 * depender de um invariante mantido duas camadas acima.
 */
export function citar(identificador: string): string {
  return `\`${identificador.replaceAll("`", "``")}\``;
}

/** Ver `condicaoKeysetOr`. Aqui só a citação é do MySQL. */
export function condicaoKeyset(
  cursor: CursorKeyset,
  colunaOrdem: string | null,
  pk: readonly string[],
  direcao: Direcao,
  anulavel: boolean,
): Condicao {
  return condicaoKeysetOr(cursor, colunaOrdem, pk, direcao, anulavel, citar);
}

/** Ver `ordenacaoOr`. */
export function ordenacao(
  colunaOrdem: string | null,
  pk: readonly string[],
  direcao: Direcao,
): string {
  return ordenacaoOr(colunaOrdem, pk, direcao, citar);
}
