import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { checkIdentityForIp } from "./ssl";

/**
 * `verify-full` contra TLS de verdade (ADR 003).
 *
 * Os testes de `ssl.test.ts` exercitam a lógica com um `PeerCertificate`
 * simulado. Estes fazem handshake real, com certificado emitido na hora, porque
 * é onde mora a diferença que motivou a decisão: o `node:tls` não usa o host
 * quando ele é um IP, e nenhuma simulação mostraria isso.
 *
 * Precisa de `openssl` no PATH — presente no runner do CI e em qualquer
 * distribuição de desenvolvimento. Sem ele os testes são pulados em vez de
 * falharem por motivo alheio ao código.
 */

const temOpenssl = Bun.spawnSync(["openssl", "version"]).exitCode === 0;

let dir = "";

function emitir(nome: string, subj: string, san: string | null): void {
  const args = [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(dir, `${nome}.key`),
    "-out", join(dir, `${nome}.crt`),
    "-days", "1", "-subj", subj,
  ];
  if (san !== null) args.push("-addext", `subjectAltName=${san}`);
  const r = Bun.spawnSync(["openssl", ...args]);
  if (r.exitCode !== 0) throw new Error(`openssl falhou: ${r.stderr.toString()}`);
}

/** Sobe um servidor TLS com o certificado dado e tenta conectar como `hostAlvo`. */
async function handshake(nome: string, hostAlvo: string): Promise<string> {
  const server = createServer(
    { key: readFileSync(join(dir, `${nome}.key`)), cert: readFileSync(join(dir, `${nome}.crt`)) },
    (socket) => { socket.end(); },
  );
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  try {
    return await new Promise<string>((resolve) => {
      const socket = connect(
        {
          host: "127.0.0.1",
          port,
          // O próprio certificado como CA: isola a validação de identidade da
          // validação de cadeia, que não é o que está sendo testado aqui.
          ca: readFileSync(join(dir, `${nome}.crt`)),
          rejectUnauthorized: true,
          checkServerIdentity: checkIdentityForIp(hostAlvo),
        },
        () => { resolve("ok"); socket.destroy(); },
      );
      socket.on("error", (err: Error) => { resolve(err.message); });
    });
  } finally {
    server.close();
  }
}

beforeAll(() => {
  if (!temOpenssl) return;
  dir = mkdtempSync(join(tmpdir(), "dbee-tls-"));
  emitir("com-ip", "/CN=10.0.0.4", "IP:10.0.0.4,DNS:db.interno");
  emitir("sem-ip", "/CN=10.0.0.4", "DNS:db.interno");
  emitir("so-cn", "/CN=10.0.0.4", null);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe.if(temOpenssl)("verify-full com host IP, handshake real", () => {
  it("certificado COM o IP no SAN: conecta", async () => {
    // Este é o caso que estava quebrado: o node caía para `localhost` e
    // recusava um certificado perfeitamente correto.
    expect(await handshake("com-ip", "10.0.0.4")).toBe("ok");
  });

  it("certificado com OUTRO IP no SAN: recusa, dizendo qual IP falta", async () => {
    const erro = await handshake("com-ip", "10.0.0.9");
    expect(erro).toContain("não cobre o IP 10.0.0.9");
    expect(erro).toContain("10.0.0.4");
  });

  it("certificado só com SAN de DNS: falha fechada", async () => {
    const erro = await handshake("sem-ip", "10.0.0.4");
    expect(erro).toContain("não declara nenhum SAN do tipo IP");
    // Diz o que fazer, não só "erro de TLS".
    expect(erro).toContain('IP:10.0.0.4');
  });

  it("certificado só com CN igual ao IP: recusa — não há fallback para CN", async () => {
    // CN é obsoleto para identidade (RFC 6125), e um certificado só-CN é
    // trivial de emitir. Aceitá-lo reabriria o que o SAN fechou.
    expect(await handshake("so-cn", "10.0.0.4")).toContain("não declara nenhum SAN do tipo IP");
  });
});

describe.if(!temOpenssl)("verify-full com host IP", () => {
  it("pulado: openssl não está no PATH", () => {
    expect(temOpenssl).toBe(false);
  });
});
