import { beforeEach, describe, expect, it } from "bun:test";

import { SESSION_COOKIE, type SessionUser, type UserSummary } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { UsersService } from "../services/users.service";
import { autenticar } from "../test/sessao";

/**
 * Administração de contas (DBee.md §9, v0.2).
 *
 * O que este arquivo existe para provar não é que a tela funciona — é que a
 * **API** recusa sozinha. Um `member` que monte a requisição à mão não passa
 * por tela nenhuma, e é esse o caminho que precisa estar fechado.
 *
 * As travas de "último admin" e "própria conta" também são testadas aqui, e não
 * por serem elegantes: chegar a zero administradores deixa a instalação sem
 * conserto pela interface, porque a tela que consertaria é a que exige admin.
 */

let store: Store;
let app: ReturnType<typeof createApp>;
let adminCookie = "";
let adminId = "";

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

/** Cria uma conta pela API e devolve um cookie já logado para ela. */
async function contaCom(role: "admin" | "member", username: string): Promise<{
  id: string;
  cookie: string;
}> {
  const res = await chamar("POST", "/users", adminCookie, {
    username,
    temporaryPassword: "provisoria-1234",
    role,
  });
  expect(res.status).toBe(201);
  const criado = (await res.json()) as SessionUser;

  // A conta nasce com troca obrigatória; para exercitar as rotas de
  // administração o teste precisa dela **fora** desse estado — que é assunto do
  // `auth.test.ts`, não daqui.
  const users = new UsersRepository(store.db);
  users.trocarSenha(criado.id, await Bun.password.hash("senha-real-12345"));
  const { token } = users.abrirSessao(criado.id);
  return { id: criado.id, cookie: `${SESSION_COOKIE}=${token}` };
}

beforeEach(async () => {
  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie: adminCookie, userId: adminId } = await autenticar(store));
});

describe("papel da primeira conta", () => {
  /**
   * A migração 004 promove quem já existe, e `criar()` usa `"admin"` como
   * default justamente para o setup. Se um dos dois mudar, a instalação nasce
   * sem administrador nenhum — e sem conserto pela interface.
   */
  it("a conta do setup é admin", async () => {
    const res = await chamar("GET", "/auth/me", adminCookie);
    const corpo = (await res.json()) as { user: SessionUser };
    expect(corpo.user.role).toBe("admin");
  });
});

describe("só admin administra", () => {
  it("member recebe 403 em todas as rotas de administração", async () => {
    const membro = await contaCom("member", "membro");
    const alvo = await contaCom("member", "alvo");

    const tentativas: readonly [string, string, unknown?][] = [
      ["GET", "/users", undefined],
      ["POST", "/users", { username: "novo", temporaryPassword: "provisoria-1234", role: "member" }],
      ["PATCH", `/users/${alvo.id}`, { role: "admin" }],
      ["POST", `/users/${alvo.id}/password`, { temporaryPassword: "outra-provisoria-1" }],
      ["DELETE", `/users/${alvo.id}`, undefined],
    ];

    for (const [metodo, caminho, corpo] of tentativas) {
      const res = await chamar(metodo, caminho, membro.cookie, corpo);
      expect(`${metodo} ${caminho} -> ${String(res.status)}`).toBe(
        `${metodo} ${caminho} -> 403`,
      );
      expect(((await res.json()) as { code: string }).code).toBe("admin_required");
    }

    // E nada aconteceu de fato: o alvo continua lá, e continua member.
    const lista = (await (await chamar("GET", "/users", adminCookie)).json()) as UserSummary[];
    expect(lista.find((u) => u.id === alvo.id)?.role).toBe("member");
  });

  it("sem sessão nenhuma é 401, não 403", async () => {
    const res = await chamar("GET", "/users", "");
    expect(res.status).toBe(401);
  });
});

describe("criar conta", () => {
  it("nasce exigindo troca de senha, e a senha não volta na resposta", async () => {
    const res = await chamar("POST", "/users", adminCookie, {
      username: "ana",
      temporaryPassword: "provisoria-1234",
      role: "member",
    });
    expect(res.status).toBe(201);

    const bruto = await res.text();
    expect(bruto).not.toContain("provisoria-1234");
    expect(bruto).not.toContain("password");

    const criado = JSON.parse(bruto) as SessionUser;
    expect(criado.mustChangePassword).toBe(true);
    expect(criado.role).toBe("member");
  });

  /** A senha provisória vale para exatamente um login: o guard barra o resto. */
  it("a conta nova não consegue usar a API antes de trocar a senha", async () => {
    const res = await chamar("POST", "/users", adminCookie, {
      username: "bruno",
      temporaryPassword: "provisoria-1234",
      role: "member",
    });
    const criado = (await res.json()) as SessionUser;

    const users = new UsersRepository(store.db);
    const { token } = users.abrirSessao(criado.id);
    const cookie = `${SESSION_COOKIE}=${token}`;

    const conexoes = await chamar("GET", "/connections", cookie);
    expect(conexoes.status).toBe(403);
    expect(((await conexoes.json()) as { code: string }).code).toBe("password_change_required");
  });

  it("nome repetido volta 409, não 500", async () => {
    const corpo = { username: "repetido", temporaryPassword: "provisoria-1234", role: "member" };
    expect((await chamar("POST", "/users", adminCookie, corpo)).status).toBe(201);

    const segunda = await chamar("POST", "/users", adminCookie, corpo);
    expect(segunda.status).toBe(409);
    expect(((await segunda.json()) as { code: string }).code).toBe("username_taken");
  });

  it("senha curta demais é recusada pelo schema", async () => {
    const res = await chamar("POST", "/users", adminCookie, {
      username: "curta",
      temporaryPassword: "curta",
      role: "member",
    });
    expect(res.status).toBe(422);
  });
});

describe("a instalação nunca fica sem admin", () => {
  it("o último admin não consegue rebaixar a si mesmo", async () => {
    const res = await chamar("PATCH", `/users/${adminId}`, adminCookie, { role: "member" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("last_admin");

    const users = new UsersRepository(store.db);
    expect(users.contarAdmins()).toBe(1);
  });

  /**
   * O outro lado da mesma regra: com dois admins, sair da função é permitido.
   * Se isto falhar, a trava virou "admin não pode se rebaixar nunca" — que é o
   * desenho que tornava o `last_admin` inalcançável.
   */
  it("com outro admin no lugar, rebaixar a si mesmo é permitido", async () => {
    await contaCom("admin", "segundo");

    const res = await chamar("PATCH", `/users/${adminId}`, adminCookie, { role: "member" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as UserSummary).role).toBe("member");

    const users = new UsersRepository(store.db);
    expect(users.contarAdmins()).toBe(1);
  });

  it("não dá para remover a própria conta, nem sendo o último admin", async () => {
    const res = await chamar("DELETE", `/users/${adminId}`, adminCookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("self_target");
  });

  it("promover nunca é barrado — só rebaixar pode zerar os admins", async () => {
    const membro = await contaCom("member", "promovido");
    const res = await chamar("PATCH", `/users/${membro.id}`, adminCookie, { role: "admin" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as UserSummary).role).toBe("admin");
  });

  /**
   * `remover()` tem a mesma trava de "nunca zero admins", e ela é **inalcançável
   * pela API** — para remover o último admin seria preciso ser ele, e a trava da
   * própria conta dispara antes. É a invariante que continua valendo se aquela
   * for relaxada um dia, então é exercitada aqui, direto no serviço.
   */
  it("o serviço recusa remover o último admin mesmo pedido por outra pessoa", async () => {
    const users = new UsersRepository(store.db);
    const service = new UsersService(users);

    const outro = await service.criar({
      username: "naoadmin",
      temporaryPassword: "provisoria-1234",
      role: "member",
    });
    expect(outro.ok).toBe(true);
    if (!outro.ok) return;

    expect(users.contarAdmins()).toBe(1);
    const resultado = service.remover(adminId, outro.value.id);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.failure).toBe("last_admin");
    expect(users.porId(adminId)).not.toBeNull();
  });
});

describe("reset de senha", () => {
  it("derruba as sessões da pessoa e volta a exigir troca", async () => {
    const alvo = await contaCom("member", "resetado");
    const users = new UsersRepository(store.db);
    expect(users.contarSessoes(alvo.id)).toBe(1);

    const res = await chamar("POST", `/users/${alvo.id}/password`, adminCookie, {
      temporaryPassword: "nova-provisoria-1",
    });
    expect(res.status).toBe(200);

    const corpo = (await res.json()) as UserSummary;
    expect(corpo.mustChangePassword).toBe(true);
    expect(corpo.activeSessions).toBe(0);
    expect(users.contarSessoes(alvo.id)).toBe(0);

    // O cookie que estava valendo deixou de valer.
    expect((await chamar("GET", "/connections", alvo.cookie)).status).toBe(401);
  });
});

describe("remover conta", () => {
  it("derruba a sessão e a auditoria da pessoa permanece", async () => {
    const alvo = await contaCom("member", "removido");

    // Uma linha de auditoria com o id dela, como se tivesse rodado algo.
    store.db.run(
      `INSERT INTO connections (id, name, host, port, database, username, password_enc,
                                ssl_mode, write_enabled, statement_timeout_ms, timezone,
                                created_at, updated_at)
       VALUES ('c1','c','h',5432,'d','u','x','disable',0,30000,'UTC','2026-01-01','2026-01-01')`,
    );
    store.db.run(
      `INSERT INTO query_log (id, connection_id, database, sql, status, read_only, actor, executed_at)
       VALUES ('q1','c1','d','SELECT 1','ok',1,?,'2026-01-01')`,
      [alvo.id],
    );

    expect((await chamar("DELETE", `/users/${alvo.id}`, adminCookie)).status).toBe(200);
    expect((await chamar("GET", "/connections", alvo.cookie)).status).toBe(401);

    // O `actor` é id, não FK: auditoria que some quando a pessoa sai não é
    // auditoria.
    const linha = store.db
      .query<{ actor: string }, []>("SELECT actor FROM query_log WHERE id = 'q1'")
      .get();
    expect(linha?.actor).toBe(alvo.id);
  });

  it("conta inexistente é 404", async () => {
    expect((await chamar("DELETE", "/users/nao-existe", adminCookie)).status).toBe(404);
  });

  it("admin não remove a própria conta", async () => {
    await contaCom("admin", "outro-admin");
    const res = await chamar("DELETE", `/users/${adminId}`, adminCookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("self_target");
  });
});

describe("a listagem", () => {
  it("não devolve hash de senha em campo nenhum", async () => {
    await contaCom("member", "alguem");
    const bruto = await (await chamar("GET", "/users", adminCookie)).text();
    expect(bruto).not.toContain("password_hash");
    expect(bruto).not.toContain("passwordHash");
    expect(bruto).not.toContain("$argon2");
  });

  it("conta só as sessões vivas", async () => {
    const alvo = await contaCom("member", "comsessao");
    const users = new UsersRepository(store.db);

    // Uma sessão já expirada, que segue na tabela até alguém logar.
    store.db.run(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ["hash-morto", alvo.id, "2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z"],
    );

    const lista = (await (await chamar("GET", "/users", adminCookie)).json()) as UserSummary[];
    expect(lista.find((u) => u.id === alvo.id)?.activeSessions).toBe(1);
    expect(users.contarSessoes(alvo.id)).toBe(2); // a morta continua na tabela
  });
});
