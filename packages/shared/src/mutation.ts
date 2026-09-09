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

export * from "./mutation.puro";
