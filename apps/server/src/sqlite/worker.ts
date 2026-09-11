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
 * consulta síncrona não tem outro jeito de ser interrompida.
 *
 * ## Um handle por worker, e o readonly é a garantia
 *
 * Cada worker abre **um** handle, no modo que o `abrir` pediu: `readonly: true`
 * para o worker de leitura, `false` para o de escrita. O `bun:sqlite` recusa
 * dois handles ao mesmo arquivo na mesma thread (`SQLITE_MISUSE`), então a
 * separação leitura/escrita é feita com **dois workers** (o gerente cria o de
 * escrita só quando uma escrita autorizada chega). É o análogo do
 * `BEGIN READ ONLY` do Postgres: a proteção é o handle readonly, não um
 * `PRAGMA query_only` que o SQL do usuário poderia desligar entre dois
 * statements. Um `member` sem concessão nunca alcança o worker de escrita — o
 * serviço o roteia para o de leitura, e o `INSERT` dele falha ali.
 */

interface PedidoAbrir {
  readonly tipo: "abrir";
  readonly caminho: string;
  /** `true` abre o handle readonly (worker de leitura); `false`, r/w. */
  readonly readonly: boolean;
}
interface PedidoConsulta {
  readonly tipo: "consulta";
  readonly id: number;
  readonly sql: string;
  readonly params: (string | null)[];
  /** Teto de linhas materializadas; a `+1` revela truncamento. */
  readonly maxRows: number;
  /** `true` é escrita (`.run`, devolve `changes`); `false` é leitura. */
  readonly escrita: boolean;
}
type Pedido = PedidoAbrir | PedidoConsulta;

interface RespostaOk {
  readonly tipo: "ok";
  readonly id: number;
  readonly columns: string[];
  readonly rows: (string | null)[][];
  /** Linhas afetadas — para a prova de cardinalidade do row-edit. */
  readonly changes: number;
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
    /*
     * O modo vem do gerente: readonly para o worker de leitura, r/w para o de
     * escrita. `create: false` nos dois recusa criar arquivo novo (abrir por
     * engano não vira banco vazio). O r/w usa `{ readwrite: true, create:
     * false }`, e **não** `{ readonly: false, create: false }` — este último o
     * `bun:sqlite` recusa com SQLITE_MISUSE (medido).
     */
    db = pedido.readonly
      ? new Database(pedido.caminho, { readonly: true, create: false })
      : new Database(pedido.caminho, { readwrite: true, create: false });
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
    if (pedido.escrita) {
      // Escrita: `.run()` devolve `changes` (a prova de cardinalidade do
      // row-edit). Não materializa linhas — um `INSERT`/`UPDATE`/`DELETE` não
      // as tem, e um `RETURNING` fica para fatia futura.
      const r = db.query(pedido.sql).run(...pedido.params);
      const ok: RespostaOk = { tipo: "ok", id: pedido.id, columns: [], rows: [], changes: r.changes };
      self.postMessage(ok);
      return;
    }

    // Leitura: `.values()` devolve linhas como arrays na ordem das colunas.
    const stmt = db.query(pedido.sql);
    const brutas = stmt.values(...pedido.params) as unknown[][];
    const columns = stmt.columnNames;
    const rows = brutas.slice(0, pedido.maxRows + 1).map((linha) => linha.map(paraTexto));
    const ok: RespostaOk = { tipo: "ok", id: pedido.id, columns, rows, changes: 0 };
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
