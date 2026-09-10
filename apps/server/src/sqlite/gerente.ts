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
  /**
   * Derruba a promessa `aberto` se ela ainda estiver pendente.
   *
   * `worker.terminate()` não emite `message` nem `error`, então um `esquecer`
   * durante a **abertura** de um worker deixaria quem faz `await aberto`
   * pendurado para sempre (o timeout da consulta só é armado depois do await).
   * Rejeitar aqui fecha essa janela; se `aberto` já resolveu, é no-op.
   */
  readonly abortarAbertura: (erro: Error) => void;
}

/** A chave de um worker: a conexão e o modo (leitura/escrita são workers distintos). */
function chave(id: string, escrita: boolean): string {
  return `${id}:${escrita ? "rw" : "ro"}`;
}

export interface LinhasCruas {
  readonly columns: string[];
  readonly rows: (string | null)[][];
}

/**
 * O erro de uma consulta **cancelada pelo usuário** (não por timeout nem por
 * erro do SQLite). O serviço a reconhece para registrar `cancelled` no log, em
 * vez de `error` — é o pedido da pessoa, não uma falha.
 */
export class ConsultaCancelada extends Error {
  constructor() {
    super("consulta cancelada pelo usuário");
    this.name = "ConsultaCancelada";
  }
}

export class GerenteSqlite {
  readonly #porId = new Map<string, Vivo>();
  /**
   * Abortadores das consultas **em voo** por conexão.
   *
   * O `worker.terminate()` mata a thread, mas **não** rejeita a promessa da
   * `consulta` — sem isto, cancelar deixaria o chamador pendurado até o timeout
   * de 30 s. Cada consulta registra aqui um abortador (limpa os listeners e
   * rejeita com `ConsultaCancelada`); `cancelar` os dispara antes de matar o
   * worker.
   */
  readonly #pendentes = new Map<string, Set<() => void>>();
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
    let abortarAbertura: (erro: Error) => void = () => undefined;
    const aberto = new Promise<void>((resolver, rejeitar) => {
      abortarAbertura = rejeitar;
      const aoPronto = (): void => {
        worker.removeEventListener("message", aoPronto);
        resolver();
      };
      worker.addEventListener("message", aoPronto);
      worker.addEventListener("error", (e) => { rejeitar(new Error(e.message)); }, { once: true });
    });
    // A rejeição de uma promessa já resolvida é no-op; e se ninguém aguarda
    // `aberto` quando ela rejeita, marca como tratada para não virar
    // unhandledRejection.
    aberto.catch(() => undefined);
    worker.postMessage({ tipo: "abrir", caminho, readonly: !escrita } satisfies Pedido);

    const vivo: Vivo = { worker, aberto, abortarAbertura };
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
      // O abortador do cancelamento: limpa e rejeita com `ConsultaCancelada`.
      // Quem mata o worker é o `cancelar`, depois de disparar os abortadores.
      const abortar = (): void => {
        limpar();
        rejeitar(new ConsultaCancelada());
      };
      const limpar = (): void => {
        clearTimeout(prazo);
        vivo.worker.removeEventListener("message", aoResponder);
        vivo.worker.removeEventListener("error", aoErro);
        const set = this.#pendentes.get(conexao.id);
        set?.delete(abortar);
        // Não deixa o `Set` vazio acumular no mapa (uma entrada por conexão).
        if (set?.size === 0) this.#pendentes.delete(conexao.id);
      };

      const doId = this.#pendentes.get(conexao.id) ?? new Set<() => void>();
      doId.add(abortar);
      this.#pendentes.set(conexao.id, doId);

      vivo.worker.addEventListener("message", aoResponder);
      vivo.worker.addEventListener("error", aoErro);
      vivo.worker.postMessage({ tipo: "consulta", id, sql, params, maxRows, escrita } satisfies Pedido);
    });
  }

  /**
   * Cancela as consultas em voo de uma conexão: rejeita cada promessa pendente
   * com `ConsultaCancelada` e mata os workers (a consulta síncrona não para de
   * outro jeito). Devolve `true` se havia algo a cancelar.
   *
   * É coarse por conexão — cancela tudo que roda nela, não uma consulta
   * específica. No SQLite local isso é aceitável: cada conexão tem no máximo um
   * worker de leitura e um de escrita, e o uso concorrente na mesma conexão é
   * raro. O próximo pedido recria o worker.
   */
  cancelar(id: string): boolean {
    const abortadores = this.#pendentes.get(id);
    if (abortadores === undefined || abortadores.size === 0) return false;
    // Cópia: `abortar` chama `limpar`, que muta o set durante a iteração.
    for (const abortar of [...abortadores]) abortar();
    this.#pendentes.delete(id);
    this.esquecer(id);
    return true;
  }

  esquecer(id: string): void {
    for (const escrita of [false, true]) {
      const k = chave(id, escrita);
      const vivo = this.#porId.get(k);
      if (vivo === undefined) continue;
      this.#porId.delete(k);
      // Derruba uma abertura em voo ANTES de matar o worker: terminar não emite
      // evento, e quem faz `await aberto` (antes de o timeout ser armado) ficaria
      // pendurado para sempre. Se já abriu, é no-op.
      vivo.abortarAbertura(new Error("worker encerrado"));
      vivo.worker.terminate();
    }
  }

  desligar(): void {
    for (const vivo of this.#porId.values()) vivo.worker.terminate();
    this.#porId.clear();
  }
}
