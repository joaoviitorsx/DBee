import { join, normalize, sep } from "node:path";

/**
 * Serve o web estático que o binário carrega em produção (DBee.md §8).
 *
 * O container tem o build do Vite em `/app/public`; o binário serve o `/api` e,
 * fora dele, estes arquivos — é o que faz o login e o setup aparecerem numa URL,
 * em vez de o container responder só JSON. Em dev não existe `public/` e o Vite
 * serve o web; aqui isso vira 404 inofensivo, porque ninguém abre o `:3001/` a pé.
 *
 * `Bun.file` em vez de `@elysiajs/static`: a primitiva do Bun resolve, então não
 * entra dependência (regra 3 do CLAUDE.md). O fallback para `index.html` é o que
 * um SPA precisa — uma rota de cliente (`/editor`, por ex.) não é arquivo e tem
 * que devolver o app, não 404.
 */
export function servirWeb(publicDir: string) {
  const raiz = normalize(publicDir);

  return async (request: Request): Promise<Response> => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const alvo = normalize(join(raiz, pathname === "/" ? "/index.html" : pathname));

    // Trava de travessia: o caminho resolvido tem que continuar sob `raiz`.
    // Sem isto, `/..%2f..%2fetc%2fpasswd` sairia do diretório do web.
    if (alvo !== raiz && !alvo.startsWith(raiz + sep)) {
      return new Response("Not found", { status: 404 });
    }

    const arquivo = Bun.file(alvo);
    if (await arquivo.exists()) return resposta(arquivo);

    // Fallback SPA: caminho que não é arquivo devolve o app (client-side routing).
    const index = Bun.file(join(raiz, "index.html"));
    if (await index.exists()) return resposta(index);

    return new Response("Not found", { status: 404 });
  };
}

/**
 * Resposta com `Content-Type` **explícito**. Ao devolver a Response por um
 * handler do Elysia, o content-type que o `Bun.file` inferiria se perde, e um
 * módulo JS servido sem MIME de JavaScript é recusado pelo navegador (o app
 * carrega em branco). `arquivo.type` traz o tipo por extensão; o mapa cobre o
 * punhado que o Bun não adivinha.
 */
function resposta(arquivo: ReturnType<typeof Bun.file>): Response {
  const tipo = arquivo.type && arquivo.type !== "application/octet-stream" ? arquivo.type : porExtensao(arquivo.name);
  return new Response(arquivo, { headers: { "content-type": tipo } });
}

const TIPOS: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json; charset=utf-8",
  webp: "image/webp",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  map: "application/json; charset=utf-8",
};

function porExtensao(nome: string | undefined): string {
  const ext = nome?.split(".").pop()?.toLowerCase() ?? "";
  return TIPOS[ext] ?? "application/octet-stream";
}
