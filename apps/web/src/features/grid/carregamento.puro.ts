import type { FilterOperator, RowFilter } from "@dbee/shared";

/**
 * Regra única de carregamento (ui-detalhes §3.7): abaixo de 120 ms nada (um
 * piscar de esqueleto é pior que espera nenhuma); até 1 s o esqueleto com a
 * forma final; acima disso `Trabalhando` com cronômetro.
 */
export type FaseCarregamento = "nada" | "esqueleto" | "trabalhando";
export const LIMIAR_ESQUELETO_MS = 120;
export const LIMIAR_TRABALHANDO_MS = 1000;

export function faseDe(decorridoMs: number): FaseCarregamento {
  if (decorridoMs < LIMIAR_ESQUELETO_MS) return "nada";
  if (decorridoMs < LIMIAR_TRABALHANDO_MS) return "esqueleto";
  return "trabalhando";
}

/** Operadores oferecidos no filtro da aba Dados, na ordem do seletor (F8). */
export const OPERADORES: readonly FilterOperator[] = [
  "contains", "eq", "ne", "lt", "lte", "gt", "gte", "in", "isNull", "isNotNull",
];

/** Símbolo curto do chip. Texto, não ícone: é o que a pessoa leria em SQL. */
export const SIMBOLO: Record<FilterOperator, string> = {
  eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=",
  contains: "ILIKE", startsWith: "ILIKE", isNull: "IS NULL", isNotNull: "IS NOT NULL", in: "IN",
};

export const semValor = (op: FilterOperator): boolean => op === "isNull" || op === "isNotNull";

/**
 * Monta o filtro do rascunho, ou `null` se incompleto. `in` parte a lista por
 * vírgula ou quebra de linha — cada item vira um parâmetro ligado no servidor
 * (o valor nunca entra no SQL). Itens vazios saem; lista vazia não filtra.
 */
export function montarFiltro(column: string, operator: FilterOperator, texto: string): RowFilter | null {
  if (column === "") return null;
  if (semValor(operator)) return { column, operator };
  if (operator === "in") {
    const values = texto.split(/[,\n]/).map((v) => v.trim()).filter((v) => v !== "").slice(0, 500);
    return values.length === 0 ? null : { column, operator, values };
  }
  return { column, operator, value: texto };
}

/** Texto do chip: `coluna = valor`, `coluna IN (a, b)`, `coluna IS NULL`. */
export function rotuloFiltro(f: RowFilter): string {
  if (semValor(f.operator)) return `${f.column} ${SIMBOLO[f.operator]}`;
  if (f.operator === "in") return `${f.column} IN (${(f.values ?? []).join(", ")})`;
  // Notação do SQL que o servidor executa (`::text ILIKE`), para a pessoa ler
  // o filtro como ele é — e sem palavra traduzível dentro do chip.
  if (f.operator === "contains") return `${f.column} ILIKE %${f.value ?? ""}%`;
  if (f.operator === "startsWith") return `${f.column} ILIKE ${f.value ?? ""}%`;
  return `${f.column} ${SIMBOLO[f.operator]} ${f.value ?? ""}`;
}
