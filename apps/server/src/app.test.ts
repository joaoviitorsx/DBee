import { beforeAll, describe, expect, it } from "bun:test";

import type { Connection } from "@dbee/shared";

import { createApp } from "./app";
import { openTestStore } from "./db/client";
import { deriveKey, newSalt } from "./lib/crypto";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  // openTestStore deriva a chave uma vez (~700 ms) para toda a suíte.
  app = createApp({ store: openTestStore(), caCert: undefined });
});

const call = (path: string, init?: RequestInit): Promise<Response> =>
  app.handle(new Request(`http://localhost${path}`, init));

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const NOVA = {
  name: "local",
  host: "127.0.0.1",
  database: "postgres",
  username: "postgres",
  password: "senha-secreta-do-teste",
};

describe("GET /api/health", () => {
  it("responde 200 { status: ok }", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("CRUD de conexões", () => {
  it("cria com 201 e aplica os defaults", async () => {
    const res = await call("/api/connections", json(NOVA));
    expect(res.status).toBe(201);

    const created = (await res.json()) as Connection;
    expect(created.name).toBe("local");
    expect(created.port).toBe(5432);
    expect(created.sslMode).toBe("disable"); // ADR 003
    expect(created.writeEnabled).toBe(false); // read-only por padrão
    expect(created.statementTimeoutMs).toBe(30000);
    expect(created.timezone).toBe("UTC");
    expect(created.id).toHaveLength(21);
  });

  it("NUNCA devolve a senha nem password_enc", async () => {
    const created = (await (await call("/api/connections", json(NOVA))).json()) as Connection;

    const corpos = [
      JSON.stringify(created),
      await (await call("/api/connections")).text(),
      await (await call(`/api/connections/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "renomeada" }),
      })).text(),
    ];

    for (const corpo of corpos) {
      expect(corpo).not.toContain("senha-secreta-do-teste");
      expect(corpo).not.toContain("password_enc");
      expect(corpo).not.toContain("password");
    }
  });

  it("lista as conexões", async () => {
    const res = await call("/api/connections");
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("atualiza sem exigir a senha", async () => {
    const created = (await (await call("/api/connections", json(NOVA))).json()) as Connection;
    const res = await call(`/api/connections/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "renomeada", writeEnabled: true }),
    });
    expect(res.status).toBe(200);

    const updated = (await res.json()) as Connection;
    expect(updated.name).toBe("renomeada");
    expect(updated.writeEnabled).toBe(true);
    expect(updated.host).toBe(NOVA.host);
  });

  it("apaga com 204 e depois dá 404", async () => {
    const created = (await (await call("/api/connections", json(NOVA))).json()) as Connection;
    expect((await call(`/api/connections/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/connections/${created.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("404 em id inexistente", async () => {
    const res = await call("/api/connections/nao-existe", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("recusa ssl_mode fora dos três do ADR 003", async () => {
    const res = await call("/api/connections", json({ ...NOVA, sslMode: "prefer" }));
    expect(res.status).toBe(422);
  });

  it("recusa payload sem campo obrigatório", async () => {
    const res = await call("/api/connections", json({ name: "só o nome" }));
    expect(res.status).toBe(422);
  });
});

describe("POST /api/connections/:id/test", () => {
  it("404 em conexão inexistente", async () => {
    const res = await call("/api/connections/nao-existe/test", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("devolve ok:false com o erro do driver quando não dá para conectar", async () => {
    const created = (await (
      await call("/api/connections", json({ ...NOVA, port: 1 }))
    ).json()) as Connection;

    const res = await call(`/api/connections/${created.id}/test`, { method: "POST" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBeTruthy();
    // O erro do Postgres/driver vai inteiro, mas sem credencial.
    expect(JSON.stringify(body)).not.toContain("senha-secreta-do-teste");
  });
});

describe("APP_SECRET trocado (DBee.md §11.5)", () => {
  it("listar continua funcionando, mas testar devolve erro com código", async () => {
    const store = openTestStore("segredo-original");
    const original = createApp({ store, caCert: undefined });

    const created = (await (
      await original.handle(
        new Request("http://localhost/api/connections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(NOVA),
        }),
      )
    ).json()) as Connection;

    // Mesmo banco, chave derivada de outro APP_SECRET.
    const comOutraChave = createApp({
      store: { ...store, key: deriveKey("segredo-diferente", newSalt()) },
      caCert: undefined,
    });

    const listagem = await comOutraChave.handle(
      new Request("http://localhost/api/connections"),
    );
    expect(listagem.status).toBe(200); // listar não decifra

    const teste = await comOutraChave.handle(
      new Request(`http://localhost/api/connections/${created.id}/test`, { method: "POST" }),
    );
    expect(teste.status).toBe(500);

    const body = (await teste.json()) as { code: string; message: string };
    expect(body.code).toBe("decryption_failed");
    expect(body.message).toContain("APP_SECRET");
    expect(JSON.stringify(body)).not.toContain("senha-secreta-do-teste");
  });
});

describe("PATCH não pode mexer em campo que o cliente não mandou", () => {
  it("preserva porta, timeout e timezone ao patchar só o nome", async () => {
    const criada = (await (
      await call(
        "/api/connections",
        json({ ...NOVA, port: 55434, statementTimeoutMs: 12_000, timezone: "America/Sao_Paulo" }),
      )
    ).json()) as Connection;

    const res = await call(`/api/connections/${criada.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "só o nome" }),
    });

    const depois = (await res.json()) as Connection;
    expect(depois.name).toBe("só o nome");
    // Regressão: o `default` do TypeBox materializava port 5432 aqui e
    // reapontava a conexão para outro servidor em silêncio.
    expect(depois.port).toBe(55434);
    expect(depois.statementTimeoutMs).toBe(12_000);
    expect(depois.timezone).toBe("America/Sao_Paulo");
    expect(depois.host).toBe(NOVA.host);
    expect(depois.database).toBe(NOVA.database);
    expect(depois.username).toBe(NOVA.username);
  });

  it("preserva writeEnabled e sslMode ao patchar só o host", async () => {
    const criada = (await (
      await call("/api/connections", json({ ...NOVA, writeEnabled: true, sslMode: "verify-full" }))
    ).json()) as Connection;

    const depois = (await (
      await call(`/api/connections/${criada.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host: "10.0.0.1" }),
      })
    ).json()) as Connection;

    expect(depois.host).toBe("10.0.0.1");
    expect(depois.writeEnabled).toBe(true);
    expect(depois.sslMode).toBe("verify-full");
  });

  it("um PATCH vazio não altera nada", async () => {
    const criada = (await (await call("/api/connections", json(NOVA))).json()) as Connection;

    const depois = (await (
      await call(`/api/connections/${criada.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).json()) as Connection;

    expect({ ...depois, updatedAt: "" }).toEqual({ ...criada, updatedAt: "" });
  });

  it("o POST continua aplicando os defaults", async () => {
    const criada = (await (await call("/api/connections", json(NOVA))).json()) as Connection;
    expect(criada.port).toBe(5432);
    expect(criada.statementTimeoutMs).toBe(30_000);
    expect(criada.timezone).toBe("UTC");
    expect(criada.sslMode).toBe("disable");
    expect(criada.writeEnabled).toBe(false);
  });
});
