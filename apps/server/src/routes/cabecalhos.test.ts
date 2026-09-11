import { beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";
import { CABECALHOS_DE_SEGURANCA } from "./cabecalhos";

/**
 * Os cabeçalhos de segurança, travados por teste.
 *
 * O `docs/DBee.md` §7 afirmava que este middleware existia. Não existia — uma
 * resposta autenticada saía só com `content-type`. O item 7 da definição de
 * pronto manda travar por teste todo número afirmado em documentação, e é isso
 * que este arquivo faz com a afirmação inteira.
 */

let app: ReturnType<typeof createApp>;
let store: Store;
let cookie = "";

beforeAll(async () => {
  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie } = await autenticar(store));
});

const chamar = (caminho: string, comSessao = true): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${caminho}`, {
      headers: comSessao ? { cookie } : {},
    }),
  );

describe("cabeçalhos de segurança", () => {
  it("saem em resposta autenticada", async () => {
    const r = await chamar("/api/connections");
    expect(r.status).toBe(200);
    for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
      expect(r.headers.get(nome), `faltou ${nome}`).toBe(valor);
    }
  });

  /*
   * O caminho de erro é onde um vazamento já aconteceu neste projeto (o 422 com
   * a senha). Ele não pode ser o caminho sem cabeçalho.
   */
  it("saem também na resposta sem sessão", async () => {
    const r = await chamar("/api/connections", false);
    expect(r.status).toBe(401);
    expect(r.headers.get("content-security-policy")).toBeTruthy();
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("saem no /health, que responde sem sessão por desenho", async () => {
    const r = await chamar("/api/health", false);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toBeTruthy();
  });

  /*
   * `connect-src 'self'` é a peça que impede um script na página mandar o
   * resultado das consultas para fora. Se alguém afrouxar isso, é aqui que
   * aparece.
   */
  it("a política fecha a saída de rede e a execução de script de fora", () => {
    const csp = CABECALHOS_DE_SEGURANCA["content-security-policy"] ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    // Nenhuma origem externa, nem `unsafe-eval`, em nenhuma diretiva.
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("http://");
    expect(csp).not.toContain("https://");
    expect(csp).not.toContain("*");
  });

  /*
   * O `unsafe-inline` de estilo é deliberado — Radix e a grade escrevem `style`
   * inline — e só vale para estilo. Se um dia ele aparecer em `script-src`, é
   * outra coisa completamente.
   */
  it("o unsafe-inline vale só para estilo, nunca para script", () => {
    const csp = CABECALHOS_DE_SEGURANCA["content-security-policy"] ?? "";
    const script = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(script).not.toContain("unsafe-inline");
    const estilo = csp.split(";").find((d) => d.trim().startsWith("style-src")) ?? "";
    expect(estilo).toContain("unsafe-inline");
  });

  /*
   * Nenhum CORS permissivo: o front é servido pelo mesmo processo, então não há
   * requisição cross-origin legítima. A ausência do cabeçalho É a política.
   */
  it("nenhuma resposta abre CORS", async () => {
    for (const caminho of ["/api/health", "/api/connections"]) {
      const r = await chamar(caminho);
      expect(r.headers.get("access-control-allow-origin"), caminho).toBeNull();
      expect(r.headers.get("access-control-allow-credentials"), caminho).toBeNull();
    }
  });
});
