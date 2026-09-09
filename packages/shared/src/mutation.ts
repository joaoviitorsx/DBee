import { t, type Static } from "elysia";

/**
 * Edição de linha — UPDATE de célula e DELETE de linha (v0.2, DBee.md §1 e §6).
 *
 * O corolário da fronteira (ADR 006): o DBee **gera o SQL** e o usuário confirma
 * antes de aplicar. Por isso o construtor devolve duas formas da mesma operação:
 *
 * - `text` + `params`: parametrizado, o que **executa**. Valor nenhum é
 *   concatenado no SQL executado — vai tudo por `$n`.
 * - `literal`: os mesmos valores **inline**, só para o preview e o `query_log`.
 *   É o que o humano lê e confirma ('2026-03-01', não `$1`). **Nunca executa.**
 *
 * A guarda otimista mora no `WHERE` do UPDATE: além da PK, ele repete os valores
 * ORIGINAIS das colunas que estão sendo alteradas. Se a linha mudou entre a
 * leitura e a aplicação, o `WHERE` casa 0 linhas e a operação aborta — o serviço
 * ainda exige que exatamente 1 linha seja afetada, dentro da transação, antes de
 * commitar.
 */

/** Valor de célula: string ou NULL. Todo valor trafega como string (regra 10). */
export const CellValue = t.Union([t.String(), t.Null()]);
export type CellValue = Static<typeof CellValue>;

const PkColumn = t.Object({
  column: t.String({ minLength: 1, maxLength: 63 }),
  /** Coluna de PK não é nula. */
  value: t.String({ maxLength: 100_000 }),
});

const Alvo = {
  database: t.String({ minLength: 1, maxLength: 100 }),
  schema: t.String({ minLength: 1, maxLength: 63 }),
  table: t.String({ minLength: 1, maxLength: 63 }),
  /**
   * Intenção de escrita explícita — igual ao executor (§6). Omitir ou mandar
   * `true` recusa: campo ausente tem que significar o estado seguro.
   */
  readOnly: t.Literal(false),
};

export const RowUpdateRequest = t.Object({
  ...Alvo,
  pk: t.Array(PkColumn, { minItems: 1, maxItems: 32 }),
  changes: t.Array(
    t.Object({
      column: t.String({ minLength: 1, maxLength: 63 }),
      from: CellValue,
      to: CellValue,
    }),
    { minItems: 1, maxItems: 512 },
  ),
});
export type RowUpdateRequest = Static<typeof RowUpdateRequest>;

export const RowDeleteRequest = t.Object({
  ...Alvo,
  pk: t.Array(PkColumn, { minItems: 1, maxItems: 32 }),
  /**
   * Guarda otimista — os valores ORIGINAIS das colunas não-PK, como foram
   * lidos. Mesmo papel que o `from` do UPDATE: se outra pessoa alterou qualquer
   * coluna entre a leitura e o clique, o `WHERE` casa 0 linhas e o DELETE
   * aborta. UPDATE que sobrescreve em silêncio já é ruim; DELETE não volta —
   * por isso a guarda é obrigatória aqui, não opcional. Vem vazia só na tabela
   * só-PK, onde não há dado não-chave que possa ter mudado.
   */
  guard: t.Array(
    t.Object({ column: t.String({ minLength: 1, maxLength: 63 }), value: CellValue }),
    { minItems: 0, maxItems: 512 },
  ),
});
export type RowDeleteRequest = Static<typeof RowDeleteRequest>;

export const RowInsertRequest = t.Object({
  ...Alvo,
  /**
   * Só as colunas que o usuário informou. As omitidas ficam com o default /
   * sequence do Postgres — é o ponto do INSERT ser um problema diferente do
   * UPDATE. Coluna gerada informada aqui faz o Postgres recusar (não há como
   * detectá-la na introspecção atual); o erro vai inteiro para a tela.
   */
  values: t.Array(
    t.Object({ column: t.String({ minLength: 1, maxLength: 63 }), value: CellValue }),
    { minItems: 1, maxItems: 512 },
  ),
});
export type RowInsertRequest = Static<typeof RowInsertRequest>;

export const RowMutationResult = t.Object({
  rowCount: t.Integer(),
  /** O SQL literal aplicado — o mesmo que foi ao `query_log`. */
  sql: t.String(),
});
export type RowMutationResult = Static<typeof RowMutationResult>;

/** SQL construído nas duas formas: a que executa e a que se lê. */
export interface SqlConstruido {
  /** Parametrizado — o que vai ao Postgres. */
  readonly text: string;
  readonly params: CellValue[];
  /** Com valores literais — preview e `query_log`. Nunca executa. */
  readonly literal: string;
}

/** Aspa de identificador: `"` vira `""`. Cobre schema, tabela e coluna. */
const qid = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** Valor como literal SQL, só para leitura. String entre aspas simples; NULL. */
const lit = (v: CellValue): string => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

const rel = (schema: string, table: string): string => `${qid(schema)}.${qid(table)}`;

/**
 * Tipo de cada coluna, como `format_type` do catálogo o escreve
 * (`character(14)`, `numeric(12,2)`, `timestamp with time zone`).
 *
 * Vem **do servidor**, lido do `pg_attribute` da conexão em uso, nunca da
 * requisição: o tipo é interpolado no SQL, e aceitar do cliente seria injeção.
 * Coluna ausente do mapa cai na forma antiga — degrada, não quebra.
 */
export type TiposDeColuna = ReadonlyMap<string, string>;

/**
 * A guarda otimista de uma coluna.
 *
 * ## O bug que esta função existe para não repetir
 *
 * A guarda era `col::text = $n`, e a justificativa estava certa pela metade:
 * `json` e `xml` não têm operador `=`, e o valor lido já veio como texto. O que
 * ninguém conferiu é que **`col::text` não é o que o driver entregou**. Medido
 * contra Postgres real, três tipos divergem:
 *
 * | tipo            | o grid recebeu   | `col::text` dá   |
 * |-----------------|------------------|------------------|
 * | `character(14)` | `"1234567890    "` (preenchido) | `"1234567890"` |
 * | `boolean`       | `"t"`            | `"true"`         |
 * | `inet`          | `"10.0.0.1"`     | `"10.0.0.1/32"`  |
 *
 * Nos três a guarda casava **zero** linhas, sempre. E zero linha não vira erro
 * técnico: vira `row_changed`, que diz à pessoa "a linha mudou desde que você a
 * leu — recarregue e refaça". Mentira, e inacionável: recarregar traz o mesmo
 * valor e falha de novo, para sempre. Como a guarda do DELETE cobre TODAS as
 * colunas não-PK, um único `char(n)` preenchido ou um `boolean` tornava a
 * tabela inteira impossível de excluir.
 *
 * ## A forma que passa em todos
 *
 * `to_json(col)#>>'{}' = to_json($n::<tipo>)#>>'{}'` — os dois lados
 * atravessam exatamente a mesma conversão. O parâmetro volta a ser o tipo da
 * coluna (é dela que ele saiu, então o cast nunca falha) e os dois viram texto
 * pelo mesmo caminho.
 *
 * **`to_json`, e não `::text`.** Os dois resolvem o `char(n)`, o `boolean` e o
 * `inet`; a diferença aparece num tipo só, e ela custa dado: `bpchar` SEM
 * comprimento (o que sai de `CREATE TABLE x AS SELECT max(uf) …`) guarda os
 * brancos à direita, e `::text` faz `rtrim` **dos dois lados** — com ele, um
 * terceiro trocando `'SP  '` por `'SP'` passava despercebido e o DELETE
 * apagava assim mesmo. `to_json` usa a função de saída do tipo, que é
 * exatamente o que o driver entregou, então preserva o branco e recusa.
 *
 * Medido nos dois sentidos, em 25 tipos contra Postgres real: valor inalterado
 * casa 1 (senão a linha fica indelével) e valor mexido por terceiro casa 0
 * (senão a guarda não protege nada). `::text` falhava no `bpchar`; `to_json`
 * passa nos 25. Inclui `json`, `xml` e `point`, que **não têm `=`** e por isso
 * derrubariam a alternativa óbvia (`col = $n::<tipo>`).
 *
 * A PK continua sem conversão nenhuma, para seguir usando o índice.
 */
function guarda(coluna: string, valor: CellValue, tipos: TiposDeColuna, ph: (v: CellValue) => string): string {
  // `= NULL` nunca casa; a ausência é comparada com `IS NULL`.
  if (valor === null) return `${qid(coluna)} IS NULL`;
  const tipo = tipos.get(coluna);
  // Sem o tipo (tabela sumiu do catálogo entre a leitura e o apply), a forma
  // antiga: pior, mas não inventa cast.
  if (tipo === undefined) return `${qid(coluna)}::text = ${ph(valor)}`;
  return `to_json(${qid(coluna)})#>>'{}' = to_json(${ph(valor)}::${tipo})#>>'{}'`;
}

export function construirUpdate(req: RowUpdateRequest, tipos: TiposDeColuna = new Map()): SqlConstruido {
  const params: CellValue[] = [];
  const ph = (v: CellValue): string => {
    params.push(v);
    return `$${String(params.length)}`;
  };

  const setSql = req.changes.map((c) => `${qid(c.column)} = ${ph(c.to)}`).join(", ");
  const setLit = req.changes.map((c) => `${qid(c.column)} = ${lit(c.to)}`).join(", ");

  const whereSql: string[] = [];
  const whereLit: string[] = [];
  for (const p of req.pk) {
    whereSql.push(`${qid(p.column)} = ${ph(p.value)}`);
    whereLit.push(`${qid(p.column)} = ${lit(p.value)}`);
  }
  // Guarda otimista: os valores originais das colunas alteradas. Ver `guarda`.
  for (const c of req.changes) {
    whereSql.push(guarda(c.column, c.from, tipos, ph));
    whereLit.push(guarda(c.column, c.from, tipos, lit));
  }

  const alvo = rel(req.schema, req.table);
  return {
    text: `UPDATE ${alvo} SET ${setSql} WHERE ${whereSql.join(" AND ")}`,
    params,
    literal: `UPDATE ${alvo} SET ${setLit} WHERE ${whereLit.join(" AND ")}`,
  };
}

export function construirInsert(req: RowInsertRequest): SqlConstruido {
  const params: CellValue[] = [];
  const ph = (v: CellValue): string => {
    params.push(v);
    return `$${String(params.length)}`;
  };

  const cols = req.values.map((v) => qid(v.column)).join(", ");
  const phs = req.values.map((v) => ph(v.value)).join(", ");
  const lits = req.values.map((v) => lit(v.value)).join(", ");

  const alvo = rel(req.schema, req.table);
  return {
    text: `INSERT INTO ${alvo} (${cols}) VALUES (${phs})`,
    params,
    literal: `INSERT INTO ${alvo} (${cols}) VALUES (${lits})`,
  };
}

export function construirDelete(req: RowDeleteRequest, tipos: TiposDeColuna = new Map()): SqlConstruido {
  const params: CellValue[] = [];
  const ph = (v: CellValue): string => {
    params.push(v);
    return `$${String(params.length)}`;
  };

  const whereSql: string[] = [];
  const whereLit: string[] = [];
  for (const p of req.pk) {
    whereSql.push(`${qid(p.column)} = ${ph(p.value)}`);
    whereLit.push(`${qid(p.column)} = ${lit(p.value)}`);
  }
  // Guarda otimista, mesmos moldes do UPDATE. Ver `guarda`.
  for (const g of req.guard) {
    whereSql.push(guarda(g.column, g.value, tipos, ph));
    whereLit.push(guarda(g.column, g.value, tipos, lit));
  }

  const alvo = rel(req.schema, req.table);
  return {
    text: `DELETE FROM ${alvo} WHERE ${whereSql.join(" AND ")}`,
    params,
    literal: `DELETE FROM ${alvo} WHERE ${whereLit.join(" AND ")}`,
  };
}
