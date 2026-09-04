/**
 * DBee — spike do dia 1 (DBee.md §6, §9).
 *
 * Objetivo: provar, antes de qualquer UI, que o driver `pg` puro-JS roda sob Bun
 * e que o streaming por `DECLARE CURSOR` em SQL funciona com:
 *   - transação com SET LOCAL statement_timeout + default_transaction_read_only
 *   - FETCH maxRows + 1 (detecção de truncamento sem contar a tabela)
 *   - linhas em modo array, todo valor como string no formato textual do Postgres
 *   - dataTypeName real de cada coluna
 *
 * Uso:
 *   bun run spike-cursor.ts "SELECT * FROM spike_wide ORDER BY id" --max-rows 10 --dump
 *   bun run spike-cursor.ts "SELECT * FROM spike_wide" --max-rows 200000
 *
 * Conexão via env: PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD, ou DATABASE_URL.
 */

import { Client } from "pg";
import { randomBytes } from "node:crypto";

// --- tipos locais -----------------------------------------------------------

/** Metadado de coluna como a API do DBee vai devolver (DBee.md §5). */
interface ColumnMeta {
  readonly name: string;
  readonly dataTypeId: number;
  readonly dataTypeName: string;
}

/** Uma célula: string no formato textual do Postgres, ou null. */
type Cell = string | null;
type Row = readonly Cell[];

interface CursorResult {
  readonly columns: readonly ColumnMeta[];
  readonly rows: readonly Row[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly durationMs: number;
}

interface Timings {
  connectMs: number;
  beginMs: number;
  declareMs: number;
  fetchMs: number;
  closeCommitMs: number;
  typeNamesMs: number;
  totalMs: number;
}

/** Snapshot de memória do processo (Bun expõe process.memoryUsage). */
interface MemSnapshot {
  readonly rssMb: number;
  readonly heapUsedMb: number;
  readonly heapTotalMb: number;
}

// --- parsers: tudo string ---------------------------------------------------

/**
 * DBee.md §6: "Configurar parsers para devolver tudo como string, no formato
 * textual do Postgres." A identidade abaixo desliga toda conversão do `pg`
 * (int8 -> string já vem, mas int4/float8/bool/timestamptz/json seriam
 * convertidos). Valor SQL NULL nunca chega aqui — o `pg` devolve null direto.
 */
const identityParser = (value: string): string => value;

/**
 * O tipo `CustomTypesConfig` do @types/pg espera a assinatura sobrecarregada de
 * `getTypeParser` do pg-types. Declaramos a forma mínima que o driver de fato
 * chama em runtime — sem `any`, sem depender do overload.
 */
interface TextTypesConfig {
  getTypeParser: () => (value: string) => string;
}

const allAsText: TextTypesConfig = {
  getTypeParser: () => identityParser,
};

// --- helpers ----------------------------------------------------------------

function mem(): MemSnapshot {
  const m = process.memoryUsage();
  const mb = (n: number): number => Math.round((n / 1024 / 1024) * 10) / 10;
  return { rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), heapTotalMb: mb(m.heapTotal) };
}

function ms(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

/** Nome de cursor seguro: identificador gerado, nunca entrada do usuário. */
function cursorName(): string {
  return `dbee_${randomBytes(8).toString("hex")}`;
}

interface Args {
  readonly sql: string;
  readonly maxRows: number;
  readonly timeoutMs: number;
  readonly dump: boolean;
  readonly dumpRows: number;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let maxRows = 1000;
  let timeoutMs = 30000;
  let dump = false;
  let dumpRows = 3;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-rows") maxRows = Number(argv[++i]);
    else if (a === "--timeout") timeoutMs = Number(argv[++i]);
    else if (a === "--dump") dump = true;
    else if (a === "--dump-rows") dumpRows = Number(argv[++i]);
    else if (a !== undefined) positional.push(a);
  }

  const sql = positional[0];
  if (sql === undefined || sql.trim() === "") {
    throw new Error('uso: bun run spike-cursor.ts "<SQL>" [--max-rows N] [--timeout MS] [--dump]');
  }
  if (!Number.isFinite(maxRows) || maxRows < 1) throw new Error("--max-rows inválido");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("--timeout inválido");

  return { sql, maxRows, timeoutMs, dump, dumpRows };
}

// --- núcleo do spike --------------------------------------------------------

/**
 * Executa a query do usuário dentro de uma transação read-only, via cursor.
 * Sequência exatamente como a seção 6 do DBee.md descreve.
 */
async function runViaCursor(
  client: Client,
  sql: string,
  maxRows: number,
  timeoutMs: number,
  timings: Timings,
): Promise<CursorResult> {
  const name = cursorName();
  const started = performance.now();

  const tBegin = performance.now();
  await client.query("BEGIN");
  // statement_timeout e read-only valem só para esta transação.
  await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
  await client.query("SET LOCAL default_transaction_read_only = on");
  timings.beginMs = ms(tBegin);

  // Verificação: `default_transaction_read_only` só vale para transações que
  // AINDA vão começar. Dentro de um BEGIN já aberto ele não muda nada — quem
  // manda é `transaction_read_only`. O spike imprime os dois para deixar isso
  // visível em vez de assumir que a transação está protegida.
  const ro = await client.query<{ tx: string; def: string }>({
    text: "SELECT current_setting('transaction_read_only') AS tx, current_setting('default_transaction_read_only') AS def",
    types: allAsText,
  });
  const flags = ro.rows[0];
  console.log(
    `\n[read-only] transaction_read_only=${flags?.tx ?? "?"}  ` +
      `default_transaction_read_only=${flags?.def ?? "?"}  ` +
      `→ escrita ${flags?.tx === "on" ? "BLOQUEADA" : "PERMITIDA nesta transação"}`,
  );

  try {
    const tDeclare = performance.now();
    // O SQL do usuário entra como corpo do cursor, sem LIMIT injetado (DBee.md §6).
    await client.query(`DECLARE ${name} NO SCROLL CURSOR FOR ${sql}`);
    timings.declareMs = ms(tDeclare);

    const tFetch = performance.now();
    // maxRows + 1: uma linha a mais revela truncamento sem contar a tabela.
    const fetched = await client.query<Cell[]>({
      text: `FETCH ${maxRows + 1} FROM ${name}`,
      rowMode: "array",
      types: allAsText,
    });
    timings.fetchMs = ms(tFetch);

    const tClose = performance.now();
    await client.query(`CLOSE ${name}`);
    await client.query("COMMIT");
    timings.closeCommitMs = ms(tClose);

    const truncated = fetched.rows.length > maxRows;
    const rows = truncated ? fetched.rows.slice(0, maxRows) : fetched.rows;

    const tTypes = performance.now();
    const columns = await resolveColumns(client, fetched.fields);
    timings.typeNamesMs = ms(tTypes);

    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: ms(started),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

interface PgField {
  readonly name: string;
  readonly dataTypeID: number;
}

/**
 * O `pg` só devolve o OID do tipo. O nome real (dataTypeName) sai do catálogo —
 * format_type dá o nome canônico ("timestamp with time zone", "integer[]").
 */
async function resolveColumns(
  client: Client,
  fields: readonly PgField[],
): Promise<readonly ColumnMeta[]> {
  const oids = [...new Set(fields.map((f) => f.dataTypeID))];
  const names = new Map<number, string>();

  if (oids.length > 0) {
    const res = await client.query<{ oid: string; typname: string; formatted: string }>({
      text: `SELECT oid::text AS oid, typname, format_type(oid, NULL) AS formatted
               FROM pg_type WHERE oid = ANY($1::oid[])`,
      values: [oids],
      types: allAsText,
    });
    for (const r of res.rows) names.set(Number(r.oid), r.formatted || r.typname);
  }

  return fields.map((f) => ({
    name: f.name,
    dataTypeId: f.dataTypeID,
    dataTypeName: names.get(f.dataTypeID) ?? `oid:${f.dataTypeID}`,
  }));
}

// --- relatório --------------------------------------------------------------

/** Mostra o valor bruto sem interpretar: aspas + escapes visíveis. */
function raw(v: Cell): string {
  if (v === null) return "NULL (js null)";
  return `${JSON.stringify(v)}  [len=${v.length}, typeof=${typeof v}]`;
}

function report(result: CursorResult, args: Args, timings: Timings, memBefore: MemSnapshot, memAfter: MemSnapshot): void {
  console.log("\n=== COLUNAS ===");
  for (const c of result.columns) {
    console.log(`  ${c.name.padEnd(14)} oid=${String(c.dataTypeId).padStart(5)}  ${c.dataTypeName}`);
  }

  if (args.dump) {
    const n = Math.min(args.dumpRows, result.rows.length);
    console.log(`\n=== VALORES BRUTOS (${n} linha(s)) ===`);
    for (let i = 0; i < n; i++) {
      const row = result.rows[i];
      if (row === undefined) continue;
      console.log(`\n--- linha ${i} ---`);
      result.columns.forEach((c, j) => {
        console.log(`  ${c.name.padEnd(14)} (${c.dataTypeName}) = ${raw(row[j] ?? null)}`);
      });
    }
  }

  const nonString = countNonString(result);
  console.log("\n=== INTEGRIDADE ===");
  console.log(`  linhas em modo array: ${Array.isArray(result.rows[0]) ? "sim" : "NAO"}`);
  console.log(`  células não-string e não-null: ${nonString}`);

  console.log("\n=== RESULTADO ===");
  console.log(`  rowCount   : ${result.rowCount}`);
  console.log(`  truncated  : ${result.truncated}  (pedido FETCH ${args.maxRows + 1})`);

  console.log("\n=== TEMPO (ms) ===");
  console.log(`  connect        : ${timings.connectMs}`);
  console.log(`  begin+SET LOCAL: ${timings.beginMs}`);
  console.log(`  declare cursor : ${timings.declareMs}`);
  console.log(`  fetch          : ${timings.fetchMs}`);
  console.log(`  close+commit   : ${timings.closeCommitMs}`);
  console.log(`  type names     : ${timings.typeNamesMs}`);
  console.log(`  TOTAL          : ${timings.totalMs}`);

  console.log("\n=== MEMÓRIA (MB) ===");
  console.log(`  antes: rss=${memBefore.rssMb} heapUsed=${memBefore.heapUsedMb} heapTotal=${memBefore.heapTotalMb}`);
  console.log(`  depois: rss=${memAfter.rssMb} heapUsed=${memAfter.heapUsedMb} heapTotal=${memAfter.heapTotalMb}`);
  console.log(`  delta rss=${Math.round((memAfter.rssMb - memBefore.rssMb) * 10) / 10} heapUsed=${Math.round((memAfter.heapUsedMb - memBefore.heapUsedMb) * 10) / 10}`);
}

function countNonString(result: CursorResult): number {
  let bad = 0;
  for (const row of result.rows) {
    for (const cell of row) {
      if (cell !== null && typeof cell !== "string") bad++;
    }
  }
  return bad;
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const memBefore = mem();
  const totalStart = performance.now();

  const timings: Timings = {
    connectMs: 0, beginMs: 0, declareMs: 0, fetchMs: 0,
    closeCommitMs: 0, typeNamesMs: 0, totalMs: 0,
  };

  const client = new Client({
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "postgres",
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "",
    // Sem PgBouncer, sem statement cache: conexão direta (DBee.md §6, §11.1).
    application_name: "dbee-spike",
  });

  console.log(`bun ${Bun.version} · pg driver`);
  console.log(`SQL: ${args.sql}`);

  const tConn = performance.now();
  await client.connect();
  timings.connectMs = ms(tConn);

  try {
    const result = await runViaCursor(client, args.sql, args.maxRows, args.timeoutMs, timings);
    timings.totalMs = ms(totalStart);
    const memAfter = mem();
    report(result, args, timings, memBefore, memAfter);
  } finally {
    await client.end();
  }
}

/**
 * Formato de erro que o CLAUDE.md pede: code, message e position para a UI
 * destacar no editor. Nada de engolir o erro do Postgres.
 */
interface PgErrorShape {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly position?: string | undefined;
  readonly hint?: string | undefined;
  readonly detail?: string | undefined;
  readonly routine?: string | undefined;
}

function asPgError(err: unknown): PgErrorShape | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof e[k] === "string" ? e[k] : undefined);
  return {
    code: str("code"),
    message: str("message"),
    position: str("position"),
    hint: str("hint"),
    detail: str("detail"),
    routine: str("routine"),
  };
}

main().catch((err: unknown) => {
  console.error("\n=== FALHOU ===");
  const pg = asPgError(err);
  if (pg?.code !== undefined) {
    console.error(`  code    : ${pg.code}`);
    console.error(`  message : ${pg.message ?? ""}`);
    if (pg.position !== undefined) console.error(`  position: ${pg.position}`);
    if (pg.detail !== undefined) console.error(`  detail  : ${pg.detail}`);
    if (pg.hint !== undefined) console.error(`  hint    : ${pg.hint}`);
    if (pg.routine !== undefined) console.error(`  routine : ${pg.routine}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
