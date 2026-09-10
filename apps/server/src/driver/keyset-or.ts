/**
 * A condição de keyset na forma **disjuntiva canônica** — a que o MySQL, o
 * MariaDB e o libSQL querem.
 *
 * ## Por que este arquivo existe
 *
 * `(c, pk) > (v, p)` e `c > v OR (c = v AND pk > p)` selecionam as mesmas
 * linhas e produzem planos diferentes, e as engines discordam sobre qual forma
 * é a boa. Medido na página 100 000 de uma tabela de 131 072 linhas:
 *
 * | | comparação de linha | disjunção com `OR` |
 * |---|---|---|
 * | PostgreSQL (`pg/rows.ts`) | `Index Cond`, **0,25 ms** | `Filter`, 76,4 ms |
 * | MySQL 8.4 | `type=index`, 24 ms | `type=range`, **1 ms** |
 * | MariaDB 11.8 | `type=index`, 21 ms | `type=range`, **0 ms** |
 * | libSQL | covering index, ~0,4 ms | covering index, ~0,4 ms |
 *
 * O Postgres fica de fora — para ele a forma disjuntiva é 300× pior, e o
 * planejador dele tem o seu próprio arquivo. As outras três compartilham esta,
 * **e mais uma coisa medida**: nas três, `ORDER BY v ASC` põe **NULL primeiro**
 * (no Postgres, por último). Como a região dos NULL é o que torna a condição
 * difícil, uma implementação que serve às três é uma decisão que não diverge —
 * e não uma economia de linhas.
 *
 * O libSQL aceitaria `NULLS LAST` para imitar a ordem do Postgres; usá-lo
 * custaria o índice, e daria duas ordens diferentes para a mesma tela conforme
 * a engine. A ordem nativa manda, como no MySQL.
 *
 * ## O que muda entre elas
 *
 * Só a citação do identificador: crase no MySQL, aspas duplas no SQLite. Por
 * isso ela entra como função, e não como constante — o resto é idêntico, e
 * `?` posicional é o placeholder das três.
 */

export type Direcao = "asc" | "desc";

/** Cita um identificador na sintaxe da engine. */
export type Citar = (identificador: string) => string;

export interface CursorKeyset {
  readonly orderValue: string | null;
  readonly orderValueIsNull: boolean;
  readonly primaryKey: readonly string[];
}

export interface Condicao {
  readonly sql: string;
  /**
   * Texto ou `null`, nunca outra coisa.
   *
   * Vem do cursor, que trafega em texto porque **toda célula trafega em texto**
   * (CLAUDE.md regra 10). Tipar como `unknown[]` custou um achado de lint — e o
   * lint estava certo: um `unknown` aqui vira `[object Object]` no log da
   * auditoria no dia em que alguém empurrar um objeto.
   */
  readonly valores: (string | null)[];
}

/** `>` para `asc`, `<` para `desc`. */
function comparador(direcao: Direcao): string {
  return direcao === "asc" ? ">" : "<";
}

/**
 * A expansão canônica de `(c1, c2, …) > (v1, v2, …)`.
 *
 * ```
 *    (c1 > v1)
 * OR (c1 = v1 AND c2 > v2)
 * OR (c1 = v1 AND c2 = v2 AND c3 > v3)
 * ```
 *
 * É verbosa de propósito: é a forma que o otimizador transforma em busca por
 * faixa, e a compacta ele varre inteira.
 */
function avancando(
  colunas: readonly string[],
  valores: readonly (string | null)[],
  direcao: Direcao,
  saida: (string | null)[],
  citar: Citar,
): string {
  const cmp = comparador(direcao);
  const ramos: string[] = [];

  for (let i = 0; i < colunas.length; i += 1) {
    const iguais: string[] = [];
    for (let j = 0; j < i; j += 1) {
      iguais.push(`${citar(colunas[j] ?? "")} = ?`);
      saida.push(valores[j] ?? null);
    }
    iguais.push(`${citar(colunas[i] ?? "")} ${cmp} ?`);
    saida.push(valores[i] ?? null);
    ramos.push(iguais.length === 1 ? (iguais[0] ?? "") : `(${iguais.join(" AND ")})`);
  }

  return ramos.length === 1 ? (ramos[0] ?? "") : `(${ramos.join(" OR ")})`;
}

/**
 * A condição que traz a página seguinte ao cursor.
 *
 * `colunaOrdem` é `null` quando a ordenação é só pela chave primária.
 * `anulavel` vem do catálogo: numa coluna `NOT NULL` a região de NULL não
 * existe e a condição fica mais curta — e mais indexável.
 */
export function condicaoKeysetOr(
  cursor: CursorKeyset,
  colunaOrdem: string | null,
  pk: readonly string[],
  direcao: Direcao,
  anulavel: boolean,
  citar: Citar,
): Condicao {
  const valores: (string | null)[] = [];

  if (colunaOrdem === null) {
    return { sql: avancando(pk, cursor.primaryKey, direcao, valores, citar), valores };
  }

  const col = citar(colunaOrdem);

  if (cursor.orderValueIsNull) {
    const dentro = avancando(pk, cursor.primaryKey, direcao, valores, citar);
    /*
     * Já dentro da região dos NULL. O que sobra depende de onde ela fica:
     * em `asc` ela vem **primeiro**, então ainda há todo o resto depois dela;
     * em `desc` ela vem por último, e não há mais nada além dela.
     */
    return direcao === "asc"
      ? { sql: `(${col} IS NULL AND ${dentro}) OR ${col} IS NOT NULL`, valores }
      : { sql: `${col} IS NULL AND ${dentro}`, valores };
  }

  const canonica = avancando(
    [colunaOrdem, ...pk],
    [cursor.orderValue, ...cursor.primaryKey],
    direcao,
    valores,
    citar,
  );

  /*
   * Cursor fora dos NULL. Em `desc` os NULL ainda estão por vir, e precisam
   * entrar; em `asc` eles já passaram, e `c > v` os exclui sozinho, porque
   * comparação com NULL não é verdadeira.
   */
  if (direcao === "desc" && anulavel) {
    return { sql: `${canonica} OR ${col} IS NULL`, valores };
  }
  return { sql: canonica, valores };
}

/**
 * `ORDER BY` correspondente, na ordem nativa da engine.
 *
 * A chave primária entra junto e na mesma direção: sem isso, uma coluna de
 * ordenação com valores repetidos deixa a ordem indefinida entre as páginas, e
 * o keyset pula ou repete linhas. É a armadilha clássica.
 */
export function ordenacaoOr(
  colunaOrdem: string | null,
  pk: readonly string[],
  direcao: Direcao,
  citar: Citar,
): string {
  const dir = direcao === "asc" ? "ASC" : "DESC";
  const colunas = colunaOrdem === null ? [...pk] : [colunaOrdem, ...pk];
  return colunas.map((c) => `${citar(c)} ${dir}`).join(", ");
}
