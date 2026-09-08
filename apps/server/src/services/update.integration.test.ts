import type { Server } from "bun";
import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import type { VersionStatus } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { SettingsRepository } from "../db/settings.repo";
import { autenticar } from "../test/sessao";
import { UpdateError, UpdateService, validarWebhook } from "./update.service";

/**
 * Aviso de versão e disparo da atualização, contra **servidores HTTP de
 * verdade** (`Bun.serve`), não contra um `fetch` fingido.
 *
 * A diferença importa: o que este recurso faz é falar com serviços externos, e
 * o mock esconde exatamente a camada onde ele erra — cabeçalho recusado,
 * redirecionamento seguido, corpo que volta com a credencial dentro. Aqui o
 * `fetch` é o real e o outro lado responde de verdade.
 */

/** GitHub de mentira: responde o que o teste mandar e conta as consultas. */
let releaseTag = "v0.2.0";
let statusGitHub = 200;
let consultas = 0;

const github: Server<undefined> = Bun.serve({
  port: 0,
  fetch(req) {
    consultas += 1;
    // A API real recusa requisição sem User-Agent; o teste também, para o
    // cabeçalho não sumir do código sem nada acusar.
    if (req.headers.get("user-agent") === null) {
      return new Response("sem user-agent", { status: 403 });
    }
    if (statusGitHub !== 200) return new Response("nope", { status: statusGitHub });
    return Response.json({
      tag_name: releaseTag,
      html_url: `https://github.com/joaoviitorsx/DBee/releases/tag/${releaseTag}`,
    });
  },
});

/** Dokploy de mentira: registra os disparos recebidos. */
let disparos = 0;
let statusWebhook = 200;

const dokploy: Server<undefined> = Bun.serve({
  port: 0,
  fetch() {
    disparos += 1;
    if (statusWebhook === 302) {
      // Redirecionamento: o desvio clássico para levar a requisição a um
      // destino que a validação da URL nunca viu.
      return new Response(null, { status: 302, headers: { location: "http://exemplo.invalido/" } });
    }
    if (statusWebhook !== 200) {
      // Corpo que ecoa a própria URL — é o que não pode chegar ao cliente.
      return new Response(`falhou ao entregar em ${dokploy.url.href}?token=segredo`, {
        status: statusWebhook,
      });
    }
    return new Response("ok");
  },
});

const API_RELEASES = github.url.href;
const URL_WEBHOOK = dokploy.url.href;

afterAll(() => {
  void github.stop(true);
  void dokploy.stop(true);
});

/** Devolve o erro rejeitado, ou `null` se a promessa resolveu. */
const capturar = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (erro: unknown) => erro,
  );

let store: Store;
let settings: SettingsRepository;

function servico(current = "v0.1.3"): UpdateService {
  return new UpdateService({ settings, current, releasesApi: API_RELEASES });
}

beforeEach(() => {
  store = openTestStore();
  settings = new SettingsRepository(store.db, store.key);
  releaseTag = "v0.2.0";
  statusGitHub = 200;
  statusWebhook = 200;
  consultas = 0;
  disparos = 0;
});

describe("verificação de versão", () => {
  it("consulta o GitHub e acende quando há versão maior", async () => {
    const s = await servico("v0.1.3").status();
    expect(s.latest).toBe("v0.2.0");
    expect(s.updateAvailable).toBe(true);
    expect(s.releaseUrl).toContain("/releases/tag/v0.2.0");
    expect(consultas).toBe(1);
  });

  it("não acende quando já está na última", async () => {
    const s = await servico("v0.2.0").status();
    expect(s.updateAvailable).toBe(false);
  });

  it("cacheia — a segunda chamada não consulta de novo", async () => {
    const svc = servico();
    await svc.status();
    await svc.status();
    expect(consultas).toBe(1);
  });

  it("verificarAgora ignora o TTL de um dia", async () => {
    const svc = servico();
    await svc.status();
    // Recua a última tentativa para além do piso, sem esperar 30 s no teste.
    settings.guardarCacheDeVersao({
      ...settings.cacheDeVersao(),
      checkedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    releaseTag = "v0.3.0";
    const s = await svc.verificarAgora();
    expect(consultas).toBe(2);
    expect(s.latest).toBe("v0.3.0");
  });

  /**
   * A API sem token dá 60 requisições por hora por IP. Segurar o botão apertado
   * queimaria a cota da instância e o aviso pararia de funcionar por uma hora,
   * sem nada na tela explicando por quê.
   */
  it("verificarAgora tem piso — o botão não queima a cota do GitHub", async () => {
    const svc = servico();
    await svc.status();
    await svc.verificarAgora();
    await svc.verificarAgora();
    expect(consultas).toBe(1);
  });

  it("com a verificação desligada, não fala com o GitHub", async () => {
    settings.definirAutoCheck(false);
    const s = await servico().status();
    expect(consultas).toBe(0);
    expect(s.autoCheck).toBe(false);
    expect(s.latest).toBeNull();
  });

  /**
   * O caso real de hoje: o repo tem tags mas nenhuma Release, e a API devolve
   * 404. Isso não pode virar 500 no cabeçalho do app.
   */
  it("404 no GitHub não estoura — vira 'não sei qual é a última'", async () => {
    statusGitHub = 404;
    const s = await servico().status();
    expect(s.latest).toBeNull();
    expect(s.updateAvailable).toBe(false);
  });

  /**
   * `checkedAt` é "quando tentei", não "quando deu certo". Sem isso, um repo
   * sem release seria consultado a cada carregamento da tela.
   */
  it("falha também marca a tentativa, senão consulta a cada requisição", async () => {
    statusGitHub = 500;
    const svc = servico();
    await svc.status();
    await svc.status();
    expect(consultas).toBe(1);
  });

  it("GitHub inalcançável não estoura", async () => {
    const svc = new UpdateService({
      settings,
      current: "v0.1.3",
      // Porta reservada por IANA para "descarte": recusa a conexão na hora.
      releasesApi: "http://127.0.0.1:9/releases",
    });
    const s = await svc.status();
    expect(s.latest).toBeNull();
  });

  it("resposta com formato inesperado é ignorada, não aceita", async () => {
    const svc = new UpdateService({
      settings,
      current: "v0.1.3",
      releasesApi: `${API_RELEASES}?forma-errada`,
      fetch: () => Promise.resolve(Response.json({ tag_name: 42 })),
    });
    expect((await svc.status()).latest).toBeNull();
  });
});

describe("URL de deploy", () => {
  it("recusa o que não é http(s)", () => {
    for (const bruta of ["file:///etc/passwd", "gopher://x", "não é url"]) {
      expect(() => validarWebhook(bruta)).toThrow(UpdateError);
    }
  });

  /**
   * Metadado de nuvem entrega credencial de instância a quem fizer um GET.
   * Faixa privada continua liberada de propósito: o Dokploy vive numa.
   */
  it("recusa metadado de nuvem e aceita rede privada", () => {
    expect(() => validarWebhook("http://169.254.169.254/latest/meta-data/")).toThrow(UpdateError);
    expect(() => validarWebhook("http://metadata.google.internal/")).toThrow(UpdateError);
    expect(validarWebhook("http://dokploy:3000/api/deploy/abc")).toContain("dokploy:3000");
    expect(validarWebhook("http://100.101.102.103/api/deploy/abc")).toContain("100.101.102.103");
  });

  /**
   * O caso de quem colou a URL errada. Salvar de novo **substitui**, não
   * acumula nem é ignorado — é o que a UI passou a oferecer com o botão
   * "Trocar", que antes não existia: `editandoUrl` nascia `false` com a URL
   * configurada e nenhum caminho no código o ligava de volta.
   */
  it("salvar outra URL substitui a anterior", () => {
    const svc = servico();
    svc.salvarAjustes({ webhookUrl: "https://dokploy.exemplo/api/deploy/errada" });
    expect(settings.webhookUrl()).toBe("https://dokploy.exemplo/api/deploy/errada");

    svc.salvarAjustes({ webhookUrl: "https://dokploy.exemplo/api/deploy/certa" });
    expect(settings.webhookUrl()).toBe("https://dokploy.exemplo/api/deploy/certa");

    // Uma linha só no banco: substituição, não uma segunda entrada que a
    // leitura pudesse pegar pela ordem errada.
    const linhas = store.db
      .query<{ n: number }, []>("SELECT count(*) AS n FROM app_meta WHERE key = 'update_webhook_enc'")
      .get();
    expect(linhas?.n).toBe(1);
  });

  /** Depois de apagar, dá para configurar de novo — o estado não fica preso. */
  it("apagar e configurar de novo funciona", () => {
    const svc = servico();
    svc.salvarAjustes({ webhookUrl: URL_WEBHOOK });
    svc.salvarAjustes({ webhookUrl: null });
    expect(settings.webhookUrl()).toBeNull();

    svc.salvarAjustes({ webhookUrl: URL_WEBHOOK });
    expect(settings.webhookUrl()).toBe(URL_WEBHOOK);
  });

  it("guardada cifrada — a URL não aparece em claro no SQLite", () => {
    settings.definirWebhookUrl("https://dokploy.exemplo/api/deploy/token-secreto");
    const bruto = store.db
      .query<{ value: string }, []>("SELECT value FROM app_meta WHERE key = 'update_webhook_enc'")
      .get();
    expect(bruto?.value).toBeString();
    expect(bruto?.value).not.toContain("token-secreto");
    expect(settings.webhookUrl()).toBe("https://dokploy.exemplo/api/deploy/token-secreto");
  });
});

describe("disparo da atualização", () => {
  it("sem URL configurada, recusa em vez de fingir que atualizou", async () => {
    const svc = servico();
    expect(await capturar(svc.dispararUpdate("u1"))).toBeInstanceOf(UpdateError);
    expect(disparos).toBe(0);
  });

  it("configurada, dispara uma vez", async () => {
    const svc = servico();
    svc.salvarAjustes({ webhookUrl: URL_WEBHOOK });
    await svc.dispararUpdate("u1");
    expect(disparos).toBe(1);
  });

  it("cliques repetidos não viram deploys enfileirados", async () => {
    const svc = servico();
    svc.salvarAjustes({ webhookUrl: URL_WEBHOOK });
    await svc.dispararUpdate("u1");
    const erro = await capturar(svc.dispararUpdate("u1"));
    expect(erro).toBeInstanceOf(UpdateError);
    expect((erro as UpdateError).codigo).toBe("update_too_soon");
    expect(disparos).toBe(1);
  });

  it("não segue redirecionamento", async () => {
    statusWebhook = 302;
    const svc = servico();
    svc.salvarAjustes({ webhookUrl: URL_WEBHOOK });
    expect(await capturar(svc.dispararUpdate("u1"))).toBeInstanceOf(UpdateError);
  });

  /** O corpo do erro do outro lado pode conter a própria URL. */
  it("erro do serviço de deploy não ecoa o corpo dele", async () => {
    statusWebhook = 500;
    const svc = servico();
    svc.salvarAjustes({ webhookUrl: URL_WEBHOOK });
    try {
      await svc.dispararUpdate("u1");
      throw new Error("deveria ter falhado");
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      expect(mensagem).toContain("500");
      expect(mensagem).not.toContain("segredo");
      expect(mensagem).not.toContain(URL_WEBHOOK);
    }
  });

  /**
   * O registro no banco pode ter sido gravado por uma versão anterior da regra.
   * Quem decide o destino do `POST` é a leitura, não a gravação.
   */
  it("URL guardada que não passa mais na validação falha fechado", async () => {
    // Escreve direto pelo repositório, contornando `salvarAjustes` — é o que
    // uma versão antiga do código teria feito.
    settings.definirWebhookUrl("http://169.254.169.254/latest/meta-data/");
    const erro = await capturar(servico().dispararUpdate("u1"));
    expect(erro).toBeInstanceOf(UpdateError);
    expect(disparos).toBe(0);
  });

  it("alternar a verificação automática não apaga a URL", () => {
    const svc = servico();
    svc.salvarAjustes({ webhookUrl: URL_WEBHOOK });
    svc.salvarAjustes({ autoCheck: false });
    expect(settings.webhookUrl()).not.toBeNull();
    // `null` explícito é o que limpa.
    svc.salvarAjustes({ webhookUrl: null });
    expect(settings.webhookUrl()).toBeNull();
  });
});

describe("pela API", () => {
  it("a URL de deploy nunca sai numa resposta", async () => {
    const store2 = openTestStore();
    const app = createApp({ store: store2, caCert: undefined, releasesApi: API_RELEASES });
    const { cookie } = await autenticar(store2);

    const call = (path: string, method: string, body?: unknown): Promise<Response> =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { "content-type": "application/json", cookie },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );

    const salvou = await call("/api/meta/update-settings", "PATCH", {
      webhookUrl: `${URL_WEBHOOK}?token=nao-pode-vazar`,
    });
    expect(salvou.status).toBe(200);

    const corpo = await salvou.text();
    expect(corpo).not.toContain("nao-pode-vazar");

    const versao = await call("/api/meta/version", "GET");
    const texto = await versao.text();
    expect(texto).not.toContain("nao-pode-vazar");

    const estado = JSON.parse(texto) as VersionStatus;
    expect(estado.webhookConfigured).toBe(true);
    expect(Object.values(estado).join(" ")).not.toContain("nao-pode-vazar");
  });

  it("URL inválida volta 400 sem ecoar a entrada", async () => {
    const store2 = openTestStore();
    const app = createApp({ store: store2, caCert: undefined, releasesApi: API_RELEASES });
    const { cookie } = await autenticar(store2);

    const res = await app.handle(
      new Request("http://localhost/api/meta/update-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ webhookUrl: "http://169.254.169.254/x?token=abc" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("token=abc");
  });
});
