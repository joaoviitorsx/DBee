import { describe, expect, it } from "bun:test";

import { SESSION_COOKIE } from "@dbee/shared";

import { createApp } from "../app";
import { criarPrimeiroUsuario } from "../db/bootstrap";
import { openTestStore } from "../db/client";
import { UsersRepository } from "../db/users.repo";

/**
 * As três formas mais comuns de uma autenticação vazar (DBee.md §7).
 *
 * Nenhuma delas aparece em teste de "consegue logar": todas passam por lá.
 */

interface Cenario {
  readonly app: ReturnType<typeof createApp>;
  readonly users: UsersRepository;
  readonly senha: string;
  readonly userId: string;
}

async function cenario(): Promise<Cenario> {
  const store = openTestStore();
  const users = new UsersRepository(store.db);
  const primeiro = await criarPrimeiroUsuario(users);
  if (primeiro === null) throw new Error("o primeiro usuário deveria ter sido criado");

  // Sai do estado de troca obrigatória para os testes que não são sobre ele.
  const hash = await Bun.password.hash("senha-normal-12345", { algorithm: "argon2id" });
  users.trocarSenha(primeiro.user.id, hash);

  return {
    app: createApp({ store, caCert: undefined }),
    users,
    senha: "senha-normal-12345",
    userId: primeiro.user.id,
  };
}

const chamar = (
  app: ReturnType<typeof createApp>,
  metodo: string,
  caminho: string,
  opcoes: { body?: unknown; cookie?: string } = {},
): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${caminho}`, {
      method: metodo,
      headers: {
        "content-type": "application/json",
        ...(opcoes.cookie === undefined ? {} : { cookie: opcoes.cookie }),
      },
      ...(opcoes.body === undefined ? {} : { body: JSON.stringify(opcoes.body) }),
    }),
  );

/** Extrai o token do `Set-Cookie` da resposta. */
function cookieDaResposta(res: Response): string | null {
  const set = res.headers.get("set-cookie");
  if (set === null) return null;
  return /dbee_session=([^;]+)/.exec(set)?.[1] ?? null;
}

describe("login", () => {
  it("entra e devolve cookie de sessão com os atributos certos", async () => {
    const { app } = await cenario();
    const res = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: "senha-normal-12345" },
    });

    expect(res.status).toBe(200);
    const set = res.headers.get("set-cookie") ?? "";
    // Os três atributos que impedem roubo por XSS e por CSRF.
    expect(set).toContain("HttpOnly");
    expect(set.toLowerCase()).toContain("samesite=strict");
    expect(set).toContain("Secure");
    // A resposta traz o usuário, **nunca** o hash.
    const corpo = (await res.json()) as {
      user: {
        id: string;
        username: string;
        mustChangePassword: boolean;
        locale: string;
        createdAt: string;
      };
    };
    expect(corpo.user.username).toBe("admin");
    expect(corpo.user.mustChangePassword).toBe(false);
    expect(corpo.user.locale).toBe("pt");
    expect(typeof corpo.user.id).toBe("string");
    expect(typeof corpo.user.createdAt).toBe("string");
    // A barreira que importa: o hash não sai da tabela por rota nenhuma.
    expect(Object.keys(corpo.user).sort()).toEqual([
      "createdAt", "id", "locale", "mustChangePassword", "username",
    ]);
  });

  it("usuário inexistente e senha errada dão a MESMA resposta", async () => {
    const { app } = await cenario();

    const naoExiste = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "ninguem", password: "senha-normal-12345" },
    });
    const senhaErrada = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: "senha-errada-12345" },
    });

    expect(naoExiste.status).toBe(senhaErrada.status);
    expect(naoExiste.status).toBe(401);
    // Byte a byte: qualquer diferença aqui é a lista de quem tem conta.
    expect(await naoExiste.text()).toBe(await senhaErrada.text());
  });

  it("os dois casos levam o MESMO tempo", async () => {
    const { app } = await cenario();

    const medir = async (username: string): Promise<number> => {
      // Três repetições e a mediana: uma medida só pega ruído de agendamento.
      const tempos: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        await chamar(app, "POST", "/api/auth/login", {
          body: { username, password: "senha-qualquer-12345" },
        });
        tempos.push(performance.now() - t);
      }
      return tempos.sort((a, b) => a - b)[1] ?? 0;
    };

    const inexistente = await medir("ninguem");
    const existente = await medir("admin");

    // O caminho do usuário inexistente também gasta um argon2id (~180 ms).
    // Sem isso ele responderia em ~0 ms e a diferença seria medível de fora.
    expect(inexistente).toBeGreaterThan(50);
    const razao = Math.max(inexistente, existente) / Math.min(inexistente, existente);
    expect(razao).toBeLessThan(2);
  });

  it("tentativas demais viram 429", async () => {
    const { app } = await cenario();
    let ultimo = 0;

    // O limite é 10 na janela; a 11ª já é barrada.
    for (let i = 0; i < 12; i++) {
      const res = await chamar(app, "POST", "/api/auth/login", {
        body: { username: "admin", password: "errada-errada-1234" },
      });
      ultimo = res.status;
    }
    expect(ultimo).toBe(429);
  }, 30_000);
});

describe("logout", () => {
  it("invalida a sessão NO SERVIDOR, não só apaga o cookie", async () => {
    const { app, users, userId } = await cenario();

    const login = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: "senha-normal-12345" },
    });
    const token = cookieDaResposta(login);
    expect(token).not.toBeNull();
    const cookie = `${SESSION_COOKIE}=${token ?? ""}`;

    expect((await chamar(app, "GET", "/api/auth/me", { cookie })).status).toBe(200);
    expect(users.contarSessoes(userId)).toBe(1);

    const saida = await chamar(app, "POST", "/api/auth/logout", { cookie });
    expect(saida.status).toBe(200);

    // O teste que importa: **reapresentar o mesmo cookie**. Se o logout só
    // apagasse o cookie no cliente, o token continuaria valendo e isto daria
    // 200 — que é exatamente o que acontece com quem tiver uma cópia dele.
    expect((await chamar(app, "GET", "/api/auth/me", { cookie })).status).toBe(401);
    expect(users.contarSessoes(userId)).toBe(0);
  });
});

describe("troca de senha", () => {
  it("derruba TODAS as sessões, inclusive as de outros dispositivos", async () => {
    const { app, users, userId } = await cenario();

    const abrir = async (): Promise<string> => {
      const res = await chamar(app, "POST", "/api/auth/login", {
        body: { username: "admin", password: "senha-normal-12345" },
      });
      return `${SESSION_COOKIE}=${cookieDaResposta(res) ?? ""}`;
    };

    const notebook = await abrir();
    const celular = await abrir();
    expect(users.contarSessoes(userId)).toBe(2);

    const troca = await chamar(app, "POST", "/api/auth/password", {
      cookie: notebook,
      body: { currentPassword: "senha-normal-12345", newPassword: "outra-senha-99999" },
    });
    expect(troca.status).toBe(200);

    // Trocar senha é o que se faz quando se suspeita que alguém está dentro.
    // Se a sessão do celular sobrevivesse, a troca não teria servido para nada.
    expect(users.contarSessoes(userId)).toBe(0);
    expect((await chamar(app, "GET", "/api/auth/me", { cookie: celular })).status).toBe(401);
    expect((await chamar(app, "GET", "/api/auth/me", { cookie: notebook })).status).toBe(401);

    // E a senha nova funciona.
    const novo = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: "outra-senha-99999" },
    });
    expect(novo.status).toBe(200);
  }, 30_000);

  it("exige a senha atual mesmo com sessão válida", async () => {
    const { app } = await cenario();
    const login = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: "senha-normal-12345" },
    });
    const cookie = `${SESSION_COOKIE}=${cookieDaResposta(login) ?? ""}`;

    // Sessão roubada não pode trancar o dono para fora.
    const res = await chamar(app, "POST", "/api/auth/password", {
      cookie,
      body: { currentPassword: "chute-errado-12345", newPassword: "outra-senha-99999" },
    });
    expect(res.status).toBe(401);
  }, 30_000);
});

describe("primeiro boot", () => {
  it("cria um usuário só, com troca obrigatória, e não recria no boot seguinte", async () => {
    const store = openTestStore();
    const users = new UsersRepository(store.db);

    const primeiro = await criarPrimeiroUsuario(users);
    expect(primeiro?.user.username).toBe("admin");
    expect(primeiro?.user.mustChangePassword).toBe(true);
    expect(primeiro?.senha).toHaveLength(24);
    // Sem caractere que se confunde ao ler do log e digitar à mão.
    expect(primeiro?.senha).toMatch(/^[a-zA-Z2-9]+$/);
    expect(primeiro?.senha).not.toMatch(/[0OlI1S5]/);

    expect(await criarPrimeiroUsuario(users)).toBeNull();
    expect(users.contar()).toBe(1);
  }, 30_000);

  it("a senha do primeiro boot não serve para nada além de trocá-la", async () => {
    const store = openTestStore();
    const users = new UsersRepository(store.db);
    const primeiro = await criarPrimeiroUsuario(users);
    const app = createApp({ store, caCert: undefined });

    const login = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: primeiro?.senha ?? "" },
    });
    expect(login.status).toBe(200);
    const cookie = `${SESSION_COOKIE}=${cookieDaResposta(login) ?? ""}`;

    // A senha está no log do container. Enquanto não trocar, a sessão existe
    // mas não abre nada.
    const bloqueada = await chamar(app, "GET", "/api/connections", { cookie });
    expect(bloqueada.status).toBe(403);

    const troca = await chamar(app, "POST", "/api/auth/password", {
      cookie,
      body: { currentPassword: primeiro?.senha ?? "", newPassword: "senha-de-verdade-1" },
    });
    expect(troca.status).toBe(200);
    expect(((await troca.json()) as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(false);

    const depois = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: "senha-de-verdade-1" },
    });
    const cookieNovo = `${SESSION_COOKIE}=${cookieDaResposta(depois) ?? ""}`;
    expect((await chamar(app, "GET", "/api/connections", { cookie: cookieNovo })).status).toBe(200);
  }, 30_000);
});

describe("idioma", () => {
  const logar = async (): Promise<{ app: Cenario["app"]; cookie: string }> => {
    const { app } = await cenario();
    const res = await chamar(app, "POST", "/api/auth/login", {
      body: { username: "admin", password: "senha-normal-12345" },
    });
    return { app, cookie: `${SESSION_COOKIE}=${cookieDaResposta(res) ?? ""}` };
  };

  it("grava a escolha no usuário e o /me reflete", async () => {
    const { app, cookie } = await logar();

    const troca = await chamar(app, "PATCH", "/api/auth/locale", { cookie, body: { locale: "en" } });
    expect(troca.status).toBe(200);
    expect(((await troca.json()) as { user: { locale: string } }).user.locale).toBe("en");

    // Persistiu: uma leitura nova traz o novo idioma, não o do corpo da resposta.
    const me = await chamar(app, "GET", "/api/auth/me", { cookie });
    expect(((await me.json()) as { user: { locale: string } }).user.locale).toBe("en");
  });

  it("sem sessão não troca idioma", async () => {
    const { app } = await cenario();
    const res = await chamar(app, "PATCH", "/api/auth/locale", { body: { locale: "en" } });
    expect(res.status).toBe(401);
  });

  it("idioma fora do domínio é recusado pela validação", async () => {
    const { app, cookie } = await logar();
    const res = await chamar(app, "PATCH", "/api/auth/locale", { cookie, body: { locale: "fr" } });
    expect(res.status).toBe(422);
  });
});
