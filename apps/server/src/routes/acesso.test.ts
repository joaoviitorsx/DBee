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
 * **Varredura de `app.routes`, não lista escrita à mão.**
 *
 * A lista à mão que estava aqui protegia as rotas que alguém lembrou de
 * escrever — e a que vazava era justamente a esquecida. Ela tinha seis
 * ausentes (`/history`, `/query/cancel`, os dois de export, os três de
 * mutação) e, pior, um **falso positivo**: `POST /connections/:id/rows`, que
 * não existe. A leitura de linhas é `/tables/:schema/:table/rows`. O 404 que a
 * asserção comemorava vinha do roteador, não da negação de acesso — a rota real
 * ficava sem cobertura enquanto o teste dizia o contrário.
 *
 * `GET /connections/:id/history` foi encontrado por uma varredura destas, não
 * por leitura. Ela pega a próxima sozinha.
 */
const CORPO_POR_ROTA: Readonly<Record<string, unknown>> = {
  "POST /api/connections/:id/query": { database: "postgres", sql: "SELECT 1" },
  "POST /api/connections/:id/query/cancel": { queryId: "00000000-0000-4000-8000-000000000000" },
  "POST /api/connections/:id/tables/:schema/:table/rows": { database: "postgres", limit: 10 },
  /*
   * Os corpos precisam ser **válidos pelo schema**. Um corpo inválido volta 422
   * antes de a autorização ser consultada, e a asserção passaria sem exercitar
   * nada — o mesmo vício do falso positivo que este arquivo acabou de perder.
   */
  "POST /api/connections/:id/rows/update": {
    // `readOnly: false` é a intenção de escrita explícita que o schema
    // exige (§6): campo ausente significa o estado seguro.
    database: "postgres", schema: "public", table: "t", readOnly: false,
    pk: [{ column: "id", value: "1" }],
    changes: [{ column: "a", from: "1", to: "2" }],
  },
  "POST /api/connections/:id/rows/delete": {
    // `readOnly: false` é a intenção de escrita explícita que o schema
    // exige (§6): campo ausente significa o estado seguro.
    database: "postgres", schema: "public", table: "t", readOnly: false,
    pk: [{ column: "id", value: "1" }],
    guard: [],
  },
  "POST /api/connections/:id/rows/insert": {
    // `readOnly: false` é a intenção de escrita explícita que o schema
    // exige (§6): campo ausente significa o estado seguro.
    database: "postgres", schema: "public", table: "t", readOnly: false,
    values: [{ column: "a", value: "1" }],
  },
  "POST /api/connections/:id/ddl/table": {
    database: "postgres", schema: "public", name: "t",
    columns: [{ name: "a", type: "integer" }],
  },
  "POST /api/connections/:id/ddl/database": { name: "novo_banco" },
  "POST /api/connections/:id/export": {
    database: "postgres",
    source: { kind: "table", schema: "public", table: "t" },
    format: "csv",
  },
  "POST /api/connections/:id/export/bundle": {
    database: "postgres",
    tables: [{ schema: "public", table: "t", structure: true, data: true }],
  },
  "POST /api/connections/:id/test": {},
  "PUT /api/connections/:id/access": { userId: "x", canWrite: false },
};

/**
 * Rotas com `:id` de conexão que **não** são de acesso do member.
 *
 * `PATCH`/`DELETE` da conexão e as três de `/access` são administrativas — a
 * resposta certa ali é 403 (`admin_required`), não 404, e elas têm teste
 * próprio no bloco "administrar conexão é de admin".
 */
const ADMINISTRATIVAS = new Set([
  "PATCH /api/connections/:id",
  "DELETE /api/connections/:id",
  "GET /api/connections/:id/access",
  "PUT /api/connections/:id/access",
  "DELETE /api/connections/:id/access/:userId",
]);

describe("um member sem concessão não alcança a conexão", () => {
  it("NENHUMA rota com :id de conexão responde 2xx — varrendo app.routes", async () => {
    const conexao = await criarConexao("producao", true);
    const ana = await membro("ana");

    const comId = app.routes
      .map((r) => ({ metodo: r.method, path: r.path, chave: `${r.method} ${r.path}` }))
      .filter((r) => r.path.includes("/connections/:id") && !ADMINISTRATIVAS.has(r.chave));

    // Se isto cair, alguém removeu rotas — ou a varredura parou de enxergá-las.
    expect(comId.length).toBeGreaterThanOrEqual(10);

    for (const rota of comId) {
      const caminho = rota.path
        .replace(":id", conexao.id)
        .replace(":schema", "public")
        .replace(":table", "t")
        .replace(":userId", ana.id);
      const corpo = CORPO_POR_ROTA[rota.chave];
      const res = await chamar(rota.metodo, caminho.replace(/^\/api/, ""), ana.cookie, corpo);

      /*
       * 404 é a resposta certa: indistinguível de "não existe", porque dizer
       * "existe, mas não é sua" confirmaria o id a quem não deveria saber.
       *
       * E **422 não vale**: significa que o schema recusou o corpo antes de a
       * autorização ser consultada, ou seja, a rota não foi exercitada. Quem
       * vir esta falha deve corrigir o corpo em `CORPO_POR_ROTA`, não relaxar a
       * asserção.
       */
      expect(`${rota.chave} -> ${String(res.status)}`).toBe(`${rota.chave} -> 404`);
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
