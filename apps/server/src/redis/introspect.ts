import type { RedisClient } from "bun";

import type {
  Column,
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  Relation,
  RelationTree,
} from "@dbee/shared";

import type { ClienteRedis } from "./cliente";
import type { ResolvedConnection } from "../db/connections.repo";

/**
 * "Catálogo" de um Redis — que não tem catálogo.
 *
 * O Redis não tem schema, coleção nem tabela: tem bancos numerados (0..N) e,
 * dentro de cada um, chaves soltas. O DBee mapeia isso na árvore que já existe:
 *
 * - **database** = o db numerado (`db0`, `db1`, …). O nome é `dbN`, e é o que a
 *   conexão passa adiante para `SELECT`.
 * - **relação** = uma só por db, chamada `keys`, que abre a grade de chaves
 *   navegada por `SCAN`. Não é uma tabela de verdade — é o único jeito de
 *   encaixar "as chaves deste db" na grade sem uma UI nova.
 *
 * ## Quantos dbs existem
 *
 * O número **não** é 0–15 fixo: é `CONFIG GET databases`, config do servidor.
 * Medido: uma credencial `+@read` recebe `NOPERM` ao ler essa config. Então a
 * leitura é **best-effort** — se der certo, usa o teto; se der `NOPERM`, cai
 * para 16 (o padrão do Redis), que é o palpite honesto quando o servidor não
 * deixa perguntar.
 */

/** O padrão do Redis quando `CONFIG GET databases` é negado. */
const DBS_PADRAO = 16;

/** As colunas fixas da grade de chaves — o Redis não as declara, o DBee as define. */
const COLUNAS: Column[] = [
  coluna("key", "string", 0, true),
  coluna("type", "string", 1, false),
  coluna("ttl", "number", 2, false),
  coluna("value", "string", 3, false),
];

function coluna(name: string, dataType: string, position: number, pk: boolean): Column {
  return {
    name,
    dataType,
    dataTypeId: position,
    nullable: !pk,
    defaultValue: null,
    position,
    isPrimaryKey: pk,
    comment: null,
  };
}

/** Quantos dbs o servidor tem, best-effort (ver o comentário do módulo). */
async function contarDbs(cliente: RedisClient): Promise<number> {
  try {
    const cfg = (await cliente.send("CONFIG", ["GET", "databases"])) as Record<string, string>;
    const n = Number.parseInt(cfg["databases"] ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : DBS_PADRAO;
  } catch {
    // `+@read` recebe NOPERM aqui — o padrão do Redis é a resposta honesta.
    return DBS_PADRAO;
  }
}

/** O número do db a partir do nome `dbN` (ou 0). */
export function numeroDoDb(nome: string): number {
  const m = /^db(\d+)$/.exec(nome);
  return m === null ? 0 : Number.parseInt(m[1] ?? "0", 10);
}

export async function listarDatabases(
  clientes: ClienteRedis,
  conexao: ResolvedConnection,
): Promise<DatabaseInfo[]> {
  const cliente = await clientes.cliente(conexao, 0);
  const total = await contarDbs(cliente);
  const out: DatabaseInfo[] = [];
  for (let i = 0; i < total; i++) {
    out.push({ name: `db${String(i)}`, isDefault: i === 0 });
  }
  return out;
}

/**
 * A árvore de um db: uma relação `keys`, com a contagem de chaves como
 * estimativa (`DBSIZE` é O(1), ao contrário do `count(*)` das outras engines).
 */
export async function introspectarArvore(
  clientes: ClienteRedis,
  conexao: ResolvedConnection,
  nomeDb: string,
): Promise<DatabaseTree> {
  const db = numeroDoDb(nomeDb);
  const cliente = await clientes.cliente(conexao, db);
  const total = (await cliente.send("DBSIZE", [])) as number;
  const relations: RelationTree[] = [{ name: "keys", kind: "table", estimatedRows: total }];
  return {
    database: nomeDb,
    schemas: [{ name: nomeDb, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/** O catálogo completo: a relação `keys` com as colunas fixas. */
export async function introspectarCompleto(
  clientes: ClienteRedis,
  conexao: ResolvedConnection,
  nomeDb: string,
): Promise<DatabaseSchema> {
  const db = numeroDoDb(nomeDb);
  const cliente = await clientes.cliente(conexao, db);
  const total = (await cliente.send("DBSIZE", [])) as number;
  const keys: Relation = {
    name: "keys",
    kind: "table",
    comment: null,
    estimatedRows: total,
    columns: COLUNAS,
    // A chave do Redis É a chave primária: única e o cursor natural do SCAN.
    primaryKey: ["key"],
    foreignKeys: [],
    indexes: [],
  };
  return {
    database: nomeDb,
    schemas: [{ name: nomeDb, relations: [keys] }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}
