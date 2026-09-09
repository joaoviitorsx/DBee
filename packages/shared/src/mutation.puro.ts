/**
 * A parte PURA da edição de linha: montar o SQL, sem TypeBox junto.
 *
 * ## Por que é um arquivo separado
 *
 * `mutation.ts` declara os schemas com `t` da Elysia, e `t` é **runtime**: quem
 * importa esse módulo leva o TypeBox inteiro junto. O front precisa só destas
 * funções — o preview do SQL antes de aplicar (ADR 006) — e não de schema
 * nenhum, porque validação é do servidor.
 *
 * Medido: os módulos do `shared` livres de Elysia custam 480 B gzip; qualquer
 * um que importe `t` custa 79,8 kB. A separação é o que deixa o navegador levar
 * o primeiro número.
 *
 * Os tipos vêm por `import type` do módulo de schema: tipo some na compilação,
 * então o ciclo é só de tipagem e não existe em runtime.
 */
import type {
  CellValue,
  RowDeleteRequest,
  RowInsertRequest,
  RowUpdateRequest,
} from "./mutation";

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
