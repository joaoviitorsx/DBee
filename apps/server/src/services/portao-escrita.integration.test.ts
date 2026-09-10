import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";
import { SESSION_COOKIE, type Connection, type SessionUser } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { autenticar } from "../test/sessao";

/**
 * O portão de escrita nas engines cuja garantia é a **credencial**.
 *
 * ## O buraco que este arquivo existe para não deixar voltar
 *
 * No Postgres, `BEGIN READ ONLY` recusa a escrita: quem não tem concessão
 * simplesmente não consegue escrever. No MySQL não há nada disso, e o portão do
 * DBee — `write_enabled` da conexão mais `can_write` da concessão — só decidia
 * se mandava `somenteLeitura: false` ao driver. Como nenhuma escrita no MySQL
 * precisa disso, **o portão nunca era atravessado: era contornado**.
 *
 * Medido antes da correção, pelo app inteiro: um `member` com
 * `canWrite: false` executou `INSERT` e `DROP TABLE` pelo editor de SQL, e a
 * resposta ainda dizia `readOnly: true`.
 *
 * A correção não recusa tudo — isso mataria o uso legítimo de quem conectou com
 * `GRANT SELECT`. Ela pergunta ao servidor se **a credencial** grava, e só
 * então exige a concessão. A grade de linhas continua livre nos dois casos:
 * o SQL dela é montado pelo DBee e é leitura por construção.
 */

const CONTAINER = "dbee-portao-it";
const PORTA = 55531;
const SENHA = "Pt7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let app: ReturnType<typeof createApp>;
let store: Store;
let adminCookie = "";

const chamar = (metodo: string, caminho: string, cookie: string, corpo?: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/api${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    }),
  );

async function membro(username: string): Promise<{ id: string; cookie: string }> {
  const res = await chamar("POST", "/users", adminCookie, {
    username, temporaryPassword: "provisoria-1234", role: "member",
  });
  const criado = (await res.json()) as SessionUser;
  const users = new UsersRepository(store.db);
  users.trocarSenha(criado.id, await Bun.password.hash("senha-real-12345"));
  const { token } = users.abrirSessao(criado.id);
  return { id: criado.id, cookie: `${SESSION_COOKIE}=${token}` };
}

/** Cria a conexão com a credencial pedida e devolve o id. */
async function conexaoMysql(nome: string, usuario: string, senha: string): Promise<Connection> {
  const res = await chamar("POST", "/connections", adminCookie, {
    name: nome, engine: "mysql",
    host: "127.0.0.1", port: PORTA, database: "loja",
    username: usuario, password: senha, sslMode: "disable",
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Connection;
}

/** Conexão com credencial de leitura E de escrita separadas. */
async function conexaoComEscrita(
  nome: string,
  usuarioRo: string,
  usuarioRw: string,
): Promise<Connection> {
  const res = await chamar("POST", "/connections", adminCookie, {
    name: nome, engine: "mysql",
    host: "127.0.0.1", port: PORTA, database: "loja",
    username: usuarioRo, password: SENHA, sslMode: "disable",
    writeUsername: usuarioRw, writePassword: SENHA,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Connection;
}

/** Conta linhas de `clientes` por fora do app, com root. */
async function contarClientes(): Promise<number> {
  const c = await mysql.createConnection({
    host: "127.0.0.1", port: PORTA, user: "root", password: SENHA, database: "loja",
  });
  const [linhas] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM clientes");
  await c.end();
  return Number((linhas as unknown as { n: unknown }[])[0]?.n);
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER,
    "-e", `MYSQL_ROOT_PASSWORD=${SENHA}`, "-e", "MYSQL_DATABASE=loja",
    "-p", `${String(PORTA)}:3306`, "mysql:8.4");

  for (let i = 0; i < 120; i++) {
    try {
      const c = await mysql.createConnection({
        host: "127.0.0.1", port: PORTA, user: "root", password: SENHA,
        database: "loja", connectTimeout: 1000,
      });
      await c.query("CREATE TABLE clientes (id INT PRIMARY KEY, nome VARCHAR(60))");
      await c.query("INSERT INTO clientes VALUES (1,'Ana'),(2,'Bruno')");
      // Duas credenciais: uma que grava e uma que não.
      await c.query(`CREATE USER 'grava'@'%' IDENTIFIED BY '${SENHA}'`);
      await c.query("GRANT SELECT, INSERT, UPDATE, DELETE, DROP ON loja.* TO 'grava'@'%'");
      await c.query(`CREATE USER 'so_le'@'%' IDENTIFIED BY '${SENHA}'`);
      await c.query("GRANT SELECT ON loja.* TO 'so_le'@'%'");
      await c.query("FLUSH PRIVILEGES");
      await c.end();
      break;
    } catch { await Bun.sleep(500); }
  }

  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie: adminCookie } = await autenticar(store));
}, 300_000);

afterAll(() => {
  sh("docker", "rm", "-f", CONTAINER);
});

describe("portão de escrita numa engine de credencial", () => {
  /*
   * O caso do achado. A conexão usa uma credencial que grava; o member não tem
   * concessão. Antes da correção isto executava e apagava a tabela.
   */
  it("member sem concessão NÃO executa SQL livre quando a credencial grava", async () => {
    if (!temDocker) return;
    const conexao = await conexaoMysql("grava", "grava", SENHA);
    const m = await membro("sem-escrita");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: m.id, canWrite: false,
    });

    const res = await chamar("POST", `/connections/${conexao.id}/query`, m.cookie, {
      sql: "INSERT INTO clientes VALUES (99,'Invasor')",
      database: "loja",
    });
    expect(res.status, "o INSERT do member passou").toBe(400);
    const corpo = (await res.json()) as { message: string };
    // A mensagem tem que dizer o que fazer, senão vira ticket.
    expect(corpo.message).toContain("concessão de escrita");
    expect(corpo.message).toContain("grade de linhas");

    // E a tabela continua com as duas linhas originais.
    const c = await mysql.createConnection({
      host: "127.0.0.1", port: PORTA, user: "root", password: SENHA, database: "loja",
    });
    const [linhas] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM clientes");
    await c.end();
    expect(Number((linhas as unknown as { n: unknown }[])[0]?.n)).toBe(2);
  }, 180_000);

  it("o DROP TABLE do member também é barrado, e a tabela sobrevive", async () => {
    if (!temDocker) return;
    const conexao = await conexaoMysql("grava2", "grava", SENHA);
    const m = await membro("sem-escrita-2");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: m.id, canWrite: false,
    });
    const res = await chamar("POST", `/connections/${conexao.id}/query`, m.cookie, {
      sql: "DROP TABLE clientes", database: "loja",
    });
    expect(res.status).toBe(400);

    const c = await mysql.createConnection({
      host: "127.0.0.1", port: PORTA, user: "root", password: SENHA, database: "loja",
    });
    const [t] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='loja' AND TABLE_NAME='clientes'",
    );
    await c.end();
    expect(Number((t as unknown as { n: unknown }[])[0]?.n), "a tabela foi dropada").toBe(1);
  }, 180_000);

  /*
   * A outra metade: recusar sempre mataria o uso legítimo. Quem conectou com
   * `GRANT SELECT` está seguro pela credencial e deve poder consultar.
   */
  it("credencial só de leitura: o member consulta normalmente, sem concessão", async () => {
    if (!temDocker) return;
    const conexao = await conexaoMysql("so-le", "so_le", SENHA);
    const m = await membro("leitor");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: m.id, canWrite: false,
    });
    const res = await chamar("POST", `/connections/${conexao.id}/query`, m.cookie, {
      sql: "SELECT nome FROM clientes ORDER BY id", database: "loja",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const corpo = (await res.json()) as { results: { rows: string[][] }[] };
    expect(corpo.results[0]?.rows.map((l) => l[0])).toEqual(["Ana", "Bruno"]);
  }, 180_000);

  it("com concessão de escrita, o member executa na credencial gravável", async () => {
    if (!temDocker) return;
    const conexao = await conexaoMysql("grava3", "grava", SENHA);
    const m = await membro("com-escrita");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: m.id, canWrite: true,
    });
    const res = await chamar("POST", `/connections/${conexao.id}/query`, m.cookie, {
      sql: "SELECT COUNT(*) FROM clientes", database: "loja",
    });
    expect(res.status, await res.clone().text()).toBe(200);
  }, 180_000);

  /*
   * A grade não passa pelo portão porque não precisa: o SQL dela é montado pelo
   * DBee. Bloqueá-la junto seria punir a leitura por causa da escrita.
   */
  it("a grade de linhas continua disponível para quem não tem concessão", async () => {
    if (!temDocker) return;
    const conexao = await conexaoMysql("grava4", "grava", SENHA);
    const m = await membro("so-grade");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: m.id, canWrite: false,
    });
    const res = await chamar("POST", `/connections/${conexao.id}/tables/loja/clientes/rows`, m.cookie, {
      database: "loja", limit: 10,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const corpo = (await res.json()) as { rows: string[][] };
    expect(corpo.rows).toHaveLength(2);
  }, 180_000);

  /*
   * A auditoria tem que dizer a verdade. Antes, `DROP TABLE` executado ficava
   * gravado com `read_only: true` — e quem auditasse filtrando por
   * `read_only = 0` não acharia a alteração.
   */
  it("a auditoria não carimba leitura numa engine sem transação protegida", async () => {
    if (!temDocker) return;
    const conexao = await conexaoMysql("aud", "so_le", SENHA);
    await chamar("POST", `/connections/${conexao.id}/query`, adminCookie, {
      sql: "SELECT 1", database: "loja",
    });
    const hist = await chamar("GET", `/connections/${conexao.id}/history`, adminCookie);
    const linhas = (await hist.json()) as { entries?: { readOnly: boolean }[] } | { readOnly: boolean }[];
    const lista = Array.isArray(linhas) ? linhas : (linhas.entries ?? []);
    expect(lista.length).toBeGreaterThan(0);
    for (const l of lista) {
      expect(l.readOnly, "MySQL não tem transação somente-leitura; o log não pode dizer que tinha").toBe(false);
    }
  }, 180_000);
});

describe("credencial de escrita numa engine de credencial", () => {
  /*
   * O caminho que a fase destrava. A conexão lê com `so_le` (só SELECT) e tem
   * uma credencial de escrita `grava`. O admin pede escrita explícita
   * (`readOnly: false`), e ela executa **pela credencial de escrita** — a de
   * leitura sozinha não conseguiria.
   */
  it("com credencial de escrita, o admin grava e a linha aparece", async () => {
    if (!temDocker) return;
    const antes = await contarClientes();
    const conexao = await conexaoComEscrita("rw-admin", "so_le", "grava");
    expect(conexao.hasWriteCredential).toBe(true);

    const res = await chamar("POST", `/connections/${conexao.id}/query`, adminCookie, {
      sql: "INSERT INTO clientes VALUES (50,'Gravada')",
      database: "loja", readOnly: false,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await contarClientes()).toBe(antes + 1);

    // Limpa para não interferir na contagem de outros testes.
    const c = await mysql.createConnection({
      host: "127.0.0.1", port: PORTA, user: "root", password: SENHA, database: "loja",
    });
    await c.query("DELETE FROM clientes WHERE id = 50");
    await c.end();
  }, 180_000);

  /*
   * A leitura continua pela credencial de leitura, mesmo havendo a de escrita:
   * sem `readOnly: false`, nada é gravado. É a promessa "nada muda por
   * acidente" — a credencial de escrita só entra quando pedida.
   */
  it("sem pedir escrita, a credencial de escrita não é usada", async () => {
    if (!temDocker) return;
    const antes = await contarClientes();
    const conexao = await conexaoComEscrita("rw-leitura", "so_le", "grava");
    // Uma consulta de leitura comum, sem readOnly: false.
    const res = await chamar("POST", `/connections/${conexao.id}/query`, adminCookie, {
      sql: "SELECT COUNT(*) FROM clientes", database: "loja",
    });
    expect(res.status).toBe(200);
    expect(await contarClientes()).toBe(antes);
  }, 180_000);

  /*
   * O portão ainda vale: um member sem concessão não grava, mesmo existindo a
   * credencial de escrita. A concessão do ator é a segunda tranca.
   */
  it("member sem concessão não grava, mesmo com credencial de escrita presente", async () => {
    if (!temDocker) return;
    const antes = await contarClientes();
    const conexao = await conexaoComEscrita("rw-member", "so_le", "grava");
    const m = await membro("rw-sem-concessao");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: m.id, canWrite: false,
    });
    const res = await chamar("POST", `/connections/${conexao.id}/query`, m.cookie, {
      sql: "INSERT INTO clientes VALUES (51,'Intruso')",
      database: "loja", readOnly: false,
    });
    // Sem concessão, o pedido de escrita é rebaixado a leitura, e o portão da
    // credencial gravável barra o SQL livre.
    expect(res.status).toBe(400);
    expect(await contarClientes()).toBe(antes);
  }, 180_000);

  /*
   * Member COM concessão grava — a concessão mais a credencial de escrita, as
   * duas presentes.
   */
  it("member com concessão grava pela credencial de escrita", async () => {
    if (!temDocker) return;
    const antes = await contarClientes();
    const conexao = await conexaoComEscrita("rw-member-ok", "so_le", "grava");
    const m = await membro("rw-com-concessao");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: m.id, canWrite: true,
    });
    const res = await chamar("POST", `/connections/${conexao.id}/query`, m.cookie, {
      sql: "INSERT INTO clientes VALUES (52,'Autorizado')",
      database: "loja", readOnly: false,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await contarClientes()).toBe(antes + 1);

    const c = await mysql.createConnection({
      host: "127.0.0.1", port: PORTA, user: "root", password: SENHA, database: "loja",
    });
    await c.query("DELETE FROM clientes WHERE id = 52");
    await c.end();
  }, 180_000);
});
