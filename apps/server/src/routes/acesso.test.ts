import { beforeEach, describe, expect, it } from "bun:test";

import { SESSION_COOKIE, type Connection, type SessionUser } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { autenticar } from "../test/sessao";

/**
 * Permissão por conexão (migração 005).
 *
 * ## O que este arquivo existe para provar
 *
 * Que a autorização é **por caminho, não por tela**. Filtrar a listagem é a
 * parte fácil e a parte que não protege: quem conhece um id de conexão pode
 * chamar `/connections/:id/query` direto, e ids vazam com facilidade — pelo
 * `saved_queries.connectionId`, pela auditoria, pelo histórico.
 *
 * Por isso o teste central aqui **varre todas as rotas que recebem id de
 * conexão** e exige 404 para quem não tem concessão. Uma rota nova que esqueça
 * de resolver pelo ator cai aqui, não em produção.
 *
 * ## Por que 404 e não 403
 *
 * Responder "existe, mas não é sua" confirma a existência de um id a quem não
 * deveria saber. `resolve()` devolve `null` nos dois casos e todo chamador já
 * tratava `null` como 404 — a indistinção é de graça e é a resposta certa.
 */

let store: Store;
let app: ReturnType<typeof createApp>;
let adminCookie = "";

const chamar = (
  metodo: string,
  caminho: string,
  cookie: string,
  corpo?: unknown,
): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/api${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    }),
  );

/** Uma conta `member` já logada e fora do estado de troca de senha. */
async function membro(username: string): Promise<{ id: string; cookie: string }> {
  const res = await chamar("POST", "/users", adminCookie, {
    username,
    temporaryPassword: "provisoria-1234",
    role: "member",
  });
  expect(res.status).toBe(201);
  const criado = (await res.json()) as SessionUser;

  const users = new UsersRepository(store.db);
  users.trocarSenha(criado.id, await Bun.password.hash("senha-real-12345"));
  const { token } = users.abrirSessao(criado.id);
  return { id: criado.id, cookie: `${SESSION_COOKIE}=${token}` };
}

async function criarConexao(nome: string, writeEnabled: boolean): Promise<Connection> {
  const res = await chamar("POST", "/connections", adminCookie, {
    name: nome,
    host: "127.0.0.1",
    port: 5432,
    database: "postgres",
    username: "postgres",
    password: "seg-red-o-1234",
    sslMode: "disable",
    writeEnabled,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Connection;
}

beforeEach(async () => {
  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie: adminCookie } = await autenticar(store));
});

/**
 * Toda rota que recebe id de conexão. **Manter em dia é o ponto do arquivo.**
 *
 * O corpo não precisa ser válido: a recusa por acesso acontece antes de a
 * requisição chegar ao Postgres, e é isso que estamos medindo. Onde o schema
 * recusaria o corpo (422) antes do acesso, o corpo aqui é válido de propósito.
 */
const ROTAS: readonly [string, (id: string) => string, unknown?][] = [
  ["GET", (id) => `/connections/${id}/databases`, undefined],
  ["GET", (id) => `/connections/${id}/databases/overview`, undefined],
  ["GET", (id) => `/connections/${id}/activity`, undefined],
  ["GET", (id) => `/connections/${id}/schema?database=postgres`, undefined],
  ["GET", (id) => `/connections/${id}/schema/tree?database=postgres`, undefined],
  ["POST", (id) => `/connections/${id}/test`, {}],
  ["POST", (id) => `/connections/${id}/query`, { database: "postgres", sql: "SELECT 1" }],
  [
    "POST",
    (id) => `/connections/${id}/rows`,
    { database: "postgres", schema: "public", table: "t", limit: 10 },
  ],
  [
    "POST",
    (id) => `/connections/${id}/ddl/table`,
    { database: "postgres", schema: "public", name: "t", columns: [{ name: "a", type: "integer" }] },
  ],
  ["POST", (id) => `/connections/${id}/ddl/database`, { name: "novo_banco" }],
];

describe("um member sem concessão não alcança a conexão", () => {
  it("todas as rotas com id respondem 404 — nenhuma vaza pelo id", async () => {
    const conexao = await criarConexao("producao", true);
    const ana = await membro("ana");

    for (const [metodo, caminho, corpo] of ROTAS) {
      const url = caminho(conexao.id);
      const res = await chamar(metodo, url, ana.cookie, corpo);
      // A string na asserção faz a falha nomear a rota culpada.
      expect(`${metodo} ${url} -> ${String(res.status)}`).toBe(`${metodo} ${url} -> 404`);
    }
  });

  it("e a conexão nem aparece na listagem dela", async () => {
    await criarConexao("producao", true);
    const ana = await membro("ana");

    const lista = (await (await chamar("GET", "/connections", ana.cookie)).json()) as Connection[];
    expect(lista).toEqual([]);

    // O admin continua vendo — ele administra as conexões.
    const doAdmin = (await (
      await chamar("GET", "/connections", adminCookie)
    ).json()) as Connection[];
    expect(doAdmin).toHaveLength(1);
  });
});

describe("com concessão, o member alcança — e só até onde foi concedido", () => {
  it("acesso de leitura numa conexão gravável não permite escrever", async () => {
    // A conexão **pode** ser escrita; a pessoa **não** pode. As duas pontas.
    const conexao = await criarConexao("producao", true);
    const ana = await membro("ana");

    expect(
      (
        await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
          userId: ana.id,
          canWrite: false,
        })
      ).status,
    ).toBe(200);

    // Agora ela vê a conexão…
    const lista = (await (await chamar("GET", "/connections", ana.cookie)).json()) as Connection[];
    expect(lista).toHaveLength(1);

    // …e o `writeEnabled` que ela recebe é o EFETIVO, já rebaixado. É esse
    // campo que as três portas de escrita leem, então rebaixá-lo aqui fecha
    // todas de uma vez, sem checagem espalhada.
    expect(lista[0]?.writeEnabled).toBe(false);

    // O admin continua vendo a conexão como gravável — a conexão não mudou.
    const doAdmin = (await (
      await chamar("GET", "/connections", adminCookie)
    ).json()) as Connection[];
    expect(doAdmin[0]?.writeEnabled).toBe(true);
  });

  it("com can_write, o writeEnabled efetivo volta a ser o da conexão", async () => {
    const conexao = await criarConexao("producao", true);
    const ana = await membro("ana");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: ana.id,
      canWrite: true,
    });

    const lista = (await (await chamar("GET", "/connections", ana.cookie)).json()) as Connection[];
    expect(lista[0]?.writeEnabled).toBe(true);
  });

  /** `can_write` não cria escrita onde a conexão não permite. */
  it("can_write numa conexão somente-leitura não habilita escrita", async () => {
    const conexao = await criarConexao("leitura", false);
    const ana = await membro("ana");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: ana.id,
      canWrite: true,
    });

    const lista = (await (await chamar("GET", "/connections", ana.cookie)).json()) as Connection[];
    expect(lista[0]?.writeEnabled).toBe(false);
  });

  it("revogar devolve a conexão ao estado invisível", async () => {
    const conexao = await criarConexao("producao", true);
    const ana = await membro("ana");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: ana.id,
      canWrite: false,
    });
    expect(
      ((await (await chamar("GET", "/connections", ana.cookie)).json()) as Connection[]).length,
    ).toBe(1);

    expect(
      (await chamar("DELETE", `/connections/${conexao.id}/access/${ana.id}`, adminCookie)).status,
    ).toBe(200);

    expect(
      ((await (await chamar("GET", "/connections", ana.cookie)).json()) as Connection[]).length,
    ).toBe(0);
    expect((await chamar("GET", `/connections/${conexao.id}/databases`, ana.cookie)).status).toBe(
      404,
    );
  });
});

describe("administrar conexão é de admin", () => {
  it("member não cria, não edita e não apaga conexão", async () => {
    const conexao = await criarConexao("producao", true);
    const ana = await membro("ana");
    // Mesmo COM acesso concedido: usar não é administrar.
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: ana.id,
      canWrite: true,
    });

    const criar = await chamar("POST", "/connections", ana.cookie, {
      name: "minha", host: "h", port: 5432, database: "d", username: "u",
      password: "seg-red-o-1234", sslMode: "disable", writeEnabled: true,
    });
    expect(criar.status).toBe(403);

    const editar = await chamar("PATCH", `/connections/${conexao.id}`, ana.cookie, {
      host: "servidor-do-atacante",
    });
    expect(editar.status).toBe(403);

    const apagar = await chamar("DELETE", `/connections/${conexao.id}`, ana.cookie);
    expect(apagar.status).toBe(403);

    // E o host não mudou — a recusa não foi só de status.
    const doAdmin = (await (
      await chamar("GET", "/connections", adminCookie)
    ).json()) as Connection[];
    expect(doAdmin[0]?.host).toBe("127.0.0.1");
  });

  it("member não lê nem altera as concessões", async () => {
    const conexao = await criarConexao("producao", true);
    const ana = await membro("ana");
    await chamar("PUT", `/connections/${conexao.id}/access`, adminCookie, {
      userId: ana.id,
      canWrite: false,
    });

    expect((await chamar("GET", `/connections/${conexao.id}/access`, ana.cookie)).status).toBe(403);

    // O caminho que importa: não dá para se promover a si mesma.
    const autoPromover = await chamar("PUT", `/connections/${conexao.id}/access`, ana.cookie, {
      userId: ana.id,
      canWrite: true,
    });
    expect(autoPromover.status).toBe(403);

    const lista = (await (await chamar("GET", "/connections", ana.cookie)).json()) as Connection[];
    expect(lista[0]?.writeEnabled).toBe(false);
  });
});

describe("auditoria segue a visibilidade", () => {
  it("member não lê no log o SQL de conexão que não enxerga", async () => {
    const visivel = await criarConexao("visivel", false);
    const oculta = await criarConexao("oculta", false);
    const ana = await membro("ana");
    await chamar("PUT", `/connections/${visivel.id}/access`, adminCookie, {
      userId: ana.id,
      canWrite: false,
    });

    for (const [id, sql] of [
      [visivel.id, "SELECT 'pode ver'"],
      [oculta.id, "SELECT 'segredo do outro cliente'"],
    ] as const) {
      store.db.run(
        `INSERT INTO query_log (id, connection_id, database, sql, status, read_only, actor, executed_at)
         VALUES (?, ?, 'postgres', ?, 'ok', 1, 'outro', ?)`,
        [`q-${id}`, id, sql, new Date().toISOString()],
      );
    }

    const bruto = await (await chamar("GET", "/audit", ana.cookie)).text();
    expect(bruto).toContain("pode ver");
    expect(bruto).not.toContain("segredo do outro cliente");

    // O admin vê os dois.
    const doAdmin = await (await chamar("GET", "/audit", adminCookie)).text();
    expect(doAdmin).toContain("pode ver");
    expect(doAdmin).toContain("segredo do outro cliente");
  });
});
