/**
 * "Copiar tabela para…" — a parte pura (ideia I10, mesmo princípio do ADR 018:
 * gera SQL, nunca aplica). Recebe a relação já introspectada na origem e as
 * linhas já lidas, e devolve `CREATE TABLE` no dialeto do destino + INSERTs.
 *
 * Tipos entre dialetos: mesmo dialeto → o tipo do catálogo, literal. Dialetos
 * diferentes → mapeamento por família (inteiro, decimal, texto, data…); o que
 * não tem família conhecida vira texto, com aviso. É um ponto de partida para a
 * pessoa revisar no editor, não uma migração fiel.
 */
import { citarIdent, montarInserts } from "./compare.puro";
import type { Relation } from "./schema";
import type { DialetoSql } from "./split";

type Celula = string | null;

export interface EntradaCopia {
  readonly relacao: Relation;
  readonly origem: DialetoSql;
  readonly destino: DialetoSql;
  readonly schemaDestino: string;
  readonly tabelaDestino: string;
  readonly colunas: readonly string[];
  readonly linhas: readonly (readonly Celula[])[];
  readonly truncado: boolean;
  /** Nome legível da origem, para o cabeçalho (`conexão · schema.tabela`). */
  readonly descricaoOrigem: string;
}

export interface ScriptCopia {
  readonly sql: string;
  readonly warnings: string[];
}

const familias: readonly { readonly re: RegExp; readonly pg: string; readonly mysql: string; readonly sqlite: string }[] = [
  { re: /^(bigint|int8|bigserial)\b/, pg: "bigint", mysql: "BIGINT", sqlite: "INTEGER" },
  { re: /^(integer|int|int4|serial|mediumint|smallint|tinyint)\b/, pg: "integer", mysql: "INT", sqlite: "INTEGER" },
  { re: /^(double precision|double|float8|float|real|float4)\b/, pg: "double precision", mysql: "DOUBLE", sqlite: "REAL" },
  { re: /^(timestamp with time zone|timestamptz)\b/, pg: "timestamp with time zone", mysql: "DATETIME(6)", sqlite: "TEXT" },
  { re: /^(timestamp|datetime)\b/, pg: "timestamp", mysql: "DATETIME(6)", sqlite: "TEXT" },
  { re: /^date\b/, pg: "date", mysql: "DATE", sqlite: "TEXT" },
  { re: /^(time)\b/, pg: "time", mysql: "TIME(6)", sqlite: "TEXT" },
  { re: /^(jsonb|json)\b/, pg: "jsonb", mysql: "JSON", sqlite: "TEXT" },
  { re: /^(text|clob|longtext|mediumtext|tinytext|uuid)\b/, pg: "text", mysql: "LONGTEXT", sqlite: "TEXT" },
];

/** Tipo da coluna no destino, ou `null` quando caiu no fallback de texto. */
export function tipoNoDestino(tipo: string, origem: DialetoSql, destino: DialetoSql): string | null {
  if (origem === destino) return tipo;
  const t = tipo.trim().toLowerCase();
  if (/^(bool(ean)?|tinyint\(1\))$/.test(t)) {
    return destino === "postgres" ? "boolean" : destino === "mysql" ? "TINYINT(1)" : "INTEGER";
  }
  if (/^(smallint|int2)\b/.test(t)) return destino === "postgres" ? "smallint" : destino === "mysql" ? "SMALLINT" : "INTEGER";
  const dec = /^(numeric|decimal)\s*(\(\s*\d+\s*(,\s*\d+\s*)?\))?/.exec(t);
  if (dec !== null) {
    const p = (dec[2] ?? "").replaceAll(" ", "");
    return destino === "postgres" ? `numeric${p}` : destino === "mysql" ? `DECIMAL${p === "" ? "(65,30)" : p}` : "NUMERIC";
  }
  const vc = /^(character varying|varchar|nvarchar|character|char|nchar)\s*(\(\s*(\d+)\s*\))?/.exec(t);
  if (vc !== null) {
    const n = vc[3];
    const fixo = vc[1] === "character" || vc[1] === "char" || vc[1] === "nchar";
    if (destino === "sqlite") return "TEXT";
    if (n === undefined) return destino === "postgres" ? "text" : "LONGTEXT";
    const nome = fixo ? (destino === "postgres" ? "char" : "CHAR") : destino === "postgres" ? "varchar" : "VARCHAR";
    return `${nome}(${n})`;
  }
  if (/^(bytea|blob|longblob|mediumblob|tinyblob|binary|varbinary)\b/.test(t)) {
    return destino === "postgres" ? "bytea" : destino === "mysql" ? "LONGBLOB" : "BLOB";
  }
  for (const f of familias) {
    if (f.re.test(t)) return destino === "postgres" ? f.pg : destino === "mysql" ? f.mysql : f.sqlite;
  }
  return null;
}

export function montarScriptCopia(e: EntradaCopia): ScriptCopia {
  const d = e.destino;
  const warnings: string[] = [];
  const q = (n: string) => citarIdent(n, d);
  const tabela = `${q(e.schemaDestino)}.${q(e.tabelaDestino)}`;
  const tipos = new Map<string, string>();
  const pk = new Set(e.relacao.primaryKey);

  const defs = e.relacao.columns.map((c) => {
    let tipo = tipoNoDestino(c.dataType, e.origem, d);
    if (tipo === null) {
      tipo = d === "mysql" ? "LONGTEXT" : d === "postgres" ? "text" : "TEXT";
      warnings.push(`coluna ${c.name}: tipo "${c.dataType}" sem equivalente conhecido em ${d}; virou ${tipo}`);
    }
    // MySQL não aceita TEXT/BLOB em chave primária sem prefixo.
    if (d === "mysql" && pk.has(c.name) && /^(LONGTEXT|LONGBLOB|JSON)$/.test(tipo)) {
      tipo = "VARCHAR(255)";
      warnings.push(`coluna ${c.name}: chave primária em MySQL não aceita texto longo; virou VARCHAR(255)`);
    }
    if (e.origem === "postgres" && d !== "postgres" && c.dataType.endsWith("[]")) {
      warnings.push(`coluna ${c.name}: array do Postgres copiado como texto literal`);
    }
    tipos.set(c.name, tipo);
    let def = "";
    if (c.defaultValue !== null) {
      // Default só no mesmo dialeto, e nunca `nextval(...)`: a sequência da
      // origem não existe no destino.
      if (e.origem === d && !c.defaultValue.includes("nextval(")) def = ` DEFAULT ${c.defaultValue}`;
      else warnings.push(`coluna ${c.name}: default "${c.defaultValue}" não copiado`);
    }
    return `${q(c.name)} ${tipo}${def}${c.nullable ? "" : " NOT NULL"}`;
  });
  if (e.relacao.primaryKey.length > 0) defs.push(`PRIMARY KEY (${e.relacao.primaryKey.map(q).join(", ")})`);
  if (e.relacao.foreignKeys.length > 0 || e.relacao.indexes.some((i) => !i.isPrimary)) {
    warnings.push("chaves estrangeiras e índices não são copiados: crie-os depois, se fizerem sentido no destino");
  }
  if (e.truncado) warnings.push(`dados truncados em ${String(e.linhas.length)} linhas: para a tabela inteira, use o export`);

  const partes = [
    `-- Gerado pelo DBee ("copiar tabela para…"). NÃO foi executado: revise antes de rodar.`,
    `-- Origem: ${e.descricaoOrigem.replace(/[\r\n]+/g, " ")} · ${String(e.linhas.length)} linha(s)${e.truncado ? " (truncado)" : ""}`,
    ...warnings.map((w) => `-- Aviso: ${w.replace(/[\r\n]+/g, " ")}`),
    "",
    `CREATE TABLE ${tabela} (\n  ${defs.join(",\n  ")}\n);`,
  ];
  if (e.linhas.length > 0) {
    partes.push(
      "",
      montarInserts(
        { schema: e.schemaDestino, table: e.tabelaDestino, dialeto: d },
        e.colunas,
        e.linhas,
        d === "postgres" ? tipos : undefined,
      ),
    );
  }
  return { sql: partes.join("\n"), warnings };
}
