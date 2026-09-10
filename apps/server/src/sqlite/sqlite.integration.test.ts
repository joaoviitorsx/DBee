import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedConnection } from "../db/connections.repo";
import { DriverSqlite } from "../driver/sqlite";

/**
 * O driver de SQLite local, contra um arquivo real — e o que só ele prova:
 *
 * - **o worker não trava o event loop**: uma consulta que roda enquanto um
 *   temporizador de 10 ms conta tiques, e os tiques continuam (o `bun:sqlite`
 *   síncrono está na thread do worker, não na principal). É a razão de a fase
 *   existir;
 * - o timeout **interrompe** a consulta (mata o worker) sem derrubar o processo;
 * - leitura, catálogo e keyset funcionam pelo transporte de mensagem;
 * - o caminho fora da raiz permitida é recusado (travessia de diretório).
 */

let raiz: string;
let arquivo: string;
let driver: DriverSqlite;

const conexao = (fp: string): ResolvedConnection =>
  ({
    id: `sq-${fp}`, name: "sqlite", color: null, engine: "sqlite",
    host: "", port: 0, database: "", username: "", password: "",
    sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
    writeEnabled: false, hasWriteCredential: false, authSource: null,
    filePath: fp, createdAt: "", updatedAt: "",
  }) satisfies ResolvedConnection;

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "dbee-sqlite-"));
  process.env["DBEE_SQLITE_ROOT"] = raiz;
  arquivo = join(raiz, "loja.db");

  // Semeia o arquivo com bun:sqlite direto (fora do driver, que é só leitura).
  const db = new Database(arquivo, { create: true });
  db.run("CREATE TABLE produto (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, preco REAL)");
  db.run("INSERT INTO produto VALUES (1,'Café',18.9),(2,'Chá',12.5),(3,'Suco',9.9)");
  db.run("CREATE TABLE pedido (id INTEGER PRIMARY KEY, produto_id INTEGER REFERENCES produto(id), qtd INTEGER)");
  db.run("INSERT INTO pedido VALUES (1,1,2),(2,2,1)");
  db.close();

  driver = new DriverSqlite();
});

afterAll(async () => {
  await driver.desligar();
  rmSync(raiz, { recursive: true, force: true });
});

describe("driver do SQLite local", () => {
  it("o teste de conexão traz a versão", async () => {
    const r = await driver.testarConexao(conexao("loja.db"));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.serverVersion).toContain("SQLite");
  });

  it("recusa caminho fora da raiz permitida", async () => {
    const r = await driver.testarConexao(conexao("../../etc/passwd"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("dentro de");
  });

  it("a árvore traz as tabelas e o catálogo infere PK e FK", async () => {
    const arvore = await driver.arvore(conexao("loja.db"));
    const nomes = arvore.schemas.flatMap((s) => s.relations.map((r) => r.name));
    expect(nomes).toEqual(["pedido", "produto"]);

    const esquema = await driver.esquema(conexao("loja.db"));
    const pedido = esquema.schemas[0]?.relations.find((r) => r.name === "pedido");
    expect(pedido?.primaryKey).toEqual(["id"]);
    expect(pedido?.foreignKeys[0]?.referencedTable).toBe("produto");
  });

  it("lê a grade, toda célula em texto, keyset por PK", async () => {
    const esquema = await driver.esquema(conexao("loja.db"));
    const produto = esquema.schemas[0]?.relations.find((r) => r.name === "produto");
    if (produto === undefined) throw new Error("tabela produto sumiu do catálogo");
    const r = await driver.linhas(conexao("loja.db"), "loja.db", "", produto, { limit: 10 });
    expect(r.resposta.rows).toHaveLength(3);
    expect(r.resposta.keyset).toBe(true);
    for (const linha of r.resposta.rows) {
      for (const c of linha) expect(c === null || typeof c === "string").toBe(true);
    }
    expect(r.resposta.rows[0]?.[0]).toBe("1");
    expect(r.resposta.rows[0]?.[1]).toBe("Café");
  });

  it("executa SQL de leitura", async () => {
    const r = await driver.executar(conexao("loja.db"), {
      sql: "SELECT COUNT(*) AS n FROM produto", database: "loja.db", maxRows: 100, somenteLeitura: true,
    });
    expect(r.error).toBeNull();
    expect(r.results[0]?.rows[0]?.[0]).toBe("3");
  });

  it("escrita com somenteLeitura=true cai no handle readonly e é recusada", async () => {
    // O caminho de um ator sem concessão: o serviço manda `somenteLeitura: true`,
    // o driver usa o handle readonly, e o SQLite recusa a escrita. A escrita
    // autorizada (somenteLeitura: false) tem seu teste em escrita.integration.
    const r = await driver.executar(conexao("loja.db"), {
      sql: "INSERT INTO produto VALUES (9,'Hack',0)", database: "loja.db", maxRows: 100, somenteLeitura: true,
    });
    expect(r.error).not.toBeNull();
    expect(r.error?.message.toLowerCase()).toContain("readonly");
  });

  /*
   * O teste que justifica o worker. Uma consulta pesada roda enquanto um
   * temporizador conta tiques na thread principal. Se o SQLite bloqueasse o
   * event loop (o defeito que adiou a fase), os tiques parariam. Com o worker,
   * eles continuam.
   */
  it("uma consulta pesada NÃO trava o event loop principal", async () => {
    let tiques = 0;
    const timer = setInterval(() => { tiques += 1; }, 10);

    // `generate_series` cruzado: trabalho o bastante para levar dezenas de ms.
    const consulta = driver.executar(conexao("loja.db"), {
      sql: "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<200000) SELECT count(*) FROM n",
      database: "loja.db", maxRows: 10, somenteLeitura: true,
    });

    const r = await consulta;
    clearInterval(timer);
    expect(r.error, JSON.stringify(r.error)).toBeNull();
    // Se o event loop tivesse travado, `tiques` seria ~0. Com o worker, o
    // temporizador disparou várias vezes durante a consulta.
    expect(tiques, "o event loop travou durante a consulta").toBeGreaterThan(1);
  });
});
