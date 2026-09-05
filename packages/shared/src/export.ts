import { t, type Static } from "elysia";

import { RowFilter } from "./rows";

/**
 * Formatos de export. XLSX está fora de escopo (exigiria dependência nativa).
 *
 * `sql` só vale para origem **tabela** (não consulta arbitrária): sem uma tabela
 * de destino, `INSERT INTO …` não teria para onde ir. Emite `CREATE TABLE` de
 * referência (da introspecção) + um `INSERT` por linha, tudo em stream — dentro
 * da fronteira (ADR 006): dados por `SELECT`, DDL **gerado**, sem `pg_dump`.
 */
export const ExportFormat = t.Union([
  t.Literal("csv"),
  t.Literal("json"),
  t.Literal("ndjson"),
  t.Literal("sql"),
]);
export type ExportFormat = Static<typeof ExportFormat>;

/**
 * Opções do CSV.
 *
 * Os defaults são os que **funcionam no Excel em português**, não os do padrão:
 *
 * - **`;` como separador.** O Excel pt-BR usa `;` como separador de lista e abre
 *   um CSV vírgula-separado jogando tudo numa coluna só.
 * - **BOM UTF-8.** Sem ele o Excel assume a codificação da região e come a
 *   acentuação — `Produção` vira `ProduÃ§Ã£o`.
 *
 * O destino provável destes arquivos é planilha de fiscal. `,` e sem-BOM
 * continuam disponíveis para quem for consumir por script.
 */
export const CsvOptions = t.Object({
  delimiter: t.Optional(t.Union([t.Literal(";"), t.Literal(","), t.Literal("\t")])),
  bom: t.Optional(t.Boolean()),
  header: t.Optional(t.Boolean()),
});
export type CsvOptions = Static<typeof CsvOptions>;

/** Alvo do export: ou um SQL, ou uma relação com os mesmos filtros da aba Dados. */
export const ExportSource = t.Union([
  t.Object({
    kind: t.Literal("query"),
    sql: t.String({ minLength: 1, maxLength: 1_000_000 }),
  }),
  t.Object({
    kind: t.Literal("table"),
    schema: t.String({ minLength: 1, maxLength: 63 }),
    table: t.String({ minLength: 1, maxLength: 63 }),
    orderBy: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
    orderDirection: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
    /**
     * O **mesmo** `RowFilter` da aba Dados, não uma cópia parecida.
     *
     * Redeclarar aqui com `operator: t.String()` deixava passar operador fora
     * da lista, que chega ao montador de SQL e sai como `undefined` no meio da
     * condição — erro de sintaxe do Postgres em vez de 400.
     */
    filters: t.Optional(t.Array(RowFilter, { maxItems: 20 })),
  }),
]);
export type ExportSource = Static<typeof ExportSource>;

export const ExportRequest = t.Object({
  source: ExportSource,
  format: ExportFormat,
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  csv: t.Optional(CsvOptions),
  /**
   * Teto de linhas. Ausente significa **tudo** — que é o ponto do export.
   *
   * A UI usa isto para a escolha "exportar as N visíveis": ali ela manda o
   * número que o usuário viu na tela.
   */
  maxRows: t.Optional(t.Integer({ minimum: 1, maximum: 100_000_000 })),
});
export type ExportRequest = Static<typeof ExportRequest>;

/** Tamanho do lote do `FETCH`. Ver `DBee.md` §6 e §11.11. */
export const EXPORT_BATCH = 1000;

const CSV_PADRAO: Required<CsvOptions> = { delimiter: ";", bom: true, header: true };

/**
 * Escapa um campo de CSV.
 *
 * Aspas duplas dobradas, campo entre aspas sempre que contiver o separador,
 * aspas, `\n` ou `\r` — a regra do RFC 4180, com o separador configurável.
 *
 * **NULL e string vazia saem os dois como campo vazio.** O CSV não tem como
 * distinguir os dois sem inventar convenção (`\N`, `NULL` literal), e qualquer
 * convenção inventada seria lida errado pelo Excel, que é o destino provável.
 * A ambiguidade é real e a UI avisa dela — escolher em silêncio seria pior.
 */
export function csvField(valor: string | null, delimiter: string): string {
  if (valor === null) return "";
  if (valor === "") return "";

  const precisaAspas =
    valor.includes(delimiter) ||
    valor.includes('"') ||
    valor.includes("\n") ||
    valor.includes("\r");

  return precisaAspas ? `"${valor.replaceAll('"', '""')}"` : valor;
}

export function csvLine(
  valores: readonly (string | null)[],
  delimiter: string = CSV_PADRAO.delimiter,
): string {
  return valores.map((v) => csvField(v, delimiter)).join(delimiter) + "\r\n";
}

/** Resolve as opções de CSV com os defaults do Excel brasileiro. */
export function csvOptions(opcoes: CsvOptions | undefined): Required<CsvOptions> {
  return {
    delimiter: opcoes?.delimiter ?? CSV_PADRAO.delimiter,
    bom: opcoes?.bom ?? CSV_PADRAO.bom,
    header: opcoes?.header ?? CSV_PADRAO.header,
  };
}

/** Uma linha em TSV — o formato que cola direto numa planilha. */
export function tsvLine(valores: readonly (string | null)[]): string {
  return valores
    .map((v) => (v ?? "").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", ""))
    .join("\t");
}

/** Nome de arquivo sugerido, sem caractere que atrapalhe em qualquer sistema. */
export function exportFilename(base: string, format: ExportFormat): string {
  const limpo = base.replace(/[^\w.-]+/g, "_").slice(0, 80) || "dbee";
  const carimbo = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  return `${limpo}_${carimbo}.${format === "ndjson" ? "ndjson" : format}`;
}

export const CONTENT_TYPE: Readonly<Record<ExportFormat, string>> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  sql: "application/sql; charset=utf-8",
};

/**
 * Identificador SQL entre aspas duplas, com aspas internas dobradas.
 *
 * Vale para schema, tabela e nome de coluna. `"` no meio de um nome é raro mas
 * legal no Postgres (`create table "a""b" (…)`) — dobrar é o escape correto e
 * fecha o vetor de quebrar o identificador para injetar DDL.
 */
export function sqlIdent(nome: string): string {
  return `"${nome.replaceAll('"', '""')}"`;
}

/**
 * Um valor de célula como literal SQL.
 *
 * `null` vira `NULL`. **Todo o resto sai como string entre aspas simples**, com
 * aspas simples internas dobradas — mesmo número, boolean, timestamp. Isso é
 * seguro porque toda célula já trafega como texto (regra 10) e o Postgres
 * coage o literal de texto para o tipo da coluna no `INSERT`: `'10'` entra numa
 * coluna `integer`, `'2026-01-01'` numa `date`. Não tentar detectar tipo aqui —
 * detecção erra (um CPF com zero à esquerda viraria número e perderia o zero) e
 * a coerção do destino é o comportamento que já queremos.
 */
export function sqlValue(valor: string | null): string {
  if (valor === null) return "NULL";
  return `'${valor.replaceAll("'", "''")}'`;
}

/** Uma linha de `INSERT INTO … VALUES (…);` já montada. */
export function sqlInsertLine(
  tabelaQualificada: string,
  colunas: readonly string[],
  valores: readonly (string | null)[],
): string {
  const cols = colunas.map(sqlIdent).join(", ");
  const vals = valores.map(sqlValue).join(", ");
  return `INSERT INTO ${tabelaQualificada} (${cols}) VALUES (${vals});\n`;
}
