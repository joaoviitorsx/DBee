/**
 * Servidor local da landing — para ver `site/` no navegador enquanto se mexe.
 *
 * Por que não abrir o `index.html` por `file://`: o `file://` não resolve
 * diretório para `index.html` (o link "Docs" quebraria), trata cada arquivo
 * como origem opaca e serve `.js` com tipo errado em alguns navegadores. Servir
 * por HTTP é o único jeito de o que se vê aqui ser o que o Pages vai entregar.
 *
 * Não há build, não há watch e não há reload automático: o site é HTML, CSS e
 * JS estáticos. Salvou, F5. Um watcher aqui seria maquinaria para economizar
 * uma tecla.
 *
 *   bun scripts/site-dev.ts            # http://localhost:4321
 *   PORT=8080 bun scripts/site-dev.ts
 */
import { join } from "node:path";

const RAIZ = new URL("../site/", import.meta.url).pathname;
const PORTA = Number(process.env["PORT"] ?? 4321);

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const servidor = Bun.serve({
  port: PORTA,
  /*
   * `127.0.0.1`, nunca `0.0.0.0`.
   *
   * O padrão do `Bun.serve` é escutar em todas as interfaces, e isso poria a
   * pasta `site/` na rede local de quem rodasse o script num café. É o mesmo
   * princípio do `docs/operacao.md`: nada bindado em 0.0.0.0 por descuido.
   */
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    let caminho = decodeURIComponent(url.pathname);
    if (caminho.endsWith("/")) caminho += "index.html";

    /*
     * Normaliza ANTES de conferir. `join` resolve os `..`, então a comparação
     * com a raiz depois dele é o que impede um `GET /../../.env` de servir
     * arquivo de fora de `site/`. É servidor de desenvolvimento, mas um que
     * entrega o repositório inteiro não é aceitável nem em desenvolvimento.
     */
    const alvo = join(RAIZ, caminho.replace(/^\/+/, ""));
    if (!alvo.startsWith(RAIZ)) return new Response("nope", { status: 403 });

    const arquivo = Bun.file(alvo);
    if (await arquivo.exists()) {
      const ext = alvo.slice(alvo.lastIndexOf("."));
      return new Response(arquivo, {
        headers: {
          "content-type": TIPOS[ext] ?? "application/octet-stream",
          // Sem cache: em dev, um CSS cacheado é meia hora procurando um bug
          // que já estava consertado no disco.
          "cache-control": "no-store",
        },
      });
    }

    // O Pages serve 404.html para qualquer caminho inexistente. Imitar isso é
    // o que torna a página de erro testável localmente.
    const erro = Bun.file(join(RAIZ, "404.html"));
    return new Response((await erro.exists()) ? erro : "404", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`landing em http://localhost:${String(servidor.port)}/`);
console.log(`docs em     http://localhost:${String(servidor.port)}/docs/`);
