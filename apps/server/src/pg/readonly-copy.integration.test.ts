import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Client } from "pg";

import { testConnection } from "./test-connection";

/**
 * A fronteira que a auditoria de segurança de 2026-09-05 achou (§11).
 *
 * `BEGIN READ ONLY` barra DML e DDL, mas **não barra `COPY … TO PROGRAM`** —
 * do ponto de vista do modo de transação, executar um programa não modifica
 * linhas. Num papel superusuário isso é execução de comando no host do banco,
 * dentro de uma conexão que a UI chama de "somente leitura".
 *
 * Não há como bloquear pelo lado do cliente sem um parser (CLAUDE.md regra 8),
 * e um superusuário desfaz qualquer `SET` que tentássemos. A defesa é **avisar**
 * — detectar o privilégio no teste de conexão e dizer que o read-only não
 * contém aquela sessão. Estes testes travam as duas metades: que o read-only
 * de fato barra o que deve barrar, e que o aviso aparece para o papel perigoso
 * e some para o papel restrito.
 */

const PORTA = 55495;
const CONTAINER = "dbee-rocopy-it";
const SENHA = "Rc8kWm3nZx6T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

const clienteRaw = async (user: string, password: string): Promise<Client> => {
  const c = new Client({ host: "127.0.0.1", port: PORTA, database: "rc", user, password });
  await c.connect();
  return c;
};

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=rc",
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  );
  let pronto = false;
  for (let i = 0; i < 80; i++) {
    if (sh("docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "rc", "-tAc", "SELECT 1")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Postgres do teste não ficou pronto");

  // Um papel restrito, para o aviso ter os dois lados.
  sh(
    "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "rc", "-c",
    "CREATE ROLE leitor LOGIN PASSWORD 'leitor123'; GRANT CONNECT ON DATABASE rc TO leitor;",
  );

}, 180_000);

afterAll(() => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

const base = {
  host: "127.0.0.1", port: PORTA, database: "rc",
  sslMode: "disable" as const, writeEnabled: false,
  statementTimeoutMs: 30_000, timezone: "UTC",
  color: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

describe.if(temDocker)("BEGIN READ ONLY barra o que deve barrar", () => {
  it("DML e DDL falham com 25006 dentro de READ ONLY", async () => {
    const c = await clienteRaw("postgres", SENHA);
    try {
      await c.query("BEGIN READ ONLY");
      for (const sql of [
        "CREATE TABLE t_x (a int)",
        "INSERT INTO pg_class VALUES (0)",
        "SELECT nextval('nao_existe')",
      ]) {
        let codigo: string | null = null;
        try {
          await c.query(sql);
        } catch (e: unknown) {
          codigo = (e as { code?: string }).code ?? null;
        }
        // 25006 = read_only_sql_transaction; 42P01/42704 quando nem chega lá.
        expect(codigo).not.toBeNull();
      }
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  }, 60_000);

  it("COPY … TO PROGRAM NÃO é barrado — é a fronteira do §11", async () => {
    // Este teste documenta a falha, não a corrige: é comportamento do Postgres.
    // Se um dia o Postgres passar a barrar isto em READ ONLY, ótimo — o teste
    // falha e o aviso pode ser reavaliado.
    const c = await clienteRaw("postgres", SENHA);
    try {
      await c.query("BEGIN READ ONLY");
      const r = await c.query("COPY (SELECT 1) TO PROGRAM 'true'");
      // Chegou aqui: o COPY passou dentro do READ ONLY.
      expect(r.command).toBe("COPY");
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  }, 60_000);
});

describe.if(temDocker)("o teste de conexão avisa sobre o papel privilegiado", () => {
  it("superusuário: vem o aviso de que o read-only não contém a sessão", async () => {
    const r = await testConnection({ ...base, id: "x", name: "su", username: "postgres", password: SENHA }, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]?.message).toContain("COPY");
  }, 60_000);

  it("papel restrito: nenhum aviso", async () => {
    const r = await testConnection({ ...base, id: "y", name: "leitor", username: "leitor", password: "leitor123" }, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
  }, 60_000);
});
