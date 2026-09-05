import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SESSION_COOKIE } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";

/**
 * Primeiro acesso pela tela de setup (DBee.md §7).
 *
 * O que importa provar: a conta nasce do token do volume (não de senha em log),
 * o token errado é recusado, o certo cria a conta e some, e depois de existir
 * conta o setup fecha — a rota é aberta, então a trava contra uma "segunda
 * primeira conta" é do serviço, não do guard.
 */

const TOKEN = "token-de-setup-para-teste-123";

let app: ReturnType<typeof createApp>;
let store: Store;
let dataDir: string;

const call = (path: string, body?: unknown, method = "POST"): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "dbee-setup-"));
  writeFileSync(join(dataDir, "setup-token"), TOKEN, { mode: 0o600 });
  store = openTestStore();
  app = createApp({ store, caCert: undefined, dataDir });
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("setup do primeiro acesso", () => {
  it("sem conta, o setup é requerido", async () => {
    const res = await call("/api/auth/setup", undefined, "GET");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { setupRequired: boolean }).setupRequired).toBe(true);
  });

  it("token errado é recusado com invalid_token, sem criar conta", async () => {
    const res = await call("/api/auth/setup", {
      token: "errado-mas-do-mesmo-tamanho-1234",
      username: "operador",
      password: "senha-bem-comprida-123",
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_token");
    expect(new UsersRepository(store.db).contar()).toBe(0);
  });

  it("token certo cria a conta, abre sessão e apaga o token", async () => {
    // O cliente normaliza para minúsculas antes de enviar (o schema `Username`
    // exige minúsculas); aqui já mandamos como o front manda.
    const res = await call("/api/auth/setup", {
      token: TOKEN,
      username: "operador",
      password: "senha-bem-comprida-123",
    });
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { user: { username: string; mustChangePassword: boolean } };
    // Sem troca obrigatória: o operador escolheu a senha, ninguém a imprimiu.
    expect(corpo.user.username).toBe("operador");
    expect(corpo.user.mustChangePassword).toBe(false);
    // Cookie de sessão veio na resposta.
    expect(res.headers.get("set-cookie") ?? "").toContain(`${SESSION_COOKIE}=`);
    // A conta existe e o token sumiu do volume.
    expect(new UsersRepository(store.db).contar()).toBe(1);
    expect(() => readFileSync(join(dataDir, "setup-token"), "utf8")).toThrow();
  });

  it("com conta já criada, o setup não é mais requerido", async () => {
    const res = await call("/api/auth/setup", undefined, "GET");
    expect(((await res.json()) as { setupRequired: boolean }).setupRequired).toBe(false);
  });

  it("uma segunda tentativa de setup é recusada com setup_done", async () => {
    // Reescreve o token para provar que a trava é a existência de conta, não o
    // arquivo: mesmo com token válido no volume, não nasce uma segunda conta.
    writeFileSync(join(dataDir, "setup-token"), TOKEN, { mode: 0o600 });
    const res = await call("/api/auth/setup", {
      token: TOKEN,
      username: "intruso",
      password: "outra-senha-comprida-123",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("setup_done");
    expect(new UsersRepository(store.db).contar()).toBe(1);
  });
});
