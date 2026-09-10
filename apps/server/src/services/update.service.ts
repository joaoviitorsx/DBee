import type { VersionStatus } from "@dbee/shared";

import type { SettingsRepository } from "../db/settings.repo";
import { haNovaVersao, VERSAO_DEV } from "../lib/semver";
import { ehMetadadoDeNuvem } from "../lib/rede";

/**
 * Aviso de versão nova e disparo da atualização (DBee.md §8).
 *
 * ## O container não se atualiza
 *
 * Um processo dentro de um container não substitui o container em que roda —
 * quem faz isso é o orquestrador. As alternativas seriam montar o socket do
 * Docker (proibido, CLAUDE.md regra 9 e §11.7) ou subir um segundo container
 * com o socket (quebra o "um container" da §2). Ambas trocam um ajuste por
 * "quem invadir o DBee vira root no host", num app que roda SQL de cliente.
 *
 * O que este serviço faz é avisar, e pedir ao Dokploy que redeploye. O trabalho
 * é dele.
 *
 * ## Por que a URL de deploy fica no banco e não no ambiente
 *
 * Variável de ambiente daria ovo e galinha: para configurar o mecanismo que
 * existe para não redeployar à mão, seria preciso editar o compose e
 * redeployar à mão. Guardada cifrada no SQLite, ela é colada uma vez pela
 * própria tela — e trocá-la depois não custa deploy nenhum.
 */

/** Releases do próprio repo. Parametrizado para o teste apontar para um fake. */
const RELEASES_API = "https://api.github.com/repos/joaoviitorsx/DBee/releases/latest";

/** Onde o link "notas da versão" leva quando ainda não há release conhecida. */
const RELEASES_HTML = "https://github.com/joaoviitorsx/DBee/releases";

/** Uma consulta por dia. O GitHub não precisa saber do DBee mais que isso. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Rede pode estar ruim; o header não pode ficar pendurado esperando. */
const TIMEOUT_CHECK_MS = 5_000;
const TIMEOUT_WEBHOOK_MS = 10_000;

/** Piso entre verificações forçadas — a cota do GitHub sem token é 60/h. */
const PISO_VERIFICACAO_MS = 30_000;

/** Cinco cliques no botão não podem virar cinco deploys enfileirados. */
const INTERVALO_MIN_DISPARO_MS = 60_000;

/**
 * Só o que este serviço usa do `fetch`. `typeof fetch` arrastaria o
 * `preconnect` da assinatura do Bun, e o teste teria de fabricar um método que
 * nada aqui chama.
 */
export type Buscar = (input: string, init?: RequestInit) => Promise<Response>;

export interface UpdateDeps {
  readonly settings: SettingsRepository;
  /** Versão do binário. Injetada em compilação — ver `versaoDoBinario`. */
  readonly current: string;
  /** `| undefined` explícito: o projeto usa `exactOptionalPropertyTypes`. */
  readonly releasesApi?: string | undefined;
  readonly fetch?: Buscar | undefined;
}

export type FalhaDeUpdate =
  | "update_not_configured"
  | "update_too_soon"
  | "update_failed";

export class UpdateError extends Error {
  constructor(readonly codigo: FalhaDeUpdate, mensagem: string) {
    super(mensagem);
    this.name = "UpdateError";
  }
}

/**
 * A versão que este binário afirma ser.
 *
 * `bun build --compile --define process.env.DBEE_VERSION=...` grava o literal
 * dentro do binário: a imagem de runtime é `debian-slim` e não tem
 * `package.json` para ler. Fora do container o valor não existe e vira `dev`,
 * que nunca compara com tag nenhuma.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- é assim que se amplia o tipo de process.env
  namespace NodeJS {
    interface ProcessEnv {
      /** Injetada em compilação pelo Dockerfile. Ausente fora do container. */
      readonly DBEE_VERSION?: string;
    }
  }
}

/**
 * Lido no escopo do módulo **de propósito**: o `--define` do `bun build`
 * substitui a expressão `process.env.DBEE_VERSION` escrita literalmente. Dentro
 * de uma função que recebesse `env` por parâmetro, a expressão seria
 * `env.DBEE_VERSION` e a substituição não aconteceria — o binário compilado
 * diria `dev` para sempre, sem nada acusar.
 */
const VERSAO_COMPILADA = process.env.DBEE_VERSION;

export function versaoDoBinario(bruta: string | undefined = VERSAO_COMPILADA): string {
  const v = bruta?.trim();
  return v === undefined || v === "" ? VERSAO_DEV : v;
}

/*
 * A lista de endereços barrados e o "por que só estes" mudaram de lugar: agora
 * moram em `lib/rede.ts`, porque o libSQL virou a segunda saída de rede por URL
 * configurável e duas cópias da mesma regra é uma que fica para trás.
 *
 * O que continua específico daqui: a resposta do webhook é **cega** — o corpo
 * nunca chega ao cliente — então o alcance de um endereço mal escolhido é
 * disparar, não exfiltrar. Numa conexão de banco isso não vale, e é por isso
 * que lá existe também `redirect: "manual"`.
 */

/**
 * Valida a URL de deploy antes de guardar. Devolve a forma normalizada.
 *
 * Estoura com mensagem sem eco da entrada — a URL é credencial e não volta em
 * resposta de erro (CLAUDE.md regra 5).
 */
export function validarWebhook(bruta: string): string {
  let url: URL;
  try {
    url = new URL(bruta.trim());
  } catch {
    throw new UpdateError("update_not_configured", "a URL de deploy não é uma URL válida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UpdateError("update_not_configured", "a URL de deploy precisa ser http ou https");
  }

  const host = url.hostname.toLowerCase();
  if (ehMetadadoDeNuvem(host)) {
    throw new UpdateError(
      "update_not_configured",
      "esse endereço é um serviço de metadado de nuvem, não um webhook de deploy",
    );
  }

  return url.toString();
}

interface RespostaRelease {
  readonly tagName: string;
  readonly htmlUrl: string | null;
}

/**
 * Lê o que interessa da resposta do GitHub, sem confiar no formato.
 *
 * JSON de terceiro não é objeto tipado só porque o TypeScript diria que é: o
 * `response` das rotas existe justamente porque um `array_agg` já chegou como
 * string crua onde o tipo prometia array (§11.17).
 */
function lerRelease(cru: unknown): RespostaRelease | null {
  if (typeof cru !== "object" || cru === null) return null;
  const obj = cru as Record<string, unknown>;
  const tag = obj["tag_name"];
  if (typeof tag !== "string" || tag.trim() === "") return null;
  const html = obj["html_url"];
  return { tagName: tag.trim(), htmlUrl: typeof html === "string" ? html : null };
}

export class UpdateService {
  readonly #settings: SettingsRepository;
  readonly #current: string;
  readonly #releasesApi: string;
  readonly #fetch: Buscar;

  constructor(deps: UpdateDeps) {
    this.#settings = deps.settings;
    this.#current = deps.current;
    this.#releasesApi = deps.releasesApi ?? RELEASES_API;
    this.#fetch = deps.fetch ?? fetch;
  }

  /**
   * Estado atual, verificando antes se a verificação está ligada e o cache
   * venceu. Sem timer de fundo: uma instância que ninguém abre nunca consulta
   * o GitHub.
   */
  async status(): Promise<VersionStatus> {
    if (this.#settings.autoCheck() && this.#cacheVenceu()) {
      await this.#consultar();
    }
    return this.#montar();
  }

  /**
   * "Verificar agora" — ignora o TTL de um dia, mas não o piso.
   *
   * O piso existe porque a API do GitHub sem token dá **60 requisições por hora
   * por IP**. Sem ele, segurar o botão apertado queima a cota da instância
   * inteira, e o sintoma seria o aviso de versão parar de funcionar por uma
   * hora sem nada explicar.
   */
  async verificarAgora(): Promise<VersionStatus> {
    if (!this.#verificouAgorinha()) await this.#consultar();
    return this.#montar();
  }

  #verificouAgorinha(): boolean {
    const { checkedAt } = this.#settings.cacheDeVersao();
    if (checkedAt === null) return false;
    const quando = Date.parse(checkedAt);
    return Number.isFinite(quando) && Date.now() - quando < PISO_VERIFICACAO_MS;
  }

  salvarAjustes(ajustes: {
    readonly autoCheck?: boolean;
    readonly webhookUrl?: string | null;
  }): void {
    if (ajustes.autoCheck !== undefined) {
      this.#settings.definirAutoCheck(ajustes.autoCheck);
    }
    // `undefined` é "não mexe"; `null` é "apaga". Alternar o interruptor não
    // pode apagar a URL que alguém colou.
    if (ajustes.webhookUrl !== undefined) {
      const url = ajustes.webhookUrl;
      this.#settings.definirWebhookUrl(
        url === null || url.trim() === "" ? null : validarWebhook(url),
      );
    }
  }

  /**
   * Dispara o redeploy e devolve **sem esperar** — o Dokploy trabalha depois de
   * responder, e o que ele vai derrubar é este próprio processo.
   */
  async dispararUpdate(actor: string): Promise<void> {
    const guardada = this.#settings.webhookUrl();
    if (guardada === null) {
      throw new UpdateError(
        "update_not_configured",
        "a URL de deploy ainda não foi configurada",
      );
    }

    // Revalidada na leitura, não só na gravação. O valor no banco pode ter sido
    // escrito por uma versão anterior desta regra, e o que decide para onde o
    // servidor faz `POST` é este ponto — validar só na entrada deixa a decisão
    // dependendo de quando o registro foi gravado. Falha fechado.
    const url = validarWebhook(guardada);

    const agora = Date.now();
    const ultimo = this.#settings.ultimoDisparo();
    if (ultimo !== null) {
      const decorrido = agora - Date.parse(ultimo);
      if (Number.isFinite(decorrido) && decorrido >= 0 && decorrido < INTERVALO_MIN_DISPARO_MS) {
        throw new UpdateError(
          "update_too_soon",
          "uma atualização acabou de ser disparada; aguarde antes de tentar de novo",
        );
      }
    }

    /*
     * Registra a **tentativa**, não o sucesso.
     *
     * Estava depois do `resposta.ok`, e o efeito era que o intervalo mínimo só
     * limitava disparos que davam certo — ou seja, não limitava nada do que
     * importa. Com faixas privadas liberadas de propósito, isso permitia
     * varrer a rede interna a ~1 ms por alvo, distinguindo "porta fechada" de
     * "HTTP 403" pelo status do erro. O gasto de um disparo é a requisição
     * sair, não ela ser aceita.
     */
    this.#settings.registrarDisparo(new Date(agora).toISOString());

    let resposta: Response;
    try {
      resposta = await this.#fetch(url, {
        method: "POST",
        // Sem seguir redirecionamento: um 302 é o desvio clássico para levar a
        // requisição a um destino que a validação da URL nunca viu.
        redirect: "manual",
        headers: { "user-agent": `DBee/${this.#current}` },
        signal: AbortSignal.timeout(TIMEOUT_WEBHOOK_MS),
      });
    } catch {
      // Nada do erro original atravessa: ele carrega a URL, que é credencial.
      throw new UpdateError("update_failed", "não foi possível falar com o serviço de deploy");
    }

    if (!resposta.ok) {
      // O status numérico ajuda a diagnosticar; o corpo, não — ele pode ecoar a
      // própria URL de volta.
      throw new UpdateError(
        "update_failed",
        `o serviço de deploy recusou o disparo (HTTP ${String(resposta.status)})`,
      );
    }

    // Ação com efeito externo: fica registrado quem apertou. Sem a URL.
    console.log(`[dbee] atualização disparada por ${actor}`);
  }

  #cacheVenceu(): boolean {
    const { checkedAt } = this.#settings.cacheDeVersao();
    if (checkedAt === null) return true;
    const quando = Date.parse(checkedAt);
    if (!Number.isFinite(quando)) return true;
    return Date.now() - quando >= TTL_MS;
  }

  /**
   * Consulta a Releases API.
   *
   * **Nunca estoura.** Rede caída ou GitHub fora do ar não é erro da rota que
   * desenha o cabeçalho do app — vira "não sei qual é a última versão".
   *
   * Grava `checkedAt` mesmo quando falha, de propósito: sem isso, um repo sem
   * release nenhuma (404) seria consultado a cada requisição do front. O campo
   * é "quando tentei", e `latest` guarda o último valor que deu certo.
   */
  async #consultar(): Promise<void> {
    const anterior = this.#settings.cacheDeVersao();
    const agora = new Date().toISOString();

    try {
      const resposta = await this.#fetch(this.#releasesApi, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          // A API do GitHub recusa requisição sem User-Agent.
          "user-agent": `DBee/${this.#current}`,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_CHECK_MS),
      });

      if (!resposta.ok) {
        this.#settings.guardarCacheDeVersao({ ...anterior, checkedAt: agora });
        return;
      }

      const release = lerRelease(await resposta.json());
      if (release === null) {
        this.#settings.guardarCacheDeVersao({ ...anterior, checkedAt: agora });
        return;
      }

      this.#settings.guardarCacheDeVersao({
        latest: release.tagName,
        releaseUrl: release.htmlUrl,
        checkedAt: agora,
      });
    } catch {
      this.#settings.guardarCacheDeVersao({ ...anterior, checkedAt: agora });
    }
  }

  #montar(): VersionStatus {
    const cache = this.#settings.cacheDeVersao();
    return {
      current: this.#current,
      latest: cache.latest,
      updateAvailable: haNovaVersao(this.#current, cache.latest),
      releaseUrl: cache.releaseUrl,
      releaseNotesUrl: cache.releaseUrl ?? RELEASES_HTML,
      checkedAt: cache.checkedAt,
      autoCheck: this.#settings.autoCheck(),
      webhookConfigured: this.#settings.webhookUrl() !== null,
    };
  }
}
