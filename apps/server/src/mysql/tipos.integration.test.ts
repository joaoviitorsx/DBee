import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { ehBinaria, paraTexto, type CampoMysql } from "./tipos";

/**
 * A regra 10 contra **MySQL e MariaDB reais** (`CLAUDE.md`, definição de
 * pronto 4). Aqui não dá para presumir do driver: as três regras que eu tentei
 * antes desta passavam no papel e erravam contra o servidor.
 *
 * - `BINARY_FLAG` bastaria? Não: o MariaDB liga o flag no JSON.
 * - `charset === 63` bastaria? Não: número e data também dizem 63, e o inteiro
 *   `1` saía `"0x31"`.
 * - `Bun.SQL` resolveria sem dependência? Não: converte tipos sem desligar, e
 *   o `DATE` muda de valor conforme a API chamada.
 *
 * Cada uma dessas três está travada por um caso abaixo.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-tipos-mysql", porta: 55494, imagem: "mysql:8.4", cli: "mysql", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE" },
  { nome: "MariaDB 11", container: "dbee-tipos-mariadb", porta: 55495, imagem: "mariadb:11", cli: "mariadb", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE" },
] as const;

const SENHA = "Tp7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

/*
 * Instruções separadas de propósito: `multipleStatements` do `mysql2` é `false`
 * por padrão, e é bom que fique — enviar várias instruções numa string é o que
 * transforma uma injeção em duas instruções.
 */
const SEED: readonly string[] = [
`CREATE TABLE tipos (
  id INT PRIMARY KEY,
  t_tinyint TINYINT, t_bool BOOLEAN, t_smallint SMALLINT, t_int INT,
  t_bigint BIGINT, t_decimal DECIMAL(18,4), t_float FLOAT, t_double DOUBLE,
  t_bit BIT(8), t_char CHAR(6), t_varchar VARCHAR(40), t_text TEXT,
  t_blob BLOB, t_binary BINARY(4), t_date DATE, t_datetime DATETIME,
  t_timestamp TIMESTAMP NULL, t_time TIME, t_year YEAR,
  t_json JSON, t_enum ENUM('a','b'), t_set SET('x','y'), t_nulo INT
)`,
`CREATE TABLE textos (
  id INT PRIMARY KEY,
  latim VARCHAR(40), cjk VARCHAR(40), emoji VARCHAR(40), misto VARCHAR(80)
) CHARACTER SET utf8mb4`,
`INSERT INTO textos VALUES (
  1, 'Björk · Céu · ação', '坂本龍一', '🎧🇧🇷', 'Ryuichi 坂本 · 100% ✓'
)`,
`INSERT INTO tipos VALUES (
  1, 127, TRUE, 32767, 2147483647,
  9223372036854775807, 12345.6789, 1.5, 2.25,
  b'10101010', 'abc', 'texto', 'longo',
  0x0102, 0x01020304, '2026-03-01', '2026-03-01 21:00:00',
  '2026-03-01 21:00:00', '13:45:59', 2026,
  '{"a":[1,2]}', 'b', 'x,y', NULL
)`,
];

/** O que cada coluna tem que virar. Nenhum `Date`, nenhum `number`, nenhum `Buffer`. */
const ESPERADO: Readonly<Record<string, string | null>> = {
  id: "1",
  t_tinyint: "127",
  t_bool: "1",
  t_smallint: "32767",
  t_int: "2147483647",
  // Maior que 2^53: se o driver convertesse para number, perderia precisão.
  t_bigint: "9223372036854775807",
  t_decimal: "12345.6789",
  t_float: "1.5",
  t_double: "2.25",
  t_bit: "0xaa",
  t_char: "abc",
  t_varchar: "texto",
  t_text: "longo",
  t_blob: "0x0102",
  t_binary: "0x01020304",
  // O caso que reprovou o Bun.SQL: nada de fuso, nada de um dia a menos.
  t_date: "2026-03-01",
  t_datetime: "2026-03-01 21:00:00",
  t_timestamp: "2026-03-01 21:00:00",
  t_time: "13:45:59",
  t_year: "2026",
  t_enum: "b",
  t_set: "x,y",
  t_nulo: null,
};

interface Lido {
  readonly valores: Record<string, string | null>;
  readonly campos: readonly CampoMysql[];
}

const lidos = new Map<string, Lido>();

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
    /*
     * Prontidão por TCP, e não por `docker exec`.
     *
     * A imagem do MySQL sobe um servidor **temporário** durante a inicialização
     * para aplicar o `MYSQL_DATABASE`, e depois o derruba para subir o
     * definitivo. Um `docker exec ... SELECT 1` passa nessa janela e o seed
     * seguinte falha com `ERROR 2002 ... socket`. Só a porta publicada aparece
     * quando o servidor de verdade está de pé — e é por ela que o DBee fala.
     */
    let pronto = false;
    for (let i = 0; i < 120; i++) {
      try {
        const teste = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA, database: "loja",
          connectTimeout: 1000,
        });
        await teste.query("SELECT 1");
        await teste.end();
        pronto = true;
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
    if (!pronto) throw new Error(`${s.nome} do teste não ficou pronto`);

    const semente = await mysql.createConnection({
      host: "127.0.0.1", port: s.porta, user: "root", password: SENHA, database: "loja",
    });
    for (const instrucao of SEED) await semente.query(instrucao);
    await semente.end();

    const c = await mysql.createConnection({
      host: "127.0.0.1", port: s.porta, user: "root", password: SENHA, database: "loja",
      // O contrato do módulo: bytes crus, decisão pelos metadados.
      typeCast: (campo) => campo.buffer(),
    });
    // `query`, não `execute`: o protocolo de texto é o que faz número e data
    // chegarem em ASCII (ver o comentário de `tipos.ts`).
    const [linhas, campos] = await c.query("SELECT * FROM tipos");
    const bruta = (linhas as Record<string, unknown>[])[0] ?? {};
    const meta = campos as unknown as CampoMysql[];
    const valores: Record<string, string | null> = {};
    for (const campo of meta) {
      valores[campo.name] = paraTexto((bruta[campo.name] ?? null) as Buffer | null, campo);
    }
    lidos.set(s.nome, { valores, campos: meta });
    await c.end();
  }
}, 180_000);

afterAll(() => {
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`regra 10 contra ${s.nome} real`, () => {
    it("toda célula chega como string — nenhuma vira number, Date ou Buffer", () => {
      if (!temDocker) return;
      const lido = lidos.get(s.nome);
      expect(lido).toBeDefined();
      for (const [coluna, valor] of Object.entries(lido?.valores ?? {})) {
        if (valor === null) continue;
        expect(typeof valor, `coluna ${coluna}`).toBe("string");
      }
    });

    it("cada coluna vale exatamente o que o servidor guardou", () => {
      if (!temDocker) return;
      const valores = lidos.get(s.nome)?.valores ?? {};
      for (const [coluna, esperado] of Object.entries(ESPERADO)) {
        expect(valores[coluna], `coluna ${coluna}`).toBe(esperado);
      }
    });

    /*
     * O JSON é medido à parte porque os dois servidores o descrevem de formas
     * diferentes — MySQL manda `columnType` 245, MariaDB manda 252 com charset
     * de texto — e porque o MariaDB liga o BINARY_FLAG nele. Comparar o texto
     * exato falharia por espaçamento (`{"a": [1, 2]}` contra `{"a":[1,2]}`), que
     * é diferença de serialização do servidor e não do driver.
     */
    it("JSON chega como texto, não como hexadecimal", () => {
      if (!temDocker) return;
      const bruto = lidos.get(s.nome)?.valores["t_json"];
      expect(bruto).toBeTypeOf("string");
      expect(bruto?.startsWith("0x")).toBe(false);
      expect(JSON.parse(bruto ?? "null")).toEqual({ a: [1, 2] });
    });

    it("número e data não são tratados como binário, mesmo dizendo charset 63", () => {
      if (!temDocker) return;
      const campos = lidos.get(s.nome)?.campos ?? [];
      const porNome = (n: string): CampoMysql | undefined => campos.find((c) => c.name === n);
      for (const nome of ["id", "t_bigint", "t_date", "t_datetime", "t_decimal"]) {
        const campo = porNome(nome);
        expect(campo, `coluna ${nome}`).toBeDefined();
        if (campo === undefined) continue;
        // A condição que sozinha reprovaria: elas realmente dizem 63.
        expect(campo.characterSet, `charset de ${nome}`).toBe(63);
        expect(ehBinaria(campo), `${nome} não pode ser binária`).toBe(false);
      }
    });

    it("BLOB e BINARY são binários; TEXT e CHAR não", () => {
      if (!temDocker) return;
      const campos = lidos.get(s.nome)?.campos ?? [];
      const eh = (n: string): boolean => {
        const c = campos.find((x) => x.name === n);
        return c !== undefined && ehBinaria(c);
      };
      expect(eh("t_blob")).toBe(true);
      expect(eh("t_binary")).toBe(true);
      expect(eh("t_bit")).toBe(true);
      expect(eh("t_text")).toBe(false);
      expect(eh("t_char")).toBe(false);
    });
  });
}

/*
 * Regra 10 com texto que **não é ASCII**.
 *
 * Este caso nasceu de um susto real: a demonstração mostrou `BjÃ¶rk` na tela.
 * Medido, o mojibake estava **gravado** — o cliente de linha de comando que
 * semeou os dados conectou com charset errado — e o driver devolvia fielmente
 * o que existia. Ainda assim, é exatamente o modo de falha que a regra 10
 * existe para pegar, e ele não tinha teste: os 24 tipos eram todos ASCII.
 *
 * Latim acentuado, CJK e emoji cobrem os três tamanhos de sequência UTF-8 que
 * importam (2, 3 e 4 bytes). O emoji só passa em `utf8mb4`, e é ele que pega o
 * `utf8` de três bytes que o MySQL chamou de UTF-8 por anos.
 */
for (const s of SERVIDORES) {
  describe(`texto não-ASCII contra ${s.nome} real`, () => {
    it("acento, CJK e emoji voltam byte a byte iguais ao que foi gravado", async () => {
      if (!temDocker) return;
      const c = await mysql.createConnection({
        host: "127.0.0.1", port: s.porta, user: "root", password: SENHA, database: "loja",
        charset: "utf8mb4",
        // O MESMO contrato do driver. Abrir sem `rowsAsArray` faz a linha vir
        // como objeto, e indexar por posição devolve null — foi assim que a
        // primeira versão deste caso falhou, repetindo o descompasso que o
        // teste de contrato do driver já tinha pegado uma vez.
        rowsAsArray: true,
        typeCast: (campo) => campo.buffer(),
      });
      const [linhas, campos] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM textos");
      const meta = campos as unknown as CampoMysql[];
      const bruta = (linhas as unknown as (Buffer | null)[][])[0] ?? [];
      const valores: Record<string, string | null> = {};
      meta.forEach((campo, i) => { valores[campo.name] = paraTexto(bruta[i] ?? null, campo); });
      await c.end();

      expect(valores["latim"]).toBe("Björk · Céu · ação");
      expect(valores["cjk"]).toBe("坂本龍一");
      expect(valores["emoji"]).toBe("🎧🇧🇷");
      expect(valores["misto"]).toBe("Ryuichi 坂本 · 100% ✓");

      // E o comprimento em caracteres, não em bytes: `Björk` tem 5, e um
      // mojibake teria 6. É a mesma checagem que expôs o susto.
      expect(Array.from(valores["latim"] ?? "").length).toBe(Array.from("Björk · Céu · ação").length);
      expect(Array.from(valores["cjk"] ?? "").length).toBe(4);
    }, 60_000);
  });
}
