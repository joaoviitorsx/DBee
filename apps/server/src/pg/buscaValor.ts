import type { PoolClient } from "pg";

import type { ValueSearchHit, ValueSearchScope, ValueSearchTableStatus } from "@dbee/shared";
import {
  BUSCA_VALOR_MAX_POR_TABELA,
  BUSCA_VALOR_MAX_TABELAS,
  BUSCA_VALOR_TIMEOUT_TABELA_MS,
  padraoContem,
} from "@dbee/shared/puro";

import { cite } from "./rows";
import { TUDO_TEXTO } from "./tipos";

/**
 * Busca de valor no Postgres (ADR 023). Roda dentro da transação `READ ONLY`
 * aberta por quem chama; aqui só catálogo, um `SELECT` por tabela e
 * `SAVEPOINT` para uma tabela lenta não derrubar as outras.
 *
 * Nenhum identificador vem do usuário direto: o escopo entra no catálogo como
 * **parâmetro**, e só os nomes que o catálogo devolve são citados no SQL. O
 * valor procurado é sempre `$n`.
 */

export interface ColunaAlvo {
  readonly nome: string;
  readonly tipo: "texto" | "numero";
}

export interface TabelaAlvo {
  readonly schema: string;
  readonly nome: string;
  readonly pk: readonly string[];
  readonly colunas: readonly ColunaAlvo[];
}

export interface PlanoTabela {
  readonly sql: string;
  readonly valores: string[];
}

/** O `SELECT` de uma tabela. Puro: os nomes já saíram do catálogo. */
export function planejarTabela(
  tabela: TabelaAlvo,
  valor: string,
  modo: "contains" | "exact",
  limite: number,
): PlanoTabela {
  const valores: string[] = [];
  let pText: string | null = null;
  let pNum: string | null = null;
  const marcadorTexto = (): string => {
    if (pText === null) {
      valores.push(modo === "contains" ? padraoContem(valor) : valor);
      pText = `$${String(valores.length)}`;
    }
    return pText;
  };
  const marcadorNumero = (): string => {
    if (pNum === null) {
      valores.push(valor.trim());
      pNum = `$${String(valores.length)}::numeric`;
    }
    return pNum;
  };

  const condicoes = tabela.colunas.map((c) => {
    const col = cite(c.nome);
    if (c.tipo === "numero") return `${col} = ${marcadorNumero()}`;
    return modo === "contains" ? `${col}::text ILIKE ${marcadorTexto()}` : `${col}::text = ${marcadorTexto()}`;
  });
  // Aliases gerados (pk0, m0…): nenhum nome do banco vira alias.
  const select = [
    ...tabela.pk.map((p, i) => `${cite(p)}::text AS pk${String(i)}`),
    ...tabela.colunas.map(
      (c, j) => `CASE WHEN ${condicoes[j] ?? "false"} THEN left(${cite(c.nome)}::text, 200) END AS m${String(j)}`,
    ),
  ];
  const sql =
    `SELECT ${select.join(", ")} FROM ${cite(tabela.schema)}.${cite(tabela.nome)} ` +
    `WHERE ${condicoes.join(" OR ")} LIMIT ${String(limite + 1)}`;
  return { sql, valores };
}

const NUMERICOS = ["int2", "int4", "int8", "numeric", "float4", "float8"];

/**
 * Tabelas e colunas compatíveis do escopo. Colunas sem privilégio de `SELECT`
 * ficam de fora (senão o `SELECT` inteiro da tabela falharia). Domínio conta
 * pelo tipo base. Partição filha fica de fora: a mãe já a cobre.
 */
export async function tabelasDoEscopo(
  client: PoolClient,
  escopo: ValueSearchScope,
  incluirNumericas: boolean,
): Promise<TabelaAlvo[]> {
  const porSchema = "schema" in escopo;
  const schemas = "tables" in escopo ? escopo.tables.map((t) => t.schema) : [];
  const nomes = "tables" in escopo ? escopo.tables.map((t) => t.name) : [];
  const res = await client.query<{ s: string; r: string; cols: string | null; pk: string | null }>({
    text: `
      SELECT n.nspname AS s, c.relname AS r,
        (SELECT json_agg(json_build_array(a.attname,
                  CASE WHEN bt.typcategory = 'S' THEN 'texto' ELSE 'numero' END) ORDER BY a.attnum)::text
           FROM pg_attribute a
           JOIN pg_type ty ON ty.oid = a.atttypid
           JOIN pg_type bt ON bt.oid = CASE WHEN ty.typtype = 'd' THEN ty.typbasetype ELSE ty.oid END
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege(c.oid, a.attnum, 'SELECT')
            AND (bt.typcategory = 'S' OR ($3::boolean AND bt.typname = ANY($4::text[])))) AS cols,
        (SELECT json_agg(pa.attname ORDER BY k.ord)::text
           FROM pg_index i
           CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute pa ON pa.attrelid = i.indrelid AND pa.attnum = k.attnum
          WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'm') AND NOT c.relispartition
        AND has_schema_privilege(n.oid, 'USAGE')
        AND CASE WHEN $1::boolean THEN n.nspname = $2
                 ELSE (n.nspname, c.relname) IN (SELECT * FROM unnest($5::text[], $6::text[])) END
      ORDER BY n.nspname, c.relname`,
    values: [porSchema, "schema" in escopo ? escopo.schema : "", incluirNumericas, NUMERICOS, schemas, nomes],
    types: TUDO_TEXTO,
  });
  const tabelas: TabelaAlvo[] = [];
  for (const row of res.rows) {
    if (row.cols === null || row.cols === "") continue;
    const cols = JSON.parse(row.cols) as [string, ColunaAlvo["tipo"]][];
    if (cols.length === 0) continue;
    tabelas.push({
      schema: row.s,
      nome: row.r,
      pk: row.pk === null ? [] : (JSON.parse(row.pk) as string[]),
      colunas: cols.map(([nome, tipo]) => ({ nome, tipo })),
    });
  }
  return tabelas;
}

export interface ResultadoBusca {
  readonly hits: ValueSearchHit[];
  readonly tables: ValueSearchTableStatus[];
  readonly tablesSkipped: number;
  readonly cancelled: boolean;
}

const codigoDe = (err: unknown): string =>
  typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : "";

/** Varre as tabelas, uma por vez, cada uma com o próprio timeout e savepoint. */
export async function buscarValor(
  client: PoolClient,
  escopo: ValueSearchScope,
  valor: string,
  modo: "contains" | "exact",
  incluirNumericas: boolean,
  foiCancelada: () => boolean,
): Promise<ResultadoBusca> {
  const todas = await tabelasDoEscopo(client, escopo, incluirNumericas);
  const alvo = todas.slice(0, BUSCA_VALOR_MAX_TABELAS);
  const hits: ValueSearchHit[] = [];
  const tables: ValueSearchTableStatus[] = [];
  let cancelled = false;

  for (const tabela of alvo) {
    if (foiCancelada()) {
      cancelled = true;
      break;
    }
    const plano = planejarTabela(tabela, valor, modo, BUSCA_VALOR_MAX_POR_TABELA);
    await client.query("SAVEPOINT dbee_busca");
    try {
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(BUSCA_VALOR_TIMEOUT_TABELA_MS),
      ]);
      const res = await client.query<Record<string, string | null>>({
        text: plano.sql,
        values: plano.valores,
        types: TUDO_TEXTO,
        queryMode: "extended",
      });
      await client.query("RELEASE SAVEPOINT dbee_busca");
      const truncou = res.rows.length > BUSCA_VALOR_MAX_POR_TABELA;
      let n = 0;
      for (const linha of res.rows.slice(0, BUSCA_VALOR_MAX_POR_TABELA)) {
        const pk =
          tabela.pk.length === 0
            ? null
            : Object.fromEntries(tabela.pk.map((p, i) => [p, linha[`pk${String(i)}`] ?? null]));
        tabela.colunas.forEach((c, j) => {
          const v = linha[`m${String(j)}`];
          if (v === undefined || v === null) return;
          hits.push({ schema: tabela.schema, table: tabela.nome, column: c.nome, pk, value: v });
          n++;
        });
      }
      tables.push({
        schema: tabela.schema,
        table: tabela.nome,
        status: truncou ? "truncated" : "ok",
        hits: n,
        error: null,
      });
    } catch (err: unknown) {
      await client.query("ROLLBACK TO SAVEPOINT dbee_busca");
      const code = codigoDe(err);
      if (code === "57014" && foiCancelada()) {
        cancelled = true;
        break;
      }
      tables.push({
        schema: tabela.schema,
        table: tabela.nome,
        status: code === "57014" ? "timeout" : "error",
        hits: 0,
        error: err instanceof Error ? err.message : "erro desconhecido",
      });
    }
  }
  return { hits, tables, tablesSkipped: todas.length - alvo.length, cancelled };
}
