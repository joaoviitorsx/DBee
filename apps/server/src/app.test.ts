import { describe, expect, it } from "bun:test";

import { app } from "./app";

describe("GET /api/health", () => {
  it("responde 200", async () => {
    const res = await app.handle(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
  });

  it("responde { status: 'ok' }", async () => {
    const res = await app.handle(new Request("http://localhost/api/health"));
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("não expõe nenhuma outra rota", async () => {
    const res = await app.handle(new Request("http://localhost/api/connections"));
    expect(res.status).toBe(404);
  });
});
