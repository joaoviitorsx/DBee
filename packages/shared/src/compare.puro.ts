/**
 * Data compare e schema compare — a parte pura (ADR 018). Sem I/O: recebe o
 * que os dois lados leram e devolve diferenças e SQL **como texto**.
 *
 * O SQL gerado nunca é executado pelo DBee; ele vai para o editor, onde a
 * pessoa lê e decide (teste 4 da fronteira). Literais seguem a regra de
 * `sqlValue`: tudo entre aspas, o destino coage para o tipo da coluna.
 */
import type {
  DataCompareKind,
  DataCompareSample,
  SchemaDiff,
} from "./compare";
import type { Column, ForeignKey, Index, SchemaNode } from "./schema";
import type { DialetoSql } from "./split";

/**
 * Texto que vai depois de `--` precisa caber numa linha só: um nome de objeto
 * (ou definição de índice) com quebra de linha terminaria o comentário e
 * deixaria o resto EXECUTÁVEL no editor — uma remoção "comentada" virava
 * statement ativo. Achado na revisão adversarial da v0.6.0.
 */
export function umaLinha(comentario: string): string {
  return comentario.replace(/[\r\n\u2028\u2029]+/g, " ");
}


type Celula = string | null;

// ── Citação por dialeto ─────────────────────────────────────────────────────

export function citarIdent(nome: string, dialeto: DialetoSql): string {
  return dialeto === "mysql" ? `\`${nome.replaceAll("`", "``")}\`` : `"${nome.replaceAll('"', '""')}"`;
}

/**
 * Literal de texto. MySQL escapa barra invertida por padrão (sem
 * `NO_BACKSLASH_ESCAPES`), então ela é dobrada lá; Postgres (com
 * `standard_conforming_strings = on`, o padrão) e SQLite não.
 */
export function literal(valor: Celula, dialeto: DialetoSql): string {
  if (valor === null) return "NULL";
  const v = dialeto === "mysql" ? valor.replaceAll("\\", "\\\\") : valor;
  return `'${v.replaceAll("'", "''")}'`;
}

// ── Data compare ────────────────────────────────────────────────────────────

export interface LadoLido {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Celula[])[];
}

export interface ResultadoDataCompare {
  readonly columns: string[];
  readonly ignoredColumns: string[];
  readonly onlyLeft: number;
  readonly onlyRight: number;
  readonly different: number;
  readonly equal: number;
  readonly samples: DataCompareSample[];
  readonly sql: string;
}

/** Chave estável de PK: JSON de array distingue `null` de `"null"` e não colide por separador. */
const chaveDe = (valores: readonly Celula[]): string => JSON.stringify(valores);

export function compararDados(
  esquerda: LadoLido,
  direita: LadoLido,
  primaryKey: readonly string[],
  alvo: { readonly schema: string; readonly table: string; readonly dialeto: DialetoSql },
  sampleSize: number,
): ResultadoDataCompare {
  const colsDir = new Set(direita.columns);
  const colsEsq = new Set(esquerda.columns);
  const columns = esquerda.columns.filter((c) => colsDir.has(c));
  const ignoredColumns = [
    ...esquerda.columns.filter((c) => !colsDir.has(c)),
    ...direita.columns.filter((c) => !colsEsq.has(c)),
  ];
  const idx = (lado: LadoLido) => columns.map((c) => lado.columns.indexOf(c));
  const iEsq = idx(esquerda);
  const iDir = idx(direita);
  const pkPos = primaryKey.map((c) => columns.indexOf(c));

  const projetar = (linha: readonly Celula[], indices: readonly number[]): Celula[] =>
    indices.map((i) => linha[i] ?? null);
  const pkDe = (linha: readonly Celula[]): Celula[] => pkPos.map((i) => linha[i] ?? null);

  const mapaDir = new Map<string, Celula[]>();
  for (const r of direita.rows) {
    const p = projetar(r, iDir);
    mapaDir.set(chaveDe(pkDe(p)), p);
  }

  const d = alvo.dialeto;
  const tabela = `${citarIdent(alvo.schema, d)}.${citarIdent(alvo.table, d)}`;
  const where = (pk: readonly Celula[]) =>
    primaryKey.map((c, i) => `${citarIdent(c, d)} = ${literal(pk[i] ?? null, d)}`).join(" AND ");

  const inserts: string[] = [];
  const updates: string[] = [];
  const deletes: string[] = [];
  const samples: DataCompareSample[] = [];
  let onlyLeft = 0;
  let different = 0;
  let equal = 0;

  const amostrar = (kind: DataCompareKind, key: Celula[], left: Celula[] | null, right: Celula[] | null, changed: string[]) => {
    if (samples.length < sampleSize) samples.push({ kind, key, left, right, changedColumns: changed });
  };

  for (const r of esquerda.rows) {
    const e = projetar(r, iEsq);
    const pk = pkDe(e);
    const k = chaveDe(pk);
    const dir = mapaDir.get(k);
    if (dir === undefined) {
      onlyLeft++;
      inserts.push(
        `INSERT INTO ${tabela} (${columns.map((c) => citarIdent(c, d)).join(", ")}) VALUES (${e.map((v) => literal(v, d)).join(", ")});`,
      );
      amostrar("only_left", pk, e, null, []);
      continue;
    }
    mapaDir.delete(k);
    const mudou = columns.filter((_, i) => e[i] !== dir[i]);
    if (mudou.length === 0) {
      equal++;
      continue;
    }
    different++;
    const sets = mudou.map((c) => `${citarIdent(c, d)} = ${literal(e[columns.indexOf(c)] ?? null, d)}`);
    updates.push(`UPDATE ${tabela} SET ${sets.join(", ")} WHERE ${where(pk)};`);
    amostrar("different", pk, e, dir, mudou);
  }

  for (const dir of mapaDir.values()) {
    const pk = pkDe(dir);
    deletes.push(`DELETE FROM ${tabela} WHERE ${where(pk)};`);
    amostrar("only_right", pk, null, dir, []);
  }

  const secao = (titulo: string, linhas: readonly string[]) =>
    linhas.length === 0 ? [] : [umaLinha(`-- ${titulo} (${String(linhas.length)})`), ...linhas, ""];
  const sql = [
    `-- Gerado pelo DBee (data compare). NÃO foi executado: revise antes de rodar.`,
    umaLinha(`-- Leva ${tabela} a ficar igual ao lado esquerdo.`),
    "",
    ...secao("só no lado esquerdo → INSERT", inserts),
    ...secao("diferentes → UPDATE", updates),
    ...secao("só no lado direito → DELETE", deletes),
  ].join("\n");

  return {
    columns,
    ignoredColumns,
    onlyLeft,
    onlyRight: mapaDir.size,
    different,
    equal,
    samples,
    sql,
  };
}

// ── Schema compare ──────────────────────────────────────────────────────────

const q = (nome: string) => citarIdent(nome, "postgres");

function definicaoColuna(c: Column): string {
  return [
    q(c.name),
    c.dataType,
    c.defaultValue === null ? "" : `DEFAULT ${c.defaultValue}`,
    c.nullable ? "" : "NOT NULL",
  ].filter((p) => p !== "").join(" ");
}

function fkAssinatura(fk: ForeignKey): string {
  return `(${fk.columns.join(",")})->${fk.referencedTable}(${fk.referencedColumns.join(",")})`;
}

function fkDdl(tabela: string, schemaAlvo: string, fk: ForeignKey, schemaEsq: string): string {
  // FK para o próprio schema comparado aponta para o schema alvo; para fora, mantém.
  const refSchema = fk.referencedSchema === schemaEsq ? schemaAlvo : fk.referencedSchema;
  return (
    `ALTER TABLE ${tabela} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fk.columns.map(q).join(", ")}) ` +
    `REFERENCES ${q(refSchema)}.${q(fk.referencedTable)} (${fk.referencedColumns.map(q).join(", ")});`
  );
}

/**
 * Diferenças de `right` para `left` e o DDL (Postgres) que levaria `right` a
 * `left`. Remoções saem comentadas (ADR 010: destrutivo nunca pronto).
 *
 * Índice criado de outro schema: `pg_get_indexdef` qualifica a tabela com o
 * schema de origem, e reescrever essa string seria parser de SQL (regra 8) —
 * quando os schemas têm nomes diferentes, a definição sai comentada com aviso.
 */
export function compararSchemas(
  esquerda: SchemaNode,
  direita: SchemaNode,
): { differences: SchemaDiff[]; ddl: string } {
  const diffs: SchemaDiff[] = [];
  const ddl: string[] = [];
  const alvo = direita.name;
  const tab = (nome: string) => `${q(alvo)}.${q(nome)}`;
  const dirPorNome = new Map(direita.relations.map((r) => [r.name, r]));
  const esqNomes = new Set(esquerda.relations.map((r) => r.name));

  for (const e of esquerda.relations) {
    if (e.kind !== "table" && e.kind !== "partitioned_table") continue;
    const d = dirPorNome.get(e.name);
    if (d === undefined) {
      diffs.push({ kind: "table_only_left", table: e.name, name: null, left: e.kind, right: null });
      const pk = e.primaryKey.length > 0 ? [`PRIMARY KEY (${e.primaryKey.map(q).join(", ")})`] : [];
      ddl.push(
        `CREATE TABLE ${tab(e.name)} (\n  ${[...e.columns.map(definicaoColuna), ...pk].join(",\n  ")}\n);`,
      );
      for (const fk of e.foreignKeys) ddl.push(fkDdl(tab(e.name), alvo, fk, esquerda.name));
      continue;
    }
    compararTabela(e, d, tab(e.name), alvo, esquerda.name, diffs, ddl);
  }

  for (const d of direita.relations) {
    if (d.kind !== "table" && d.kind !== "partitioned_table") continue;
    if (esqNomes.has(d.name)) continue;
    diffs.push({ kind: "table_only_right", table: d.name, name: null, left: null, right: d.kind });
    ddl.push(umaLinha(`-- DROP TABLE ${tab(d.name)};  -- só no lado direito; remoção não vem pronta`));
  }

  const cabecalho = [
    `-- Gerado pelo DBee (schema compare). NÃO foi executado: revise antes de rodar.`,
    umaLinha(`-- Leva ${q(alvo)} a ficar igual a ${q(esquerda.name)}. Remoções vêm comentadas.`),
    "",
  ];
  return { differences: diffs, ddl: [...cabecalho, ...ddl].join("\n") };
}

function compararTabela(
  e: SchemaNode["relations"][number],
  d: SchemaNode["relations"][number],
  tabela: string,
  alvo: string,
  schemaEsq: string,
  diffs: SchemaDiff[],
  ddl: string[],
): void {
  const colsDir = new Map(d.columns.map((c) => [c.name, c]));
  const colsEsq = new Set(e.columns.map((c) => c.name));
  const t = e.name;

  for (const c of e.columns) {
    const o = colsDir.get(c.name);
    if (o === undefined) {
      diffs.push({ kind: "column_only_left", table: t, name: c.name, left: c.dataType, right: null });
      ddl.push(`ALTER TABLE ${tabela} ADD COLUMN ${definicaoColuna(c)};`);
      continue;
    }
    if (o.dataType !== c.dataType) {
      diffs.push({ kind: "column_type", table: t, name: c.name, left: c.dataType, right: o.dataType });
      ddl.push(`ALTER TABLE ${tabela} ALTER COLUMN ${q(c.name)} TYPE ${c.dataType};`);
    }
    if (o.nullable !== c.nullable) {
      diffs.push({ kind: "column_nullable", table: t, name: c.name, left: String(c.nullable), right: String(o.nullable) });
      ddl.push(`ALTER TABLE ${tabela} ALTER COLUMN ${q(c.name)} ${c.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`);
    }
    if (o.defaultValue !== c.defaultValue) {
      diffs.push({ kind: "column_default", table: t, name: c.name, left: c.defaultValue, right: o.defaultValue });
      ddl.push(
        c.defaultValue === null
          ? `ALTER TABLE ${tabela} ALTER COLUMN ${q(c.name)} DROP DEFAULT;`
          : `ALTER TABLE ${tabela} ALTER COLUMN ${q(c.name)} SET DEFAULT ${c.defaultValue};`,
      );
    }
  }
  for (const o of d.columns) {
    if (colsEsq.has(o.name)) continue;
    diffs.push({ kind: "column_only_right", table: t, name: o.name, left: null, right: o.dataType });
    ddl.push(umaLinha(`-- ALTER TABLE ${tabela} DROP COLUMN ${q(o.name)};  -- só no lado direito`));
  }

  compararIndices(e.indexes, d.indexes, t, alvo !== schemaEsq, diffs, ddl);

  const fksDir = new Set(d.foreignKeys.map(fkAssinatura));
  const fksEsq = new Set(e.foreignKeys.map(fkAssinatura));
  for (const fk of e.foreignKeys) {
    if (fksDir.has(fkAssinatura(fk))) continue;
    diffs.push({ kind: "fk_only_left", table: t, name: fk.name, left: fkAssinatura(fk), right: null });
    ddl.push(fkDdl(tabela, alvo, fk, schemaEsq));
  }
  for (const fk of d.foreignKeys) {
    if (fksEsq.has(fkAssinatura(fk))) continue;
    diffs.push({ kind: "fk_only_right", table: t, name: fk.name, left: null, right: fkAssinatura(fk) });
    ddl.push(umaLinha(`-- ALTER TABLE ${tabela} DROP CONSTRAINT ${q(fk.name)};  -- só no lado direito`));
  }
}

function compararIndices(
  esq: readonly Index[],
  dir: readonly Index[],
  tabela: string,
  schemasDiferentes: boolean,
  diffs: SchemaDiff[],
  ddl: string[],
): void {
  // Índice casa por colunas + unicidade, não por nome: nome gerado difere entre ambientes.
  const assin = (i: Index) => `${i.isUnique ? "u" : ""}(${i.columns.join(",")})`;
  const dirAss = new Set(dir.filter((i) => !i.isPrimary).map(assin));
  const esqAss = new Set(esq.filter((i) => !i.isPrimary).map(assin));
  for (const i of esq) {
    if (i.isPrimary || dirAss.has(assin(i))) continue;
    diffs.push({ kind: "index_only_left", table: tabela, name: i.name, left: i.definition, right: null });
    ddl.push(
      schemasDiferentes
        ? umaLinha(`-- ${i.definition};  -- ajuste o schema antes de rodar`)
        : `${i.definition};`,
    );
  }
  for (const i of dir) {
    if (i.isPrimary || esqAss.has(assin(i))) continue;
    diffs.push({ kind: "index_only_right", table: tabela, name: i.name, left: null, right: i.definition });
    ddl.push(umaLinha(`-- DROP INDEX ${q(i.name)};  -- só no lado direito`));
  }
}

// ── Copiar como INSERT ──────────────────────────────────────────────────────

/**
 * INSERTs como texto, com a mesma citação do data compare. `tipos` (só
 * Postgres) põe `::tipo` em cada literal não nulo — o tipo vem do catálogo.
 * Recusa NUL no Postgres: `text` não aceita `\0`, e o INSERT falharia depois.
 */
export function montarInserts(
  alvo: { readonly schema: string; readonly table: string; readonly dialeto: DialetoSql },
  colunas: readonly string[],
  linhas: readonly (readonly Celula[])[],
  tipos?: ReadonlyMap<string, string>,
): string {
  const d = alvo.dialeto;
  const tabela = `${citarIdent(alvo.schema, d)}.${citarIdent(alvo.table, d)}`;
  const cols = colunas.map((c) => citarIdent(c, d)).join(", ");
  return linhas
    .map((linha) => {
      if (linha.length !== colunas.length) throw new Error("linha com número de valores diferente das colunas");
      const vals = linha.map((v, i) => {
        if (v !== null && d === "postgres" && v.includes("\u0000")) throw new Error("o Postgres não aceita o caractere NUL em texto");
        const tipo = tipos?.get(colunas[i] ?? "");
        return v === null || tipo === undefined ? literal(v, d) : `${literal(v, d)}::${tipo}`;
      });
      return `INSERT INTO ${tabela} (${cols}) VALUES (${vals.join(", ")});`;
    })
    .join("\n");
}
