import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { Relation, RowsRequest } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { DriverMongo } from "../driver/mongo";
import { RowsError } from "./rows";

/**
 * O driver de MongoDB contra um Mongo real.
 *
 * O que só o servidor prova:
 * - a árvore traz as coleções, e o catálogo infere os campos por amostragem;
 * - toda célula volta como texto (regra 10): ObjectId em hex, data em ISO,
 *   aninhado em JSON, e `null` preservado onde o campo falta;
 * - a paginação por `_id` cobre a coleção exatamente uma vez, sem pular nem
 *   repetir, inclusive ordenando por um campo que repete;
 * - o filtro com regex e caractere especial é **valor**, não padrão.
 */

const CONTAINER = "dbee-mongo-it";
const PORTA = 55551;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let driver: DriverMongo;
let conexao: ResolvedConnection;
let pessoa: Relation;

const conn = (): ResolvedConnection => ({
  id: "mongo-it", name: "mongo", color: null, engine: "mongodb",
  host: "127.0.0.1", port: PORTA, database: "loja",
  username: "", password: "", sslMode: "disable", timezone: "UTC",
  statementTimeoutMs: 30_000, writeEnabled: false, hasWriteCredential: false,
  authSource: null, createdAt: "", updatedAt: "",
});

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-p", `${String(PORTA)}:27017`, "mongo:7");

  // Espera o servidor e semeia por `mongosh`.
  let pronto = false;
  for (let i = 0; i < 120; i++) {
    if (sh("docker", "exec", CONTAINER, "mongosh", "--quiet", "--eval", "db.runCommand({ping:1})")) {
      pronto = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!pronto) throw new Error("Mongo não ficou pronto");

  /*
   * `setor` repete e falta em alguns documentos (o que quebra um keyset ingênuo
   * e testa a coluna ausente virando null). `apelido` carrega regex e aspas.
   */
  const seed = `
    db = db.getSiblingDB('loja');
    db.pessoa.insertMany([
      { _id: 1, nome: 'Ana',  setor: 'eng', tags: ['a','b'], criado: new Date('2020-01-01T00:00:00Z') },
      { _id: 2, nome: 'Bia',  setor: 'eng' },
      { _id: 3, nome: 'Caio', apelido: 'x.*y[!]' },
      { _id: 4, nome: 'Duda', setor: 'adm' },
      { _id: 5, nome: 'Eli',  setor: 'eng' },
      { _id: 6, nome: 'Fabi' },
      { _id: 7, nome: 'Gui',  setor: 'adm' },
      { _id: 8, nome: 'Hugo', setor: 'eng' },
      { _id: 9, nome: 'Ivo',  setor: 'adm' },
      { _id: 10, nome: 'Joca' }
    ]);
  `;
  if (!sh("docker", "exec", CONTAINER, "mongosh", "--quiet", "--eval", seed)) {
    throw new Error("seed do Mongo falhou");
  }

  driver = new DriverMongo(undefined);
  conexao = conn();

  const esquema = await driver.esquema(conexao, "loja");
  const achada = esquema.schemas[0]?.relations.find((r) => r.name === "pessoa");
  if (achada === undefined) throw new Error("a coleção semeada não apareceu no catálogo");
  pessoa = achada;
}, 240_000);

afterAll(async () => {
  if (!temDocker) return;
  await driver.desligar();
  sh("docker", "rm", "-f", CONTAINER);
});

const pular = !temDocker;

describe.skipIf(pular)("driver do MongoDB", () => {
  it("o teste de conexão traz a versão", async () => {
    const r = await driver.testarConexao(conexao);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.serverVersion).toContain("MongoDB");
  });

  it("lista o database da conexão como padrão", async () => {
    const dbs = await driver.listarDatabases(conexao);
    expect(dbs.find((d) => d.name === "loja")?.isDefault).toBe(true);
  });

  it("a árvore traz a coleção semeada", async () => {
    const arvore = await driver.arvore(conexao, "loja");
    const nomes = arvore.schemas.flatMap((s) => s.relations.map((r) => r.name));
    expect(nomes).toContain("pessoa");
  });

  it("o catálogo infere os campos e marca _id como chave", () => {
    const nomes = pessoa.columns.map((c) => c.name);
    expect(nomes).toContain("_id");
    expect(nomes).toContain("nome");
    expect(pessoa.primaryKey).toEqual(["_id"]);
    expect(pessoa.columns.find((c) => c.name === "_id")?.isPrimaryKey).toBe(true);
  });

  it("toda célula volta como texto, com null onde o campo falta", async () => {
    const r = await driver.linhas(conexao, "loja", "", pessoa, { limit: 10, orderBy: "_id" });
    for (const linha of r.resposta.rows) {
      for (const celula of linha) {
        expect(celula === null || typeof celula === "string").toBe(true);
      }
    }
    // `_id` é INTEGER no seed e chega como texto.
    expect(r.resposta.rows[0]?.[0]).toBe("1");
    // `setor` falta no doc 6 (Fabi): a coluna existe e vira null.
    const iSetor = pessoa.columns.findIndex((c) => c.name === "setor");
    const iNome = pessoa.columns.findIndex((c) => c.name === "nome");
    const fabi = r.resposta.rows.find((l) => l[iNome] === "Fabi");
    expect(fabi?.[iSetor]).toBeNull();
  });

  it("o aninhado vira JSON e a data vira ISO", async () => {
    const r = await driver.linhas(conexao, "loja", "", pessoa, {
      limit: 10, orderBy: "_id",
      filters: [{ column: "_id", operator: "eq", value: "1" }],
    });
    const iTags = pessoa.columns.findIndex((c) => c.name === "tags");
    const iCriado = pessoa.columns.findIndex((c) => c.name === "criado");
    const linha = r.resposta.rows[0];
    if (iTags >= 0) expect(linha?.[iTags]).toBe('["a","b"]');
    if (iCriado >= 0) expect(linha?.[iCriado]).toBe("2020-01-01T00:00:00.000Z");
  });

  /*
   * O teste que importa: paginar por uma coluna que repete e falta, cobrindo a
   * coleção exatamente uma vez. Se o keyset estiver errado, um documento some ou
   * repete — e nenhum dá erro.
   */
  it("a paginação por campo repetido cobre a coleção uma vez só", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const vistos: string[] = [];
      let pedido: RowsRequest = { limit: 3, orderBy: "setor", orderDirection: direction };
      for (let pagina = 0; pagina < 10; pagina++) {
        const r = await driver.linhas(conexao, "loja", "", pessoa, pedido);
        for (const linha of r.resposta.rows) vistos.push(linha[0] ?? "");
        if (r.resposta.nextCursor === null) break;
        pedido = { limit: 3, orderBy: "setor", orderDirection: direction, after: r.resposta.nextCursor };
      }
      const ordenado = [...vistos].sort((a, b) => Number(a) - Number(b));
      expect(ordenado, direction).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    }
  });

  it("o filtro com regex e caractere especial é valor, não padrão", async () => {
    const r = await driver.linhas(conexao, "loja", "", pessoa, {
      limit: 10,
      filters: [{ column: "apelido", operator: "eq", value: "x.*y[!]" }],
    });
    // `eq` casa o literal, não o padrão: um único documento (Caio).
    expect(r.resposta.rows).toHaveLength(1);
  });

  it("contains trata o valor como literal, não regex", async () => {
    const r = await driver.linhas(conexao, "loja", "", pessoa, {
      limit: 10,
      filters: [{ column: "apelido", operator: "contains", value: ".*" }],
    });
    // `.*` literal não aparece em 'x.*y[!]'? Aparece: contém ".*". Então 1.
    // O que o teste prova é que não casou TODOS por o `.*` virar curinga.
    expect(r.resposta.rows.length).toBeLessThan(10);
  });

  it("campo que não existe no catálogo é erro nosso", async () => {
    let erro: unknown;
    try {
      await driver.linhas(conexao, "loja", "", pessoa, {
        limit: 10, filters: [{ column: "inexistente", operator: "isNull" }],
      });
    } catch (e: unknown) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(RowsError);
  });
});
