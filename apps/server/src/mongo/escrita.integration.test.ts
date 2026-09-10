import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MongoClient } from "mongodb";
import { SESSION_COOKIE, type Connection, type SessionUser } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { autenticar } from "../test/sessao";

/**
 * Escrita de documento no MongoDB pela credencial de escrita, pelo app inteiro.
 *
 * O que os testes travam:
 * - update/delete/insert de documento funcionam pela credencial de escrita;
 * - a guarda otimista pega o documento alterado (matchedCount 0 → `row_changed`);
 * - um `member` sem concessão é barrado, e admin grava;
 * - a credencial de leitura sozinha não grava (o portão da credencial).
 */

const CONTAINER = "dbee-mongo-escrita";
const PORTA = 55553;
const SENHA = "Mw7pQz2mVx4T";
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

async function conexao(): Promise<Connection> {
  const res = await chamar("POST", "/connections", adminCookie, {
    name: "mongo-escrita", engine: "mongodb",
    host: "127.0.0.1", port: PORTA, database: "loja",
    username: "leitor", password: SENHA, authSource: "admin", sslMode: "disable",
    writeUsername: "gravador", writePassword: SENHA,
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

/** Lê um documento por fora do app, com root, para conferir a escrita. */
async function doc(id: number): Promise<Record<string, unknown> | null> {
  const c = new MongoClient(`mongodb://root:${SENHA}@127.0.0.1:${String(PORTA)}/?authSource=admin`);
  await c.connect();
  const d = await c.db("loja").collection("produto").findOne({ _id: id as never });
  await c.close();
  return d;
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER,
    "-e", `MONGO_INITDB_ROOT_USERNAME=root`, "-e", `MONGO_INITDB_ROOT_PASSWORD=${SENHA}`,
    "-p", `${String(PORTA)}:27017`, "mongo:7");

  let pronto = false;
  for (let i = 0; i < 120; i++) {
    if (sh("docker", "exec", CONTAINER, "mongosh", "--quiet", "-u", "root", "-p", SENHA,
      "--authenticationDatabase", "admin", "--eval", "db.runCommand({ping:1})")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Mongo não ficou pronto");

  // Semente + dois usuários: leitor (read) e gravador (readWrite em loja).
  const seed = `
    db = db.getSiblingDB('loja');
    db.produto.insertMany([{_id:1,nome:'Café',preco:18.9},{_id:2,nome:'Chá',preco:12.5}]);
    db.getSiblingDB('admin').createUser({user:'leitor',pwd:'${SENHA}',roles:[{role:'read',db:'loja'}]});
    db.getSiblingDB('admin').createUser({user:'gravador',pwd:'${SENHA}',roles:[{role:'readWrite',db:'loja'}]});
  `;
  if (!sh("docker", "exec", CONTAINER, "mongosh", "--quiet", "-u", "root", "-p", SENHA,
    "--authenticationDatabase", "admin", "--eval", seed)) {
    throw new Error("seed do Mongo falhou");
  }

  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie: adminCookie } = await autenticar(store));
}, 300_000);

afterAll(() => {
  if (temDocker) sh("docker", "rm", "-f", CONTAINER);
});

const pular = !temDocker;

describe.skipIf(pular)("escrita de documento no MongoDB", () => {
  it("admin atualiza uma célula pela credencial de escrita", async () => {
    const c = await conexao();
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie, {
      database: "loja", schema: "loja", table: "produto", readOnly: false,
      pk: [{ column: "_id", value: "1" }],
      changes: [{ column: "preco", from: "18.9", to: "19.9" }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await doc(1))?.["preco"]).toBe(19.9);
  });

  it("a guarda otimista pega o valor original errado", async () => {
    const c = await conexao();
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie, {
      database: "loja", schema: "loja", table: "produto", readOnly: false,
      pk: [{ column: "_id", value: "2" }],
      // `from` errado de propósito: o documento tem preco 12.5, não 99.
      changes: [{ column: "preco", from: "99", to: "1" }],
    });
    expect(res.status).toBe(409);
  });

  it("admin insere e exclui um documento", async () => {
    const c = await conexao();
    const ins = await chamar("POST", `/connections/${c.id}/rows/insert`, adminCookie, {
      database: "loja", schema: "loja", table: "produto", readOnly: false,
      values: [{ column: "_id", value: "3" }, { column: "nome", value: "Suco" }],
    });
    expect(ins.status, await ins.clone().text()).toBe(200);
    expect((await doc(3))?.["nome"]).toBe("Suco");

    const del = await chamar("POST", `/connections/${c.id}/rows/delete`, adminCookie, {
      database: "loja", schema: "loja", table: "produto", readOnly: false,
      pk: [{ column: "_id", value: "3" }], guard: [{ column: "nome", value: "Suco" }],
    });
    expect(del.status).toBe(200);
    expect(await doc(3)).toBeNull();
  });

  it("member sem concessão não grava", async () => {
    const c = await conexao();
    const cookie = await membro("mongo-sem-escrita", false, c.id);
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, cookie, {
      database: "loja", schema: "loja", table: "produto", readOnly: false,
      pk: [{ column: "_id", value: "1" }],
      changes: [{ column: "preco", from: "19.9", to: "0" }],
    });
    expect(res.status).toBe(403);
  });
});
