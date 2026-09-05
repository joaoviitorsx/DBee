import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

/**
 * Proteção estrutural: **toda rota declara `response`.**
 *
 * Não é formalidade. Foi a validação de resposta do TypeBox que pegou
 * `array_agg(attname)` devolvendo a string crua `{a,b}` em vez de um array JS
 * (`DBee.md` §11.17) — um bug que nenhum teste cobria e que teria chegado à UI
 * como texto onde a tela espera lista.
 *
 * Genérico como o do ADR 004: percorre os arquivos de rota que existirem, então
 * vale para a rota que ainda não foi escrita.
 */

const SRC = join(import.meta.dir, "..");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith(".ts") && !name.includes(".test.") ? [full] : [];
  });
}

interface Route {
  readonly file: string;
  readonly method: string;
  readonly path: string;
  readonly hasResponse: boolean;
}

/**
 * Localiza `.get("/x", handler, { ... })` e verifica se o objeto de opções
 * declara `response`. Casa o parêntese para não confundir a opção de uma rota
 * com a da seguinte.
 */
function routesInSource(source: string, file: string): Route[] {
  const found: Route[] = [];
  // O caminho precisa começar com `/`: sem isso o detector casa qualquer
  // `.get("...")` do código — `headers.get("cookie")`, por exemplo — e acusa
  // uma rota que não existe. Toda rota do Elysia aqui é um caminho absoluto.
  const start = /\.(get|post|patch|put|delete)\(\s*\n?\s*"(\/[^"]*)"/g;

  let match: RegExpExecArray | null;
  while ((match = start.exec(source)) !== null) {
    const [, method, path] = match;
    if (method === undefined || path === undefined) continue;

    // Do "(" da chamada até o ")" que o fecha.
    const open = source.indexOf("(", match.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    found.push({
      file,
      method: method.toUpperCase(),
      path,
      hasResponse: /\bresponse:/.test(source.slice(open, end)),
    });
  }
  return found;
}

const routesIn = (file: string): Route[] =>
  routesInSource(readFileSync(file, "utf8"), file.replace(SRC, "src"));

const routes = tsFiles(SRC).flatMap(routesIn);

describe("toda rota valida a resposta", () => {
  it("encontrou rotas para verificar", () => {
    // Se o detector parar de achar rotas (mudança de estilo, por exemplo), este
    // expect quebra em vez de a suíte passar vazia.
    expect(routes.length).toBeGreaterThanOrEqual(6);
  });

  it("nenhuma rota fica sem `response`", () => {
    const semResposta = routes
      // O catch-all `/*` é o web estático/SPA (serve arquivos do build, §8), não
      // uma rota JSON: um schema de `response` do TypeBox não descreve um stream
      // de arquivo. A invariante de validar resposta é sobre as rotas de API.
      .filter((r) => !r.hasResponse && r.path !== "/*")
      .map((r) => `${r.method} ${r.path} (${r.file})`);

    expect(semResposta).toEqual([]);
  });

  it("o detector realmente detecta — caso de controle", () => {
    // Roda o MESMO detector sobre fonte sintético. Sem isto, um routesInSource
    // quebrado faria o teste acima passar sempre.
    const fonte = `
      const a = new Elysia()
        .get("/com", () => 1, { response: { 200: X } })
        .get("/sem", () => 2)
        .post("/tambem-sem", () => 3, { body: Y })
        .patch("/aninhada", ({ p }) => f(g(p)), { params: P, response: { 200: R } });
    `;

    const achadas = routesInSource(fonte, "sintético.ts");
    expect(achadas.map((r) => [r.method, r.path, r.hasResponse])).toEqual([
      ["GET", "/com", true],
      ["GET", "/sem", false],
      ["POST", "/tambem-sem", false],
      // Casar o parêntese importa: sem isso a chamada aninhada `f(g(p))`
      // faria o detector varrer até a rota seguinte e achar `response` ali.
      ["PATCH", "/aninhada", true],
    ]);
  });
});
