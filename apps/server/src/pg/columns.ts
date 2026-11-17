import type { PoolClient } from "pg";

import type { ColumnOrigin, ResultColumn } from "@dbee/shared";

interface TextTypesConfig {
  getTypeParser: () => (value: string) => string;
}
const TUDO_TEXTO: TextTypesConfig = { getTypeParser: () => (v) => v };

export interface PgField {
  readonly name: string;
  readonly dataTypeID: number;
  /** OID da tabela de origem na RowDescription; 0 em coluna calculada. */
  readonly tableID?: number;
  /** `attnum` da coluna de origem; 0 em coluna calculada. */
  readonly columnID?: number;
}

/**
 * Resolve o nome canônico do tipo de cada coluna do resultado.
 *
 * O `pg` só devolve o OID. `format_type` dá `"timestamp with time zone"` e
 * `"integer[]"`, que é o que a UI usa para decidir alinhamento e formatação
 * (DBee.md §6).
 *
 * Compartilhado entre o executor e a leitura de linhas: os dois devolvem
 * `columns[].dataTypeName` com o mesmo significado, e duas implementações
 * divergiriam.
 */
export async function resolveColumns(
  client: PoolClient,
  fields: readonly PgField[],
  opcoes: { readonly origem?: boolean } = {},
): Promise<ResultColumn[]> {
  const oids = [...new Set(fields.map((f) => f.dataTypeID))];
  if (oids.length === 0) return [];

  const res = await client.query<{ oid: string; nome: string }>({
    text: `SELECT oid::bigint AS oid, format_type(oid, NULL) AS nome
             FROM pg_type WHERE oid = ANY($1::oid[])`,
    values: [oids],
    types: TUDO_TEXTO,
  });

  const nomes = new Map(res.rows.map((r) => [Number(r.oid), r.nome]));
  const origens = opcoes.origem === true ? await origensSemDerrubar(client, fields) : null;
  return fields.map((f) => ({
    name: f.name,
    dataTypeId: f.dataTypeID,
    dataTypeName: nomes.get(f.dataTypeID) ?? `oid:${String(f.dataTypeID)}`,
    ...(origens === null ? {} : { origin: origens.get(chave(f.tableID ?? 0, f.columnID ?? 0)) ?? null }),
  }));
}

/**
 * A origem é enfeite do resultado: falhar nela não pode derrubar a query do
 * usuário. SAVEPOINT porque um erro aqui abortaria a transação dele.
 */
async function origensSemDerrubar(
  client: PoolClient,
  fields: readonly PgField[],
): Promise<Map<string, ColumnOrigin | null>> {
  await client.query("SAVEPOINT dbee_origem");
  try {
    const r = await resolverOrigens(client, fields);
    await client.query("RELEASE SAVEPOINT dbee_origem");
    return r;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT dbee_origem");
    return new Map();
  }
}

const chave = (tid: number, cid: number): string => `${String(tid)}:${String(cid)}`;

/** TTL da origem em cache — o mesmo do catálogo (DBee.md §5). */
const TTL_ORIGEM_MS = 5 * 60_000;

/**
 * Cache de origem **por cliente do pool**. OID de tabela só tem sentido dentro
 * de um database de um servidor, e um `PoolClient` é exatamente isso; o
 * `WeakMap` some junto com o cliente. Assim o salto por FK não custa ida ao
 * catálogo por query repetida, e resultado sem coluna de tabela (`SELECT 1`)
 * não custa nada.
 */
const cacheOrigem = new WeakMap<PoolClient, Map<string, { valor: ColumnOrigin | null; ate: number }>>();

/**
 * `tableID`/`columnID` → `schema.tabela.coluna`, mais a FK **de uma coluna**
 * que parte dela (FK composta não vira salto: um valor só não identifica a
 * linha alvo). Uma consulta de catálogo para os pares ainda não vistos.
 */
async function resolverOrigens(
  client: PoolClient,
  fields: readonly PgField[],
): Promise<Map<string, ColumnOrigin | null>> {
  const agora = Date.now();
  let cache = cacheOrigem.get(client);
  if (cache === undefined) {
    cache = new Map();
    cacheOrigem.set(client, cache);
  }
  const saida = new Map<string, ColumnOrigin | null>();
  const faltam: { tid: number; cid: number }[] = [];
  for (const f of fields) {
    const tid = f.tableID ?? 0;
    const cid = f.columnID ?? 0;
    if (tid === 0 || cid <= 0) continue;
    const k = chave(tid, cid);
    const hit = cache.get(k);
    if (hit !== undefined && hit.ate > agora) saida.set(k, hit.valor);
    else if (!faltam.some((x) => x.tid === tid && x.cid === cid)) faltam.push({ tid, cid });
  }
  if (faltam.length === 0) return saida;

  const res = await client.query<{
    tid: string; cid: string; schema: string; tabela: string; coluna: string;
    ref_schema: string | null; ref_tabela: string | null; ref_coluna: string | null;
  }>({
    text: `SELECT x.tid::bigint AS tid, x.cid AS cid, n.nspname AS schema, c.relname AS tabela,
                  a.attname AS coluna, fk.ref_schema, fk.ref_tabela, fk.ref_coluna
             FROM ROWS FROM (pg_catalog.unnest($1::pg_catalog.oid[]), pg_catalog.unnest($2::pg_catalog.int2[])) AS x(tid, cid)
             JOIN pg_catalog.pg_attribute a ON a.attrelid = x.tid AND a.attnum = x.cid AND NOT a.attisdropped
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN LATERAL (
               SELECT rn.nspname AS ref_schema, rcl.relname AS ref_tabela, ra.attname AS ref_coluna
                 FROM pg_catalog.pg_constraint k
                 JOIN pg_catalog.pg_class rcl ON rcl.oid = k.confrelid
                 JOIN pg_catalog.pg_namespace rn ON rn.oid = rcl.relnamespace
                 JOIN pg_catalog.pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = k.confkey[1]
                WHERE k.contype = 'f' AND k.conrelid = x.tid
                  AND pg_catalog.array_length(k.conkey, 1) = 1 AND k.conkey[1] = x.cid
                ORDER BY k.conname
                LIMIT 1
             ) fk ON true`,
    values: [faltam.map((x) => x.tid), faltam.map((x) => x.cid)],
    types: TUDO_TEXTO,
  });

  for (const x of faltam) cache.set(chave(x.tid, x.cid), { valor: null, ate: agora + TTL_ORIGEM_MS });
  for (const r of res.rows) {
    const valor: ColumnOrigin = {
      source: { schema: r.schema, table: r.tabela, column: r.coluna },
      references:
        r.ref_schema === null || r.ref_tabela === null || r.ref_coluna === null
          ? null
          : { schema: r.ref_schema, table: r.ref_tabela, column: r.ref_coluna },
    };
    cache.set(chave(Number(r.tid), Number(r.cid)), { valor, ate: agora + TTL_ORIGEM_MS });
  }
  for (const x of faltam) {
    const k = chave(x.tid, x.cid);
    saida.set(k, cache.get(k)?.valor ?? null);
  }
  return saida;
}
