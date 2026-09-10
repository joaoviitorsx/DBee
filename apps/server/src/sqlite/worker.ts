/// <reference lib="webworker" />
import { Database } from "bun:sqlite";

/**
 * O worker que executa SQLite **fora do event loop principal**.
 *
 * ## Por que um worker
 *
 * O `bun:sqlite` é **síncrono**: uma consulta que leve 47 segundos produz zero
 * tiques num temporizador de 10 ms enquanto roda (medido, `docs/multi-engine.md`).
 * No processo principal isso é negação de serviço — um `SELECT` malfeito de um
 * usuário congela o app inteiro para todos os outros. O worker isola isso: o
 * bloqueio fica **nesta thread**, e o event loop principal segue atendendo.
 *
 * O cancelamento e o timeout são por **terminação do worker**: quem chama, do
 * lado principal, dá `worker.terminate()` se a resposta não vier no prazo. A
 * consulta síncrona não tem outro jeito de ser interrompida — não há sinal que
 * atravesse uma chamada nativa bloqueante —, e matar a thread é o que o
 * `bun:sqlite` permite. O pool do lado principal recria o worker depois.
 *
 * ## Um worker, um arquivo
 *
 * Cada worker abre **um** arquivo, em modo somente-leitura (`readonly: true`) —
 * a garantia de leitura do SQLite é o handle, não um PRAGMA que o SQL do usuário
 * possa desligar. O caminho já vem validado do lado principal (dentro da raiz
 * permitida); o worker confia nele.
 */

interface PedidoAbrir {
  readonly tipo: "abrir";
  readonly caminho: string;
}
interface PedidoConsulta {
  readonly tipo: "consulta";
  readonly id: number;
  readonly sql: string;
  readonly params: (string | null)[];
  /** Teto de linhas materializadas; a `+1` revela truncamento. */
  readonly maxRows: number;
}
type Pedido = PedidoAbrir | PedidoConsulta;

interface RespostaOk {
  readonly tipo: "ok";
  readonly id: number;
  readonly columns: string[];
  readonly rows: (string | null)[][];
}
interface RespostaErro {
  readonly tipo: "erro";
  readonly id: number;
  readonly message: string;
}
interface RespostaPronto {
  readonly tipo: "pronto";
}

declare const self: Worker;

let db: Database | null = null;

/** Toda célula em texto (regra 10): o worker não confia na conversão do driver. */
function paraTexto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) {
    let hex = "0x";
    for (const b of v) hex += b.toString(16).padStart(2, "0");
    return hex;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  // Qualquer outro tipo do bun:sqlite (não deveria ocorrer): representação segura.
  return JSON.stringify(v);
}

self.onmessage = (evento: MessageEvent<Pedido>): void => {
  const pedido = evento.data;

  if (pedido.tipo === "abrir") {
    // `readonly` é a garantia: o arquivo não pode ser modificado por este
    // handle, faça o SQL o que fizer. `create: false` recusa criar um arquivo
    // novo se o caminho não existe — abrir por engano não vira banco vazio.
    db = new Database(pedido.caminho, { readonly: true, create: false });
    const pronto: RespostaPronto = { tipo: "pronto" };
    self.postMessage(pronto);
    return;
  }

  if (db === null) {
    const erro: RespostaErro = { tipo: "erro", id: pedido.id, message: "banco não aberto" };
    self.postMessage(erro);
    return;
  }

  try {
    const stmt = db.query(pedido.sql);
    // `.values()` devolve linhas como arrays na ordem das colunas — sem custo
    // de montar objeto por linha, e é a forma que a grade consome.
    const brutas = stmt.values(...pedido.params) as unknown[][];
    const columns = stmt.columnNames;
    const rows = brutas
      .slice(0, pedido.maxRows + 1)
      .map((linha) => linha.map(paraTexto));
    const ok: RespostaOk = { tipo: "ok", id: pedido.id, columns, rows };
    self.postMessage(ok);
  } catch (err: unknown) {
    const erro: RespostaErro = {
      tipo: "erro",
      id: pedido.id,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(erro);
  }
};

export type { Pedido, RespostaOk, RespostaErro, RespostaPronto };
