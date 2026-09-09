/**
 * A parte PURA do export: CSV, TSV, literais SQL e nome de arquivo.
 *
 * Separado de `export.ts` pelo mesmo motivo de `mutation.puro.ts`: o módulo de
 * schema importa `t` da Elysia, que é runtime. O front usa `tsvLine` para o
 * `Ctrl+C` da grade e `PREVIEW_MAX_BYTES` para o corte do preview — nada disso
 * precisa de TypeBox.
 */
import type { CsvOptions, ExportFormat } from "./export";

/** Teto do `preview`. Acima disso o corpo é cortado e a UI avisa. */
export const PREVIEW_MAX_BYTES = 256 * 1024;

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

/**
 * Uma linha de `INSERT INTO … VALUES (…);` já montada.
 *
 * `sufixo` entra antes do `;` — é onde `ON CONFLICT DO NOTHING` cabe, para
 * recarregar por cima de dado que já existe sem estourar na chave primária.
 * Fica como parâmetro, e não como concatenação de quem chama, porque o `;` é
 * montado aqui: emendar depois produziria `…);` seguido do sufixo, que é
 * sintaxe inválida.
 */
export function sqlInsertLine(
  tabelaQualificada: string,
  colunas: readonly string[],
  valores: readonly (string | null)[],
  sufixo = "",
): string {
  const cols = colunas.map(sqlIdent).join(", ");
  const vals = valores.map(sqlValue).join(", ");
  const fim = sufixo === "" ? "" : ` ${sufixo}`;
  return `INSERT INTO ${tabelaQualificada} (${cols}) VALUES (${vals})${fim};\n`;
}

/**
 * Uma tabela no dump de várias (Adminer-like).
 *
 * `structure` e `data` são independentes porque os três casos úteis existem:
 * só o schema (para criar um ambiente vazio), só os dados (para recarregar num
 * schema que já existe), ou os dois.
 */
