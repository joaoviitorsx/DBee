import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";

/**
 * Dump de várias tabelas, contra Postgres real.
 *
 * A asserção que vale mais que todas: **o arquivo gerado recarrega num banco
 * vazio**. Um dump que "parece certo" e não recarrega é pior que dump nenhum —
 * a pessoa descobre no dia em que precisa dele.
 */

const PORTA = 15552;
const ORIGEM = "dbee-bundle-origem";
const SENHA = "teste-bundle";

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
let cookie = "";
let connectionId = "";

const psql = (args: readonly string[]): { saida: string; erro: string; codigo: number } => {
  const r = Bun.spawnSync(["docker", "exec", ORIGEM, "psql", "-U", "postgres", ...args]);
  return { saida: r.stdout.toString(), erro: r.stderr.toString(), codigo: r.exitCode };
};

async function baixarBundle(corpo: unknown): Promise<Response> {
  return await app.handle(
    new Request(`http://localhost/api/connections/${connectionId}/export/bundle`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(corpo),
    }),
  );
}

/**
 * Espera o Postgres **definitivo**, por TCP.
 *
 * Medido, não suposto: o entrypoint da imagem sobe um servidor temporário para
 * inicializar o cluster e **reinicia** depois (o log traz "ready to accept
 * connections" duas vezes). Esse temporário roda com `listen_addresses=''` —
 * atende o socket unix, não TCP. Numa medição: socket respondeu em 1492 ms,
 * TCP em 1780 ms, e nessa janela de ~290 ms o seed morria com
 * `FATAL: the database system is shutting down`.
 *
 * `pg_isready` e `psql` pelo socket passam cedo demais. `-h 127.0.0.1` força
 * TCP, que só existe no servidor que vai ficar de pé.
 */
async function esperarPostgres(): Promise<void> {
  const limite = Date.now() + 90_000;
  for (;;) {
    if (psql(["-h", "127.0.0.1", "-tAc", "SELECT 1"]).codigo === 0) return;
    if (Date.now() > limite) throw new Error("Postgres de teste não subiu");
    await Bun.sleep(500);
  }
}

beforeAll(async () => {
  if (!temDocker) return;

  Bun.spawnSync(["docker", "rm", "-f", ORIGEM]);
  Bun.spawnSync([
    "docker", "run", "-d", "--rm", "--name", ORIGEM,
    "-e", `POSTGRES_PASSWORD=${SENHA}`,
    "-p", `${String(PORTA)}:5432`, "postgres:16",
  ]);
  await esperarPostgres();

  // Dados com o que costuma quebrar um dump: aspas simples, acento, NULL,
  // numeric com casas, e uma segunda tabela para provar o multi-tabela.
  const seed = psql(["-v", "ON_ERROR_STOP=1", "-c", `
    CREATE TABLE clientes (
      id serial PRIMARY KEY,
      nome text NOT NULL,
      apelido text,
      saldo numeric(12,2) NOT NULL DEFAULT 0
    );
    INSERT INTO clientes (nome, apelido, saldo) VALUES
      ('O''Brien & Cia', NULL, 1234.56),
      ('Produção Ltda', 'produção', -0.10),
      ('Tab\there', 'quebra
linha', 0);
    CREATE TABLE notas (id serial PRIMARY KEY, cliente_id int NOT NULL, valor numeric(10,2));
    INSERT INTO notas (cliente_id, valor) VALUES (1, 10.00), (2, 20.50);
  `]);
  // Sem esta linha, um seed que falha vira seis testes falhando por
  // "tabela não existe" — o sintoma longe da causa.
  if (seed.codigo !== 0) throw new Error(`seed falhou: ${seed.erro}`);

  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie } = await autenticar(store));

  const res = await app.handle(
    new Request("http://localhost/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "origem", host: "127.0.0.1", port: PORTA, database: "postgres",
        username: "postgres", password: SENHA, sslMode: "disable",
      }),
    }),
  );
  connectionId = ((await res.json()) as { id: string }).id;
}, 180_000);

afterAll(() => {
  if (!temDocker) return;
  Bun.spawnSync(["docker", "rm", "-f", ORIGEM]);
}, 60_000);

describe.if(temDocker)("dump de várias tabelas", () => {
  it("traz estrutura e dados das duas tabelas num arquivo só", async () => {
    const res = await baixarBundle({
      tables: [
        { schema: "public", table: "clientes", structure: true, data: true },
        { schema: "public", table: "notas", structure: true, data: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/sql");

    const texto = await res.text();
    expect(texto).toContain('CREATE TABLE "public"."clientes"');
    expect(texto).toContain('CREATE TABLE "public"."notas"');
    // Aspas simples dobradas, não escapadas com barra.
    expect(texto).toContain("'O''Brien & Cia'");
    expect(texto).toContain("NULL");
    // O cabeçalho diz o que o arquivo NÃO é.
    expect(texto).toContain("NÃO é um pg_dump");
  });

  /**
   * A prova de que serve para alguma coisa: recriar num banco vazio e conferir
   * que as linhas voltaram idênticas.
   */
  it("o arquivo gerado recarrega num banco vazio, com os valores intactos", async () => {
    const res = await baixarBundle({
      tables: [
        { schema: "public", table: "clientes", structure: true, data: true },
        { schema: "public", table: "notas", structure: true, data: true },
      ],
    });
    const dump = await res.text();

    psql(["-c", "DROP DATABASE IF EXISTS restaurado"]);
    psql(["-c", "CREATE DATABASE restaurado"]);

    const caminho = `/tmp/dump-${String(Date.now())}.sql`;
    await Bun.write(caminho, dump);
    Bun.spawnSync(["docker", "cp", caminho, `${ORIGEM}:/tmp/dump.sql`]);

    const carga = Bun.spawnSync([
      "docker", "exec", ORIGEM, "psql", "-U", "postgres", "-d", "restaurado",
      "-v", "ON_ERROR_STOP=1", "-f", "/tmp/dump.sql",
    ]);
    expect(carga.stderr.toString()).not.toContain("ERROR");
    expect(carga.exitCode).toBe(0);

    const conferir = Bun.spawnSync([
      "docker", "exec", ORIGEM, "psql", "-U", "postgres", "-d", "restaurado", "-tAc",
      "SELECT nome || '|' || coalesce(apelido,'<null>') || '|' || saldo FROM clientes ORDER BY id",
    ]);
    const linhas = conferir.stdout.toString().trim().split("\n");
    expect(linhas[0]).toBe("O'Brien & Cia|<null>|1234.56");
    expect(linhas[1]).toBe("Produção Ltda|produção|-0.10");

    const notas = Bun.spawnSync([
      "docker", "exec", ORIGEM, "psql", "-U", "postgres", "-d", "restaurado", "-tAc",
      "SELECT count(*) FROM notas",
    ]);
    expect(notas.stdout.toString().trim()).toBe("2");
  });

  it("só estrutura não emite INSERT; só dados não emite CREATE", async () => {
    const soEstrutura = await (
      await baixarBundle({
        tables: [{ schema: "public", table: "clientes", structure: true, data: false }],
      })
    ).text();
    expect(soEstrutura).toContain("CREATE TABLE");
    expect(soEstrutura).not.toContain("INSERT INTO");

    const soDados = await (
      await baixarBundle({
        tables: [{ schema: "public", table: "clientes", structure: false, data: true }],
      })
    ).text();
    expect(soDados).not.toContain("CREATE TABLE");
    expect(soDados).toContain("INSERT INTO");
  });

  it("DROP+CREATE emite o DROP antes de cada CREATE", async () => {
    const texto = await (
      await baixarBundle({
        dropFirst: true,
        tables: [{ schema: "public", table: "clientes", structure: true, data: false }],
      })
    ).text();
    expect(texto).toContain('DROP TABLE IF EXISTS "public"."clientes" CASCADE;');
    expect(texto.indexOf("DROP TABLE")).toBeLessThan(texto.indexOf("CREATE TABLE"));
  });

  /** `dropFirst` sem estrutura apagaria a tabela e não a recriaria. */
  it("DROP não sai quando a estrutura não foi pedida", async () => {
    const texto = await (
      await baixarBundle({
        dropFirst: true,
        tables: [{ schema: "public", table: "clientes", structure: false, data: true }],
      })
    ).text();
    expect(texto).not.toContain("DROP TABLE");
  });

  it("gzip devolve gzip de verdade, e descomprime no mesmo conteúdo", async () => {
    const res = await baixarBundle({
      gzip: true,
      tables: [{ schema: "public", table: "clientes", structure: true, data: true }],
    });
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("content-disposition")).toContain(".sql.gz");

    const comprimido = new Uint8Array(await res.arrayBuffer());
    // Assinatura do gzip: 0x1f 0x8b.
    expect(comprimido[0]).toBe(0x1f);
    expect(comprimido[1]).toBe(0x8b);

    const texto = new TextDecoder().decode(Bun.gunzipSync(comprimido));
    expect(texto).toContain('CREATE TABLE "public"."clientes"');
    expect(texto).toContain("'O''Brien & Cia'");
  });

  it("tabela inexistente volta 404 em vez de arquivo pela metade", async () => {
    const res = await baixarBundle({
      tables: [{ schema: "public", table: "nao_existe", structure: true, data: true }],
    });
    expect(res.status).toBe(404);
  });

  it("tudo desmarcado é 400, não arquivo vazio", async () => {
    const res = await baixarBundle({
      tables: [{ schema: "public", table: "clientes", structure: false, data: false }],
    });
    expect(res.status).toBe(400);
  });

  it("o dump cai no query_log com a lista de tabelas", async () => {
    await (
      await baixarBundle({
        tables: [{ schema: "public", table: "notas", structure: true, data: true }],
      })
    ).text();

    const linha = store.db
      .query<{ sql: string; row_count: number; read_only: number }, []>(
        "SELECT sql, row_count, read_only FROM query_log ORDER BY executed_at DESC LIMIT 1",
      )
      .get();
    expect(linha?.sql).toContain("public.notas");
    expect(linha?.row_count).toBe(2);
    expect(linha?.read_only).toBe(1);
  });
});
