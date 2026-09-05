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

export function construirUpdate(req: RowUpdateRequest): SqlConstruido {
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
  // Guarda otimista: os valores originais das colunas alteradas. NULL vira
  // `IS NULL` — `= NULL` nunca casa.
  //
  // A comparação é sobre `col::text`, não `col = $n`: `json` e `xml` (entre
  // outros) não têm operador `=`, e o valor lido já veio como texto de qualquer
  // forma. Casar `col::text` contra esse texto detecta a mudança sem depender de
  // o tipo ter igualdade — e vale para todos os tipos. A PK fica sem cast, para
  // continuar usando o índice.
  for (const c of req.changes) {
    if (c.from === null) {
      whereSql.push(`${qid(c.column)} IS NULL`);
      whereLit.push(`${qid(c.column)} IS NULL`);
    } else {
      whereSql.push(`${qid(c.column)}::text = ${ph(c.from)}`);
      whereLit.push(`${qid(c.column)}::text = ${lit(c.from)}`);
    }
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

export function construirDelete(req: RowDeleteRequest): SqlConstruido {
  const params: CellValue[] = [];
  const ph = (v: CellValue): string => {
    params.push(v);
    return `$${String(params.length)}`;
  };

  const whereSql = req.pk.map((p) => `${qid(p.column)} = ${ph(p.value)}`).join(" AND ");
  const whereLit = req.pk.map((p) => `${qid(p.column)} = ${lit(p.value)}`).join(" AND ");

  const alvo = rel(req.schema, req.table);
  return {
    text: `DELETE FROM ${alvo} WHERE ${whereSql}`,
    params,
    literal: `DELETE FROM ${alvo} WHERE ${whereLit}`,
  };
}
