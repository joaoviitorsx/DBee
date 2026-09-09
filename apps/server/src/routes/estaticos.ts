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
 *
 * ## Compressão e cache
 *
 * Medido contra o binário compilado: a resposta saía **só** com `content-type`.
 * Sem validador nenhum, o navegador não tinha como reaproveitar nada, e abrir o
 * DBee custava **1,38 MB toda vez** — inclusive na segunda abertura do mesmo
 * dia, pela tailnet. Com gzip e `immutable`: 538 kB na primeira visita e
 * **2,9 kB** nas seguintes; o FCP medido caiu de 812 ms para 236 ms.
 *
 * Três cuidados que não são opcionais:
 *
 * - **`index.html` nunca cacheia.** Os nomes dos assets carregam hash do Vite;
 *   se o HTML cachear, o app velho continua apontando para arquivos que já não
 *   existem, e a tela quebra depois de um deploy.
 * - **`Vary: Accept-Encoding`** em tudo que pode variar, senão um proxy entrega
 *   corpo gzipado a quem não pediu.
 * - **Não comprimir o que já está comprimido** (webp, png, woff2): gasta CPU e
 *   costuma aumentar o tamanho.
 *
 * O gzip acontece **uma vez por arquivo** e fica em memória: são poucos
 * arquivos, e comprimir por requisição trocaria banda por CPU num container que
 * também atende query.
 */
export function servirWeb(publicDir: string) {
  const raiz = normalize(publicDir);
  /** Corpo já gzipado, por caminho absoluto. Preenchido na primeira leitura. */
  const cacheGzip = new Map<string, Uint8Array>();

  return async (request: Request): Promise<Response> => {
    /*
     * `decodeURIComponent` **estoura** em `%`, `%zz` e afins, e o erro virava
     * 500 pelo handler global. Não vaza nada, mas 500 diz "o servidor quebrou"
     * para uma requisição malformada, que é 404. O `\0` entra na mesma recusa:
     * caminho com byte nulo não tem uso legítimo aqui.
     */
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (pathname.includes("\0")) return new Response("Not found", { status: 404 });
    const alvo = normalize(join(raiz, pathname === "/" ? "/index.html" : pathname));

    // Trava de travessia: o caminho resolvido tem que continuar sob `raiz`.
    // Sem isto, `/..%2f..%2fetc%2fpasswd` sairia do diretório do web.
    if (alvo !== raiz && !alvo.startsWith(raiz + sep)) {
      return new Response("Not found", { status: 404 });
    }

    const aceitaGzip = (request.headers.get("accept-encoding") ?? "").includes("gzip");

    const arquivo = Bun.file(alvo);
    if (await arquivo.exists()) return await resposta(arquivo, alvo, aceitaGzip, cacheGzip);

    // Fallback SPA: caminho que não é arquivo devolve o app (client-side routing).
    const caminhoIndex = join(raiz, "index.html");
    const index = Bun.file(caminhoIndex);
    if (await index.exists()) {
      return await resposta(index, caminhoIndex, aceitaGzip, cacheGzip);
    }

    return new Response("Not found", { status: 404 });
  };
}

/** Tipos que valem comprimir. webp/png/woff2 já vêm comprimidos. */
const COMPRIMIVEIS = /^(?:text\/|application\/(?:javascript|json)|image\/svg)/;

/**
 * Um ano, imutável — só para nome com hash do Vite (`app-B3xK9.js`).
 *
 * O reconhecimento é pelo formato do nome, não por uma lista: o Vite gera o
 * hash entre o último `-` e a extensão, e um arquivo sem hash (o `index.html`,
 * um `favicon.ico`) não pode receber `immutable` porque o nome dele não muda
 * quando o conteúdo muda.
 */
const COM_HASH = /-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/;

/**
 * Resposta com `Content-Type` **explícito**. Ao devolver a Response por um
 * handler do Elysia, o content-type que o `Bun.file` inferiria se perde, e um
 * módulo JS servido sem MIME de JavaScript é recusado pelo navegador (o app
 * carrega em branco). `arquivo.type` traz o tipo por extensão; o mapa cobre o
 * punhado que o Bun não adivinha.
 */
async function resposta(
  arquivo: ReturnType<typeof Bun.file>,
  caminho: string,
  aceitaGzip: boolean,
  cacheGzip: Map<string, Uint8Array>,
): Promise<Response> {
  const tipo =
    arquivo.type && arquivo.type !== "application/octet-stream"
      ? arquivo.type
      : porExtensao(arquivo.name);

  const headers: Record<string, string> = {
    "content-type": tipo,
    // Mesmo sem comprimir: um proxy no meio precisa saber que a resposta
    // varia com o cabeçalho, senão serve o corpo errado para o próximo.
    vary: "Accept-Encoding",
    "cache-control": COM_HASH.test(caminho)
      ? "public, max-age=31536000, immutable"
      : // Sem hash no nome, o conteúdo pode mudar sob o mesmo endereço. O
        // `no-cache` não proíbe guardar — obriga a revalidar, que com o ETag
        // custa uma resposta de 304 vazia.
        "no-cache",
  };

  if (!aceitaGzip || !COMPRIMIVEIS.test(tipo)) {
    return new Response(arquivo, { headers });
  }

  let corpo = cacheGzip.get(caminho);
  if (corpo === undefined) {
    corpo = Bun.gzipSync(new Uint8Array(await arquivo.arrayBuffer()));
    cacheGzip.set(caminho, corpo);
  }
  return new Response(corpo, { headers: { ...headers, "content-encoding": "gzip" } });
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
