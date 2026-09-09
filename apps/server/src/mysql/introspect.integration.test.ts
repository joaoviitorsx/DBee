import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { introspectarArvore, listarDatabases } from "./introspect";

/**
 * Introspecção contra MySQL e MariaDB reais (`CLAUDE.md`, definição de pronto 4).
 *
 * Três coisas que só o servidor de verdade prova, e que uma simulação
 * afirmaria errado:
 *
 * - `information_schema` **já filtra por grant**: o papel restrito não vê a
 *   tabela que não pode abrir. É o equivalente do `has_table_privilege` que a
 *   introspecção do Postgres precisa pedir à mão.
 * - `TABLE_ROWS` vem `NULL` em view, e é estimativa em tabela.
 * - `TABLE_TYPE = 'SEQUENCE'` existe **só no MariaDB**.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-intro-mysql", porta: 55502, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE", temSequence: false },
  { nome: "MariaDB 11", container: "dbee-intro-mariadb", porta: 55503, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE", temSequence: true },
] as const;

const SENHA = "In7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

const conexoes = new Map<string, mysql.Connection>();
const restritas = new Map<string, mysql.Connection>();

const abrir = (porta: number, usuario: string, senha: string): Promise<mysql.Connection> =>
  mysql.createConnection({
    host: "127.0.0.1", port: porta, user: usuario, password: senha, database: "loja",
    // O mesmo contrato do driver: bytes crus, decisão pelos metadados.
    typeCast: (campo) => campo.buffer(),
  });

beforeAll(async () => {
  if (!temDocker) return;

  for (const s of SERVIDORES) {
    sh("docker", "rm", "-f", s.container);
    sh(
      "docker", "run", "-d", "--name", s.container,
      "-e", `${s.envSenha}=${SENHA}`, "-e", `${s.envDb}=loja`,
      "-p", `${String(s.porta)}:3306`, s.imagem,
    );
  }

  for (const s of SERVIDORES) {
    // Prontidão por TCP: `docker exec` passa na janela do servidor temporário
    // que a imagem sobe durante a inicialização.
    let pronto: mysql.Connection | undefined;
    for (let i = 0; i < 120; i++) {
      try {
        const c = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA,
          database: "loja", connectTimeout: 1000,
        });
        await c.query("SELECT 1");
        pronto = c;
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
    if (pronto === undefined) throw new Error(`${s.nome} não ficou pronto`);

    const passos = [
      "CREATE TABLE clientes (id INT PRIMARY KEY, nome VARCHAR(60))",
      "CREATE TABLE pedidos (id INT PRIMARY KEY, cliente_id INT, total DECIMAL(10,2))",
      "INSERT INTO clientes VALUES (1,'Ana'),(2,'Bruno'),(3,'Carla')",
      "INSERT INTO pedidos VALUES (1,1,10),(2,2,20)",
      "CREATE VIEW v_totais AS SELECT cliente_id, SUM(total) t FROM pedidos GROUP BY cliente_id",
      "CREATE DATABASE outra_loja",
      // Papel restrito: enxerga UMA tabela, e a árvore tem que refletir isso.
      "CREATE USER 'restrito'@'%' IDENTIFIED BY 'r'",
      "GRANT SELECT ON loja.clientes TO 'restrito'@'%'",
      "FLUSH PRIVILEGES",
      "ANALYZE TABLE clientes, pedidos",
    ];
    if (s.temSequence) passos.push("CREATE SEQUENCE s_pedido START WITH 1 INCREMENT BY 1");
    for (const p of passos) await pronto.query(p);
    await pronto.end();

    conexoes.set(s.nome, await abrir(s.porta, "root", SENHA));
    restritas.set(s.nome, await abrir(s.porta, "restrito", "r"));
  }
}, 240_000);

afterAll(async () => {
  for (const c of [...conexoes.values(), ...restritas.values()]) {
    try { await c.end(); } catch { /* container já pode ter sumido */ }
  }
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`introspecção contra ${s.nome} real`, () => {
    it("a árvore traz as tabelas e a view, ordenadas", async () => {
      if (!temDocker) return;
      const c = conexoes.get(s.nome);
      expect(c).toBeDefined();
      if (c === undefined) return;

      const arvore = await introspectarArvore(c, "loja");
      const nomes = arvore.schemas[0]?.relations.map((r) => r.name) ?? [];
      expect(nomes).toContain("clientes");
      expect(nomes).toContain("pedidos");
      expect(nomes).toContain("v_totais");
      expect([...nomes].sort()).toEqual(nomes);
    });

    /*
     * O nível que o MySQL não tem. A resposta mantém a forma do fio — um nó de
     * schema — e ele carrega o nome do database, para dizer algo verdadeiro se
     * alguma tela o desenhar.
     */
    it("devolve um único nó de schema, com o nome do database", async () => {
      if (!temDocker) return;
      const c = conexoes.get(s.nome);
      if (c === undefined) return;
      const arvore = await introspectarArvore(c, "loja");
      expect(arvore.schemas).toHaveLength(1);
      expect(arvore.schemas[0]?.name).toBe("loja");
      expect(arvore.database).toBe("loja");
    });

    it("view é view e não tem estimativa; tabela é tabela e tem", async () => {
      if (!temDocker) return;
      const c = conexoes.get(s.nome);
      if (c === undefined) return;
      const rel = (await introspectarArvore(c, "loja")).schemas[0]?.relations ?? [];
      const view = rel.find((r) => r.name === "v_totais");
      expect(view?.kind).toBe("view");
      expect(view?.estimatedRows).toBeNull();

      const tabela = rel.find((r) => r.name === "clientes");
      expect(tabela?.kind).toBe("table");
      expect(typeof tabela?.estimatedRows).toBe("number");
    });

    it("os databases internos do servidor não aparecem; os do usuário sim", async () => {
      if (!temDocker) return;
      const c = conexoes.get(s.nome);
      if (c === undefined) return;
      const dbs = await listarDatabases(c, "loja");
      const nomes = dbs.map((d) => d.name);
      expect(nomes).toContain("loja");
      expect(nomes).toContain("outra_loja");
      for (const interno of ["information_schema", "performance_schema", "mysql", "sys"]) {
        expect(nomes, interno).not.toContain(interno);
      }
      expect(dbs.find((d) => d.name === "loja")?.isDefault).toBe(true);
      expect(dbs.find((d) => d.name === "outra_loja")?.isDefault).toBe(false);
    });

    /*
     * O caso de segurança: a árvore não pode listar o que o usuário não abre.
     * No Postgres isso é uma cláusula que a introspecção precisa lembrar de
     * escrever; aqui o servidor já aplica, e este teste é o que prova que a
     * afirmação do comentário é verdade, e não esperança.
     */
    it("papel restrito vê só a tabela concedida", async () => {
      if (!temDocker) return;
      const c = restritas.get(s.nome);
      expect(c).toBeDefined();
      if (c === undefined) return;
      const rel = (await introspectarArvore(c, "loja")).schemas[0]?.relations ?? [];
      expect(rel.map((r) => r.name)).toEqual(["clientes"]);
    });

    it("papel restrito não enxerga o database que não lhe foi concedido", async () => {
      if (!temDocker) return;
      const c = restritas.get(s.nome);
      if (c === undefined) return;
      const nomes = (await listarDatabases(c, "loja")).map((d) => d.name);
      expect(nomes).toContain("loja");
      expect(nomes).not.toContain("outra_loja");
    });
  });
}

/*
 * A quinta divergência entre as duas, medida: `SEQUENCE` é um `TABLE_TYPE` que
 * só o MariaDB produz. Vira `table` porque é o que ela é ali — um objeto que se
 * lê com SELECT — e inventar um `RelationKind` que uma só engine produz seria
 * pior.
 */
describe("SEQUENCE do MariaDB", () => {
  it("aparece na árvore, classificada como tabela", async () => {
    if (!temDocker) return;
    const c = conexoes.get("MariaDB 11");
    expect(c).toBeDefined();
    if (c === undefined) return;
    const rel = (await introspectarArvore(c, "loja")).schemas[0]?.relations ?? [];
    const seq = rel.find((r) => r.name === "s_pedido");
    expect(seq, "a sequence tem que aparecer, não sumir").toBeDefined();
    expect(seq?.kind).toBe("table");
  });

  it("o MySQL não produz esse tipo — se produzir, a regra precisa mudar", async () => {
    if (!temDocker) return;
    const c = conexoes.get("MySQL 8.4");
    if (c === undefined) return;
    const rel = (await introspectarArvore(c, "loja")).schemas[0]?.relations ?? [];
    expect(rel.find((r) => r.name === "s_pedido")).toBeUndefined();
  });
});
