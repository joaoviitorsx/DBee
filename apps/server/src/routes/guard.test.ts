import { describe, expect, it } from "bun:test";

import { SESSION_COOKIE } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { criarPrimeiroUsuario } from "../db/bootstrap";
import { UsersRepository } from "../db/users.repo";
import { ROTAS_ABERTAS } from "./guard";

/**
 * Nenhuma rota responde sem sessão.
 *
 * **Varre `app.routes`, não uma lista escrita à mão.** Conferir rota a rota
 * protege as rotas que alguém lembrou de conferir — e a que vaza é justamente
 * a que ninguém lembrou. Aqui, uma rota nova sem cobertura faz este teste
 * falhar sozinha, sem ninguém precisar voltar aqui.
 *
 * O export é o caso que motivou a forma: ele devolve um `Response` cru com
 * stream, não passa pela serialização normal, e por ser diferente é o mais
 * fácil de esquecer.
 */

/** Preenche `:id`, `:schema` etc. com algo válido de formato. */
function concretizar(path: string): string {
  return path
    .replaceAll(":id", "kT91jSIJ6lvu-2zh4tjLq")
    .replaceAll(":schema", "public")
    .replaceAll(":table", "t");
}

const store = openTestStore();
const app = createApp({ store, caCert: undefined });

/** Todas as rotas registradas, com o caminho concreto. */
const ROTAS = app.routes.map((r) => ({
  method: r.method,
  path: r.path,
  chave: `${r.method} ${r.path}`,
  url: `http://localhost${concretizar(r.path)}`,
}));

const chamar = (
  metodo: string,
  url: string,
  cookie?: string,
): Promise<Response> =>
  app.handle(
    new Request(url, {
      method: metodo,
      headers: {
        "content-type": "application/json",
        ...(cookie === undefined ? {} : { cookie }),
      },
      // Corpo vazio e válido: o objetivo é a resposta de autorização, não a de
      // validação. Se o guard rodasse depois da validação, este `{}` viraria
      // 422 e o teste acusaria.
      ...(metodo === "GET" || metodo === "HEAD" ? {} : { body: "{}" }),
    }),
  );

describe("o guard cobre todas as rotas registradas", () => {
  it("registrou rotas (senão o teste passaria por vacuidade)", () => {
    expect(ROTAS.length).toBeGreaterThan(8);
  });

  it("as rotas abertas são exatamente estas, e cada uma tem motivo", () => {
    // Acrescentar rota aqui é decisão de segurança. O teste existe para que a
    // decisão seja consciente, não um efeito colateral de outra mudança.
    // health (sem cookie no healthcheck), login (nasce a sessão), e o setup do
    // primeiro acesso (GET informa o modo; POST cria a conta, travado por
    // `setup_done` no serviço quando já há usuário) — §7.
    expect([...ROTAS_ABERTAS].sort()).toEqual([
      "GET /api/auth/setup",
      "GET /api/health",
      "POST /api/auth/login",
      "POST /api/auth/setup",
    ]);
  });

  it("toda rota fechada responde 401 sem cookie de sessão", async () => {
    const vazamentos: string[] = [];

    for (const rota of ROTAS) {
      if (ROTAS_ABERTAS.has(rota.chave)) continue;
      const res = await chamar(rota.method, rota.url);
      if (res.status !== 401) vazamentos.push(`${rota.chave} → ${String(res.status)}`);
      await res.body?.cancel();
    }

    expect(vazamentos).toEqual([]);
  });

  it("toda rota fechada responde 401 com cookie inválido", async () => {
    const vazamentos: string[] = [];

    for (const rota of ROTAS) {
      if (ROTAS_ABERTAS.has(rota.chave)) continue;
      const res = await chamar(rota.method, rota.url, `${SESSION_COOKIE}=token-que-nao-existe`);
      if (res.status !== 401) vazamentos.push(`${rota.chave} → ${String(res.status)}`);
      await res.body?.cancel();
    }

    expect(vazamentos).toEqual([]);
  });

  it("o healthcheck responde sem sessão — o container não tem cookie", async () => {
    const res = await chamar("GET", "http://localhost/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("o export, que devolve stream e não passa pela serialização normal, também é barrado", async () => {
    // Chamado explicitamente além da varredura: é a rota mais fácil de escapar,
    // e um teste que só existe dentro de um laço não documenta isso.
    const res = await chamar(
      "POST",
      "http://localhost/api/connections/qualquer/export",
    );
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });
});

describe("senha por trocar bloqueia o resto da API", () => {
  it("com mustChangePassword, só /auth/me, /auth/password e /auth/logout passam", async () => {
    const proprio = openTestStore();
    const users = new UsersRepository(proprio.db);
    const primeiro = await criarPrimeiroUsuario(users);
    expect(primeiro).not.toBeNull();

    const appProprio = createApp({ store: proprio, caCert: undefined });
    const { token } = users.abrirSessao(primeiro?.user.id ?? "");
    const cookie = `${SESSION_COOKIE}=${token}`;

    const chamarProprio = (metodo: string, caminho: string): Promise<Response> =>
      appProprio.handle(
        new Request(`http://localhost${caminho}`, {
          method: metodo,
          headers: { "content-type": "application/json", cookie },
          ...(metodo === "GET" ? {} : { body: "{}" }),
        }),
      );

    // Passa: é o que a pessoa precisa para sair do estado.
    expect((await chamarProprio("GET", "/api/auth/me")).status).toBe(200);

    // Barrado com 403, não 401: a sessão é válida, o que falta é a troca.
    const bloqueada = await chamarProprio("GET", "/api/connections");
    expect(bloqueada.status).toBe(403);
    expect(((await bloqueada.json()) as { code: string }).code).toBe("password_change_required");
  });
});
