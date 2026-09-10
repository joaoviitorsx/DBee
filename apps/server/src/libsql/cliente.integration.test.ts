import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { arg, ErroLibsql, executarSql, type AlvoLibsql } from "./cliente";
import { paraTexto } from "./protocolo";

/**
 * O cliente contra um `sqld` real, **incluindo com autenticação**.
 *
 * O que só o servidor prova:
 *
 * - a regra 10 vem do protocolo: inteiro de 64 bits chega inteiro;
 * - infinito guardado num `REAL` **não** vira `NULL` — o cliente oficial nem
 *   consegue ler essa tabela;
 * - o claim `"a":"ro"` do JWT é a garantia de somente-leitura, e ela é do
 *   servidor: bloqueia até DDL;
 * - valor hostil vai por parâmetro ligado e não vira comando.
 */

const SEM_AUTH = { container: "dbee-ls-livre", porta: 8095 };
const COM_AUTH = { container: "dbee-ls-auth", porta: 8096 };
const IMAGEM = "ghcr.io/tursodatabase/libsql-server:latest";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const temOpenssl = Bun.spawnSync(["openssl", "version"]).exitCode === 0;
const podeRodar = temDocker && temOpenssl;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let livre: AlvoLibsql;
let tokenRo = "";
let tokenRw = "";
let dir = "";

async function esperar(porta: number): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${String(porta)}/health`);
      if (r.ok) return;
    } catch { /* ainda subindo */ }
    await Bun.sleep(500);
  }
  throw new Error(`libSQL na porta ${String(porta)} não ficou pronto`);
}

beforeAll(async () => {
  if (!podeRodar) return;
  dir = `/tmp/dbee-libsql-teste-${String(process.pid)}`;
  Bun.spawnSync(["mkdir", "-p", dir]);
  Bun.spawnSync(["openssl", "genpkey", "-algorithm", "ed25519", "-out", `${dir}/priv.pem`]);
  Bun.spawnSync(["openssl", "pkey", "-in", `${dir}/priv.pem`, "-pubout", "-out", `${dir}/pub.pem`]);

  // A chave pública que o sqld valida: os 32 bytes finais do DER, em base64url.
  const pem = await Bun.file(`${dir}/pub.pem`).text();
  const der = Buffer.from(pem.split("\n").filter((l) => !l.startsWith("-----")).join(""), "base64");
  const pubB64 = der.subarray(der.length - 32).toString("base64url");

  sh("docker", "rm", "-f", SEM_AUTH.container);
  sh("docker", "rm", "-f", COM_AUTH.container);
  sh("docker", "run", "-d", "--name", SEM_AUTH.container, "-p", `${String(SEM_AUTH.porta)}:8080`, IMAGEM);
  sh("docker", "run", "-d", "--name", COM_AUTH.container, "-p", `${String(COM_AUTH.porta)}:8080`,
    "-e", `SQLD_AUTH_JWT_KEY=${pubB64}`, IMAGEM);

  await esperar(SEM_AUTH.porta);
  await esperar(COM_AUTH.porta);

  livre = { url: `http://127.0.0.1:${String(SEM_AUTH.porta)}`, token: null };

  // Assina os dois tokens.
  const assinar = (claims: Record<string, unknown>): string => {
    const b64u = (b: Buffer): string => b.toString("base64url");
    const msg = `${b64u(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })))}.${b64u(Buffer.from(JSON.stringify(claims)))}`;
    Bun.spawnSync(["sh", "-c", `printf '%s' '${msg}' > ${dir}/msg.bin`]);
    const r = Bun.spawnSync(["openssl", "pkeyutl", "-sign", "-inkey", `${dir}/priv.pem`, "-rawin", "-in", `${dir}/msg.bin`, "-out", `${dir}/sig.bin`]);
    if (r.exitCode !== 0) throw new Error(`openssl: ${r.stderr.toString()}`);
    const sig = Bun.spawnSync(["base64", "-w0", `${dir}/sig.bin`]).stdout.toString().trim()
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    return `${msg}.${sig}`;
  };
  tokenRo = assinar({ a: "ro" });
  tokenRw = assinar({ a: "rw" });

  await executarSql(livre, [
    { sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, i INTEGER, r REAL, txt TEXT, b BLOB)" },
    { sql: "INSERT INTO t VALUES (1, 9223372036854775807, 3.14159, 'Björk 坂本 🎧', x'0102FF')" },
    { sql: "INSERT INTO t VALUES (2, NULL, 1e308*10, NULL, NULL)" },
  ]);
}, 300_000);

afterAll(() => {
  sh("docker", "rm", "-f", SEM_AUTH.container);
  sh("docker", "rm", "-f", COM_AUTH.container);
  if (dir !== "") Bun.spawnSync(["rm", "-rf", dir]);
});

describe("cliente libSQL contra servidor real", () => {
  it("inteiro de 64 bits chega inteiro — a regra 10 vem do protocolo", async () => {
    if (!podeRodar) return;
    const [r] = await executarSql(livre, [{ sql: "SELECT i FROM t WHERE id = 1" }]);
    expect(paraTexto(r?.rows[0]?.[0] ?? { type: "null" })).toBe("9223372036854775807");
  }, 60_000);

  it("texto não-ASCII volta byte a byte", async () => {
    if (!podeRodar) return;
    const [r] = await executarSql(livre, [{ sql: "SELECT txt FROM t WHERE id = 1" }]);
    expect(paraTexto(r?.rows[0]?.[0] ?? { type: "null" })).toBe("Björk 坂本 🎧");
  }, 60_000);

  it("blob vira hexadecimal", async () => {
    if (!podeRodar) return;
    const [r] = await executarSql(livre, [{ sql: "SELECT b FROM t WHERE id = 1" }]);
    expect(paraTexto(r?.rows[0]?.[0] ?? { type: "null" })).toBe("0x0102ff");
  }, 60_000);

  /*
   * A tabela que o cliente oficial não consegue ler. Ele lança
   * `HRANA_PROTO_ERROR: Expected number, received null` e a consulta inteira
   * falha; aqui ela é lida, e o infinito não se disfarça de NULL.
   */
  it("infinito é lido, e não se confunde com o NULL da mesma linha", async () => {
    if (!podeRodar) return;
    const [r] = await executarSql(livre, [{ sql: "SELECT r, txt FROM t WHERE id = 2" }]);
    const infinito = r?.rows[0]?.[0] ?? { type: "null" as const };
    const nulo = r?.rows[0]?.[1] ?? { type: "text" as const };
    expect(infinito.type).toBe("float");
    expect(paraTexto(infinito)).toBe("±Inf");
    expect(nulo.type).toBe("null");
    expect(paraTexto(nulo)).toBeNull();
  }, 60_000);

  it("valor hostil vai por parâmetro e não vira comando", async () => {
    if (!podeRodar) return;
    const hostil = "x' ; DROP TABLE t; --";
    const [r] = await executarSql(livre, [{ sql: "SELECT ? AS v", args: [arg(hostil)] }]);
    expect(paraTexto(r?.rows[0]?.[0] ?? { type: "null" })).toBe(hostil);
    // A tabela sobreviveu: o valor nunca foi comando.
    const [c] = await executarSql(livre, [{ sql: "SELECT COUNT(*) FROM t" }]);
    expect(paraTexto(c?.rows[0]?.[0] ?? { type: "null" })).toBe("2");
  }, 60_000);

  it("erro de SQL sobe com a mensagem do servidor", async () => {
    if (!podeRodar) return;
    let capturado: unknown;
    try {
      await executarSql(livre, [{ sql: "SELECT * FROM nao_existe" }]);
    } catch (e) { capturado = e; }
    expect(capturado).toBeInstanceOf(ErroLibsql);
    expect((capturado as Error).message).toContain("nao_existe");
  }, 60_000);
});

describe("a garantia do libSQL é o claim do JWT", () => {
  const comToken = (token: string | null): AlvoLibsql => ({
    url: `http://127.0.0.1:${String(COM_AUTH.porta)}`,
    token,
  });

  it("sem token nem SELECT passa", async () => {
    if (!podeRodar) return;
    let capturado: unknown;
    try {
      await executarSql(comToken(null), [{ sql: "SELECT 1" }]);
    } catch (e) { capturado = e; }
    expect(capturado).toBeInstanceOf(ErroLibsql);
    expect((capturado as Error).message.toLowerCase()).toContain("authorization");
  }, 60_000);

  it("token de escrita cria e insere", async () => {
    if (!podeRodar) return;
    await executarSql(comToken(tokenRw), [
      { sql: "CREATE TABLE g (id INTEGER PRIMARY KEY, v TEXT)" },
      { sql: "INSERT INTO g VALUES (1,'a'),(2,'b')" },
    ]);
    const [r] = await executarSql(comToken(tokenRw), [{ sql: "SELECT COUNT(*) FROM g" }]);
    expect(paraTexto(r?.rows[0]?.[0] ?? { type: "null" })).toBe("2");
  }, 60_000);

  /*
   * A garantia, medida. É do SERVIDOR, e cobre DDL — diferente do MySQL, onde
   * ela depende de montar o GRANT certo, e do SQLite local, onde o
   * `PRAGMA query_only` está ao alcance do usuário.
   */
  it("token de leitura lê, e o servidor barra tudo que escreve — inclusive DDL", async () => {
    if (!podeRodar) return;
    const ro = comToken(tokenRo);

    const [r] = await executarSql(ro, [{ sql: "SELECT COUNT(*) FROM g" }]);
    expect(paraTexto(r?.rows[0]?.[0] ?? { type: "null" })).toBe("2");

    const barrados = [
      "INSERT INTO g VALUES (3,'c')",
      "UPDATE g SET v='x'",
      "DELETE FROM g",
      "DROP TABLE g",
      "CREATE TABLE z (a INT)",
      // As duas saídas clássicas do SQLite, e as duas estão fechadas aqui.
      "PRAGMA query_only = OFF",
      "ATTACH DATABASE ':memory:' AS m",
    ];
    for (const sql of barrados) {
      let capturado: unknown;
      try {
        await executarSql(ro, [{ sql }]);
      } catch (e) { capturado = e; }
      expect(capturado, `${sql} passou com token de leitura`).toBeInstanceOf(ErroLibsql);
    }

    // E os dados continuam lá, pelo token que pode escrever.
    const [depois] = await executarSql(comToken(tokenRw), [{ sql: "SELECT COUNT(*) FROM g" }]);
    expect(paraTexto(depois?.rows[0]?.[0] ?? { type: "null" })).toBe("2");
  }, 120_000);
});
