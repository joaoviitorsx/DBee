import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { capacidadesDe, type Engine } from "@dbee/shared/puro";

import type { ResolvedConnection } from "../db/connections.repo";
import { executarSql } from "../libsql/cliente";
import { PoolManager } from "../pg/pool";
import { DriverLibsql } from "./libsql";
import { DriverMysql } from "./mysql";
import { DriverPostgres } from "./postgres";
import type { DriverLeitura } from "./tipos";

/**
 * **O mesmo teste, contra as três engines.**
 *
 * A interface `DriverLeitura` foi extraída depois de dois drivers existirem, e
 * não antes — a forma certa de uma abstração aparece com o segundo caso. Este
 * arquivo é o que prova que ela é real: as asserções são escritas **uma vez** e
 * rodam contra PostgreSQL, MySQL, MariaDB e libSQL de verdade.
 *
 * Se um driver precisar de um `if` numa asserção, a abstração está errada. Onde
 * as engines legitimamente divergem — o nível de schema, o rótulo de comando —
 * a asserção afirma o que é comum, e a diferença tem teste próprio no arquivo
 * da engine.
 *
 * **A exceção é capacidade declarada.** O cancelamento não existe no protocolo
 * do libSQL, e `capacidadesDe("libsql").cancelarQuery` é `false` — a tela nem
 * mostra o botão. Ali o teste lê a capacidade e afirma **o outro lado**: que o
 * driver não entrega token e que cancelar devolve `false`. Isso não é o `if`
 * proibido escondendo divergência; é a divergência declarada em tabela sendo
 * verificada dos dois lados.
 *
 * A preparação de cada alvo (subir container, semear) ramifica por engine, e
 * isso é esperado: semear é falar o protocolo de administração de cada
 * servidor, não exercitar o contrato.
 */

interface Alvo {
  readonly nome: string;
  readonly engine: Engine;
  readonly container: string;
  readonly porta: number;
  readonly imagem: string;
  readonly ambiente: string[];
  readonly usuario: string;
  readonly pronto: (c: string) => boolean;
  readonly semear: readonly string[];
  /** Semeia por HTTP em vez de `docker exec` (libSQL não tem cliente CLI). */
  readonly semearPorHttp?: boolean;
  driver?: DriverLeitura;
  conexao?: ResolvedConnection;
}

const SENHA = "Dr7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

const TABELA_SQL = "CREATE TABLE peca (id INT PRIMARY KEY, nome VARCHAR(40), vazio VARCHAR(10))";
const LINHAS_SQL = "INSERT INTO peca (id, nome, vazio) VALUES (1,'um',NULL),(2,'dois',NULL),(3,'tres',NULL)";

/** A porta em que cada servidor escuta dentro do container. */
const PORTA_INTERNA: Partial<Record<Engine, string>> = {
  postgres: "5432",
  mysql: "3306",
  mariadb: "3306",
  libsql: "8080",
};

const ALVOS: Alvo[] = [
  {
    nome: "PostgreSQL 16",
    engine: "postgres",
    container: "dbee-drv-pg",
    porta: 55516,
    imagem: "postgres:16",
    ambiente: ["-e", `POSTGRES_PASSWORD=${SENHA}`, "-e", "POSTGRES_DB=loja"],
    usuario: "postgres",
    pronto: (c) => sh("docker", "exec", c, "psql", "-U", "postgres", "-d", "loja", "-tAc", "SELECT 1"),
    semear: [TABELA_SQL, LINHAS_SQL],
  },
  {
    nome: "MySQL 8.4",
    engine: "mysql",
    container: "dbee-drv-my",
    porta: 55517,
    imagem: "mysql:8.4",
    ambiente: ["-e", `MYSQL_ROOT_PASSWORD=${SENHA}`, "-e", "MYSQL_DATABASE=loja"],
    usuario: "root",
    /*
     * A sonda fala **TCP com o database `loja`**, não o socket com `SELECT 1`.
     * A entrada do MySQL sobe um servidor temporário só no socket para rodar a
     * inicialização e só depois reinicia o de verdade: uma sonda por socket
     * responde "pronto" antes de a porta existir e antes de `loja` existir, e o
     * seed seguinte falha com "CREATE TABLE falhou" — que foi o que aconteceu.
     */
    pronto: (c) =>
      sh("docker", "exec", c, "mysql", `-p${SENHA}`, "-h", "127.0.0.1", "--protocol=TCP",
         "loja", "-e", "SELECT 1"),
    semear: [TABELA_SQL, LINHAS_SQL],
  },
  {
    nome: "MariaDB 11",
    engine: "mariadb",
    container: "dbee-drv-ma",
    porta: 55518,
    imagem: "mariadb:11",
    ambiente: ["-e", `MARIADB_ROOT_PASSWORD=${SENHA}`, "-e", "MARIADB_DATABASE=loja"],
    usuario: "root",
    // Mesma razão do MySQL: TCP e o database de destino, não o socket.
    pronto: (c) =>
      sh("docker", "exec", c, "mariadb", `-p${SENHA}`, "-h", "127.0.0.1", "--protocol=TCP",
         "loja", "-e", "SELECT 1"),
    semear: [TABELA_SQL, LINHAS_SQL],
  },
  {
    nome: "libSQL",
    engine: "libsql",
    container: "dbee-drv-ls",
    porta: 55519,
    imagem: "ghcr.io/tursodatabase/libsql-server:latest",
    ambiente: [],
    // Não há usuário: a credencial é o token, e este servidor sobe sem
    // `SQLD_AUTH_JWT_KEY`.
    usuario: "",
    // `/health` é a sonda do próprio `sqld`. `curl` não existe na imagem, então
    // ela é feita de fora, do lado do teste — ver `beforeAll`.
    pronto: () => true,
    /*
     * `INTEGER PRIMARY KEY` e não `INT PRIMARY KEY`: no SQLite só a primeira
     * forma é o rowid, e a tabela precisa de chave primária para o keyset.
     */
    semear: [
      "CREATE TABLE peca (id INTEGER PRIMARY KEY, nome TEXT, vazio TEXT)",
      LINHAS_SQL,
    ],
    semearPorHttp: true,
  },
];

let pools: PoolManager | undefined;

function conexao(alvo: Alvo): ResolvedConnection {
  return {
    id: `drv-${alvo.container}`, name: alvo.nome, color: null,
    engine: alvo.engine,
    host: "127.0.0.1", port: alvo.porta, database: "loja",
    username: alvo.usuario, password: SENHA,
    sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
    writeEnabled: false, hasWriteCredential: false, createdAt: "", updatedAt: "",
  };
}

beforeAll(async () => {
  if (!temDocker) return;
  pools = new PoolManager(undefined);

  for (const alvo of ALVOS) {
    sh("docker", "rm", "-f", alvo.container);
    sh("docker", "run", "-d", "--name", alvo.container, ...alvo.ambiente,
      "-p", `${String(alvo.porta)}:${PORTA_INTERNA[alvo.engine] ?? "3306"}`, alvo.imagem);
  }

  for (const alvo of ALVOS) {
    let ok = false;
    for (let i = 0; i < 160; i++) {
      if (alvo.semearPorHttp === true) {
        // O `sqld` não traz `curl`: a sonda vai de fora, pela porta publicada.
        try {
          const r = await fetch(`http://127.0.0.1:${String(alvo.porta)}/health`);
          if (r.ok) { ok = true; break; }
        } catch { /* subindo */ }
      } else if (alvo.pronto(alvo.container)) { ok = true; break; }
      await Bun.sleep(500);
    }
    if (!ok) throw new Error(`${alvo.nome} não ficou pronto`);

    alvo.conexao = conexao(alvo);
    alvo.driver =
      alvo.engine === "postgres"
        ? new DriverPostgres(pools, undefined)
        : alvo.engine === "libsql"
          ? new DriverLibsql()
          : new DriverMysql(undefined);

    // Semeia por fora do driver: ele é de leitura, e semear por ele seria pedir
    // o que ele não promete.
    if (alvo.semearPorHttp === true) {
      await executarSql(
        { url: `http://127.0.0.1:${String(alvo.porta)}`, token: null },
        alvo.semear.map((sql) => ({ sql })),
      );
      continue;
    }

    for (const sql of alvo.semear) {
      const cmd = alvo.engine === "postgres"
        ? ["docker", "exec", alvo.container, "psql", "-U", "postgres", "-d", "loja", "-c", sql]
        : ["docker", "exec", alvo.container, alvo.engine === "mysql" ? "mysql" : "mariadb",
           `-p${SENHA}`, "loja", "-e", sql];
      if (!sh(...cmd)) throw new Error(`seed de ${alvo.nome} falhou: ${sql}`);
    }
  }
}, 300_000);

afterAll(async () => {
  for (const alvo of ALVOS) await alvo.driver?.desligar();
  await pools?.shutdown();
  for (const alvo of ALVOS) sh("docker", "rm", "-f", alvo.container);
});

for (const alvo of ALVOS) {
  describe(`contrato de leitura — ${alvo.nome}`, () => {
    const dv = (): DriverLeitura | undefined => alvo.driver;
    const cx = (): ResolvedConnection | undefined => alvo.conexao;

    it("o teste de conexão responde com a versão do servidor", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      expect(d).toBeDefined(); expect(c).toBeDefined();
      if (d === undefined || c === undefined) return;
      const r = await d.testarConexao(c);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.serverVersion.length).toBeGreaterThan(0);
    }, 90_000);

    it("lista os databases, marcando o da conexão", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      const dbs = await d.listarDatabases(c, c.database);
      expect(dbs.map((x) => x.name)).toContain("loja");
      expect(dbs.find((x) => x.name === "loja")?.isDefault).toBe(true);
    }, 90_000);

    it("a árvore traz a tabela semeada", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      const arvore = await d.arvore(c, c.database);
      expect(arvore.database).toBe("loja");
      const nomes = arvore.schemas.flatMap((s) => s.relations.map((r) => r.name));
      expect(nomes).toContain("peca");
    }, 90_000);

    /*
     * Regra 10 pelas três engines, pela mesma asserção: célula é string ou
     * null, nunca number, Date ou Buffer.
     */
    it("executa e devolve toda célula como string, com NULL preservado", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      const r = await d.executar(c, {
        sql: "SELECT id, nome, vazio FROM peca ORDER BY id",
        database: c.database, maxRows: 100, somenteLeitura: true,
      });
      expect(r.error, JSON.stringify(r.error)).toBeNull();
      const primeiro = r.results[0];
      expect(primeiro).toBeDefined();
      if (primeiro === undefined) return;
      expect(primeiro.columns.map((x) => x.name)).toEqual(["id", "nome", "vazio"]);
      expect(primeiro.rows).toHaveLength(3);
      expect(primeiro.rows[0]?.[0]).toBe("1");
      expect(primeiro.rows[0]?.[1]).toBe("um");
      expect(primeiro.rows[0]?.[2], "NULL não pode virar string vazia").toBeNull();
      for (const linha of primeiro.rows) {
        for (const celula of linha) {
          if (celula !== null) expect(typeof celula).toBe("string");
        }
      }
    }, 90_000);

    it("trunca em maxRows e diz que truncou", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      const r = await d.executar(c, {
        sql: "SELECT id FROM peca ORDER BY id",
        database: c.database, maxRows: 2, somenteLeitura: true,
      });
      expect(r.results[0]?.rows).toHaveLength(2);
      expect(r.results[0]?.truncated).toBe(true);
    }, 90_000);

    it("SQL inválido vira erro com índice do statement, e não exceção", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      const r = await d.executar(c, {
        sql: "SELECT * FROM tabela_que_nao_existe",
        database: c.database, maxRows: 10, somenteLeitura: true,
      });
      expect(r.error).not.toBeNull();
      expect(r.error?.index).toBe(0);
      expect(r.error?.message.length).toBeGreaterThan(0);
    }, 90_000);

    /*
     * O cancelamento é **capacidade declarada**, e o teste lê a tabela em vez
     * de presumir. Onde ela diz `true`, o driver tem que entregar o token —
     * sem token não há como cancelar. Onde diz `false` (libSQL: o protocolo
     * não oferece), ele tem que **não** entregar: um token ali seria a
     * promessa de um cancelamento que não acontece.
     */
    it("o token de cancelamento segue a capacidade declarada da engine", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      let token = 0;
      await d.executar(c, {
        sql: "SELECT id FROM peca",
        database: c.database, maxRows: 10, somenteLeitura: true,
        aoIniciar: (t) => { token = t; },
      });
      if (capacidadesDe(alvo.engine)?.cancelarQuery === true) {
        expect(token, "sem token não há como cancelar").toBeGreaterThan(0);
      } else {
        expect(token, "engine sem cancelamento não pode entregar token").toBe(0);
      }
    }, 90_000);

    it("cancelar algo que não existe devolve false, sem lançar", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      expect(await d.cancelar(c, c.database, 999_999_999)).toBe(false);
    }, 90_000);

    it("esquecer a conexão não quebra o driver", async () => {
      if (!temDocker) return;
      const d = dv(); const c = cx();
      if (d === undefined || c === undefined) return;
      await d.esquecer(c.id);
      const r = await d.executar(c, {
        sql: "SELECT id FROM peca ORDER BY id LIMIT 1",
        database: c.database, maxRows: 10, somenteLeitura: true,
      });
      expect(r.error).toBeNull();
      expect(r.results[0]?.rows[0]?.[0]).toBe("1");
    }, 90_000);
  });
}
