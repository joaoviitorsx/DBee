import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import { colunasDoResultado } from "./colunas";
import { introspectarCompleto } from "./introspect";
import type { CampoMysql } from "./tipos";

/**
 * A introspecção **completa** contra MySQL e MariaDB reais.
 *
 * Além de conferir colunas, índices e chaves estrangeiras, ela trava a
 * invariante que liga catálogo e resultado: **o `dataTypeId` das duas pontas
 * tem que ser o mesmo número**. É como a tela sabe que a coluna `nome` do
 * catálogo é a coluna `nome` que voltou na consulta.
 *
 * Essa invariante já foi quebrada uma vez: o protocolo tem dois números para
 * varchar — `VARCHAR` (15) e `VAR_STRING` (253) — o servidor manda 253, e o
 * mapa do catálogo devolvia 15. Nada acusava.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-ic-mysql", porta: 55520, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE" },
  { nome: "MariaDB 11", container: "dbee-ic-mariadb", porta: 55521, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE" },
] as const;

const SENHA = "Ic7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const conexoes = new Map<string, mysql.Connection>();

const SEED: readonly string[] = [
  `CREATE TABLE artistas (
     id INT PRIMARY KEY,
     nome VARCHAR(80) COMMENT 'nome artístico',
     pais CHAR(2) NOT NULL DEFAULT 'BR'
   ) COMMENT='quem grava'`,
  `CREATE TABLE albuns (
     id INT PRIMARY KEY,
     artista_id INT,
     titulo VARCHAR(120),
     ano YEAR,
     nota DECIMAL(3,1),
     capa BLOB,
     CONSTRAINT fk_alb_art FOREIGN KEY (artista_id) REFERENCES artistas(id)
   )`,
  // Chave primária COMPOSTA e FK composta: é onde a ordem das colunas importa,
  // e onde trocá-la manda o salto da tela para a linha errada sem nada acusar.
  `CREATE TABLE participacao (
     album_id INT, artista_id INT, papel VARCHAR(40),
     PRIMARY KEY (album_id, artista_id)
   )`,
  `CREATE TABLE credito (
     id INT PRIMARY KEY, alb INT, art INT,
     CONSTRAINT fk_cred FOREIGN KEY (alb, art) REFERENCES participacao(album_id, artista_id)
   )`,
  "CREATE INDEX idx_alb_ano ON albuns(ano)",
  "CREATE UNIQUE INDEX uq_art_nome ON artistas(nome)",
  "CREATE VIEW v_resumo AS SELECT a.nome, COUNT(al.id) total FROM artistas a LEFT JOIN albuns al ON al.artista_id=a.id GROUP BY a.nome",
  "INSERT INTO artistas (id,nome,pais) VALUES (1,'Elis','BR'),(2,'Björk','IS')",
  "INSERT INTO albuns (id,artista_id,titulo,ano,nota) VALUES (1,1,'Falso Brilhante',1976,9.5)",
];

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
        const t = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA,
          database: "loja", connectTimeout: 1000, charset: "utf8mb4",
          // O contrato do driver de produção.
          rowsAsArray: true,
          typeCast: (campo) => campo.buffer(),
        });
        await t.query("SELECT 1");
        c = t;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (c === undefined) throw new Error(`${s.nome} não ficou pronto`);
    for (const sql of SEED) await c.query(sql);
    conexoes.set(s.nome, c);
  }
}, 300_000);

afterAll(async () => {
  for (const c of conexoes.values()) { try { await c.end(); } catch { /* já foi */ } }
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`introspecção completa contra ${s.nome} real`, () => {
    const conn = (): mysql.Connection | undefined => conexoes.get(s.nome);
    const rel = async (nome: string) => {
      const c = conn();
      if (c === undefined) return undefined;
      const e = await introspectarCompleto(c, "loja");
      return e.schemas[0]?.relations.find((r) => r.name === nome);
    };

    it("colunas trazem o tipo canônico, com tamanho", async () => {
      if (!temDocker) return;
      const r = await rel("albuns");
      expect(r).toBeDefined();
      const porNome = new Map((r?.columns ?? []).map((c) => [c.name, c]));
      // `COLUMN_TYPE` e não `DATA_TYPE`: o tamanho tem que sobreviver.
      expect(porNome.get("titulo")?.dataType).toBe("varchar(120)");
      expect(porNome.get("nota")?.dataType).toBe("decimal(3,1)");
      /*
       * Sexta divergência medida: o MariaDB reporta `year(4)` e o MySQL `year`.
       * O código devolve `COLUMN_TYPE` fielmente; normalizar seria a camada de
       * baixo inventando um formato que nenhum dos dois usa.
       */
      expect(["year", "year(4)"]).toContain(porNome.get("ano")?.dataType ?? "");
      expect(porNome.get("capa")?.dataType).toBe("blob");
    }, 90_000);

    it("nulabilidade, padrão e comentário de coluna", async () => {
      if (!temDocker) return;
      const r = await rel("artistas");
      const porNome = new Map((r?.columns ?? []).map((c) => [c.name, c]));
      expect(porNome.get("pais")?.nullable).toBe(false);
      /*
       * Sétima divergência medida: o MariaDB devolve o default de literal COM
       * aspas (`'BR'`) e o MySQL SEM (`BR`). A forma do MariaDB é a mesma
       * convenção do Postgres, que guarda a expressão (`'BR'::text`).
       *
       * Nada é normalizado aqui de propósito: tirar aspas às cegas quebraria
       * `CURRENT_TIMESTAMP`, que vem sem elas, e um literal que contenha aspas.
       * O campo é a expressão como o servidor a guarda.
       */
      expect(["BR", "'BR'"]).toContain(porNome.get("pais")?.defaultValue ?? "");
      expect(porNome.get("nome")?.nullable).toBe(true);
      // UTF-8 no comentário: o mesmo caminho de bytes das células.
      expect(porNome.get("nome")?.comment).toBe("nome artístico");
      expect(porNome.get("pais")?.comment).toBeNull();
    }, 90_000);

    it("comentário de tabela existe; o da view NÃO é a palavra VIEW", async () => {
      if (!temDocker) return;
      expect((await rel("artistas"))?.comment).toBe("quem grava");
      /*
       * Medido: `TABLE_COMMENT` de uma view vem literalmente "VIEW". Sem o
       * filtro, toda view do catálogo mostraria um comentário que ninguém
       * escreveu.
       */
      expect((await rel("v_resumo"))?.comment).toBeNull();
      expect((await rel("v_resumo"))?.kind).toBe("view");
    }, 90_000);

    it("chave primária simples e composta, na ordem", async () => {
      if (!temDocker) return;
      expect((await rel("artistas"))?.primaryKey).toEqual(["id"]);
      // A ordem da PK composta é a da definição, e é o que o keyset usa para
      // desempatar: invertê-la pula ou repete linhas entre páginas.
      expect((await rel("participacao"))?.primaryKey).toEqual(["album_id", "artista_id"]);
    }, 90_000);

    it("índices com único e primário corretos", async () => {
      if (!temDocker) return;
      const r = await rel("artistas");
      const porNome = new Map((r?.indexes ?? []).map((i) => [i.name, i]));
      const pk = porNome.get("PRIMARY");
      expect(pk?.isPrimary).toBe(true);
      expect(pk?.isUnique).toBe(true);
      const uq = porNome.get("uq_art_nome");
      // `NON_UNIQUE = 0` significa único — a negação no nome é a armadilha.
      expect(uq?.isUnique).toBe(true);
      expect(uq?.isPrimary).toBe(false);
      expect(uq?.columns).toEqual(["nome"]);

      const alb = await rel("albuns");
      const idx = (alb?.indexes ?? []).find((i) => i.name === "idx_alb_ano");
      expect(idx?.isUnique).toBe(false);
    }, 90_000);

    it("chave estrangeira simples aponta para a tabela e coluna certas", async () => {
      if (!temDocker) return;
      const r = await rel("albuns");
      const fk = (r?.foreignKeys ?? []).find((f) => f.name === "fk_alb_art");
      expect(fk).toBeDefined();
      expect(fk?.columns).toEqual(["artista_id"]);
      expect(fk?.referencedTable).toBe("artistas");
      expect(fk?.referencedColumns).toEqual(["id"]);
      // Sem nível de schema: o "schema referenciado" é o database.
      expect(fk?.referencedSchema).toBe("loja");
    }, 90_000);

    /*
     * FK composta. `columns[i]` tem que casar com `referencedColumns[i]`, e é
     * o `ORDINAL_POSITION` que garante isso — trocar a ordem manda o salto da
     * tela para a linha errada, e nada acusa.
     */
    it("chave estrangeira composta mantém as colunas pareadas na ordem", async () => {
      if (!temDocker) return;
      const r = await rel("credito");
      const fk = (r?.foreignKeys ?? []).find((f) => f.name === "fk_cred");
      expect(fk).toBeDefined();
      expect(fk?.columns).toEqual(["alb", "art"]);
      expect(fk?.referencedColumns).toEqual(["album_id", "artista_id"]);
      expect(fk?.referencedTable).toBe("participacao");
    }, 90_000);

    /*
     * A invariante que liga as duas pontas, e que já quebrou uma vez: o número
     * de tipo do catálogo tem que ser o mesmo que a consulta devolve.
     */
    it("o dataTypeId do catálogo é o mesmo que a consulta devolve", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;

      const r = await rel("albuns");
      const doCatalogo = new Map((r?.columns ?? []).map((x) => [x.name, x.dataTypeId]));

      const [, campos] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM albuns");
      const doResultado = colunasDoResultado(campos as unknown as (CampoMysql & { flags?: number })[]);

      const divergencias: string[] = [];
      for (const col of doResultado) {
        const cat = doCatalogo.get(col.name);
        if (cat !== col.dataTypeId) {
          divergencias.push(`${col.name}: catálogo=${String(cat)} resultado=${String(col.dataTypeId)}`);
        }
      }
      expect(divergencias, divergencias.join(" | ")).toEqual([]);
    }, 90_000);

    it("view aparece com colunas, e sem chave primária", async () => {
      if (!temDocker) return;
      const v = await rel("v_resumo");
      expect(v?.columns.map((c) => c.name)).toEqual(["nome", "total"]);
      expect(v?.primaryKey).toEqual([]);
      expect(v?.foreignKeys).toEqual([]);
    }, 90_000);
  });
}
