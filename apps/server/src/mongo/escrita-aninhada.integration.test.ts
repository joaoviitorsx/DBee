import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MongoClient } from "mongodb";
import { type Connection } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";

/**
 * Edição de **campo aninhado** de documento no MongoDB, pelo app inteiro.
 *
 * O que os testes travam:
 * - editar `endereco.cidade` grava só o campo aninhado e preserva o resto;
 * - a guarda otimista sobre o path aninhado pega mudança concorrente (409);
 * - a regressão de segurança: `$where`, `endereco.$gt`, um segmento `$op` e um
 *   campo desconhecido (`__proto__`) são recusados — a tentativa de injeção é
 *   reproduzida e a recusa provada (502, nada gravado).
 *
 * Container efêmero próprio, porta própria — como os demais `*.integration`.
 */

const CONTAINER = "dbee-mongo-aninhado";
const PORTA = 55554;
const SENHA = "Kp3xR9nT7wLd";
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
    name: "mongo-aninhado", engine: "mongodb",
    host: "127.0.0.1", port: PORTA, database: "loja",
    username: "leitor", password: SENHA, authSource: "admin", sslMode: "disable",
    writeUsername: "gravador", writePassword: SENHA,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Connection;
}

/** Lê um documento por fora do app, com root, para conferir a escrita. */
async function doc(id: number): Promise<Record<string, unknown> | null> {
  const c = new MongoClient(`mongodb://root:${SENHA}@127.0.0.1:${String(PORTA)}/?authSource=admin`);
  await c.connect();
  const d = await c.db("loja").collection("cliente").findOne({ _id: id as never });
  await c.close();
  return d;
}

/** A cidade aninhada (`endereco.cidade`) de um documento lido, ou undefined. */
async function cidadeDe(id: number): Promise<unknown> {
  const endereco = (await doc(id))?.["endereco"] as Record<string, unknown> | undefined;
  return endereco?.["cidade"];
}

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER,
    "-e", `MONGO_INITDB_ROOT_USERNAME=root`, "-e", `MONGO_INITDB_ROOT_PASSWORD=${SENHA}`,
    "-p", `${String(PORTA)}:27017`, "mongo:6");

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

  // Documentos com campo aninhado (endereco.cidade / endereco.cep) e o par de
  // usuários (leitor read, gravador readWrite em loja).
  const seed = `
    db = db.getSiblingDB('loja');
    db.cliente.insertMany([
      {_id:1, nome:'Ana', endereco:{cidade:'Recife', cep:'50000-000'}, tags:['ouro']},
      {_id:2, nome:'Bia', endereco:{cidade:'Olinda', cep:'53000-000'}, tags:['prata']}
    ]);
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

describe.skipIf(pular)("edição de campo aninhado no MongoDB", () => {
  it("edita endereco.cidade e preserva o resto do documento", async () => {
    const c = await conexao();
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie, {
      database: "loja", schema: "loja", table: "cliente", readOnly: false,
      pk: [{ column: "_id", value: "1" }],
      changes: [{ column: "endereco.cidade", from: "Recife", to: "Caruaru" }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const d = await doc(1);
    const endereco = d?.["endereco"] as Record<string, unknown> | undefined;
    // Só a cidade mudou; o cep aninhado e o nome de topo ficaram intactos, e o
    // sub-documento não foi reescrito.
    expect(endereco?.["cidade"]).toBe("Caruaru");
    expect(endereco?.["cep"]).toBe("50000-000");
    expect(d?.["nome"]).toBe("Ana");
  });

  it("a guarda otimista sobre o path aninhado pega mudança concorrente", async () => {
    const c = await conexao();
    const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie, {
      database: "loja", schema: "loja", table: "cliente", readOnly: false,
      pk: [{ column: "_id", value: "2" }],
      // `from` errado de propósito: a cidade de _id:2 é 'Olinda', não 'Jaboatão'.
      changes: [{ column: "endereco.cidade", from: "Jaboatão", to: "X" }],
    });
    expect(res.status).toBe(409);
    // Nada mudou.
    expect(await cidadeDe(2)).toBe("Olinda");
  });

  // A regressão de segurança: cada tentativa de injeção é reproduzida e a recusa
  // provada. MutacaoError → upstream_error (502), e o documento fica intacto.
  const injecoes: readonly { nome: string; column: string }[] = [
    { nome: "$where (operador de topo)", column: "$where" },
    { nome: "endereco.$gt (operador no segmento aninhado)", column: "endereco.$gt" },
    { nome: "endereco.$op (operador arbitrário)", column: "endereco.$op" },
    { nome: "__proto__ (campo desconhecido no catálogo)", column: "__proto__" },
    { nome: "endereco.pais (campo aninhado nunca amostrado)", column: "endereco.pais" },
    { nome: "endereco. cidade (espaço no segmento)", column: "endereco. cidade" },
  ];

  for (const inj of injecoes) {
    it(`recusa a injeção: ${inj.nome}`, async () => {
      const c = await conexao();
      const res = await chamar("POST", `/connections/${c.id}/rows/update`, adminCookie, {
        database: "loja", schema: "loja", table: "cliente", readOnly: false,
        pk: [{ column: "_id", value: "1" }],
        changes: [{ column: inj.column, from: "x", to: "y" }],
      });
      expect(res.status, `${inj.nome} deveria ser recusada`).toBe(502);
      // A cidade real (do primeiro teste, 'Caruaru') segue intacta — nada gravou.
      expect(await cidadeDe(1)).toBe("Caruaru");
    });
  }
});
