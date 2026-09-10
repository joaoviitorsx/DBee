import { resolve } from "node:path";

import type { ResolvedConnection } from "../db/connections.repo";
import type { Pedido, RespostaErro, RespostaOk } from "./worker";

/**
 * O lado principal do SQLite: um worker por conexão, com timeout por terminação.
 *
 * ## O que o gerente resolve
 *
 * O `bun:sqlite` é síncrono e travaria o event loop (ver `worker.ts`). O gerente
 * mantém um worker por conexão (o worker é quem bloqueia, numa thread própria) e
 * conversa com ele por mensagem. Cada consulta tem um **prazo**: se a resposta
 * não vier, o worker é **terminado** — a única forma de interromper uma chamada
 * nativa síncrona — e o próximo pedido recria um.
 *
 * ## A raiz permitida
 *
 * Abrir um arquivo arbitrário do sistema por pedido de conexão é travessia de
 * caminho. O gerente valida que o `filePath` resolvido está **dentro de uma
 * raiz** (`DBEE_SQLITE_ROOT`, ou `/data` por padrão no container). Um caminho
 * com `..` que escape da raiz é recusado antes de o worker ver.
 */

const PRAZO_MS = 30_000;

/** A raiz onde os arquivos SQLite podem morar. */
function raizPermitida(): string {
  return process.env["DBEE_SQLITE_ROOT"] ?? "/data";
}

/**
 * Valida e normaliza o caminho do arquivo. Estoura se escapar da raiz.
 *
 * `resolve` colapsa `..`; a checagem é sobre o resultado, então
 * `/data/../etc/passwd` vira `/etc/passwd` e é recusado. A raiz com barra final
 * evita que `/data-secreto` passe por começar com `/data`.
 */
export function validarCaminho(filePath: string): string {
  const raiz = resolve(raizPermitida());
  const alvo = resolve(raiz, filePath);
  const raizComBarra = raiz.endsWith("/") ? raiz : `${raiz}/`;
  if (alvo !== raiz && !alvo.startsWith(raizComBarra)) {
    throw new Error(
      `o arquivo tem que estar dentro de ${raiz} — "${filePath}" resolve para fora`,
    );
  }
  return alvo;
}

interface Vivo {
  readonly worker: Worker;
  /** Promessa que resolve quando o worker respondeu "pronto" (abriu o arquivo). */
  readonly aberto: Promise<void>;
}

/** A chave de um worker: a conexão e o modo (leitura/escrita são workers distintos). */
function chave(id: string, escrita: boolean): string {
  return `${id}:${escrita ? "rw" : "ro"}`;
}

export interface LinhasCruas {
  readonly columns: string[];
  readonly rows: (string | null)[][];
}

export class GerenteSqlite {
  readonly #porId = new Map<string, Vivo>();
  #seq = 0;

  /**
   * O worker de uma conexão e modo, criado e com o arquivo aberto sob demanda.
   *
   * Leitura e escrita são workers **distintos** — o `bun:sqlite` recusa dois
   * handles ao mesmo arquivo na mesma thread. O de escrita nasce só quando uma
   * escrita autorizada chega (`escrita: true`).
   */
  #vivo(conexao: ResolvedConnection, escrita: boolean): Vivo {
    const k = chave(conexao.id, escrita);
    const existente = this.#porId.get(k);
    if (existente !== undefined) return existente;

    const caminho = validarCaminho(conexao.filePath ?? "");
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
    const aberto = new Promise<void>((resolver, rejeitar) => {
      const aoPronto = (): void => {
        worker.removeEventListener("message", aoPronto);
        resolver();
      };
      worker.addEventListener("message", aoPronto);
      worker.addEventListener("error", (e) => { rejeitar(new Error(e.message)); }, { once: true });
    });
    worker.postMessage({ tipo: "abrir", caminho, readonly: !escrita } satisfies Pedido);

    const vivo: Vivo = { worker, aberto };
    this.#porId.set(k, vivo);
    return vivo;
  }

  /**
   * Executa uma consulta, com prazo. Estoura em erro do SQLite ou em timeout —
   * e no timeout **mata o worker**, porque a consulta síncrona não para de
   * outro jeito.
   */
  async consulta(
    conexao: ResolvedConnection,
    sql: string,
    params: (string | null)[],
    maxRows: number,
    escrita = false,
  ): Promise<LinhasCruas & { changes: number }> {
    const vivo = this.#vivo(conexao, escrita);
    await vivo.aberto;
    const id = ++this.#seq;

    return await new Promise<LinhasCruas & { changes: number }>((resolver, rejeitar) => {
      const prazo = setTimeout(() => {
        limpar();
        // Mata a thread bloqueada e esquece o worker: o próximo pedido recria.
        this.esquecer(conexao.id);
        rejeitar(new Error(`a consulta excedeu ${String(PRAZO_MS)} ms e foi interrompida`));
      }, PRAZO_MS);

      const aoResponder = (e: MessageEvent<RespostaOk | RespostaErro>): void => {
        if (e.data.id !== id) return;
        limpar();
        if (e.data.tipo === "ok") {
          resolver({ columns: e.data.columns, rows: e.data.rows, changes: e.data.changes });
        }
        else rejeitar(new Error(e.data.message));
      };
      const aoErro = (e: ErrorEvent): void => {
        limpar();
        this.esquecer(conexao.id);
        rejeitar(new Error(e.message));
      };
      const limpar = (): void => {
        clearTimeout(prazo);
        vivo.worker.removeEventListener("message", aoResponder);
        vivo.worker.removeEventListener("error", aoErro);
      };

      vivo.worker.addEventListener("message", aoResponder);
      vivo.worker.addEventListener("error", aoErro);
      vivo.worker.postMessage({ tipo: "consulta", id, sql, params, maxRows, escrita } satisfies Pedido);
    });
  }

  esquecer(id: string): void {
    for (const escrita of [false, true]) {
      const k = chave(id, escrita);
      const vivo = this.#porId.get(k);
      if (vivo === undefined) continue;
      this.#porId.delete(k);
      vivo.worker.terminate();
    }
  }

  desligar(): void {
    for (const vivo of this.#porId.values()) vivo.worker.terminate();
    this.#porId.clear();
  }
}
