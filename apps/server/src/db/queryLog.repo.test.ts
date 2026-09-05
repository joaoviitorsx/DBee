import { beforeEach, describe, expect, it } from "bun:test";

import { openTestStore, type Store } from "./client";
import { ConnectionsRepository } from "./connections.repo";
import { QueryLogRepository, type NewLogEntry } from "./queryLog.repo";

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
