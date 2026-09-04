import { Client } from "pg";

import type { TestConnectionResult } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { sslConfigFor } from "./ssl";

interface PgErrorish {
  readonly code?: unknown;
  readonly message?: unknown;
}

function describe(err: unknown): { code: string | null; message: string } {
  if (typeof err !== "object" || err === null) {
    return { code: null, message: String(err) };
  }
  const e = err as PgErrorish;
  return {
    code: typeof e.code === "string" ? e.code : null,
    message: typeof e.message === "string" ? e.message : "erro desconhecido",
  };
}

/**
 * Abre a conexão, roda `SELECT 1` dentro de `BEGIN READ ONLY` e fecha.
 *
 * O `BEGIN READ ONLY` não é decoração: exercita desde o dia 1 o caminho que o
 * ADR 001 definiu, então um servidor que não aceite o modo aparece aqui e não
 * na primeira query de verdade. `statement_timeout` sempre setado (§11.6).
 *
 * Nunca conectar no PgBouncer (6432) — CLAUDE.md regra 6. A porta é do usuário,
 * mas o modo de transação interativo exige o Postgres direto.
 */
export async function testConnection(
  connection: ResolvedConnection,
  caCert: string | undefined,
): Promise<TestConnectionResult> {
  const started = performance.now();
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: sslConfigFor(connection.sslMode, caCert),
    application_name: "dbee",
    connectionTimeoutMillis: 10_000,
  });

  const elapsed = (): number => Math.round(performance.now() - started);

  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${connection.statementTimeoutMs}`);
    await client.query("SELECT 1");
    const version = await client.query<{ v: string }>("SELECT version() AS v");
    await client.query("ROLLBACK");

    return {
      ok: true,
      serverVersion: version.rows[0]?.v ?? "desconhecida",
      durationMs: elapsed(),
    };
  } catch (err: unknown) {
    // Erro do Postgres vai inteiro para a UI. Nunca incluir a senha aqui.
    return { ok: false, ...describe(err), durationMs: elapsed() };
  } finally {
    await client.end().catch(() => undefined);
  }
}
