import { afterAll, describe, expect, it } from "bun:test";

import { ErroLibsql, executarSql } from "./cliente";

/**
 * Servidor HTTP local imitando falhas de transporte que o sqld real não
 * produz: corpo que trava depois dos cabeçalhos e HTML de proxy.
 */
const servidor = Bun.serve({
  port: 0,
  fetch(req) {
    const caminho = new URL(req.url).pathname;
    if (caminho.startsWith("/trava/")) {
      // Cabeçalhos saem na hora; o corpo nunca termina.
      const corpo = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("{"));
        },
      });
      return new Response(corpo, { headers: { "content-type": "application/json" } });
    }
    return new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
  },
});

afterAll(() => {
  void servidor.stop(true);
});

const TOKEN = "segredo-jwt-que-nao-pode-vazar";

async function erroDe(p: Promise<unknown>): Promise<ErroLibsql> {
  try {
    await p;
  } catch (err: unknown) {
    if (err instanceof ErroLibsql) return err;
    throw err;
  }
  throw new Error("esperava ErroLibsql");
}

describe("executarSql — falhas de transporte", () => {
  it("corpo que trava após os cabeçalhos cai no prazo", async () => {
    const e = await erroDe(
      executarSql(
        { url: `http://127.0.0.1:${String(servidor.port)}/trava`, token: TOKEN, timeoutMs: 300 },
        [{ sql: "SELECT 1" }],
      ),
    );
    expect(e.code).toBe("timeout");
  });

  it("502 com HTML vira ErroLibsql com o status, sem ecoar token/URL", async () => {
    const url = `http://127.0.0.1:${String(servidor.port)}/html`;
    const e = await erroDe(executarSql({ url, token: TOKEN, timeoutMs: 2000 }, [{ sql: "SELECT 1" }]));
    expect(e.code).toBe("http_502");
    expect(e.message).toContain("502");
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain("127.0.0.1");
    expect(e.message).not.toContain("<html>");
  });
});
