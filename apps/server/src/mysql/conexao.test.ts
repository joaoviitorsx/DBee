import { describe, expect, it } from "bun:test";

import { ehRecusa, sslMysqlPara } from "./conexao";

/**
 * O ADR 003 em cima do `mysql2`: três modos, e o único que não dá para
 * entregar por IP é recusado em voz alta em vez de fingir.
 */
describe("TLS de MySQL/MariaDB", () => {
  it("disable é texto claro, sem objeto de ssl", () => {
    const r = sslMysqlPara("disable", undefined, "10.0.0.4");
    expect(ehRecusa(r)).toBe(false);
    if (!ehRecusa(r)) expect(r.ssl).toBe(false);
  });

  /*
   * `require` promete sigilo e não identidade. Ligar `verifyIdentity` aqui
   * faria o modo mais permissivo recusar conexões que o mais restrito aceita —
   * e faria `require` falhar por IP exatamente como `verify-full`, que é o
   * oposto do que o modo quer dizer.
   */
  it("require criptografa sem autenticar, inclusive por IP", () => {
    for (const host of ["10.0.0.4", "100.74.101.69", "db.interno"]) {
      const r = sslMysqlPara("require", "ca-qualquer", host);
      expect(ehRecusa(r), host).toBe(false);
      if (ehRecusa(r)) continue;
      expect(r.ssl).toEqual({ rejectUnauthorized: false });
    }
  });

  it("verify-full por hostname DNS liga cadeia e identidade", () => {
    const r = sslMysqlPara("verify-full", "-----CA-----", "db.interno");
    expect(ehRecusa(r)).toBe(false);
    if (!ehRecusa(r)) {
      expect(r.ssl).toEqual({ rejectUnauthorized: true, ca: "-----CA-----", verifyIdentity: true });
    }
  });

  it("verify-full sem CA ainda liga a conferência, usando as CAs do sistema", () => {
    const r = sslMysqlPara("verify-full", undefined, "db.interno");
    expect(ehRecusa(r)).toBe(false);
    if (!ehRecusa(r)) expect(r.ssl).toEqual({ rejectUnauthorized: true, verifyIdentity: true });
  });

  /*
   * O caso que motiva o arquivo inteiro. A produção do DBee é alcançada pelo IP
   * da tailnet, então esta é a combinação que de fato aparece.
   */
  it("verify-full por IP é recusado — IPv4, IPv6 e o caso real da tailnet", () => {
    for (const host of ["127.0.0.1", "10.0.0.4", "100.74.101.69", "::1", "fd7a:115c:a1e0::1"]) {
      const r = sslMysqlPara("verify-full", "-----CA-----", host);
      expect(ehRecusa(r), host).toBe(true);
    }
  });

  it("a recusa diz o host, a causa e as duas saídas", () => {
    const r = sslMysqlPara("verify-full", undefined, "100.74.101.69");
    expect(ehRecusa(r)).toBe(true);
    if (!ehRecusa(r)) return;
    // O host, para a pessoa saber de qual conexão se trata.
    expect(r.motivo).toContain("100.74.101.69");
    // As duas saídas reais, porque erro que não diz o que fazer vira ticket.
    expect(r.motivo).toContain("hostname DNS");
    expect(r.motivo).toContain("require");
    // E o aviso de que `require` não autentica — senão a saída sugerida vira
    // uma segunda promessa falsa.
    expect(r.motivo).toContain("sem autenticar");
  });

  /*
   * Hostname que se PARECE com IP não pode cair na recusa. `isIP` decide, e
   * este caso trava o dia em que alguém trocar por uma expressão regular.
   */
  it("hostname parecido com IP não é tratado como IP", () => {
    for (const host of ["10.0.0.4.exemplo.com", "1.2.3.4.nip.io", "999.999.999.999"]) {
      const r = sslMysqlPara("verify-full", undefined, host);
      expect(ehRecusa(r), host).toBe(false);
    }
  });
});
