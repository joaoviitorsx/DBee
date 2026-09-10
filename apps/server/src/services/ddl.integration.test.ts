import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { PoolManager } from "../pg/pool";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";

/**
 * DDL aditivo contra um Postgres **de verdade** (ADR 010).
 *
 * O que só um Postgres real prova, e nenhum teste unitário pega:
 *
 * - `CREATE DATABASE` **não roda dentro de transação**. É a razão de existir o
 *   `withAutocommit`; se alguém o trocar por `withTransaction`, este arquivo
 *   falha com a mensagem do próprio Postgres.
 * - `CREATE TABLE` **roda** dentro dela, e portanto não precisa daquele
 *   caminho.
 * - O `write_enabled` desligado barra os dois **no servidor**, e não só na UI.
 */

const PORTA = 15551;
const CONTAINER = "dbee-ddl-test";
const SENHA = "teste-ddl";

/**
 * Sem Docker, a suíte inteira deste arquivo é pulada em vez de falhar —
 * mesma postura dos demais testes de integração.
 *
 * O `try` não é decoração: `Bun.spawnSync` **lança** `ENOENT` quando o binário
 * não está no PATH, em vez de devolver exit code. Sem ele, "não tem Docker"
 * viraria erro não tratado entre testes — o oposto de pular.
 */
const temDocker = ((): boolean => {
  try {
    return Bun.spawnSync(["docker", "version"]).exitCode === 0;
  } catch {
    return false;
  }
})();

let store: Store;
let app: ReturnType<typeof createApp>;
let pools: PoolManager | undefined;
let cookie = "";

/** Cria a conexão pelo próprio CRUD, para o teste usar o caminho de produção. */
async function criarConexao(writeEnabled: boolean): Promise<string> {
  const res = await app.handle(
    new Request("http://localhost/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: writeEnabled ? "grava" : "so-leitura",
        host: "127.0.0.1",
        port: PORTA,
        database: "postgres",
        username: "postgres",
        password: SENHA,
        sslMode: "disable",
        writeEnabled,
      }),
    }),
  );
  const corpo = (await res.json()) as { id: string };
  return corpo.id;
}

const chamar = (path: string, body: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  if (!temDocker) return;

  Bun.spawnSync(["docker", "rm", "-f", CONTAINER]);
  Bun.spawnSync([
    "docker", "run", "-d", "--rm", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${SENHA}`,
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  ]);

  /*
   * Espera por TCP, não pelo socket unix. Medido: o entrypoint sobe um servidor
   * temporário com `listen_addresses=''` para inicializar o cluster e reinicia
   * depois; o socket responde ~290 ms antes do TCP, e nessa janela um comando
   * morre com `FATAL: the database system is shutting down`.
   */
  const limite = Date.now() + 90_000;
  for (;;) {
    const pronto = Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres", "-tAc", "SELECT 1",
    ]);
    if (pronto.exitCode === 0) break;
    if (Date.now() > limite) throw new Error("Postgres de teste não subiu");
    await Bun.sleep(500);
  }

  store = openTestStore();
  pools = new PoolManager(undefined);
  app = createApp({ store, caCert: undefined, pools });
  ({ cookie } = await autenticar(store));
}, 180_000);

/**
 * Fecha os pools **antes** de derrubar o container.
 *
 * Ao contrário, as conexões ociosas do pool recebem um `FATAL 57P01
 * terminating connection due to unexpected postmaster exit` depois que os
 * testes deste arquivo já reportaram sucesso. Como ninguém está esperando
 * por elas, o erro não pertence a teste nenhum: o `bun test` o conta como
 * `1 error` e sai com código 1 mesmo com `0 fail` — foi assim que a release
 * da v0.2.2 quebrou no CI, com a suíte inteira verde.
 */
afterAll(async () => {
  if (!temDocker) return;
  await pools?.shutdown();
  Bun.spawnSync(["docker", "rm", "-f", CONTAINER]);
}, 60_000);

describe.if(temDocker)("criar tabela", () => {
  it("cria de verdade, e a tabela existe depois", async () => {
    const id = await criarConexao(true);
    const res = await chamar(`/api/connections/${id}/ddl/table`, {
      database: "postgres",
      schema: "public",
      name: "pedidos",
      columns: [
        { name: "id", type: "bigserial", primaryKey: true },
        { name: "cliente", type: "text", notNull: true },
        { name: "valor", type: "numeric", length: 12, scale: 2 },
        { name: "criado", type: "timestamptz", defaultExpression: "now()" },
      ],
      comment: "criada pelo teste",
    });

    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { ok: boolean; sql: string };
    expect(corpo.ok).toBe(true);
    expect(corpo.sql).toContain('CREATE TABLE "public"."pedidos"');

    // Confere no catálogo, não na resposta: a resposta diria "ok" mesmo se o
    // comando não tivesse chegado ao banco.
    const conferir = Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-tAc",
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pedidos' ORDER BY ordinal_position",
    ]);
    const saida = conferir.stdout.toString();
    expect(saida).toContain("id|bigint");
    expect(saida).toContain("cliente|text");
    expect(saida).toContain("valor|numeric");
    expect(saida).toContain("criado|timestamp with time zone");
  });

  /** O nome não vira comando: o `;` do ataque é texto dentro do identificador. */
  it("nome com aspas cria uma tabela de nome esquisito, não roda DROP", async () => {
    const id = await criarConexao(true);
    Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-c",
      "CREATE TABLE alvo_intacto (id int)",
    ]);

    const res = await chamar(`/api/connections/${id}/ddl/table`, {
      database: "postgres",
      schema: "public",
      name: 'x"; DROP TABLE alvo_intacto; --',
      columns: [{ name: "a", type: "integer" }],
    });
    expect(res.status).toBe(200);

    const conferir = Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-tAc",
      "SELECT to_regclass('alvo_intacto') IS NOT NULL",
    ]);
    expect(conferir.stdout.toString().trim()).toBe("t");
  });

  it("sem write_enabled, o servidor recusa — e registra a tentativa", async () => {
    const id = await criarConexao(false);
    const res = await chamar(`/api/connections/${id}/ddl/table`, {
      database: "postgres",
      schema: "public",
      name: "nao_deve_existir",
      columns: [{ name: "a", type: "integer" }],
    });
    expect(res.status).toBe(403);

    const conferir = Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-tAc",
      "SELECT to_regclass('nao_deve_existir') IS NULL",
    ]);
    expect(conferir.stdout.toString().trim()).toBe("t");

    // A recusa vira linha de auditoria com o SQL que teria rodado.
    const linha = store.db
      .query<{ sql: string; status: string; error: string }, []>(
        "SELECT sql, status, error FROM query_log ORDER BY executed_at DESC LIMIT 1",
      )
      .get();
    expect(linha?.status).toBe("error");
    expect(linha?.sql).toContain("nao_deve_existir");
    // O portão unificado (mutação + DDL) registra a recusa por `write_forbidden`
    // com o motivo; era "write_enabled desligado" antes de o DDL adotar o mesmo
    // portão da edição de linha.
    expect(linha?.error).toContain("write_forbidden");
  });

  it("erro do Postgres chega inteiro à resposta", async () => {
    const id = await criarConexao(true);
    const corpo = {
      database: "postgres",
      schema: "public",
      name: "repetida",
      columns: [{ name: "a", type: "integer" }],
    };
    expect((await chamar(`/api/connections/${id}/ddl/table`, corpo)).status).toBe(200);

    const segunda = await chamar(`/api/connections/${id}/ddl/table`, corpo);
    expect(segunda.status).toBe(502);
    const erro = (await segunda.json()) as { message: string };
    expect(erro.message).toContain("already exists");
  });
});

describe.if(temDocker)("criar database", () => {
  /**
   * A razão de existir o `withAutocommit`. Trocar por `withTransaction` faz
   * este teste falhar com a mensagem do próprio Postgres.
   */
  it("cria de verdade — fora de transação", async () => {
    const id = await criarConexao(true);
    const res = await chamar(`/api/connections/${id}/ddl/database`, {
      name: "faturamento_2027",
      encoding: "UTF8",
      template: "template0",
    });

    expect(res.status).toBe(200);
    const conferir = Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-tAc",
      "SELECT count(*) FROM pg_database WHERE datname = 'faturamento_2027'",
    ]);
    expect(conferir.stdout.toString().trim()).toBe("1");
  });

  /**
   * Prova o motivo, não só o efeito: o mesmo comando dentro de transação é
   * recusado pelo Postgres. Se este comportamento mudar numa versão futura, é
   * aqui que se descobre.
   */
  it("o Postgres realmente recusa CREATE DATABASE em transação", () => {
    const dentro = Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-c",
      "BEGIN; CREATE DATABASE dentro_de_transacao; COMMIT;",
    ]);
    expect(dentro.stderr.toString()).toContain("cannot run inside a transaction block");
  });

  it("sem write_enabled, recusa", async () => {
    const id = await criarConexao(false);
    const res = await chamar(`/api/connections/${id}/ddl/database`, { name: "nao_criada" });
    expect(res.status).toBe(403);

    const conferir = Bun.spawnSync([
      "docker", "exec", CONTAINER, "psql", "-U", "postgres", "-tAc",
      "SELECT count(*) FROM pg_database WHERE datname = 'nao_criada'",
    ]);
    expect(conferir.stdout.toString().trim()).toBe("0");
  });

  it("nome inválido volta 422 antes de tocar o banco", async () => {
    const id = await criarConexao(true);
    const res = await chamar(`/api/connections/${id}/ddl/database`, { name: "   " });
    expect(res.status).toBe(422);
  });
});
