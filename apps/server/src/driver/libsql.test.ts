import { describe, expect, it } from "bun:test";

import type { ResolvedConnection } from "../db/connections.repo";
import { alvoLibsqlDe } from "./libsql";

/**
 * Os três modos de SSL do libSQL, travados por teste (ADR 003: cada modo
 * significa o que promete). Foi a dívida da fase 3 — a versão anterior tratava
 * `require` e `verify-full` como a mesma coisa.
 *
 * O comportamento de rede em si (require aceita self-signed, verify-full
 * recusa) foi medido contra `badssl.com`; aqui trava a **tradução** do modo
 * para a config que o `fetch` recebe, que é o que decide aquele comportamento.
 */
const conexao = (sslMode: "disable" | "require" | "verify-full"): ResolvedConnection =>
  ({
    id: "c1", name: "ls", color: null, engine: "libsql",
    host: "db.exemplo.com", port: 8080, database: "", username: "",
    sslMode, timezone: "UTC", statementTimeoutMs: 30_000,
    writeEnabled: false, createdAt: "", updatedAt: "", password: "tok",
  });

describe("alvoLibsqlDe — os três modos de SSL", () => {
  it("disable é http e não configura TLS", () => {
    const a = alvoLibsqlDe(conexao("disable"), undefined);
    expect(a.url).toBe("http://db.exemplo.com:8080");
    expect(a.tls).toBeUndefined();
  });

  /*
   * O modo que a fase 3 tratava errado. `require` cifra mas NÃO autentica: é
   * https com rejectUnauthorized false — o que faz um self-signed passar.
   */
  it("require é https e NÃO valida a identidade", () => {
    const a = alvoLibsqlDe(conexao("require"), undefined);
    expect(a.url).toBe("https://db.exemplo.com:8080");
    expect(a.tls?.rejectUnauthorized).toBe(false);
  });

  it("verify-full é https e valida", () => {
    const a = alvoLibsqlDe(conexao("verify-full"), undefined);
    expect(a.url).toBe("https://db.exemplo.com:8080");
    expect(a.tls?.rejectUnauthorized).toBe(true);
  });

  it("a CA própria acompanha os dois modos https, e não o http", () => {
    expect(alvoLibsqlDe(conexao("verify-full"), "CA-PEM").tls?.ca).toBe("CA-PEM");
    expect(alvoLibsqlDe(conexao("require"), "CA-PEM").tls?.ca).toBe("CA-PEM");
    expect(alvoLibsqlDe(conexao("disable"), "CA-PEM").tls).toBeUndefined();
  });

  it("token vazio vira null; token presente sobe como está", () => {
    const semToken = { ...conexao("require"), password: "" } as ResolvedConnection;
    expect(alvoLibsqlDe(semToken, undefined).token).toBeNull();
    expect(alvoLibsqlDe(conexao("require"), undefined).token).toBe("tok");
  });
});
