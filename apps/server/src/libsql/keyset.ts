import {
  condicaoKeysetOr,
  ordenacaoOr,
  type Condicao,
  type CursorKeyset,
  type Direcao,
} from "../driver/keyset-or";
import { citar } from "./citar";

/**
 * A condição de keyset do libSQL.
 *
 * ## A forma: indiferente, e é o único caso
 *
 * Medido na página 100 000 de uma tabela de 131 072 linhas: as duas formas — a
 * comparação de linha `(c, pk) > (v, p)` e a disjunção canônica com `OR` —
 * produzem o **mesmo plano** (covering index) e o **mesmo tempo** (~0,4 ms).
 * O libSQL é o único das três engines que não tem preferência; o Postgres quer
 * a comparação de linha (0,25 ms contra 76,4 ms) e o MySQL quer a disjunção
 * (1 ms contra 24 ms).
 *
 * Sendo indiferente, ele usa a disjunção — a mesma de `driver/keyset-or.ts`.
 * Não é economia de linhas: a região dos NULL é a parte difícil da condição, e
 * mantê-la escrita uma vez só significa que ela não pode divergir entre as
 * engines que a compartilham.
 *
 * ## Os NULL: como no MySQL, não como no Postgres
 *
 * `ORDER BY v ASC` põe **NULL primeiro**. O libSQL até aceita `NULLS LAST` —
 * diferente do MySQL, onde é erro de sintaxe — mas usá-lo para imitar a ordem
 * do Postgres custaria o índice, e daria duas ordens diferentes para a mesma
 * tela conforme a engine. A ordem nativa manda.
 */

export type { Condicao, CursorKeyset, Direcao };

/** Ver `condicaoKeysetOr`. Aqui só a citação é do SQLite. */
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
