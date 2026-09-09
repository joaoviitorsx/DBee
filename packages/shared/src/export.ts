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
export const BundleTable = t.Object({
  schema: t.String({ minLength: 1, maxLength: 63 }),
  table: t.String({ minLength: 1, maxLength: 63 }),
  structure: t.Boolean(),
  data: t.Boolean(),
});
export type BundleTable = Static<typeof BundleTable>;

/**
 * Formato do export de várias tabelas.
 *
 * `sql` sai num arquivo só. Os demais saem **um arquivo por tabela dentro de um
 * `.zip`**: CSVs concatenados num arquivo só não são lidos por ferramenta
 * nenhuma (o Adminer faz isso e o resultado não abre no Excel).
 */
export const BundleFormat = t.Union([
  t.Literal("sql"),
  /** `;` — o separador que o Excel em português espera. */
  t.Literal("csv"),
  /** `,` — o do padrão, para quem consome por script. */
  t.Literal("csv-comma"),
  t.Literal("tsv"),
  /** Um array JSON por tabela. */
  t.Literal("json"),
  /** Um objeto por linha — o que ferramenta de log e stream espera. */
  t.Literal("ndjson"),
]);
export type BundleFormat = Static<typeof BundleFormat>;

/**
 * O que fazer com o resultado.
 *
 * `preview` abre na tela em vez de baixar, com teto de bytes — o ponto é
 * conferir o começo do arquivo antes de gerar um de 2 GB.
 */
export const BundleOutput = t.Union([
  t.Literal("download"),
  t.Literal("gzip"),
  t.Literal("preview"),
]);
export type BundleOutput = Static<typeof BundleOutput>;

/**
 * Estrutura no dump `.sql`.
 *
 * `drop-create` emite `DROP TABLE IF EXISTS … CASCADE` antes do `CREATE`.
 * O Adminer chama de "DROP+CREATE"; aqui o nome diz o que faz.
 */
export const BundleStructure = t.Union([
  t.Literal("none"),
  t.Literal("create"),
  t.Literal("drop-create"),
]);
export type BundleStructure = Static<typeof BundleStructure>;

/**
 * Como os dados saem no `.sql`.
 *
 * - `insert` — um `INSERT` por linha. Legível, lento de recarregar.
 * - `insert-conflict` — com `ON CONFLICT DO NOTHING`, para recarregar por cima
 *   de dado que já existe sem estourar na chave.
 * - `copy` — `COPY … FROM stdin`, **muito** mais rápido de recarregar num banco
 *   grande. É o que o `pg_dump` usa por padrão, e o motivo de existir aqui.
 *
 * Nos formatos que não são SQL, isto é ignorado: CSV não tem "modo de INSERT".
 */
export const BundleData = t.Union([
  t.Literal("none"),
  t.Literal("insert"),
  t.Literal("insert-conflict"),
  t.Literal("copy"),
]);
export type BundleData = Static<typeof BundleData>;

/**
 * Export de várias tabelas.
 *
 * As opções espelham o painel do Adminer, **traduzidas para o Postgres**. Ficam
 * de fora as que são só do MySQL: `USE` (o Postgres não tem) e "Incremento
 * Automático" (o equivalente é `serial`/`identity`, que já sai na estrutura).
 */
export const ExportBundleRequest = t.Object({
  database: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  tables: t.Array(BundleTable, { minItems: 1, maxItems: 500 }),
  format: t.Optional(BundleFormat),
  output: t.Optional(BundleOutput),
  structure: t.Optional(BundleStructure),
  data: t.Optional(BundleData),
  /** `CREATE INDEX` dos índices que não são a PK (`pg_get_indexdef`). */
  indexes: t.Optional(t.Boolean()),
  /** `CREATE TRIGGER` (`pg_get_triggerdef`). */
  triggers: t.Optional(t.Boolean()),
  /** Funções e procedures do schema (`pg_get_functiondef`). */
  routines: t.Optional(t.Boolean()),
});
export type ExportBundleRequest = Static<typeof ExportBundleRequest>;

/** Extensão de cada arquivo dentro do zip, por formato. */
export const EXTENSAO_BUNDLE: Readonly<Record<BundleFormat, string>> = {
  sql: "sql",
  csv: "csv",
  "csv-comma": "csv",
  tsv: "tsv",
  json: "json",
  ndjson: "ndjson",
};

/** Separador de cada formato tabular. `sql`/`json`/`ndjson` não usam. */
export const SEPARADOR_BUNDLE: Readonly<Record<BundleFormat, string>> = {
  sql: "",
  csv: ";",
  "csv-comma": ",",
  tsv: "\t",
  json: "",
  ndjson: "",
};

export * from "./export.puro";
