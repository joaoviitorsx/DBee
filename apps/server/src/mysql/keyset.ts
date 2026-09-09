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
 */

export type Direcao = "asc" | "desc";

export interface CursorKeyset {
  readonly orderValue: string | null;
  readonly orderValueIsNull: boolean;
  readonly primaryKey: readonly string[];
}

export interface Condicao {
  readonly sql: string;
  readonly valores: unknown[];
}

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
 * É verbosa de propósito: é a forma que o otimizador do MySQL transforma em
 * busca por faixa, e a compacta ele varre inteira.
 */
function avancando(
  colunas: readonly string[],
  valores: readonly unknown[],
  direcao: Direcao,
  saida: unknown[],
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
export function condicaoKeyset(
  cursor: CursorKeyset,
  colunaOrdem: string | null,
  pk: readonly string[],
  direcao: Direcao,
  anulavel: boolean,
): Condicao {
  const valores: unknown[] = [];

  if (colunaOrdem === null) {
    return { sql: avancando(pk, cursor.primaryKey, direcao, valores), valores };
  }

  const col = citar(colunaOrdem);

  if (cursor.orderValueIsNull) {
    const dentro = avancando(pk, cursor.primaryKey, direcao, valores);
    /*
     * Já dentro da região dos NULL. O que sobra depende de onde ela fica:
     * em `asc` ela vem **primeiro**, então ainda há todo o resto depois dela;
     * em `desc` ela vem por último, e não há mais nada além dela.
     */
    return direcao === "asc"
      ? { sql: `(${col} IS NULL AND ${dentro}) OR ${col} IS NOT NULL`, valores }
      : { sql: `${col} IS NULL AND ${dentro}`, valores };
  }

  const canonica = avancando([colunaOrdem, ...pk], [cursor.orderValue, ...cursor.primaryKey], direcao, valores);

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
export function ordenacao(colunaOrdem: string | null, pk: readonly string[], direcao: Direcao): string {
  const dir = direcao === "asc" ? "ASC" : "DESC";
  const colunas = colunaOrdem === null ? [...pk] : [colunaOrdem, ...pk];
  return colunas.map((c) => `${citar(c)} ${dir}`).join(", ");
}
