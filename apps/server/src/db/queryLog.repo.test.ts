import { beforeEach, describe, expect, it } from "bun:test";

import { openTestStore, type Store } from "./client";
import { ConnectionsRepository } from "./connections.repo";
import { montarBusca, QueryLogRepository, type NewLogEntry } from "./queryLog.repo";

/**
 * Busca de auditoria — filtros combinados e keyset.
 *
 * O `query_log` tem FK para `connections`, então cada entrada precisa de uma
 * conexão real. A ordem de inserção é controlada para o keyset ser verificável:
 * `executed_at` é gravado com `new Date()` no `record`, então as entradas saem
 * em ordem crescente de tempo, e a busca as devolve do mais novo ao mais velho.
 */
let store: Store;
let log: QueryLogRepository;
let conexaoA: string;
let conexaoB: string;

const base = (over: Partial<NewLogEntry>): NewLogEntry => ({
  connectionId: conexaoA,
  database: "app",
  sql: "SELECT 1",
  status: "ok",
  error: null,
  rowCount: 1,
  durationMs: 5,
  readOnly: true,
  actor: "joao",
  ...over,
});

beforeEach(() => {
  store = openTestStore();
  const conns = new ConnectionsRepository(store.db, store.key);
  conexaoA = conns.create({ name: "A", host: "h", database: "app", username: "u", password: "p" }).id;
  conexaoB = conns.create({ name: "B", host: "h", database: "app", username: "u", password: "p" }).id;
  log = new QueryLogRepository(store.db);
});

describe("QueryLogRepository.search", () => {
  it("sem filtro, devolve do mais novo ao mais velho", async () => {
    // Gaps de 2 ms para o `executed_at` diferir: entradas no mesmo milissegundo
    // desempatam pelo id (aleatório), não pela ordem de inserção — o que é
    // aceitável em produção (sub-ms não importa numa auditoria), mas tornaria a
    // asserção de ordem instável aqui.
    log.record(base({ sql: "SELECT a" }));
    await Bun.sleep(2);
    log.record(base({ sql: "SELECT b" }));
    await Bun.sleep(2);
    log.record(base({ sql: "SELECT c" }));

    const page = log.search({ limit: 10 });
    expect(page.entries.map((e) => e.sql)).toEqual(["SELECT c", "SELECT b", "SELECT a"]);
    expect(page.nextCursor).toBeNull();
  });

  it("filtra por texto do SQL (substring, sem curinga)", () => {
    log.record(base({ sql: "SELECT * FROM clientes" }));
    log.record(base({ sql: "UPDATE notas SET x = 1" }));
    log.record(base({ sql: "SELECT * FROM notas" }));

    const page = log.search({ q: "notas", limit: 10 });
    expect(page.entries).toHaveLength(2);
    expect(page.entries.every((e) => e.sql.includes("notas"))).toBe(true);

    // `%` é procurado literalmente, não como curinga.
    expect(log.search({ q: "%", limit: 10 }).entries).toHaveLength(0);
  });

  it("filtra por status, conexão e autor, combinando com AND", () => {
    log.record(base({ status: "error", error: "boom", actor: "joao" }));
    log.record(base({ status: "ok", actor: "maria" }));
    log.record(base({ status: "error", error: "boom2", actor: "maria", connectionId: conexaoB }));

    expect(log.search({ status: "error", limit: 10 }).entries).toHaveLength(2);
    expect(log.search({ actor: "maria", limit: 10 }).entries).toHaveLength(2);
    expect(log.search({ connectionId: conexaoB, limit: 10 }).entries).toHaveLength(1);
    expect(log.search({ status: "error", actor: "maria", limit: 10 }).entries).toHaveLength(1);
  });

  it("pagina por keyset sem repetir nem pular", () => {
    for (let i = 0; i < 5; i++) log.record(base({ sql: `SELECT ${String(i)}` }));

    const p1 = log.search({ limit: 2 });
    expect(p1.entries).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = log.search({ limit: 2, cursor: p1.nextCursor ?? undefined });
    expect(p2.entries).toHaveLength(2);

    const p3 = log.search({ limit: 2, cursor: p2.nextCursor ?? undefined });
    expect(p3.entries).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();

    // Nenhuma linha repetida entre as três páginas.
    const ids = [...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("o texto procurado casa sem diferenciar maiúscula", () => {
    log.record(base({ sql: "SELECT * FROM Clientes" }));
    expect(log.search({ q: "clientes", limit: 10 }).entries).toHaveLength(1);
  });
});

/**
 * A paginação depois da migration 006.
 *
 * O `WHERE` do keyset deixou de ser a forma canônica em `OR` e passou a ser
 * comparação de tupla. A troca é de PLANO, não de semântica — mas "não muda a
 * semântica" é exatamente o tipo de afirmação que precisa de teste, porque o
 * erro aqui não aparece na primeira página: aparece como linha pulada ou
 * repetida na virada, com a auditoria mentindo em silêncio.
 */
describe("keyset da auditoria — tupla no lugar do OR", () => {
  /** Grava N entradas com `executed_at` DISTINTO e crescente. */
  const semear = (n: number): void => {
    for (let i = 0; i < n; i++) {
      log.record(base({ sql: `SELECT ${String(i)}` }));
    }
  };

  it("percorre todas as páginas sem pular nem repetir", () => {
    semear(37);
    const vistos: string[] = [];
    let cursor: string | undefined;
    for (let pagina = 0; pagina < 20; pagina++) {
      const p: { entries: { id: string }[]; nextCursor: string | null } = log.search({
        limit: 5,
        ...(cursor === undefined ? {} : { cursor }),
      });
      vistos.push(...p.entries.map((e) => e.id));
      if (p.nextCursor === null) break;
      cursor = p.nextCursor;
    }
    expect(vistos).toHaveLength(37);
    expect(new Set(vistos).size).toBe(37);
  });

  it("a ordem paginada é a mesma de uma leitura única", () => {
    semear(23);
    const inteiro = log.search({ limit: 100 }).entries.map((e) => e.id);

    const paginado: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const p = log.search({ limit: 4, ...(cursor === undefined ? {} : { cursor }) });
      paginado.push(...p.entries.map((e) => e.id));
      if (p.nextCursor === null) break;
      cursor = p.nextCursor;
    }
    expect(paginado).toEqual(inteiro);
  });

  /**
   * O caso que o `OR` e a tupla poderiam divergir: várias entradas com o MESMO
   * `executed_at`. É aí que o desempate por `id` é o que decide, e é o que
   * acontece de verdade quando várias queries terminam no mesmo milissegundo.
   */
  it("desempata por id quando o instante se repete", () => {
    // `record` carimba o instante sozinho, então este caso é gravado direto na
    // tabela — é o único jeito de forçar o empate que se quer testar.
    const mesmoInstante = new Date().toISOString();
    for (let i = 0; i < 9; i++) {
      store.db.run(
        `INSERT INTO query_log (id, connection_id, database, sql, status, error,
                                row_count, duration_ms, read_only, actor, executed_at)
         VALUES (?, ?, 'app', ?, 'ok', NULL, 1, 5, 1, 'joao', ?)`,
        [`log_${String(i)}`, conexaoA, `SELECT ${String(i)}`, mesmoInstante],
      );
    }
    const inteiro = log.search({ limit: 100 }).entries.map((e) => e.id);
    expect(inteiro).toHaveLength(9);

    const paginado: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 12; i++) {
      const p = log.search({ limit: 2, ...(cursor === undefined ? {} : { cursor }) });
      paginado.push(...p.entries.map((e) => e.id));
      if (p.nextCursor === null) break;
      cursor = p.nextCursor;
    }
    expect(paginado).toEqual(inteiro);
  });

  it("o filtro combinado continua valendo na segunda página", () => {
    for (let i = 0; i < 12; i++) {
      log.record(base({ actor: i % 2 === 0 ? "ana" : "bruno", sql: `SELECT ${String(i)}` }));
    }
    const primeira = log.search({ limit: 3, actor: "ana" });
    expect(primeira.entries).toHaveLength(3);
    expect(primeira.entries.every((e) => e.actor === "ana")).toBe(true);

    const segunda = log.search({
      limit: 10,
      actor: "ana",
      ...(primeira.nextCursor === null ? {} : { cursor: primeira.nextCursor }),
    });
    expect(segunda.entries.every((e) => e.actor === "ana")).toBe(true);
    const ids = [...primeira.entries, ...segunda.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(6);
  });
});

/**
 * Os índices da migration 006 e o plano que eles devem produzir.
 *
 * Teste de comportamento não pega índice ausente — a busca continua devolvendo
 * as linhas certas, só que varrendo a tabela inteira. Foi assim que os filtros
 * de auditoria chegaram a 394 ms num log de 1M linhas sem ninguém notar: a tela
 * respondia, só demorava.
 *
 * O que se trava aqui é o **plano** do statement que de fato executa (vem de
 * `montarBusca`, não de uma cópia): filtro tem que virar `SEARCH … USING INDEX`,
 * nunca `SCAN query_log`.
 */
describe("migration 006 — o planejador usa os índices", () => {
  const plano = (filtros: Parameters<typeof montarBusca>[0]): string => {
    const { sql, params } = montarBusca(filtros);
    return store.db
      .query<{ detail: string }, (string | number)[]>(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((p) => p.detail)
      .join(" | ");
  };

  it("os três índices existem, e o redundante foi derrubado", () => {
    const nomes = store.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'query_log'",
      )
      .all()
      .map((r) => r.name);
    expect(nomes).toContain("idx_query_log_keyset");
    expect(nomes).toContain("idx_query_log_ator");
    expect(nomes).toContain("idx_query_log_status");
    // Prefixo estrito de idx_query_log_keyset: manter os dois pagaria escrita
    // duas vezes pela mesma ordenação.
    expect(nomes).not.toContain("idx_query_log_recent");
  });

  it("filtro por ator não varre a tabela", () => {
    const p = plano({ limit: 50, actor: "ana" });
    expect(p).toContain("idx_query_log_ator");
    expect(p).not.toContain("SCAN query_log");
  });

  it("filtro por status não varre a tabela", () => {
    const p = plano({ limit: 50, status: "error" });
    expect(p).toContain("idx_query_log_status");
    expect(p).not.toContain("SCAN query_log");
  });

  /**
   * O caso que o índice sozinho NÃO resolvia: com o `WHERE` na forma canônica
   * em `OR`, o SQLite escolhe `MULTI-INDEX OR` e varre. A comparação de tupla é
   * o que vira `SEARCH`.
   */
  it("a paginação salta para a posição em vez de varrer", () => {
    const p = plano({ limit: 50, cursor: `${new Date().toISOString()}|abc` });
    expect(p).toContain("SEARCH");
    expect(p).not.toContain("MULTI-INDEX OR");
    expect(p).not.toContain("SCAN query_log");
  });

  it("ordenação sem filtro continua servida por índice", () => {
    expect(plano({ limit: 50 })).toContain("idx_query_log_keyset");
  });

  /**
   * A busca por substring no SQL **não** é indexável — e o teste diz isso em voz
   * alta para ninguém "consertar" o plano dela achando que é regressão.
   */
  it("busca por texto varre mesmo — substring não tem índice", () => {
    const p = plano({ limit: 50, q: "delete" });
    expect(p).toContain("query_log");
  });
});
