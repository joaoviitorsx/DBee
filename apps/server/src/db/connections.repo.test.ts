import { describe, expect, it } from "bun:test";

import type { Ator } from "../lib/ator";
import { openTestStore } from "./client";
import { ConnectionsRepository } from "./connections.repo";

/**
 * A credencial de escrita, no repositório — o coração da escrita nas engines de
 * credencial (migração 008).
 *
 * O que estes testes travam:
 * - a credencial de escrita **volta decifrada** no `resolve`, e só ali;
 * - ela **nunca** aparece no `find`/na listagem (só o `hasWriteCredential`);
 * - ela cifra com AAD **distinto** da senha de leitura — a defesa contra a
 *   troca intra-linha (ADR 005, um nível mais fino);
 * - o `update` com string vazia **remove** a credencial.
 */
const admin: Ator = { id: "u-admin", role: "admin" };

function repo(): ConnectionsRepository {
  const store = openTestStore();
  return new ConnectionsRepository(store.db, store.key);
}

describe("credencial de escrita no repositório", () => {
  it("resolve devolve a credencial de escrita decifrada quando existe", () => {
    const r = repo();
    const c = r.create({
      name: "my", engine: "mysql", host: "127.0.0.1", database: "loja",
      username: "leitor", password: "senha-ro",
      writeUsername: "gravador", writePassword: "senha-rw",
    });
    expect(c.hasWriteCredential).toBe(true);

    const resolvida = r.resolve(c.id, admin);
    expect(resolvida?.password).toBe("senha-ro");
    expect(resolvida?.writeCredential?.username).toBe("gravador");
    expect(resolvida?.writeCredential?.password).toBe("senha-rw");
  });

  it("sem credencial de escrita, resolve não traz writeCredential", () => {
    const r = repo();
    const c = r.create({
      name: "my", engine: "mysql", host: "127.0.0.1", database: "loja",
      username: "leitor", password: "senha-ro",
    });
    expect(c.hasWriteCredential).toBe(false);
    expect(r.resolve(c.id, admin)?.writeCredential).toBeUndefined();
  });

  it("o libSQL guarda só o token gravável, sem username", () => {
    const r = repo();
    const c = r.create({
      name: "ls", engine: "libsql", host: "127.0.0.1", port: 8080,
      password: "", writePassword: "jwt-rw",
    });
    expect(c.hasWriteCredential).toBe(true);
    const resolvida = r.resolve(c.id, admin);
    expect(resolvida?.writeCredential?.username).toBe("");
    expect(resolvida?.writeCredential?.password).toBe("jwt-rw");
  });

  /*
   * A defesa que a migração 008 existe para dar. Se a senha de escrita cifrasse
   * com o MESMO AAD da de leitura, mover `password_enc` para
   * `write_password_enc` (acesso ao volume, não à API) decifraria, e a escrita
   * rodaria com a credencial de leitura. Com AAD distinto, não decifra.
   */
  it("a credencial de escrita não decifra sob o AAD da leitura", () => {
    const store = openTestStore();
    const r = new ConnectionsRepository(store.db, store.key);
    const c = r.create({
      name: "my", engine: "mysql", host: "127.0.0.1", database: "loja",
      username: "leitor", password: "senha-ro",
      writeUsername: "gravador", writePassword: "senha-rw",
    });

    // Simula o atacante com escrita no volume: copia password_enc (leitura) por
    // cima de write_password_enc (escrita). Se o AAD fosse o mesmo, decifraria.
    store.db
      .query("UPDATE connections SET write_password_enc = (SELECT password_enc FROM connections WHERE id = ?) WHERE id = ?")
      .run(c.id, c.id);

    expect(() => r.resolve(c.id, admin)).toThrow();
  });

  it("update com writePassword vazio remove a credencial de escrita", () => {
    const r = repo();
    const c = r.create({
      name: "my", engine: "mysql", host: "127.0.0.1", database: "loja",
      username: "leitor", password: "senha-ro",
      writeUsername: "gravador", writePassword: "senha-rw",
    });
    expect(c.hasWriteCredential).toBe(true);

    const atualizada = r.update(c.id, { writePassword: "" });
    expect(atualizada?.hasWriteCredential).toBe(false);
    expect(r.resolve(c.id, admin)?.writeCredential).toBeUndefined();
  });

  it("update troca a credencial de escrita sem tocar a de leitura", () => {
    const r = repo();
    const c = r.create({
      name: "my", engine: "mysql", host: "127.0.0.1", database: "loja",
      username: "leitor", password: "senha-ro",
      writeUsername: "gravador", writePassword: "senha-rw",
    });
    r.update(c.id, { writePassword: "senha-rw-2", writeUsername: "gravador2" });
    const resolvida = r.resolve(c.id, admin);
    expect(resolvida?.password).toBe("senha-ro");
    expect(resolvida?.writeCredential?.username).toBe("gravador2");
    expect(resolvida?.writeCredential?.password).toBe("senha-rw-2");
  });
});
