import type {
  Column,
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  ForeignKey,
  Index,
  Relation,
  RelationKind,
  RelationTree,
} from "@dbee/shared";

import type { GerenteSqlite, LinhasCruas } from "./gerente";
import { citar } from "../libsql/citar";
import type { ResolvedConnection } from "../db/connections.repo";

/**
 * Ler o catálogo de um SQLite local — o mesmo `sqlite_master`/`pragma_*` do
 * libSQL, mas pelas consultas passando pelo worker (`GerenteSqlite`).
 *
 * ## Um arquivo, um "database", nenhum schema
 *
 * Como o libSQL: a árvore é arquivo → tabelas. O nível de "database" existe só
 * para a API manter a forma; ele carrega o nome do arquivo (o basename), para a
 * tela desenhar algo verdadeiro.
 */

/** O nome do "database" — o basename do arquivo, sem diretório. */
export function nomeDoArquivo(filePath: string): string {
  const partes = filePath.split("/");
  return partes[partes.length - 1] ?? "sqlite";
}

const RELACOES_SQL = `
  SELECT type, name
    FROM sqlite_master
   WHERE type IN ('table', 'view')
     AND name NOT LIKE 'sqlite_%'
   ORDER BY name
`;

/** Uma linha de resultado como objeto {coluna: valor}. */
function linhas(r: LinhasCruas): Record<string, string | null>[] {
  return r.rows.map((linha) => {
    const o: Record<string, string | null> = {};
    r.columns.forEach((c, i) => (o[c] = linha[i] ?? null));
    return o;
  });
}

function especieDe(tipo: string | null): RelationKind {
  return tipo === "view" ? "view" : "table";
}

export async function introspectarArvore(
  gerente: GerenteSqlite,
  conexao: ResolvedConnection,
): Promise<DatabaseTree> {
  const nome = nomeDoArquivo(conexao.filePath ?? "");
  const r = await gerente.consulta(conexao, RELACOES_SQL, [], 10_000);
  const relations: RelationTree[] = linhas(r).map((l) => ({
    name: l["name"] ?? "",
    kind: especieDe(l["type"] ?? null),
    estimatedRows: null,
  }));
  return {
    database: nome,
    schemas: [{ name: nome, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

export async function introspectarCompleto(
  gerente: GerenteSqlite,
  conexao: ResolvedConnection,
): Promise<DatabaseSchema> {
  const nome = nomeDoArquivo(conexao.filePath ?? "");
  const rels = linhas(await gerente.consulta(conexao, RELACOES_SQL, [], 10_000));

  const relations: Relation[] = [];
  for (const rel of rels) {
    const tabela = rel["name"] ?? "";
    const info = linhas(
      await gerente.consulta(
        conexao,
        `SELECT cid, name, type, [notnull], dflt_value, pk FROM pragma_table_info(${citar(tabela)})`,
        [],
        10_000,
      ),
    );
    const fks = linhas(
      await gerente.consulta(
        conexao,
        `SELECT [table], [from], [to], seq, id FROM pragma_foreign_key_list(${citar(tabela)})`,
        [],
        10_000,
      ),
    );
    const idxs = linhas(
      await gerente.consulta(
        conexao,
        `SELECT name, [unique], origin FROM pragma_index_list(${citar(tabela)})`,
        [],
        10_000,
      ),
    );

    const columns: Column[] = info.map((c, i) => ({
      name: c["name"] ?? "",
      dataType: c["type"] ?? "",
      dataTypeId: i,
      nullable: c["notnull"] !== "1",
      defaultValue: c["dflt_value"] ?? null,
      position: i,
      isPrimaryKey: (c["pk"] ?? "0") !== "0",
      comment: null,
    }));

    // A chave primária pela ordem do campo `pk` (1,2,…), não pela ordem da coluna.
    const primaryKey = info
      .filter((c) => (c["pk"] ?? "0") !== "0")
      .sort((a, b) => Number(a["pk"]) - Number(b["pk"]))
      .map((c) => c["name"] ?? "");

    // FKs agrupadas por `id`, colunas pareadas por `seq`.
    const porFk = new Map<string, Record<string, string | null>[]>();
    for (const f of fks) {
      const id = f["id"] ?? "0";
      const grupo = porFk.get(id) ?? [];
      grupo.push(f);
      porFk.set(id, grupo);
    }
    const foreignKeys: ForeignKey[] = [...porFk.values()].map((linhasFk) => {
      const ord = [...linhasFk].sort((a, b) => Number(a["seq"]) - Number(b["seq"]));
      return {
        name: `fk_${tabela}_${ord[0]?.["table"] ?? ""}`,
        columns: ord.map((f) => f["from"] ?? ""),
        referencedSchema: nome,
        referencedTable: ord[0]?.["table"] ?? "",
        referencedColumns: ord.map((f) => f["to"] ?? ""),
      };
    });

    const indexes: Index[] = [];
    for (const ix of idxs) {
      const nomeIx = ix["name"] ?? "";
      const cols = linhas(
        await gerente.consulta(
          conexao,
          `SELECT seqno, name FROM pragma_index_info(${citar(nomeIx)})`,
          [],
          10_000,
        ),
      )
        .sort((a, b) => Number(a["seqno"]) - Number(b["seqno"]))
        .map((c) => c["name"] ?? "");
      const unico = (ix["unique"] ?? "0") !== "0";
      indexes.push({
        name: nomeIx,
        columns: cols,
        isUnique: unico,
        isPrimary: (ix["origin"] ?? "") === "pk",
        definition:
          `${unico ? "UNIQUE " : ""}INDEX ${citar(nomeIx)}` +
          (cols.length === 0 ? "" : ` (${cols.map(citar).join(", ")})`),
      });
    }

    relations.push({
      name: tabela,
      kind: especieDe(rel["type"] ?? null),
      comment: null,
      estimatedRows: null,
      columns,
      primaryKey,
      foreignKeys,
      indexes,
    });
  }

  return {
    database: nome,
    schemas: [{ name: nome, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/** Um "database": o arquivo. */
export function listarDatabases(conexao: ResolvedConnection): DatabaseInfo[] {
  const nome = nomeDoArquivo(conexao.filePath ?? "");
  return [{ name: nome, isDefault: true }];
}
