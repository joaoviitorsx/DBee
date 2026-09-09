import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../app";
import { PoolManager } from "../pg/pool";
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
let pools: PoolManager | undefined;
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
    -- Exatamente EXPORT_BATCH linhas: o gatilho do travamento. Ver o teste
    -- "múltiplo exato de EXPORT_BATCH" abaixo.
    CREATE TABLE lote_exato (id int PRIMARY KEY, texto text NOT NULL);
    INSERT INTO lote_exato SELECT g, 'linha ' || g FROM generate_series(1, 1000) g;

    -- Nomes hostis, todos LEGAIS no Postgres quando citados. O nome da entrada
    -- do zip era \`schema.tabela.ext\` cru, então:
    --   \`ponto\`  + \`b.c\`  e  \`ponto.b\` + \`c\`  dão a MESMA entrada
    --   \`com/barra\` vira um DIRETÓRIO dentro do zip
    CREATE SCHEMA ponto;
    CREATE SCHEMA "ponto.b";
    CREATE TABLE ponto."b.c" (id int PRIMARY KEY, v text);
    INSERT INTO ponto."b.c" VALUES (1, 'sou a b.c');
    CREATE TABLE "ponto.b".c (id int PRIMARY KEY, v text);
    INSERT INTO "ponto.b".c VALUES (1, 'sou a c');
    CREATE TABLE ponto."com/barra" (id int PRIMARY KEY, v text);
    INSERT INTO ponto."com/barra" VALUES (1, 'sou a barra');
  `]);
  // Sem esta linha, um seed que falha vira seis testes falhando por
  // "tabela não existe" — o sintoma longe da causa.
  if (seed.codigo !== 0) throw new Error(`seed falhou: ${seed.erro}`);

  store = openTestStore();
  pools = new PoolManager(undefined);
  app = createApp({ store, caCert: undefined, pools });
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
    // O cabeçalho lista o que de fato entrou nesta geração.
    expect(texto).toContain("Entra: colunas, defaults, NOT NULL, PRIMARY KEY");
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

  it("structure drop-create emite o DROP antes de cada CREATE", async () => {
    const texto = await (
      await baixarBundle({
        structure: "drop-create",
        tables: [{ schema: "public", table: "clientes", structure: true, data: false }],
      })
    ).text();
    expect(texto).toContain('DROP TABLE IF EXISTS "public"."clientes" CASCADE;');
    expect(texto.indexOf("DROP TABLE")).toBeLessThan(texto.indexOf("CREATE TABLE"));
  });

  /** `dropFirst` sem estrutura apagaria a tabela e não a recriaria. */
  it("DROP não sai quando a tabela não pediu estrutura", async () => {
    const texto = await (
      await baixarBundle({
        structure: "drop-create",
        tables: [{ schema: "public", table: "clientes", structure: false, data: true }],
      })
    ).text();
    expect(texto).not.toContain("DROP TABLE");
  });

  it("gzip devolve gzip de verdade, e descomprime no mesmo conteúdo", async () => {
    const res = await baixarBundle({
      output: "gzip",
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

describe.if(temDocker)("formatos", () => {
  const soClientes = { schema: "public", table: "clientes", structure: false, data: true };

  /**
   * A prova do container: um `unzip` de verdade tem que aceitar, e cada tabela
   * tem que virar um arquivo separado com o conteúdo certo.
   */
  it("csv de várias tabelas vira um zip com um arquivo por tabela", async () => {
    const res = await baixarBundle({
      format: "csv",
      tables: [
        { schema: "public", table: "clientes", structure: false, data: true },
        { schema: "public", table: "notas", structure: false, data: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(".zip");

    const dir = mkdtempSync(join(tmpdir(), "dbee-bundle-"));
    const caminho = join(dir, "d.zip");
    await Bun.write(caminho, new Uint8Array(await res.arrayBuffer()));

    expect(Bun.spawnSync(["unzip", "-t", caminho]).stdout.toString()).toContain(
      "No errors detected",
    );
    Bun.spawnSync(["unzip", "-o", "-q", caminho, "-d", dir]);

    const clientes = await Bun.file(join(dir, "public.clientes.csv")).text();
    // Cabeçalho de coluna, separador `;` (padrão Excel pt-BR) e aspas no valor
    // que contém o separador.
    expect(clientes.split("\r\n")[0]).toBe("id;nome;apelido;saldo");
    expect(clientes).toContain("O'Brien & Cia");
    expect(await Bun.file(join(dir, "public.notas.csv")).text()).toContain("id;cliente_id;valor");
  });

  /**
   * Nome de tabela é entrada do usuário, e o nome da entrada do zip era
   * `schema.tabela.ext` cru.
   *
   * Duas tabelas DIFERENTES — `ponto`/`"b.c"` e `"ponto.b"`/`c` — colidiam na
   * mesma entrada. O zip aceita duas entradas homônimas sem reclamar, e o
   * `unzip` sobrescreve: a pessoa pedia duas tabelas e recebia um arquivo, sem
   * aviso nenhum. A barra, por sua vez, virava um DIRETÓRIO dentro do zip.
   */
  it("nomes que colidem viram entradas distintas, e barra não vira diretório", async () => {
    const res = await baixarBundle({
      format: "csv",
      tables: [
        { schema: "ponto", table: "b.c", structure: false, data: true },
        { schema: "ponto.b", table: "c", structure: false, data: true },
        { schema: "ponto", table: "com/barra", structure: false, data: true },
      ],
    });
    expect(res.status).toBe(200);

    const dir = mkdtempSync(join(tmpdir(), "dbee-bundle-hostil-"));
    const caminho = join(dir, "d.zip");
    await Bun.write(caminho, new Uint8Array(await res.arrayBuffer()));

    const listagem = Bun.spawnSync(["unzip", "-Z1", caminho]).stdout.toString();
    const entradas = listagem.split("\n").filter((l) => l.trim() !== "");

    // Três tabelas pedidas, três entradas — e três nomes DIFERENTES.
    expect(entradas).toHaveLength(3);
    expect(new Set(entradas).size).toBe(3);
    // Nenhuma entrada é caminho: barra viraria pasta na extração.
    expect(entradas.filter((e) => e.includes("/"))).toEqual([]);

    // E o conteúdo das duas que colidiam continua sendo o de cada uma.
    Bun.spawnSync(["unzip", "-o", "-q", caminho, "-d", dir]);
    const conteudos = await Promise.all(
      entradas.map(async (e) => await Bun.file(join(dir, e)).text()),
    );
    const juntos = conteudos.join("\n");
    expect(juntos).toContain("sou a b.c");
    expect(juntos).toContain("sou a c");
    expect(juntos).toContain("sou a barra");
  });

  it("csv-comma usa vírgula; tsv usa tabulação", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dbee-bundle-"));

    for (const [format, ext, esperado] of [
      ["csv-comma", "csv", "id,nome,apelido,saldo"],
      ["tsv", "tsv", "id\tnome\tapelido\tsaldo"],
    ] as const) {
      const res = await baixarBundle({ format, tables: [soClientes] });
      const caminho = join(dir, `${format}.zip`);
      await Bun.write(caminho, new Uint8Array(await res.arrayBuffer()));
      Bun.spawnSync(["unzip", "-o", "-q", caminho, "-d", join(dir, format)]);
      const texto = await Bun.file(join(dir, format, `public.clientes.${ext}`)).text();
      expect(texto.split("\r\n")[0]).toBe(esperado);
    }
  });

  it("json é um array válido; ndjson é um objeto por linha", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dbee-bundle-"));

    const jsonRes = await baixarBundle({ format: "json", tables: [soClientes] });
    await Bun.write(join(dir, "j.zip"), new Uint8Array(await jsonRes.arrayBuffer()));
    Bun.spawnSync(["unzip", "-o", "-q", join(dir, "j.zip"), "-d", join(dir, "j")]);
    const bruto = await Bun.file(join(dir, "j", "public.clientes.json")).text();
    const linhas = JSON.parse(bruto) as { nome: string }[];
    expect(linhas).toHaveLength(3);
    expect(linhas[0]?.nome).toBe("O'Brien & Cia");

    const ndRes = await baixarBundle({ format: "ndjson", tables: [soClientes] });
    await Bun.write(join(dir, "n.zip"), new Uint8Array(await ndRes.arrayBuffer()));
    Bun.spawnSync(["unzip", "-o", "-q", join(dir, "n.zip"), "-d", join(dir, "n")]);
    const nd = (await Bun.file(join(dir, "n", "public.clientes.ndjson")).text()).trim().split("\n");
    expect(nd).toHaveLength(3);
    expect((JSON.parse(nd[1] ?? "{}") as { nome: string }).nome).toBe("Produção Ltda");
  });

  /**
   * `COPY` existe porque recarregar milhões de linhas por `INSERT` é lento. Só
   * vale se o arquivo de fato recarregar — é isso que este teste mede.
   */
  it("data=copy gera COPY … FROM stdin, e o arquivo recarrega", async () => {
    const dump = await (
      await baixarBundle({
        data: "copy",
        tables: [{ schema: "public", table: "clientes", structure: true, data: true }],
      })
    ).text();

    expect(dump).toContain("COPY \"public\".\"clientes\" (");
    expect(dump).toContain("FROM stdin;");
    // O terminador do COPY. Sem ele o psql não fecha o bloco.
    expect(dump).toContain("\\.");
    expect(dump).not.toContain("INSERT INTO");

    psql(["-c", "DROP DATABASE IF EXISTS via_copy"]);
    psql(["-c", "CREATE DATABASE via_copy"]);
    const caminho = `/tmp/copy-${String(Date.now())}.sql`;
    await Bun.write(caminho, dump);
    Bun.spawnSync(["docker", "cp", caminho, `${ORIGEM}:/tmp/copy.sql`]);

    const carga = Bun.spawnSync([
      "docker", "exec", ORIGEM, "psql", "-U", "postgres", "-d", "via_copy",
      "-v", "ON_ERROR_STOP=1", "-f", "/tmp/copy.sql",
    ]);
    expect(carga.stderr.toString()).not.toContain("ERROR");

    const conferir = Bun.spawnSync([
      "docker", "exec", ORIGEM, "psql", "-U", "postgres", "-d", "via_copy", "-tAc",
      "SELECT nome || '|' || saldo FROM clientes ORDER BY id LIMIT 1",
    ]);
    expect(conferir.stdout.toString().trim()).toBe("O'Brien & Cia|1234.56");
  });

  it("data=insert-conflict acrescenta ON CONFLICT DO NOTHING", async () => {
    const dump = await (
      await baixarBundle({ data: "insert-conflict", tables: [soClientes] })
    ).text();
    expect(dump).toContain("ON CONFLICT DO NOTHING");
  });

  it("índices e triggers saem quando pedidos", async () => {
    psql(["-c", "CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes (nome)"]);
    const dump = await (
      await baixarBundle({
        indexes: true,
        tables: [{ schema: "public", table: "clientes", structure: true, data: false }],
      })
    ).text();
    expect(dump).toContain("CREATE INDEX idx_clientes_nome");

    const sem = await (
      await baixarBundle({
        tables: [{ schema: "public", table: "clientes", structure: true, data: false }],
      })
    ).text();
    expect(sem).not.toContain("idx_clientes_nome");
  });

  it("funções saem quando pedidas", async () => {
    psql(["-c", "CREATE OR REPLACE FUNCTION dobro(x int) RETURNS int LANGUAGE sql AS 'SELECT x*2'"]);
    const dump = await (
      await baixarBundle({
        routines: true,
        tables: [{ schema: "public", table: "clientes", structure: true, data: false }],
      })
    ).text();
    expect(dump).toContain("FUNCTION public.dobro");
  });

  /** A prévia existe para conferir o começo sem gerar um arquivo de 2 GB. */
  it("preview volta como texto e é cortada no teto", async () => {
    const res = await baixarBundle({
      output: "preview",
      tables: [{ schema: "public", table: "clientes", structure: true, data: true }],
    });
    expect(res.headers.get("content-type")).toContain("text/plain");
    const texto = await res.text();
    expect(texto).toContain("CREATE TABLE");
    expect(texto.length).toBeLessThanOrEqual(256 * 1024);
  });
});

/**
 * O travamento do stream, e por que ele não é "lentidão".
 *
 * Uma tabela com **múltiplo exato** de `EXPORT_BATCH` linhas força um `FETCH`
 * final que volta com zero. Nesse passo o caminho `sql` + `insert` não tem nada
 * a emitir — o `fecharTabela` do recipiente SQL é `null` — e também não fecha o
 * stream; um `pull` que volta sem enfileirar e sem fechar nunca é chamado de
 * novo.
 *
 * O que quebrava não era a resposta: era o **pool**. `aoTerminar` nunca rodava,
 * logo o `encerrar` do `withStreamingTransaction` nunca rodava, o lease ficava
 * preso, o `sweep()` pula pools com lease por desenho, e sobrava uma transação
 * `REPEATABLE READ` pendurada no banco do cliente segurando o horizonte do
 * VACUUM. Três exports e aquele par conexão+database ficava morto até o
 * processo reiniciar.
 *
 * As fixtures antigas tinham 2 e 3 linhas, então nenhum teste chegava a um
 * `FETCH` de zero.
 */
describe.if(temDocker)("múltiplo exato de EXPORT_BATCH", () => {
  it("o export .sql termina — e traz as 1000 linhas", async () => {
    const res = await baixarBundle({
      tables: [{ schema: "public", table: "lote_exato", structure: true, data: true }],
      format: "sql",
      data: "insert",
    });
    expect(res.status).toBe(200);

    // O `text()` só resolve quando o stream fecha. Antes da correção ele
    // pendurava aqui até o timeout do teste.
    const texto = await res.text();
    expect(texto).toContain('CREATE TABLE "public"."lote_exato"');
    expect((texto.match(/INSERT INTO/g) ?? []).length).toBe(1000);
    expect(texto).toContain("linha 1000");
  }, 30_000);

  /**
   * A consequência que dói: o lease tem de voltar. Sem isso o terceiro export
   * esgota o pool e a conexão fica inutilizável.
   */
  it("três exports seguidos continuam funcionando — o lease volta ao pool", async () => {
    for (const tentativa of [1, 2, 3]) {
      const res = await baixarBundle({
        tables: [{ schema: "public", table: "lote_exato", structure: false, data: true }],
        format: "sql",
        data: "insert",
      });
      const texto = await res.text();
      expect(`tentativa ${String(tentativa)}: ${String((texto.match(/INSERT INTO/g) ?? []).length)}`)
        .toBe(`tentativa ${String(tentativa)}: 1000`);
    }

    // E a conexão segue viva para outra coisa depois dos três.
    const depois = await baixarBundle({
      tables: [{ schema: "public", table: "notas", structure: false, data: true }],
      format: "sql",
      data: "insert",
    });
    expect(depois.status).toBe(200);
    expect(await depois.text()).toContain("INSERT INTO");
  }, 60_000);

  /** Os outros formatos escapavam por acidente; que continuem escapando. */
  it("zip e json também terminam com múltiplo exato", async () => {
    for (const format of ["csv", "json"] as const) {
      const res = await baixarBundle({
        tables: [{ schema: "public", table: "lote_exato", structure: false, data: true }],
        format,
      });
      expect(`${format}: ${String(res.status)}`).toBe(`${format}: 200`);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  }, 30_000);
});
