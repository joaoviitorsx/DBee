import type { PoolClient } from "pg";

import type {
  Column,
  DatabaseSchema,
  ForeignKey,
  Index,
  Relation,
  RelationKind,
  SchemaNode,
} from "@dbee/shared";

/**
 * Introspecção do catálogo (DBee.md §5).
 *
 * Quatro consultas de conjunto, montadas em memória — nunca uma consulta por
 * tabela. Num banco com centenas de relações o N+1 levaria segundos e seguraria
 * o pool (§11.6).
 *
 * Roda em `BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ`, então as quatro
 * leem o mesmo instante do catálogo. `BEGIN READ ONLY` sozinho NÃO bastaria: o
 * isolamento default é READ COMMITTED, em que cada statement pega um snapshot
 * novo, e um DDL entre a consulta de relações e a de colunas produziria uma
 * tabela com zero colunas na árvore — sem erro nenhum.
 */

/** Schemas de sistema: nunca aparecem na árvore. */
const SYSTEM_SCHEMAS = "('pg_catalog', 'information_schema', 'pg_toast')";

/** `relkind` do `pg_class` → o vocabulário da UI. */
const KIND_BY_RELKIND: Readonly<Record<string, RelationKind>> = {
  r: "table",
  v: "view",
  m: "materialized_view",
  p: "partitioned_table",
  f: "foreign_table",
};

/**
 * OIDs vêm como `::bigint` e, por isso, como **string** (§11.2). O cast é
 * proposital: `oid::int` faz wrap para negativo acima de 2^31, e aí o
 * `dataTypeId` da árvore divergiria do `dataTypeID` que o `pg` expõe no
 * resultado de uma query — que ele lê sem sinal. A UI não conseguiria casar os
 * dois num cluster antigo. OID cabe exato em `number` (< 2^53).
 */
interface RelationRow {
  oid: string;
  schema: string;
  name: string;
  relkind: string;
  comment: string | null;
  reltuples: number;
}

interface ColumnRow {
  oid: string;
  name: string;
  data_type: string;
  data_type_id: string;
  nullable: boolean;
  default_value: string | null;
  position: number;
  comment: string | null;
}

interface ConstraintRow {
  oid: string;
  name: string;
  contype: string;
  columns: string[];
  ref_schema: string | null;
  ref_table: string | null;
  ref_columns: string[] | null;
}

interface IndexRow {
  oid: string;
  name: string;
  /** `array_agg` devolve NULL em índice sobre expressão — não tem attname. */
  columns: string[] | null;
  is_unique: boolean;
  is_primary: boolean;
  definition: string;
}

const RELATIONS_SQL = `
  SELECT c.oid::bigint       AS oid,
         n.nspname           AS schema,
         c.relname           AS name,
         c.relkind::text     AS relkind,
         obj_description(c.oid, 'pg_class') AS comment,
         c.reltuples::float8 AS reltuples
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
     AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
     AND n.nspname NOT LIKE 'pg_temp%'
     AND n.nspname NOT LIKE 'pg_toast_temp%'
     -- Respeita a permissão de quem está conectado: relação sem SELECT não
     -- aparece na árvore em vez de aparecer e falhar depois.
     AND has_table_privilege(c.oid, 'SELECT')
   ORDER BY n.nspname, c.relname
`;

const COLUMNS_SQL = `
  SELECT a.attrelid::bigint AS oid,
         a.attname       AS name,
         format_type(a.atttypid, a.atttypmod) AS data_type,
         a.atttypid::bigint AS data_type_id,
         NOT a.attnotnull AS nullable,
         pg_get_expr(d.adbin, d.adrelid) AS default_value,
         a.attnum::int   AS position,
         col_description(a.attrelid, a.attnum) AS comment
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0
     AND NOT a.attisdropped
     AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
     AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
     AND n.nspname NOT LIKE 'pg_temp%'
     AND has_table_privilege(c.oid, 'SELECT')
   ORDER BY a.attrelid, a.attnum
`;

// PK e FK numa consulta só; `conkey` e `confkey` são arrays de attnum, então o
// unnest precisa de WITH ORDINALITY para preservar a ordem das colunas
// compostas — sem isso um FK de duas colunas pode sair trocado.
//
// `attname` é do tipo `name`, e `array_agg` sobre ele devolve `name[]`
// (OID 1003), que o driver `pg` NÃO converte para array JS — chega string
// crua `{a,b}`. O `::text` força `text[]` (OID 1009), que ele converte.
const CONSTRAINTS_SQL = `
  SELECT con.conrelid::bigint AS oid,
         con.conname       AS name,
         con.contype::text AS contype,
         (SELECT array_agg(att.attname::text ORDER BY k.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute att
              ON att.attrelid = con.conrelid AND att.attnum = k.attnum
         ) AS columns,
         fn.nspname AS ref_schema,
         fc.relname AS ref_table,
         (SELECT array_agg(att.attname::text ORDER BY k.ord)
            FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute att
              ON att.attrelid = con.confrelid AND att.attnum = k.attnum
         ) AS ref_columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class fc ON fc.oid = con.confrelid
    LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
   WHERE con.contype IN ('p', 'f')
     AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
     AND has_table_privilege(c.oid, 'SELECT')
`;

const INDEXES_SQL = `
  SELECT i.indrelid::bigint AS oid,
         ic.relname      AS name,
         i.indisunique   AS is_unique,
         i.indisprimary  AS is_primary,
         pg_get_indexdef(i.indexrelid) AS definition,
         -- attnum = 0 marca posição de expressão. Num índice MISTO
         -- (lower(a), b) filtrar por > 0 devolveria ['b'] — array não-nulo e
         -- incompleto, que a UI exibiria como "índice de coluna única em b".
         -- Falso na direção que importa: b é a segunda chave e o índice não
         -- serve para WHERE b = ?. Então: se QUALQUER chave for expressão,
         -- devolve NULL e a UI cai para a definição literal.
         (SELECT CASE WHEN bool_or(k.attnum = 0) THEN NULL
                      ELSE array_agg(a.attname::text ORDER BY k.ord) END
            FROM unnest(i.indkey::int[]) WITH ORDINALITY AS k(attnum, ord)
            LEFT JOIN pg_attribute a
              ON a.attrelid = i.indrelid AND a.attnum = k.attnum
         ) AS columns
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS}
     AND n.nspname NOT LIKE 'pg_temp%'
     AND has_table_privilege(c.oid, 'SELECT')
   ORDER BY ic.relname
`;

/** Agrupa linhas por OID da relação, preservando a ordem de chegada. */
function groupByOid<T extends { oid: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.oid);
    if (bucket === undefined) grouped.set(row.oid, [row]);
    else bucket.push(row);
  }
  return grouped;
}

export async function introspect(client: PoolClient, database: string): Promise<DatabaseSchema> {
  // Em sequência, não em Promise.all: um `Client` do `pg` executa uma consulta
  // por vez, e chamar `query()` com outra em voo é deprecado (some no pg@9).
  // Não há ganho real em paralelizar — o servidor as serializaria de qualquer
  // forma, e as quatro precisam do mesmo client para verem a mesma transação.
  const relations = await client.query<RelationRow>(RELATIONS_SQL);
  const columns = await client.query<ColumnRow>(COLUMNS_SQL);
  const constraints = await client.query<ConstraintRow>(CONSTRAINTS_SQL);
  const indexes = await client.query<IndexRow>(INDEXES_SQL);

  const columnsByOid = groupByOid(columns.rows);
  const constraintsByOid = groupByOid(constraints.rows);
  const indexesByOid = groupByOid(indexes.rows);

  const schemas = new Map<string, Relation[]>();

  for (const rel of relations.rows) {
    const relConstraints = constraintsByOid.get(rel.oid) ?? [];

    const primaryKey =
      relConstraints.find((c) => c.contype === "p")?.columns ?? [];

    const foreignKeys: ForeignKey[] = relConstraints
      .filter((c) => c.contype === "f")
      .flatMap((c): ForeignKey[] => {
        // Defensivo: um FK sem alvo resolvido é catálogo inconsistente. Some da
        // árvore em vez de virar entrada com campo vazio.
        if (c.ref_schema === null || c.ref_table === null || c.ref_columns === null) return [];
        return [
          {
            name: c.name,
            columns: c.columns,
            referencedSchema: c.ref_schema,
            referencedTable: c.ref_table,
            referencedColumns: c.ref_columns,
          },
        ];
      });

    const pkSet = new Set(primaryKey);

    const relColumns: Column[] = (columnsByOid.get(rel.oid) ?? []).map((c) => ({
      name: c.name,
      dataType: c.data_type,
      dataTypeId: Number(c.data_type_id),
      nullable: c.nullable,
      defaultValue: c.default_value,
      position: c.position,
      isPrimaryKey: pkSet.has(c.name),
      comment: c.comment,
    }));

    const relIndexes: Index[] = (indexesByOid.get(rel.oid) ?? []).map((i) => ({
      name: i.name,
      // Índice sobre expressão não tem attname; `columns` vem null e a UI cai
      // para a definição literal.
      columns: i.columns ?? [],
      isUnique: i.is_unique,
      isPrimary: i.is_primary,
      definition: i.definition,
    }));

    const relation: Relation = {
      name: rel.name,
      kind: KIND_BY_RELKIND[rel.relkind] ?? "table",
      comment: rel.comment,
      // reltuples é -1 quando a relação nunca passou por ANALYZE.
      estimatedRows: rel.reltuples < 0 ? null : Math.round(rel.reltuples),
      columns: relColumns,
      primaryKey,
      foreignKeys,
      indexes: relIndexes,
    };

    const bucket = schemas.get(rel.schema);
    if (bucket === undefined) schemas.set(rel.schema, [relation]);
    else bucket.push(relation);
  }

  const tree: SchemaNode[] = [...schemas].map(([name, rels]) => ({ name, relations: rels }));

  return {
    database,
    schemas: tree,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/**
 * Databases do cluster, filtrando templates e os que não aceitam conexão
 * (DBee.md §5). `has_database_privilege` respeita a permissão de quem está
 * conectado: database que o usuário não pode abrir não aparece na árvore, em
 * vez de aparecer e falhar ao expandir.
 */
const DATABASES_SQL = `
  SELECT datname AS name
    FROM pg_database
   WHERE NOT datistemplate
     AND datallowconn
     AND has_database_privilege(datname, 'CONNECT')
   ORDER BY datname
`;

export async function listDatabases(
  client: PoolClient,
  current: string,
): Promise<{ name: string; isDefault: boolean }[]> {
  const res = await client.query<{ name: string }>(DATABASES_SQL);
  return res.rows.map((row) => ({ name: row.name, isDefault: row.name === current }));
}

/**
 * Visão geral dos databases: tamanho, encoding, collation, dono, conexões.
 *
 * `pg_database_size` só quando `has_database_privilege(... 'CONNECT')` — medir
 * um database sem permissão dá erro, então protegemos com `CASE`. Tudo do
 * catálogo, uma consulta.
 */
const DATABASES_OVERVIEW_SQL = `
  SELECT d.datname AS name,
         CASE WHEN has_database_privilege(d.datname, 'CONNECT')
              THEN pg_database_size(d.datname) ELSE NULL END AS size_bytes,
         pg_encoding_to_char(d.encoding) AS encoding,
         d.datcollate AS collate,
         pg_get_userbyid(d.datdba) AS owner,
         (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS connections
    FROM pg_database d
   WHERE NOT d.datistemplate
     AND d.datallowconn
     AND has_database_privilege(d.datname, 'CONNECT')
   ORDER BY d.datname
`;

interface DatabaseOverviewRow {
  name: string;
  size_bytes: string | null;
  encoding: string;
  collate: string;
  owner: string;
  connections: string;
}

export async function overviewDatabases(
  client: PoolClient,
  current: string,
): Promise<
  {
    name: string;
    isDefault: boolean;
    sizeBytes: number | null;
    encoding: string;
    collate: string;
    owner: string;
    connections: number;
  }[]
> {
  const res = await client.query<DatabaseOverviewRow>(DATABASES_OVERVIEW_SQL);
  return res.rows.map((r) => ({
    name: r.name,
    isDefault: r.name === current,
    // `pg_database_size` volta bigint → string; parse seguro, null preservado.
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    encoding: r.encoding,
    collate: r.collate,
    owner: r.owner,
    connections: Number(r.connections),
  }));
}

/**
 * O que está rodando no servidor agora (`pg_stat_activity`).
 *
 * Exclui as próprias linhas de fundo do Postgres (`backend_type <> 'client
 * backend'` são walwriter, autovacuum, etc.) e a sessão que faz esta consulta
 * (`pid <> pg_backend_pid()`). `isSelf` marca as sessões cujo `application_name`
 * é `dbee` — as do próprio cliente.
 */
const ACTIVITY_SQL = `
  SELECT pid,
         datname AS database,
         usename AS "user",
         COALESCE(application_name, '') AS application_name,
         host(client_addr) AS client_addr,
         state,
         EXTRACT(EPOCH FROM (now() - query_start))::float8 AS duration_seconds,
         wait_event,
         COALESCE(query, '') AS query,
         (application_name = 'dbee') AS is_self
    FROM pg_stat_activity
   WHERE backend_type = 'client backend'
     AND pid <> pg_backend_pid()
   ORDER BY query_start ASC NULLS LAST
`;

interface ActivityRow {
  pid: number;
  database: string | null;
  user: string | null;
  application_name: string;
  client_addr: string | null;
  state: string | null;
  duration_seconds: number | null;
  wait_event: string | null;
  query: string;
  is_self: boolean;
}

export async function listActivity(
  client: PoolClient,
): Promise<
  {
    pid: number;
    database: string | null;
    user: string | null;
    applicationName: string;
    clientAddr: string | null;
    state: string | null;
    durationSeconds: number | null;
    waitEvent: string | null;
    query: string;
    isSelf: boolean;
  }[]
> {
  const res = await client.query<ActivityRow>(ACTIVITY_SQL);
  return res.rows.map((r) => ({
    pid: r.pid,
    database: r.database,
    user: r.user,
    applicationName: r.application_name,
    clientAddr: r.client_addr,
    state: r.state,
    durationSeconds: r.duration_seconds,
    waitEvent: r.wait_event,
    query: r.query,
    isSelf: r.is_self,
  }));
}
