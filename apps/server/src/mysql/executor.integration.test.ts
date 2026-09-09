import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import { erroDeConsulta, executarUm } from "./executor";
import { sqlDeTimeout } from "./sessao";

/**
 * O executor contra MySQL e MariaDB reais.
 *
 * O que ele precisa provar, e que nenhuma simulação provaria:
 *
 * - **Não traz a tabela inteira.** Sem cursor e sem poder injetar `LIMIT`
 *   (regra 8), o mecanismo é streaming com parada antecipada. Medido:
 *   262 144 linhas custam +75 MB em modo buffered e 6 ms parando em 101.
 * - **A conexão sobrevive à parada.** Destruir o fluxo no meio não pode
 *   inutilizar a conexão para a consulta seguinte.
 * - **Truncamento é detectado sem contar a tabela**, pela linha extra.
 * - Resultado vazio ainda traz as colunas.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-exec-mysql", porta: 55510, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE", sabor: "mysql" as const },
  { nome: "MariaDB 11", container: "dbee-exec-mariadb", porta: 55511, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE", sabor: "mariadb" as const },
] as const;

const SENHA = "Ex7pQz2mVx4T";
/** 2^15 = 32 768 linhas de ~180 bytes: grande o bastante para o buffered doer. */
const DUPLICACOES = 15;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const conexoes = new Map<string, mysql.Connection>();

/** Uma conexão com o contrato do driver: linhas em array, células em bytes. */
const abrirConexao = (porta: number): Promise<mysql.Connection> =>
  mysql.createConnection({
    host: "127.0.0.1", port: porta, user: "root", password: SENHA, database: "loja",
    rowsAsArray: true,
    typeCast: (campo) => campo.buffer(),
  });

beforeAll(async () => {
  if (!temDocker) return;
  for (const s of SERVIDORES) {
    sh("docker", "rm", "-f", s.container);
    sh("docker", "run", "-d", "--name", s.container,
      "-e", `${s.envSenha}=${SENHA}`, "-e", `${s.envDb}=loja`,
      "-p", `${String(s.porta)}:3306`, s.imagem);
  }
  for (const s of SERVIDORES) {
    let c: mysql.Connection | undefined;
    for (let i = 0; i < 120; i++) {
      try {
        const tentativa = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA, database: "loja",
          connectTimeout: 1000,
          // O contrato do driver: linhas em array, células em bytes crus.
          rowsAsArray: true,
          typeCast: (campo) => campo.buffer(),
        });
        await tentativa.query("SELECT 1");
        c = tentativa;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (c === undefined) throw new Error(`${s.nome} não ficou pronto`);

    /*
     * Número FIXO de duplicações, sem consultar o total no meio.
     *
     * A primeira versão lia `SELECT COUNT(*)` para decidir quando parar — e
     * esta conexão tem `rowsAsArray` e `typeCast` devolvendo bytes, então a
     * linha é um array de Buffer e `linha.c` é `undefined`. O total lia zero
     * para sempre, e o laço dobrou a tabela até o `beforeAll` estourar em
     * 300 s. Contagem fixa não tem como entrar nesse estado.
     */
    await c.query("CREATE TABLE grande (id INT PRIMARY KEY AUTO_INCREMENT, texto VARCHAR(200))");
    await c.query("INSERT INTO grande (texto) VALUES (REPEAT('x', 180))");
    for (let i = 0; i < DUPLICACOES; i++) {
      await c.query("INSERT INTO grande (texto) SELECT REPEAT('y', 180) FROM grande");
    }
    await c.query("CREATE TABLE vazia (id INT PRIMARY KEY, nome VARCHAR(20))");
    conexoes.set(s.nome, c);
  }
}, 300_000);

afterAll(async () => {
  for (const c of conexoes.values()) { try { await c.end(); } catch { /* já foi */ } }
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`executor contra ${s.nome} real`, () => {
    const conn = (): mysql.Connection | undefined => conexoes.get(s.nome);

    it("um SELECT simples volta com colunas, linhas e tudo em texto", async () => {
      if (!temDocker) return;
      const c = conn();
      expect(c).toBeDefined();
      if (c === undefined) return;

      const r = await executarUm(c, "SELECT id, texto FROM grande ORDER BY id LIMIT 3", 100);
      expect(r.columns.map((x) => x.name)).toEqual(["id", "texto"]);
      expect(r.columns[0]?.dataTypeName).toBe("int");
      expect(r.columns[1]?.dataTypeName).toBe("varchar");
      expect(r.rows).toHaveLength(3);
      expect(r.rowCount).toBe(3);
      expect(r.truncated).toBe(false);
      expect(r.command).toBe("SELECT");
      expect(r.viaCursor).toBe(false);
      // Regra 10: toda célula é string.
      for (const linha of r.rows) for (const celula of linha) expect(typeof celula).toBe("string");
      expect(r.rows[0]?.[0]).toBe("1");
    }, 60_000);

    /*
     * O ponto do arquivo — e as DUAS versões anteriores deste teste não o
     * testavam.
     *
     * A primeira lia 32 768 linhas com `maxRows` 100 e afirmava que o heap
     * crescia menos de 20 MB. Só que 32 768 linhas de 180 bytes são ~6 MB:
     * cabiam com folga, e removendo a parada antecipada o teste continuava
     * verde. Ele media a própria folga.
     *
     * A segunda cruzou a tabela consigo mesma — 1 bilhão de linhas — esperando
     * que a primeira linha chegasse em milissegundos. Não chega: o MySQL não
     * entrega o começo de um `JOIN` desse tamanho de imediato, e o caso estourou
     * 90 s. Ela media o otimizador do servidor, não o executor.
     *
     * A propriedade não é observável de fora, então o executor a expõe:
     * `linhasLidas` é quanto ele puxou do fio. Determinístico, sem folga e sem
     * depender de plano de execução.
     */
    it("puxa no máximo maxRows + 1 do fio, por maior que seja a tabela", async () => {
      if (!temDocker) return;
      // Conexão própria: isto vai truncar, e truncar obriga a descartar.
      const c = await abrirConexao(s.porta);
      const r = await executarUm(c, "SELECT id, texto FROM grande", 100);
      await c.end().catch(() => undefined);

      expect(r.rows).toHaveLength(100);
      expect(r.truncated).toBe(true);
      // A linha extra revela o truncamento; nem uma a mais sai do servidor.
      expect(r.linhasLidas, `puxou ${String(r.linhasLidas)} linhas do fio`).toBe(101);
    }, 90_000);

    it("quando cabe, lê só o que existe e não pede a linha extra à toa", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      const r = await executarUm(c, "SELECT id FROM grande ORDER BY id LIMIT 7", 100);
      expect(r.linhasLidas).toBe(7);
      expect(r.truncated).toBe(false);
    }, 60_000);

    /*
     * O contrato que impede o pool de passar fome. Medido: parar no meio de um
     * resultado grande deixa a conexão bloqueada 15,2 s drenando o que o
     * servidor continua mandando. Devolver essa conexão ao pool é entregar uma
     * conexão inutilizável ao próximo usuário.
     */
    it("truncar exige descartar a conexão; não truncar, não", async () => {
      if (!temDocker) return;
      const c = await abrirConexao(s.porta);
      const truncou = await executarUm(c, "SELECT id, texto FROM grande", 50);
      expect(truncou.truncated).toBe(true);
      expect(truncou.descartarConexao, "truncou: a conexão não serve mais").toBe(true);
      await c.end().catch(() => undefined);

      const limpa = await abrirConexao(s.porta);
      const inteiro = await executarUm(limpa, "SELECT id FROM grande ORDER BY id LIMIT 5", 50);
      expect(inteiro.truncated).toBe(false);
      expect(inteiro.descartarConexao, "leu tudo: a conexão continua boa").toBe(false);
      const outra = await executarUm(limpa, "SELECT 9 AS v", 10);
      expect(outra.rows).toEqual([["9"]]);
      await limpa.end().catch(() => undefined);
    }, 90_000);

    /*
     * A linha extra é o que distingue "cabe exatamente" de "tem mais". Sem ela
     * o executor precisaria de um COUNT(*) — que custa a tabela inteira.
     */
    it("exatamente maxRows linhas NÃO é truncamento", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      const r = await executarUm(c, "SELECT id FROM grande ORDER BY id LIMIT 5", 5);
      expect(r.rows).toHaveLength(5);
      expect(r.truncated).toBe(false);
    }, 60_000);

    it("resultado vazio ainda traz as colunas", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      const r = await executarUm(c, "SELECT id, nome FROM vazia", 100);
      expect(r.rows).toEqual([]);
      expect(r.rowCount).toBe(0);
      expect(r.columns.map((x) => x.name)).toEqual(["id", "nome"]);
    }, 60_000);

    it("NULL continua null, e não vira string vazia", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      const r = await executarUm(c, "SELECT NULL AS n, '' AS vazio", 10);
      expect(r.rows[0]?.[0]).toBeNull();
      expect(r.rows[0]?.[1]).toBe("");
    }, 60_000);

    it("statement sem conjunto de resultado não inventa rótulo de comando", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      /*
       * Pelo `sqlDeTimeout`, e não por um SET escrito à mão: a variável de
       * limite de tempo tem nome diferente nos dois, e a primeira versão deste
       * teste falhou no MariaDB com `Unknown system variable
       * 'max_execution_time'` — a divergência que `sessao.ts` existe para
       * esconder do resto do driver.
       */
      const r = await executarUm(c, sqlDeTimeout(s.sabor, 30_000), 100);
      expect(r.columns).toEqual([]);
      expect(r.rows).toEqual([]);
      // O protocolo do MySQL não manda rótulo de comando; null é a verdade.
      expect(r.command).toBeNull();
    }, 60_000);

    it("erro do servidor chega inteiro, sem posição inventada", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      let capturado: unknown;
      try {
        await executarUm(c, "SELECT * FROM nao_existe_mesmo", 10);
      } catch (e) { capturado = e; }
      expect(capturado).toBeDefined();
      const erro = erroDeConsulta(capturado);
      expect(erro.message).toContain("nao_existe_mesmo");
      expect(erro.code).not.toBeNull();
      // O MySQL não manda posição; inventar destacaria o lugar errado.
      expect(erro.position).toBeNull();
      // E a conexão sobrevive ao erro.
      const ok = await executarUm(c, "SELECT 1 AS um", 10);
      expect(ok.rows).toEqual([["1"]]);
    }, 60_000);
  });
}
