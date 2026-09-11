import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import { colunasDoResultado, nomeDoTipo } from "./colunas";
import type { CampoMysql } from "./tipos";

/**
 * O mapa de tipos conferido contra a resposta do **próprio servidor**.
 *
 * A tabela de `colunas.ts` poderia ser escrita de memória e parecer certa. Este
 * teste não a lê: ele pergunta ao MySQL e ao MariaDB, por
 * `information_schema.COLUMNS.DATA_TYPE`, como cada coluna se chama, e exige que
 * o mapa concorde. Quem tem razão é o servidor.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-col-mysql", porta: 55508, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE" },
  { nome: "MariaDB 11", container: "dbee-col-mariadb", porta: 55509, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE" },
] as const;

const SENHA = "Co7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

const TABELA = `CREATE TABLE tipos (
  t_int INT, t_tinyint TINYINT, t_smallint SMALLINT, t_mediumint MEDIUMINT, t_bigint BIGINT,
  t_decimal DECIMAL(18,4), t_float FLOAT, t_double DOUBLE, t_bit BIT(8),
  t_char CHAR(6), t_varchar VARCHAR(40), t_text TEXT, t_longtext LONGTEXT,
  t_blob BLOB, t_binary BINARY(4), t_varbinary VARBINARY(8),
  t_date DATE, t_datetime DATETIME, t_timestamp TIMESTAMP NULL, t_time TIME, t_year YEAR,
  t_enum ENUM('a','b'), t_set SET('x','y'))`;

/**
 * Colunas cujo nome o fio **não** carrega, medido.
 *
 * `TEXT` e `LONGTEXT` chegam idênticos (tipo 252, charset de texto, mesmos
 * flags): o tamanho não viaja no metadado do resultado. O mapa devolve a
 * família, que é a informação que existe. Ficam listadas aqui em vez de o teste
 * as ignorar em silêncio.
 */
const COLAPSADAS: Readonly<Record<string, string>> = {
  t_longtext: "text",
};

type CampoComFlags = CampoMysql & { readonly flags?: number };

const lidos = new Map<string, { campos: CampoComFlags[]; servidor: Map<string, string> }>();

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
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA,
          database: "loja", connectTimeout: 1000,
        });
        await tentativa.query("SELECT 1");
        c = tentativa;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (c === undefined) throw new Error(`${s.nome} não ficou pronto`);
    await c.query(TABELA);

    const [, campos] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM tipos");
    const [doServidor] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME n, DATA_TYPE d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='loja' AND TABLE_NAME='tipos'",
    );
    lidos.set(s.nome, {
      campos: campos as unknown as CampoComFlags[],
      servidor: new Map(
        (doServidor as unknown as { n: string; d: string }[]).map((r) => [r.n, r.d.toLowerCase()]),
      ),
    });
    await c.end();
  }
}, 240_000);

afterAll(() => {
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`nomes de tipo contra ${s.nome} real`, () => {
    it("o mapa concorda com o que o servidor chama cada coluna", () => {
      if (!temDocker) return;
      const lido = lidos.get(s.nome);
      expect(lido, "faltou ler o servidor").toBeDefined();
      if (lido === undefined) return;

      const divergencias: string[] = [];
      for (const campo of lido.campos) {
        const doServidor = lido.servidor.get(campo.name);
        if (doServidor === undefined) continue;
        const esperado = COLAPSADAS[campo.name] ?? doServidor;
        const obtido = nomeDoTipo(campo);
        if (obtido !== esperado) {
          divergencias.push(`${campo.name}: servidor="${doServidor}" mapa="${obtido}"`);
        }
      }
      expect(divergencias, divergencias.join(" | ")).toEqual([]);
    });

    /*
     * O limite, dito em voz alta. Se um dia o fio passar a carregar o tamanho,
     * este teste falha e a lista COLAPSADAS pode encolher.
     */
    it("TEXT e LONGTEXT chegam indistinguíveis — o limite é do protocolo", () => {
      if (!temDocker) return;
      const campos = lidos.get(s.nome)?.campos ?? [];
      const texto = campos.find((c) => c.name === "t_text");
      const longo = campos.find((c) => c.name === "t_longtext");
      expect(texto).toBeDefined();
      expect(longo).toBeDefined();
      expect(longo?.columnType).toBe(texto?.columnType ?? -1);
      expect(longo?.characterSet).toBe(texto?.characterSet ?? -1);
    });

    it("enum e set não se disfarçam de char", () => {
      if (!temDocker) return;
      const campos = lidos.get(s.nome)?.campos ?? [];
      const nome = (n: string): string => {
        const c = campos.find((x) => x.name === n);
        return c === undefined ? "?" : nomeDoTipo(c);
      };
      expect(nome("t_enum")).toBe("enum");
      expect(nome("t_set")).toBe("set");
      expect(nome("t_char")).toBe("char");
    });

    it("binário e texto não se confundem, apesar do mesmo tipo de protocolo", () => {
      if (!temDocker) return;
      const campos = lidos.get(s.nome)?.campos ?? [];
      const nome = (n: string): string => {
        const c = campos.find((x) => x.name === n);
        return c === undefined ? "?" : nomeDoTipo(c);
      };
      expect(nome("t_blob")).toBe("blob");
      expect(nome("t_text")).toBe("text");
      expect(nome("t_binary")).toBe("binary");
      expect(nome("t_char")).toBe("char");
      expect(nome("t_varbinary")).toBe("varbinary");
      expect(nome("t_varchar")).toBe("varchar");
    });

    it("as colunas do resultado saem no formato que a API declara", () => {
      if (!temDocker) return;
      const campos = lidos.get(s.nome)?.campos ?? [];
      const colunas = colunasDoResultado(campos);
      expect(colunas.length).toBe(campos.length);
      for (const c of colunas) {
        expect(typeof c.name).toBe("string");
        expect(Number.isInteger(c.dataTypeId)).toBe(true);
        expect(c.dataTypeName.length).toBeGreaterThan(0);
        // Nada de `tipo_NNN`: isso é a saída de escape, e nenhum tipo comum
        // deveria cair nela.
        expect(c.dataTypeName.startsWith("tipo_"), `${c.name} caiu no escape`).toBe(false);
      }
    });
  });
}
