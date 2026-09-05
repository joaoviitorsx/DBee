import { Client } from "pg";

import type { ConnectionWarning, TestConnectionResult } from "@dbee/shared";

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
 *
 * Também **checa o privilégio do papel**: se ele pode `COPY … TO PROGRAM`, o
 * modo read-only não contém o que essa conexão pode fazer (§11), e isso vira
 * um aviso — não um bloqueio, porque não há como bloquear pelo lado do cliente
 * sem parser (regra 8), e um superuser desfaz qualquer `SET` que tentássemos.
 */

/**
 * O papel usado na conexão é privilegiado o bastante para furar o read-only?
 *
 * `COPY … TO PROGRAM` exige superuser ou o papel `pg_execute_server_program`.
 * Qualquer um dos dois significa que "conexão em modo leitura" **não** é uma
 * garantia de que o banco de produção do cliente está protegido daquela sessão.
 */
async function detectarPrivilegio(client: Client): Promise<ConnectionWarning[]> {
  try {
    const r = await client.query<{ perigoso: boolean }>(
      `SELECT (rolsuper OR pg_has_role(current_user, 'pg_execute_server_program', 'USAGE')) AS perigoso
         FROM pg_roles WHERE rolname = current_user`,
    );
    if (r.rows[0]?.perigoso !== true) return [];
    return [
      {
        code: "privileged_role",
        message:
          "Este usuário é superusuário ou pode executar programas no servidor. " +
          "O modo leitura do DBee barra INSERT, UPDATE e DDL, mas não impede " +
          "COPY … TO PROGRAM — uma sessão com este papel pode executar comandos " +
          "no host do banco. Para o modo leitura ser uma barreira real, conecte " +
          "com um usuário sem esses privilégios.",
      },
    ];
  } catch {
    // A checagem é defensiva: se `pg_roles` não responde (permissão, versão
    // antiga), o teste de conexão não deve falhar por causa dela.
    return [];
  }
}
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
    ssl: sslConfigFor(connection.sslMode, caCert, connection.host),
    application_name: "dbee",
    connectionTimeoutMillis: 10_000,
  });

  const elapsed = (): number => Math.round(performance.now() - started);

  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    // set_config e não `SET x = $1`: mesmo padrão do PoolManager (§11.16). O
    // valor aqui vem validado, mas a segurança não deve depender de um
    // invariante mantido duas camadas acima.
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(connection.statementTimeoutMs),
    ]);
    await client.query("SELECT set_config('TimeZone', $1, true)", [connection.timezone]);
    await client.query("SELECT 1");
    const version = await client.query<{ v: string }>("SELECT version() AS v");
    const warnings = await detectarPrivilegio(client);
    await client.query("ROLLBACK");

    return {
      ok: true,
      serverVersion: version.rows[0]?.v ?? "desconhecida",
      durationMs: elapsed(),
      warnings,
    };
  } catch (err: unknown) {
    // Erro do Postgres vai inteiro para a UI. Nunca incluir a senha aqui.
    return { ok: false, ...describe(err), durationMs: elapsed() };
  } finally {
    await client.end().catch(() => undefined);
  }
}
