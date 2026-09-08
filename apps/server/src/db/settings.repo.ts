import type { Database, Statement } from "bun:sqlite";

import { decrypt, encrypt, type EncryptionKey } from "../lib/crypto";

/**
 * Ajustes da instância, sobre a `app_meta` da migration 001 (DBee.md §4).
 *
 * `app_meta` já é uma tabela chave/valor e já guarda o `schema_version` e o
 * salt de cifra — então a atualização **não precisa de migration**: são chaves
 * novas numa tabela que existe desde o começo.
 *
 * São ajustes da instalação, não do usuário: quem liga a verificação automática
 * liga para todo mundo que abre o DBee. Por isso ficam aqui e não em `users`.
 */

/**
 * Escopo do AAD da URL de deploy.
 *
 * A cifra amarra cada registro a um id (ADR 005) para que ninguém troque um
 * `password_enc` de lugar. Aqui o id é este literal: um `password_enc` de
 * conexão copiado para cá — ou o contrário — falha na decifragem em vez de
 * passar despercebido. Nunca pode colidir com um nanoid de conexão, e não
 * colide: nanoid não tem `:`.
 */
const AAD_WEBHOOK = "app:update_webhook";

const CHAVES = {
  autoCheck: "update_auto_check",
  webhook: "update_webhook_enc",
  latest: "update_latest",
  releaseUrl: "update_release_url",
  checkedAt: "update_checked_at",
  triggeredAt: "update_triggered_at",
} as const;

interface Row {
  value: string;
}

/** O que a verificação guardou da última consulta que deu certo. */
export interface CacheDeVersao {
  readonly latest: string | null;
  readonly releaseUrl: string | null;
  readonly checkedAt: string | null;
}

export class SettingsRepository {
  readonly #ler: Statement<Row, [string]>;
  readonly #gravar: Statement<unknown, [string, string]>;
  readonly #apagar: Statement<unknown, [string]>;

  constructor(
    db: Database,
    private readonly key: EncryptionKey,
  ) {
    this.#ler = db.query("SELECT value FROM app_meta WHERE key = ?");
    this.#gravar = db.query(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    this.#apagar = db.query("DELETE FROM app_meta WHERE key = ?");
  }

  #get(chave: string): string | null {
    return this.#ler.get(chave)?.value ?? null;
  }

  #set(chave: string, valor: string | null): void {
    if (valor === null) this.#apagar.run(chave);
    else this.#gravar.run(chave, valor);
  }

  /**
   * Verificação automática. Padrão **ligada**, e a chave ausente é o padrão:
   * uma instalação nova avisa de versão nova sem ninguém precisar descobrir a
   * opção. Desligar grava `0` e a consulta ao GitHub deixa de acontecer.
   */
  autoCheck(): boolean {
    return this.#get(CHAVES.autoCheck) !== "0";
  }

  definirAutoCheck(ligado: boolean): void {
    this.#set(CHAVES.autoCheck, ligado ? "1" : "0");
  }

  /**
   * A URL de deploy, decifrada.
   *
   * Devolve `null` se a decifragem falhar em vez de estourar: `APP_SECRET`
   * trocado já quebra as conexões de forma barulhenta (§11.5), e derrubar o
   * header do app por causa de um ajuste opcional seria transformar um recurso
   * acessório em falha total. Fica como "não configurado", que é recuperável
   * pela própria tela.
   */
  webhookUrl(): string | null {
    const enc = this.#get(CHAVES.webhook);
    if (enc === null) return null;
    try {
      return decrypt(this.key, AAD_WEBHOOK, enc);
    } catch {
      console.warn("[dbee] URL de deploy ilegível (APP_SECRET mudou?) — tratando como ausente");
      return null;
    }
  }

  /** Cifrada com a mesma AES-256-GCM das senhas de conexão. `null` limpa. */
  definirWebhookUrl(url: string | null): void {
    this.#set(CHAVES.webhook, url === null ? null : encrypt(this.key, AAD_WEBHOOK, url));
  }

  cacheDeVersao(): CacheDeVersao {
    return {
      latest: this.#get(CHAVES.latest),
      releaseUrl: this.#get(CHAVES.releaseUrl),
      checkedAt: this.#get(CHAVES.checkedAt),
    };
  }

  guardarCacheDeVersao(cache: CacheDeVersao): void {
    this.#set(CHAVES.latest, cache.latest);
    this.#set(CHAVES.releaseUrl, cache.releaseUrl);
    this.#set(CHAVES.checkedAt, cache.checkedAt);
  }

  ultimoDisparo(): string | null {
    return this.#get(CHAVES.triggeredAt);
  }

  registrarDisparo(quando: string): void {
    this.#set(CHAVES.triggeredAt, quando);
  }
}
