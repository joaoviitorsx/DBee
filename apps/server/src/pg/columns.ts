import type { PoolClient } from "pg";

import type { ResultColumn } from "@dbee/shared";

interface TextTypesConfig {
  getTypeParser: () => (value: string) => string;
}
const TUDO_TEXTO: TextTypesConfig = { getTypeParser: () => (v) => v };

export interface PgField {
  readonly name: string;
  readonly dataTypeID: number;
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
  return fields.map((f) => ({
    name: f.name,
    dataTypeId: f.dataTypeID,
    dataTypeName: nomes.get(f.dataTypeID) ?? `oid:${String(f.dataTypeID)}`,
  }));
}
