import type {
  RowDeleteRequest,
  RowInsertRequest,
  RowMutationResult,
  RowUpdateRequest,
} from "@dbee/shared";

import { citar } from "../libsql/citar";
import { MutacaoError } from "../driver/erros";
import type { GerenteSqlite } from "./gerente";
import type { ResolvedConnection } from "../db/connections.repo";

/**
 * Edição de linha no SQLite local — o SQL montado aqui, executado pelo handle
 * **r/w** do worker.
 *
 * Não reusa o construtor do Postgres (`construirUpdate`/…): aquele emite `$n` e
 * casts `::tipo` do Postgres, que o SQLite não entende. Aqui o placeholder é
 * `?` posicional (o do `bun:sqlite`), o identificador é citado por `citar()`
 * (aspas duplas, como o libSQL), e não há cast — o SQLite tem tipagem dinâmica
 * e compara o texto com a coluna.
 *
 * A **guarda otimista** é o mesmo contrato das outras engines: o `WHERE` repete
 * os valores originais (o `from` do update, o `guard` do delete) além da PK. Se
 * a linha mudou desde a leitura, o `WHERE` casa zero e a prova de cardinalidade
 * (changes ≠ 1) recusa com `row_changed`.
 */

/** `col = ?` para cada nome, citado; empurra o valor em `params`. */
function igualdades(
  pares: readonly { column: string; value: string | null }[],
  params: (string | null)[],
): string[] {
  return pares.map((p) => {
    params.push(p.value);
    // `IS ?` e não `= ?`: no SQL, `x = NULL` nunca é verdadeiro. A guarda com um
    // valor NULL precisa de `IS` para casar a linha cujo campo é NULL.
    return `${citar(p.column)} IS ?`;
  });
}

export async function atualizar(
  gerente: GerenteSqlite,
  conexao: ResolvedConnection,
  req: RowUpdateRequest,
): Promise<RowMutationResult> {
  const params: (string | null)[] = [];
  const sets = req.changes.map((c) => {
    params.push(c.to);
    return `${citar(c.column)} = ?`;
  });
  // `WHERE` = PK + valores originais das colunas alteradas (guarda otimista).
  const where = [
    ...igualdades(req.pk.map((p) => ({ column: p.column, value: p.value })), params),
    ...igualdades(req.changes.map((c) => ({ column: c.column, value: c.from })), params),
  ];
  const sql = `UPDATE ${citar(req.table)} SET ${sets.join(", ")} WHERE ${where.join(" AND ")}`;
  const r = await gerente.consulta(conexao, sql, params, 0, true);
  if (r.changes === 0) return { rowCount: 0, sql };
  if (r.changes > 1) throw new MutacaoError(`a condição casou ${String(r.changes)} linhas`);
  return { rowCount: r.changes, sql };
}

export async function excluir(
  gerente: GerenteSqlite,
  conexao: ResolvedConnection,
  req: RowDeleteRequest,
): Promise<RowMutationResult> {
  const params: (string | null)[] = [];
  const where = [
    ...igualdades(req.pk.map((p) => ({ column: p.column, value: p.value })), params),
    ...igualdades(req.guard, params),
  ];
  const sql = `DELETE FROM ${citar(req.table)} WHERE ${where.join(" AND ")}`;
  const r = await gerente.consulta(conexao, sql, params, 0, true);
  if (r.changes === 0) return { rowCount: 0, sql };
  if (r.changes > 1) throw new MutacaoError(`a condição casou ${String(r.changes)} linhas`);
  return { rowCount: r.changes, sql };
}

export async function inserir(
  gerente: GerenteSqlite,
  conexao: ResolvedConnection,
  req: RowInsertRequest,
): Promise<RowMutationResult> {
  const params: (string | null)[] = req.values.map((v) => v.value);
  const colunas = req.values.map((v) => citar(v.column)).join(", ");
  const marcadores = req.values.map(() => "?").join(", ");
  const sql = `INSERT INTO ${citar(req.table)} (${colunas}) VALUES (${marcadores})`;
  const r = await gerente.consulta(conexao, sql, params, 0, true);
  return { rowCount: r.changes, sql };
}
