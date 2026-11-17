import type { DataCompareResponse, ResultColumn, SchemaCompareResponse } from "@dbee/shared";

/**
 * Formas de exibição do resultado de comparar (ADR 018). Puras: entram a
 * resposta do servidor e os rótulos já traduzidos, saem colunas e linhas para o
 * `ResultGrid` — que é virtualizado (regra 11) e copia o valor bruto (regra 10).
 */

const coluna = (name: string): ResultColumn => ({ name, dataTypeId: 25, dataTypeName: "text" });

type Linha = readonly (string | null)[];

/**
 * Amostra de dados: **duas linhas por diferença**, A em cima e B embaixo, com
 * os valores crus. Juntar "a → b" numa célula só seria formatar o dado (e o
 * Ctrl+C copiaria a seta); lado a lado em linhas, o bruto continua bruto.
 */
export function gradeDaAmostra(
  r: DataCompareResponse,
  rotulos: { tipo: string; lado: string; alteradas: string; kind: Record<"only_left" | "only_right" | "different", string> },
): { columns: ResultColumn[]; rows: Linha[] } {
  const columns = [coluna(rotulos.tipo), coluna(rotulos.lado), coluna(rotulos.alteradas), ...r.columns.map(coluna)];
  const rows: Linha[] = [];
  for (const s of r.samples) {
    const alteradas = s.changedColumns.join(", ");
    const vazia = r.columns.map(() => null);
    if (s.left !== null) rows.push([rotulos.kind[s.kind], "A", alteradas, ...s.left]);
    if (s.right !== null) rows.push([rotulos.kind[s.kind], "B", alteradas, ...s.right]);
    if (s.left === null && s.right === null) rows.push([rotulos.kind[s.kind], "", alteradas, ...vazia]);
  }
  return { columns, rows };
}

export function gradeDasDiferencas(
  r: SchemaCompareResponse,
  rotulos: { tipo: string; tabela: string; nome: string },
  rotuloDoTipo: (k: SchemaCompareResponse["differences"][number]["kind"]) => string,
): { columns: ResultColumn[]; rows: Linha[] } {
  return {
    columns: [coluna(rotulos.tipo), coluna(rotulos.tabela), coluna(rotulos.nome), coluna("A"), coluna("B")],
    rows: r.differences.map((d) => [rotuloDoTipo(d.kind), d.table, d.name, d.left, d.right]),
  };
}

/**
 * SQL que vai para o editor, com o aviso **dentro** do texto: o editor é de
 * outra fatia e o aviso tem de sobreviver a copiar/colar. Comentário `--` em
 * cada linha do aviso, para nenhuma quebra no texto traduzido virar SQL.
 */
export function sqlComAviso(sql: string, aviso: string): string {
  const cabecalho = aviso.split("\n").map((l) => `-- ${l}`).join("\n");
  return `${cabecalho}\n\n${sql}`;
}
