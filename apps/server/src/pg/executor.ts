import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import type { QueryError, ResultColumn, StatementResult } from "@dbee/shared";

import { splitStatements } from "./split";

/**
 * Execução de query do usuário (DBee.md §6).
 *
 * O que este arquivo garante, em ordem de importância:
 *
 * 1. **A proteção de escrita é o modo da transação**, aberto por quem chama
 *    (`BEGIN READ ONLY`). Nada aqui inspeciona o SQL para decidir se ele
 *    escreve — ADR 001 e regra 8 do `CLAUDE.md`.
 * 2. **`maxRows + 1`** revela truncamento sem contar a tabela.
 * 3. **`position` corrigida**, calculada a partir do prefixo real do `DECLARE`,
 *    nunca de constante literal (§11.12).
 * 4. **Nenhum `LIMIT` injetado** no SQL do usuário.
 */

/** Todo valor de célula é string; `null` é SQL NULL (§6). */
type Cell = string | null;

/**
 * Desliga toda conversão de tipo do `pg`: valores chegam no formato textual do
 * Postgres. Evita a classe inteira de bug "o número apareceu diferente na
 * tela" (§6).
 */
interface TextTypesConfig {
  getTypeParser: () => (value: string) => string;
}
const TUDO_TEXTO: TextTypesConfig = { getTypeParser: () => (v) => v };

/** Nome de cursor gerado, nunca entrada do usuário. */
const nomeCursor = (): string => `dbee_${randomBytes(8).toString("hex")}`;

interface PgErrorShape {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly position?: unknown;
  readonly detail?: unknown;
  readonly hint?: unknown;
}

const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Converte o erro do driver, corrigindo a `position`.
 *
 * @param prefixo caracteres que o executor colocou ANTES do SQL do usuário —
 *   o `DECLARE ... CURSOR FOR `. Zero quando o statement rodou direto.
 * @param offset onde este statement começa dentro do SQL original, para a
 *   posição apontar para a linha certa num envio com vários statements.
 */
export function toQueryError(err: unknown, prefixo: number, offset: number): QueryError {
  if (typeof err !== "object" || err === null) {
    return { code: null, message: String(err), position: null, detail: null, hint: null };
  }
  const e = err as PgErrorShape;

  const cru = typeof e.position === "string" ? Number(e.position) : null;
  const position =
    cru === null || !Number.isFinite(cru)
      ? null
      : // `position` é 1-based; tira o prefixo e soma onde o statement começa.
        cru - prefixo + offset;

  return {
    code: texto(e.code),
    message: texto(e.message) ?? "erro desconhecido",
    position,
    detail: texto(e.detail),
    hint: texto(e.hint),
  };
}

interface PgField {
  readonly name: string;
  readonly dataTypeID: number;
}

/** O `pg` só dá o OID; o nome canônico sai do catálogo. */
async function resolveColumns(
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

/**
 * Erro de um statement, carregando quanto prefixo o executor pôs antes do SQL
 * do usuário.
 *
 * Classe e não objeto cru: um `throw` de objeto perde o stack e quebra
 * qualquer `instanceof Error` no caminho — inclusive o do serviço, que usa
 * `err instanceof Error` para montar a mensagem do `query_log`.
 */
class StatementFailure extends Error {
  constructor(
    /** Caracteres antes do SQL do usuário. Zero fora do cursor. */
    readonly prefixo: number,
    readonly causa: unknown,
  ) {
    super(causa instanceof Error ? causa.message : String(causa));
    this.name = "StatementFailure";
  }
}

export interface ExecutionOutcome {
  readonly results: StatementResult[];
  readonly error: (QueryError & { index: number }) | null;
}

/**
 * Executa os statements em sequência, parando no primeiro erro.
 *
 * Já dentro da transação aberta por quem chama, com o modo e o
 * `statement_timeout` definidos.
 */
export async function execute(
  client: PoolClient,
  sql: string,
  maxRows: number,
): Promise<ExecutionOutcome> {
  const statements = splitStatements(sql);
  const results: StatementResult[] = [];

  for (const [index, statement] of statements.entries()) {
    const inicio = performance.now();
    try {
      const parcial = await executeOne(client, statement.sql, maxRows);
      results.push({
        index,
        sql: statement.sql,
        ...parcial,
        durationMs: Math.round(performance.now() - inicio),
      });
    } catch (err: unknown) {
      const falha =
        err instanceof StatementFailure ? err : new StatementFailure(0, err);
      return {
        results,
        error: { ...toQueryError(falha.causa, falha.prefixo, statement.offset), index },
      };
    }
  }

  return { results, error: null };
}

type Parcial = Omit<StatementResult, "index" | "sql" | "durationMs">;

/**
 * Um statement.
 *
 * `DECLARE ... CURSOR FOR <stmt>` só aceita comando que devolve linhas; com
 * `UPDATE`, `SET` ou DDL ele falha com **42601** — exatamente o código de um
 * erro de sintaxe de verdade. Não dá para distinguir pelo código, e inspecionar
 * o SQL para adivinhar é o que a regra 8 proíbe.
 *
 * A saída é um `SAVEPOINT`: tenta o cursor e, se ele falhar, desfaz e executa
 * direto. Se a execução direta também falhar, é **o erro dela** que é
 * reportado — com `position` sem deslocamento nenhum, porque ali não houve
 * prefixo. O erro do `DECLARE` é descartado justamente por ser ambíguo.
 */
async function executeOne(client: PoolClient, sql: string, maxRows: number): Promise<Parcial> {
  const ponto = `sp_${randomBytes(4).toString("hex")}`;
  await client.query(`SAVEPOINT ${ponto}`);

  const cursor = nomeCursor();
  const prefixo = `DECLARE ${cursor} NO SCROLL CURSOR FOR `;

  try {
    // Sem LIMIT injetado: o SQL do usuário entra inteiro (§6).
    await client.query(prefixo + sql);
  } catch {
    // Não era cursorável — ou tem erro de sintaxe. A execução direta decide.
    await client.query(`ROLLBACK TO SAVEPOINT ${ponto}`);
    return await executeDirect(client, sql);
  }

  try {
    // maxRows + 1: uma linha a mais revela truncamento sem contar a tabela.
    const fetched = await client.query<Cell[]>({
      text: `FETCH ${String(maxRows + 1)} FROM ${cursor}`,
      rowMode: "array",
      types: TUDO_TEXTO,
    });
    await client.query(`CLOSE ${cursor}`);
    await client.query(`RELEASE SAVEPOINT ${ponto}`);

    const truncated = fetched.rows.length > maxRows;
    const rows = truncated ? fetched.rows.slice(0, maxRows) : fetched.rows;

    return {
      columns: await resolveColumns(client, fetched.fields),
      rows,
      rowCount: rows.length,
      truncated,
      // O comando do FETCH é "FETCH"; o do usuário era um comando de leitura.
      command: "SELECT",
      viaCursor: true,
    };
  } catch (causa: unknown) {
    // Erro ao buscar: aconteceu DEPOIS do DECLARE, então a posição é relativa
    // ao SQL embrulhado.
    throw new StatementFailure(prefixo.length, causa);
  }
}

/** Statement que não passa por cursor. Sem prefixo, logo sem deslocamento. */
async function executeDirect(client: PoolClient, sql: string): Promise<Parcial> {
  try {
    const res = await client.query<Cell[]>({ text: sql, rowMode: "array", types: TUDO_TEXTO });
    const temLinhas = res.fields.length > 0;

    return {
      columns: temLinhas ? await resolveColumns(client, res.fields) : [],
      rows: temLinhas ? res.rows : [],
      rowCount: temLinhas ? res.rows.length : (res.rowCount ?? 0),
      truncated: false,
      command: res.command,
      viaCursor: false,
    };
  } catch (causa: unknown) {
    throw new StatementFailure(0, causa);
  }
}
