import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import type { ResolvedConnection } from "../db/connections.repo";
import { testConnectionMysql } from "./test-connection";

/**
 * Teste de conexão contra MySQL e MariaDB reais.
 *
 * O que ele mede não é "conectou": é **o que a conexão não garante**. No
 * Postgres o teste abre `BEGIN READ ONLY` e com isso exercita a proteção. Aqui
 * não há proteção para exercitar — a garantia mora na credencial
 * (`docs/papeis-mysql.md`) — então o teste olha os privilégios e o aviso é o
 * produto.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-tc-mysql", porta: 55504, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE" },
  { nome: "MariaDB 11", container: "dbee-tc-mariadb", porta: 55505, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE" },
] as const;

const SENHA_ROOT = "Tc7pQz2mVx4T";
const SENHA_USUARIO = "Us7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

/** Uma conexão resolvida com os campos que o teste de conexão usa. */
function conexao(porta: number, usuario: string, senha: string, extra: Partial<ResolvedConnection> = {}): ResolvedConnection {
  return {
    id: "c1", name: "teste", color: null, engine: "mysql",
    host: "127.0.0.1", port: porta, database: "loja",
    username: usuario, password: senha,
    sslMode: "disable", timezone: "UTC", statementTimeoutMs: 5000,
    writeEnabled: false, hasWriteCredential: false, authSource: null, createdAt: "", updatedAt: "",
    ...extra,
  };
}

beforeAll(async () => {
  if (!temDocker) return;
  for (const s of SERVIDORES) {
    sh("docker", "rm", "-f", s.container);
    sh("docker", "run", "-d", "--name", s.container,
      "-e", `${s.envSenha}=${SENHA_ROOT}`, "-e", `${s.envDb}=loja`,
      "-p", `${String(s.porta)}:3306`, s.imagem);
  }
  for (const s of SERVIDORES) {
    let pronto: mysql.Connection | undefined;
    for (let i = 0; i < 120; i++) {
      try {
        const c = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA_ROOT,
          database: "loja", connectTimeout: 1000,
        });
        await c.query("SELECT 1");
        pronto = c;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (pronto === undefined) throw new Error(`${s.nome} não ficou pronto`);
    for (const p of [
      "CREATE TABLE clientes (id INT PRIMARY KEY, nome VARCHAR(60))",
      `CREATE USER 'so_leitura'@'%' IDENTIFIED BY '${SENHA_USUARIO}'`,
      "GRANT SELECT ON loja.* TO 'so_leitura'@'%'",
      `CREATE USER 'escreve'@'%' IDENTIFIED BY '${SENHA_USUARIO}'`,
      "GRANT SELECT, INSERT, UPDATE, DELETE ON loja.* TO 'escreve'@'%'",
      `CREATE USER 'com_file'@'%' IDENTIFIED BY '${SENHA_USUARIO}'`,
      "GRANT SELECT ON loja.* TO 'com_file'@'%'",
      "GRANT FILE ON *.* TO 'com_file'@'%'",
      // Uma coluna só, para provar que o aviso não depende de grant amplo.
      `CREATE USER 'uma_coluna'@'%' IDENTIFIED BY '${SENHA_USUARIO}'`,
      "GRANT SELECT ON loja.* TO 'uma_coluna'@'%'",
      "GRANT UPDATE (nome) ON loja.clientes TO 'uma_coluna'@'%'",
      "FLUSH PRIVILEGES",
    ]) await pronto.query(p);
    await pronto.end();
  }
}, 240_000);

afterAll(() => {
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`teste de conexão contra ${s.nome} real`, () => {
    it("credencial só de leitura conecta e não gera aviso nenhum", async () => {
      if (!temDocker) return;
      const r = await testConnectionMysql(conexao(s.porta, "so_leitura", SENHA_USUARIO), undefined);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toEqual([]);
      expect(r.serverVersion.length).toBeGreaterThan(0);
    }, 60_000);

    /*
     * O aviso que é o produto desta fatia. Sem ele a tela diz "modo leitura"
     * sobre uma conexão que apaga tabela, e a pessoa acredita.
     */
    it("credencial com escrita avisa que o modo leitura não é barreira", async () => {
      if (!temDocker) return;
      const r = await testConnectionMysql(conexao(s.porta, "escreve", SENHA_USUARIO), undefined);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const aviso = r.warnings.find((w) => w.code === "credential_can_write");
      expect(aviso, "faltou o aviso de credencial gravável").toBeDefined();
      expect(aviso?.message).toContain("INSERT");
      expect(aviso?.message).toContain("DELETE");
      // Precisa dizer o que fazer, senão vira ruído que se aprende a ignorar.
      expect(aviso?.message).toContain("GRANT SELECT");
    }, 60_000);

    /*
     * Grant de UMA coluna. É o caso que uma checagem preguiçosa perde — olhar
     * só privilégio global ou de database não veria nada aqui, e a conexão
     * escreveria mesmo assim.
     */
    it("basta UPDATE numa única coluna para o aviso aparecer", async () => {
      if (!temDocker) return;
      const r = await testConnectionMysql(conexao(s.porta, "uma_coluna", SENHA_USUARIO), undefined);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings.some((w) => w.code === "credential_can_write")).toBe(true);
    }, 60_000);

    it("privilégio FILE alcança o host do banco, e é dito", async () => {
      if (!temDocker) return;
      const r = await testConnectionMysql(conexao(s.porta, "com_file", SENHA_USUARIO), undefined);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const aviso = r.warnings.find((w) => w.code === "privileged_role");
      expect(aviso).toBeDefined();
      expect(aviso?.message).toContain("FILE");
      // FILE não é escrita no banco: os dois avisos são independentes.
      expect(r.warnings.some((w) => w.code === "credential_can_write")).toBe(false);
    }, 60_000);

    /*
     * CLAUDE.md regra 5. Este projeto já devolveu a senha do banco em claro num
     * 422, e nenhum teste unitário pegou — foi revisão adversarial. Aqui fica
     * travado no caminho de erro, que é onde aconteceu.
     */
    it("senha errada falha sem jamais devolver a senha", async () => {
      if (!temDocker) return;
      const segredo = "SenhaSuperSecreta123";
      const r = await testConnectionMysql(conexao(s.porta, "so_leitura", segredo), undefined);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(JSON.stringify(r)).not.toContain(segredo);
      expect(r.message.length).toBeGreaterThan(0);
    }, 60_000);

    /*
     * A recusa de `verify-full` por IP acontece ANTES de discar — o retorno é
     * de configuração, e o servidor nem é procurado.
     */
    it("verify-full por IP é recusado sem sequer tentar conectar", async () => {
      if (!temDocker) return;
      const r = await testConnectionMysql(
        conexao(s.porta, "so_leitura", SENHA_USUARIO, { sslMode: "verify-full" }),
        undefined,
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe("ssl_mode_unsupported");
      expect(r.message).toContain("127.0.0.1");
      expect(r.message).toContain("hostname DNS");
    }, 30_000);
  });
}
