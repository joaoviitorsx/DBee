import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import { ehCortePorTempo, saborDaVersao, sqlDeTimeout } from "./sessao";

/**
 * O limite de tempo por consulta, contra os dois servidores reais.
 *
 * A primeira versão de `sessao.ts` reconhecia o corte pelo **nome** do código de
 * erro. Funcionava no MySQL e falhava calada no MariaDB, que não manda nome
 * nenhum — só `errno`. Este arquivo existe para essa correção não se perder.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-ses-mysql", porta: 55506, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE", sabor: "mysql" as const },
  { nome: "MariaDB 11", container: "dbee-ses-mariadb", porta: 55507, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE", sabor: "mariadb" as const },
] as const;

const SENHA = "Se7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const conexoes = new Map<string, mysql.Connection>();
const versoes = new Map<string, string>();

beforeAll(async () => {
  if (!temDocker) return;
  for (const s of SERVIDORES) {
    sh("docker", "rm", "-f", s.container);
    sh("docker", "run", "-d", "--name", s.container,
      "-e", `${s.envSenha}=${SENHA}`, "-e", `${s.envDb}=loja`,
      "-p", `${String(s.porta)}:3306`, s.imagem);
  }
  for (const s of SERVIDORES) {
    for (let i = 0; i < 120; i++) {
      try {
        const c = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA,
          database: "loja", connectTimeout: 1000,
        });
        const [v] = await c.query<mysql.RowDataPacket[]>("SELECT VERSION() AS v");
        versoes.set(s.nome, String(v[0]?.["v"] ?? ""));
        conexoes.set(s.nome, c);
        break;
      } catch { await Bun.sleep(500); }
    }
    if (!conexoes.has(s.nome)) throw new Error(`${s.nome} não ficou pronto`);
  }
}, 240_000);

afterAll(async () => {
  for (const c of conexoes.values()) { try { await c.end(); } catch { /* já foi */ } }
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`sessão em ${s.nome} real`, () => {
    it("o sabor é reconhecido pela string de versão do próprio servidor", () => {
      if (!temDocker) return;
      expect(saborDaVersao(versoes.get(s.nome) ?? "")).toBe(s.sabor);
    });

    it("o SQL de timeout é aceito — a variável existe neste servidor", async () => {
      if (!temDocker) return;
      const c = conexoes.get(s.nome);
      expect(c).toBeDefined();
      if (c === undefined) return;
      // Aceito sem erro é o ponto: a variável do outro sabor não existe aqui.
      await c.query(sqlDeTimeout(s.sabor, 1500));
    }, 30_000);

    it("a variável do OUTRO sabor não existe — é por isso que há dois SQLs", async () => {
      if (!temDocker) return;
      const c = conexoes.get(s.nome);
      if (c === undefined) return;
      const outro = s.sabor === "mysql" ? "mariadb" : "mysql";
      let falhou = false;
      try {
        await c.query(sqlDeTimeout(outro, 1500));
      } catch {
        falhou = true;
      }
      expect(falhou, `${s.nome} aceitou a variável de ${outro} — a divisão pode ser desnecessária`).toBe(true);
    }, 30_000);

    it("a consulta pesada é cortada, e o corte é reconhecido pelo errno", async () => {
      if (!temDocker) return;
      const c = conexoes.get(s.nome);
      if (c === undefined) return;
      await c.query(sqlDeTimeout(s.sabor, 800));
      const inicio = Date.now();
      let capturado: unknown;
      try {
        await c.query(
          "SELECT COUNT(*) FROM information_schema.columns a, information_schema.columns b, information_schema.columns c",
        );
      } catch (e) {
        capturado = e;
      }
      expect(capturado, "a consulta deveria ter sido cortada").toBeDefined();
      expect(ehCortePorTempo(capturado), JSON.stringify(capturado)).toBe(true);
      // Cortou perto do limite, e não depois de terminar sozinha.
      expect(Date.now() - inicio).toBeLessThan(8000);
      // Devolve a sessão a um estado utilizável para os testes seguintes.
      await c.query(sqlDeTimeout(s.sabor, 30_000));
    }, 60_000);
  });
}

/*
 * A armadilha do MySQL, medida: `SELECT SLEEP` cortado por tempo volta SEM
 * erro, com o valor 1. Um executor que confie na ausência de erro relataria
 * sucesso numa consulta interrompida.
 *
 * Fica travado como conhecimento: se um dia o MySQL passar a levantar erro
 * aqui, o teste falha e o comentário que avisa sobre isso pode ser revisto.
 */
describe("o corte silencioso do MySQL", () => {
  it("SELECT SLEEP cortado volta sem erro, com 1", async () => {
    if (!temDocker) return;
    const c = conexoes.get("MySQL 8.4");
    expect(c).toBeDefined();
    if (c === undefined) return;
    await c.query(sqlDeTimeout("mysql", 700));
    const inicio = Date.now();
    const [r] = await c.query<mysql.RowDataPacket[]>("SELECT SLEEP(5) AS s");
    const decorrido = Date.now() - inicio;
    expect(decorrido).toBeLessThan(3000);
    expect(String(r[0]?.["s"])).toBe("1");
    await c.query(sqlDeTimeout("mysql", 30_000));
  }, 60_000);
});
