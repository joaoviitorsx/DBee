import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { servirWeb } from "./estaticos";

/**
 * O web estático servido pelo binário (DBee.md §8).
 *
 * O que este arquivo trava é o que **não se vê**: cabeçalho ausente não quebra
 * tela nenhuma, então o custo passa despercebido para sempre. Medido antes:
 * sem `Content-Encoding` e sem validador, abrir o DBee baixava 1,38 MB **toda
 * vez**, inclusive na segunda abertura do mesmo dia — o navegador não tinha
 * como reaproveitar nada.
 *
 * Duas regras aqui não são otimização, são corretude:
 *
 * - **`index.html` não pode ser `immutable`.** Os assets têm hash no nome; se o
 *   HTML cachear por um ano, depois de um deploy o app velho aponta para
 *   arquivos que já não existem e a tela quebra em branco.
 * - **`Vary: Accept-Encoding` em tudo.** Sem ele um proxy entrega corpo gzipado
 *   a um cliente que não pediu.
 */

let raiz = "";
let servir: ReturnType<typeof servirWeb>;

const HTML = "<!doctype html><html><body>dbee</body></html>";
// Grande o bastante para o gzip valer: conteúdo repetitivo, como um bundle.
const JS = `console.log(${JSON.stringify("x".repeat(4000))});`;

const pedir = (caminho: string, gzip = true): Promise<Response> =>
  servir(
    new Request(`http://localhost${caminho}`, {
      headers: gzip ? { "accept-encoding": "gzip, deflate, br" } : {},
    }),
  );

beforeAll(async () => {
  raiz = mkdtempSync(join(tmpdir(), "dbee-web-"));
  mkdirSync(join(raiz, "assets"));
  await Bun.write(join(raiz, "index.html"), HTML);
  await Bun.write(join(raiz, "assets", "app-B3xK9a1z.js"), JS);
  await Bun.write(join(raiz, "assets", "marca-C7d2Ff10.webp"), "RIFF....WEBP");
  await Bun.write(join(raiz, "favicon.ico"), "icone");
  servir = servirWeb(raiz);
});

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
});

describe("compressão", () => {
  it("comprime JS e o corpo volta idêntico ao original", async () => {
    const res = await pedir("/assets/app-B3xK9a1z.js");
    expect(res.headers.get("content-encoding")).toBe("gzip");

    // A prova que vale: descomprimir devolve exatamente o arquivo.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(JS);
    expect(bytes.length).toBeLessThan(JS.length / 2);
  });

  it("não comprime quem já vem comprimido", async () => {
    const res = await pedir("/assets/marca-C7d2Ff10.webp");
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("cliente que não aceita gzip recebe o arquivo cru", async () => {
    const res = await pedir("/assets/app-B3xK9a1z.js", false);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(JS);
  });

  /** Sem isto um proxy serve corpo gzipado a quem não pediu. */
  it("declara Vary mesmo quando não comprime", async () => {
    for (const caminho of ["/assets/app-B3xK9a1z.js", "/assets/marca-C7d2Ff10.webp", "/"]) {
      const res = await pedir(caminho);
      expect(`${caminho}: ${res.headers.get("vary") ?? "ausente"}`).toBe(
        `${caminho}: Accept-Encoding`,
      );
    }
  });
});

describe("cache", () => {
  it("arquivo com hash no nome é imutável por um ano", async () => {
    const res = await pedir("/assets/app-B3xK9a1z.js");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  /**
   * O caso que quebra o app depois de um deploy: o HTML aponta para os assets
   * com hash, e um HTML velho aponta para arquivos que já foram substituídos.
   */
  it("index.html NUNCA é imutável", async () => {
    for (const caminho of ["/", "/index.html", "/uma/rota/do/spa"]) {
      const res = await pedir(caminho);
      const cc = res.headers.get("cache-control") ?? "";
      expect(`${caminho}: ${cc}`).toBe(`${caminho}: no-cache`);
      expect(cc).not.toContain("immutable");
    }
  });

  it("arquivo sem hash no nome também não é imutável", async () => {
    const res = await pedir("/favicon.ico");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
});

describe("o que já valia continua valendo", () => {
  it("módulo JS sai com MIME de JavaScript", async () => {
    const res = await pedir("/assets/app-B3xK9a1z.js");
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("rota do SPA devolve o app, não 404", async () => {
    const res = await pedir("/qualquer/rota");
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const corpo =
      res.headers.get("content-encoding") === "gzip"
        ? new TextDecoder().decode(Bun.gunzipSync(bytes))
        : new TextDecoder().decode(bytes);
    expect(corpo).toBe(HTML);
  });

  /** A trava de travessia não pode ter sido afrouxada pelo caminho novo. */
  it("não sai do diretório do web", async () => {
    for (const caminho of ["/../etc/passwd", "/..%2f..%2fetc%2fpasswd"]) {
      const res = await pedir(caminho);
      // Ou 404, ou o fallback do SPA — nunca o arquivo de fora.
      const texto = await res.text();
      expect(texto).not.toContain("root:");
    }
  });
});
