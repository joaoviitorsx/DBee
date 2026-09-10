import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SESSION_COOKIE, type Connection, type SessionUser } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { autenticar } from "../test/sessao";

/**
 * Escrita de chave no Redis pela credencial de escrita, pelo app inteiro.
 *
 * O que os testes travam:
 * - editar o valor de uma chave `string` (SET), excluir (DEL), inserir;
 * - editar um tipo não-`string` é recusado com mensagem clara;
 * - a guarda otimista pega o valor mudado;
 * - member sem concessão barrado, admin grava.
 *
 * O Redis do teste sobe **sem ACL** (uma senha só, que é a credencial de
 * leitura e de escrita ao mesmo tempo). A separação de credencial que importa
 * aqui é a do DBee — o portão de concessão do ator —, não a do servidor.
 */

const CONTAINER = "dbee-redis-escrita";
const PORTA = 55563;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const SENHA = "Rw7pQz2mVx4T";
const cli = (...cmd: string[]): string =>
  Bun.spawnSync(["docker", "exec", CONTAINER, "redis-cli", "-a", SENHA, ...cmd]).stdout.toString().trim();

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

async function conexao(): Promise<Connection> {
  const res = await chamar("POST", "/connections", adminCookie, {
    name: "redis-escrita", engine: "redis",
    host: "127.0.0.1", port: PORTA, password: SENHA, sslMode: "disable",
    // No Redis a credencial de escrita é só a senha. O servidor do teste sobe
    // com `--requirepass`, então leitura e escrita usam a mesma senha real — a
    // separação que este teste prova é o portão de concessão do DBee.
    writePassword: SENHA,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Connection;
}

async function membro(username: string, canWrite: boolean, connId: string): Promise<string> {
  const res = await chamar("POST", "/users", adminCookie, {
    username, temporaryPassword: "provisoria-1234", role: "member",
  });
  const criado = (await res.json()) as SessionUser;
  const users = new UsersRepository(store.db);
  users.trocarSenha(criado.id, await Bun.password.hash("senha-real-12345"));
  await chamar("PUT", `/connections/${connId}/access`, adminCookie, { userId: criado.id, canWrite });
  const { token } = users.abrirSessao(criado.id);
  return `${SESSION_COOKIE}=${token}`;
}

const alvo = (extra: Record<string, unknown>): Record<string, unknown> => ({
  database: "db0", schema: "db0", table: "keys", readOnly: false, ...extra,
});

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-p", `${String(PORTA)}:6379`,
    "redis:7", "redis-server", "--requirepass", SENHA);
  let pronto = false;
  for (let i = 0; i < 60; i++) {
    if (sh("docker", "exec", CONTAINER, "redis-cli", "-a", SENHA, "PING")) { pronto = true; break; }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Redis não ficou pronto");

  cli("SET", "greeting", "ola");
  cli("HSET", "perfil:1", "nome", "Ana");

  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie: adminCookie } = await autenticar(store));
}, 180_000);

afterAll(() => {
  if (temDocker) sh("docker", "rm", "-f", CONTAINER);
});

const pular = !temDocker;

describe.skipIf(pular)("escrita de chave no Redis", () => {
  it("admin edita o valor de uma chave string", async () => {
    const c = await conexao();
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie,
      alvo({ pk: [{ column: "key", value: "greeting" }], changes: [{ column: "value", from: "ola", to: "oi" }] }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(cli("GET", "greeting")).toBe("oi");
  });

  it("editar o valor de um hash é recusado com mensagem clara", async () => {
    const c = await conexao();
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie,
      alvo({ pk: [{ column: "key", value: "perfil:1" }], changes: [{ column: "value", from: "{}", to: "x" }] }));
    // MutacaoError → upstream_error (502) com a mensagem.
    expect(res.status).toBe(502);
  });

  it("a guarda otimista pega o valor mudado", async () => {
    const c = await conexao();
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie,
      alvo({ pk: [{ column: "key", value: "greeting" }], changes: [{ column: "value", from: "valor-errado", to: "z" }] }));
    expect(res.status).toBe(409);
  });

  it("admin insere e exclui uma chave", async () => {
    const c = await conexao();
    const ins = await chamar("POST", `/connections/${c.id}/rows/insert`, adminCookie,
      alvo({ values: [{ column: "key", value: "novo:1" }, { column: "value", value: "abc" }] }));
    expect(ins.status, await ins.clone().text()).toBe(200);
    expect(cli("GET", "novo:1")).toBe("abc");

    const del = await chamar("POST", `/connections/${c.id}/rows/delete`, adminCookie,
      alvo({ pk: [{ column: "key", value: "novo:1" }], guard: [{ column: "value", value: "abc" }] }));
    expect(del.status).toBe(200);
    expect(cli("EXISTS", "novo:1")).toBe("0");
  });

  it("member sem concessão não grava", async () => {
    const c = await conexao();
    const cookie = await membro("redis-sem-escrita", false, c.id);
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, cookie,
      alvo({ pk: [{ column: "key", value: "greeting" }], changes: [{ column: "value", from: "oi", to: "hack" }] }));
    expect(res.status).toBe(403);
  });
});
