import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * TLS de MySQL com o driver de verdade (ADR 003, `docs/multi-engine.md` §3c).
 *
 * O equivalente do Postgres (`pg/ssl.tls.test.ts`) usa um servidor TLS simples,
 * porque lá o que se testa é a nossa verificação de identidade. Aqui não dá: o
 * MySQL negocia TLS **no meio** do seu próprio handshake, então só um servidor
 * MySQL de verdade exercita o caminho que o `mysql2` percorre.
 *
 * O terceiro caso é um **alarme**, não uma verificação de comportamento
 * desejado. Ele trava a limitação medida do `mysql2` — identidade quebrada
 * quando o host é IP. No dia em que o driver corrigir isso, este teste falha, e
 * a falha é a notícia: `sslMysqlPara` pode parar de recusar `verify-full` por
 * IP. Sem ele a restrição sobreviveria à sua própria razão de existir.
 */

const CONTAINER = "dbee-mysql-tls-it";
const PORTA = 55501;
const SENHA = "Tl7pQz2mVx4T";

const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const temOpenssl = Bun.spawnSync(["openssl", "version"]).exitCode === 0;
const podeRodar = temDocker && temOpenssl;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let dir = "";
let ca = "";

function openssl(...args: string[]): void {
  const r = Bun.spawnSync(["openssl", ...args]);
  if (r.exitCode !== 0) throw new Error(`openssl: ${r.stderr.toString()}`);
}

/**
 * Um certificado de servidor assinado pela CA do teste, com o SAN pedido.
 *
 * Dois certificados, um SAN cada: `IP:127.0.0.1` e `DNS:localhost`. Os dois
 * apontam para o mesmo endereço, então a diferença entre conectar por IP e por
 * nome fica isolada — que é exatamente a variável em jogo.
 */
function emitirServidor(nome: string, san: string): void {
  openssl("req", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(dir, `${nome}.key`), "-out", join(dir, `${nome}.csr`),
    "-subj", "/CN=irrelevante-por-rfc-6125");
  writeFileSync(join(dir, `${nome}.ext`), `subjectAltName=${san}\nextendedKeyUsage=serverAuth\n`);
  openssl("x509", "-req", "-in", join(dir, `${nome}.csr`),
    "-CA", join(dir, "ca.crt"), "-CAkey", join(dir, "ca.key"), "-CAcreateserial",
    "-out", join(dir, `${nome}.crt`), "-days", "1", "-extfile", join(dir, `${nome}.ext`));
  // O mysqld roda como outro usuário dentro do container e precisa ler os dois.
  chmodSync(join(dir, `${nome}.crt`), 0o644);
  chmodSync(join(dir, `${nome}.key`), 0o644);
}

async function conecta(host: string, ssl: mysql.SslOptions): Promise<string> {
  try {
    const c = await mysql.createConnection({
      host, port: PORTA, user: "root", password: SENHA, database: "loja",
      ssl, connectTimeout: 8000,
    });
    // `Ssl_cipher` vazio significa conexão em texto claro — o modo de falha
    // silenciosa que este teste existe para pegar.
    const [r] = await c.query("SHOW STATUS LIKE 'Ssl_cipher'");
    const cifra = (r as { Value?: string }[])[0]?.Value ?? "";
    await c.end();
    return cifra === "" ? "conectou-sem-tls" : "conectou";
  } catch (e) {
    return `recusou: ${(e as Error).message}`;
  }
}

/** Sobe o mysqld com o certificado escolhido. Trocar de cert exige recriar. */
async function subirCom(nome: string): Promise<void> {
  sh("docker", "rm", "-f", CONTAINER);
  sh(
    "docker", "run", "-d", "--name", CONTAINER,
    "-e", `MYSQL_ROOT_PASSWORD=${SENHA}`, "-e", "MYSQL_DATABASE=loja",
    "-p", `${String(PORTA)}:3306`,
    "-v", `${join(dir, "ca.crt")}:/tls/ca.pem:ro`,
    "-v", `${join(dir, `${nome}.crt`)}:/tls/server.pem:ro`,
    "-v", `${join(dir, `${nome}.key`)}:/tls/server.key:ro`,
    "mysql:8.4",
    "--ssl-ca=/tls/ca.pem", "--ssl-cert=/tls/server.pem", "--ssl-key=/tls/server.key",
    "--require_secure_transport=ON",
  );
  // Prontidão por TCP: a imagem sobe um servidor temporário na inicialização, e
  // `docker exec` passa nessa janela (ver `tipos.integration.test.ts`).
  for (let i = 0; i < 120; i++) {
    try {
      const c = await mysql.createConnection({
        host: "127.0.0.1", port: PORTA, user: "root", password: SENHA,
        database: "loja", ssl: { rejectUnauthorized: false }, connectTimeout: 1000,
      });
      await c.query("SELECT 1");
      await c.end();
      return;
    } catch {
      await Bun.sleep(500);
    }
  }
  throw new Error("MySQL com TLS não ficou pronto");
}

beforeAll(() => {
  if (!podeRodar) return;
  dir = mkdtempSync(join(tmpdir(), "dbee-mysql-tls-"));
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", join(dir, "ca.key"), "-out", join(dir, "ca.crt"), "-subj", "/CN=dbee-ca-de-teste");
  chmodSync(join(dir, "ca.crt"), 0o644);
  emitirServidor("ip", "IP:127.0.0.1");
  emitirServidor("dns", "DNS:localhost");
  ca = readFileSync(join(dir, "ca.crt"), "utf8");
}, 60_000);

afterAll(() => {
  sh("docker", "rm", "-f", CONTAINER);
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("TLS de MySQL contra servidor real", () => {
  it("require criptografa por IP — é o modo utilizável na tailnet", async () => {
    if (!podeRodar) return;
    await subirCom("ip");
    expect(await conecta("127.0.0.1", { rejectUnauthorized: false })).toBe("conectou");
  }, 180_000);

  it("verify-full por hostname aceita o SAN certo e recusa o errado", async () => {
    if (!podeRodar) return;
    // Servidor com DNS:localhost — conectar por "localhost" tem que passar.
    await subirCom("dns");
    expect(await conecta("localhost", { ca, rejectUnauthorized: true, verifyIdentity: true })).toBe("conectou");

    // Mesmo servidor, mas o certificado só cobre IP: por nome tem que recusar.
    await subirCom("ip");
    const errado = await conecta("localhost", { ca, rejectUnauthorized: true, verifyIdentity: true });
    expect(errado.startsWith("recusou")).toBe(true);
  }, 240_000);

  /*
   * ALARME. Não descreve comportamento desejado: descreve a limitação que
   * obriga `sslMysqlPara` a recusar `verify-full` por IP.
   *
   * O certificado tem `IP:127.0.0.1` entre os SANs e a conexão é para
   * 127.0.0.1 — deveria passar, e não passa, porque o `mysql2` descarta o
   * `servername` quando o host é numérico. Se um dia passar, a recusa em
   * `conexao.ts` pode cair.
   */
  it("ALARME: verify-full por IP recusa até o certificado correto (limitação do mysql2)", async () => {
    if (!podeRodar) return;
    await subirCom("ip");
    const r = await conecta("127.0.0.1", { ca, rejectUnauthorized: true, verifyIdentity: true });
    expect(
      r.startsWith("recusou"),
      "mysql2 passou a validar SAN de IP — reveja a recusa em conexao.ts e docs/multi-engine.md §3c",
    ).toBe(true);
    expect(r).toContain("altnames");
  }, 180_000);
});
