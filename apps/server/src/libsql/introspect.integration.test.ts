import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { executarSql, type AlvoLibsql } from "./cliente";
import { introspectarArvore, introspectarCompleto, listarDatabases } from "./introspect";

/**
 * O catálogo do libSQL contra um `sqld` real.
 *
 * O que só o servidor prova: a ordem da chave primária composta vem do campo
 * `pk` do `pragma_table_info` — **não** da ordem das colunas na tabela — e a
 * chave estrangeira composta mantém as colunas pareadas pelo `seq`. Errar
 * qualquer um dos dois quebra o keyset em silêncio.
 */

const CONTAINER = "dbee-ls-intro";
const PORTA = 8097;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
let alvo: AlvoLibsql;

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER, "-p", `${String(PORTA)}:8080`,
    "ghcr.io/tursodatabase/libsql-server:latest");
  alvo = { url: `http://127.0.0.1:${String(PORTA)}`, token: null };

  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${alvo.url}/health`);
      if (r.ok) break;
    } catch { /* subindo */ }
    await Bun.sleep(500);
  }

  await executarSql(alvo, [
    { sql: `CREATE TABLE art (
              id INTEGER PRIMARY KEY,
              nome TEXT NOT NULL,
              pais TEXT DEFAULT 'BR'
            )` },
    { sql: `CREATE TABLE alb (
              id INTEGER PRIMARY KEY,
              art_id INTEGER REFERENCES art(id),
              tit TEXT,
              ano INTEGER
            )` },
    /*
     * Chave primária composta com a ordem INVERTIDA em relação às colunas: a
     * PK é (b, a) e as colunas são (a, b). É o caso que separa ler o campo `pk`
     * de assumir a ordem da tabela.
     */
    { sql: `CREATE TABLE comp (
              a INTEGER,
              b INTEGER,
              v TEXT,
              PRIMARY KEY (b, a)
            )` },
    { sql: `CREATE TABLE ref (
              id INTEGER PRIMARY KEY,
              rb INTEGER, ra INTEGER,
              FOREIGN KEY (rb, ra) REFERENCES comp(b, a)
            )` },
    { sql: "CREATE UNIQUE INDEX uq_art_nome ON art(nome)" },
    { sql: "CREATE INDEX ix_alb ON alb(ano, tit)" },
    { sql: "CREATE VIEW v_art AS SELECT nome FROM art" },
    { sql: "INSERT INTO art (id, nome) VALUES (1,'Elis'), (2,'Björk')" },
  ]);
}, 300_000);

afterAll(() => {
  sh("docker", "rm", "-f", CONTAINER);
});

describe("catálogo do libSQL", () => {
  it("a árvore traz tabelas e view, sem as internas do SQLite", async () => {
    if (!temDocker) return;
    const a = await introspectarArvore(alvo, "main");
    const nomes = a.schemas[0]?.relations.map((r) => r.name) ?? [];
    expect(nomes).toEqual(["alb", "art", "comp", "ref", "v_art"]);
    expect(nomes.some((n) => n.startsWith("sqlite_"))).toBe(false);
    expect(a.schemas).toHaveLength(1);
    expect(a.schemas[0]?.name).toBe("main");
  }, 60_000);

  it("view é view; e ninguém finge saber quantas linhas há", async () => {
    if (!temDocker) return;
    const rel = (await introspectarArvore(alvo, "main")).schemas[0]?.relations ?? [];
    expect(rel.find((r) => r.name === "v_art")?.kind).toBe("view");
    expect(rel.find((r) => r.name === "art")?.kind).toBe("table");
    /*
     * `estimatedRows` é null de propósito: o SQLite só tem estimativa depois de
     * um `ANALYZE`, e ler `sqlite_stat1` num banco sem ele daria erro de tabela
     * inexistente. Null faz a tela mostrar "—" em vez de um número inventado.
     */
    for (const r of rel) expect(r.estimatedRows).toBeNull();
  }, 60_000);

  it("um database só, marcado como padrão — é o que a URL aponta", () => {
    const dbs = listarDatabases("main");
    expect(dbs).toHaveLength(1);
    expect(dbs[0]?.isDefault).toBe(true);
    expect(listarDatabases("")[0]?.name).toBe("main");
  });

  it("colunas trazem tipo declarado, nulabilidade, padrão e posição", async () => {
    if (!temDocker) return;
    const e = await introspectarCompleto(alvo, "main");
    const art = e.schemas[0]?.relations.find((r) => r.name === "art");
    const porNome = new Map((art?.columns ?? []).map((c) => [c.name, c]));

    expect(porNome.get("nome")?.dataType).toBe("TEXT");
    expect(porNome.get("nome")?.nullable).toBe(false);
    expect(porNome.get("pais")?.nullable).toBe(true);
    expect(porNome.get("pais")?.defaultValue).toBe("'BR'");
    expect(porNome.get("id")?.position).toBe(1);
    expect(porNome.get("nome")?.position).toBe(2);
    // O SQLite não guarda comentário; null é a verdade, não um vazio.
    expect(porNome.get("nome")?.comment).toBeNull();
  }, 60_000);

  /*
   * O caso que separa ler o catálogo de assumir a ordem: a tabela é (a, b) e a
   * chave primária é (b, a). Ler a ordem das colunas em vez do campo `pk`
   * devolveria (a, b), e o keyset desempataria errado — pulando ou repetindo
   * linhas entre páginas, sem nada acusar.
   */
  it("a chave primária composta vem na ordem do PK, não na da tabela", async () => {
    if (!temDocker) return;
    const e = await introspectarCompleto(alvo, "main");
    const comp = e.schemas[0]?.relations.find((r) => r.name === "comp");
    expect(comp?.columns.map((c) => c.name)).toEqual(["a", "b", "v"]);
    expect(comp?.primaryKey, "a PK é (b, a), não (a, b)").toEqual(["b", "a"]);
  }, 60_000);

  it("chave estrangeira composta mantém as colunas pareadas", async () => {
    if (!temDocker) return;
    const e = await introspectarCompleto(alvo, "main");
    const ref = e.schemas[0]?.relations.find((r) => r.name === "ref");
    const fk = ref?.foreignKeys[0];
    expect(fk).toBeDefined();
    expect(fk?.referencedTable).toBe("comp");
    expect(fk?.columns).toEqual(["rb", "ra"]);
    expect(fk?.referencedColumns).toEqual(["b", "a"]);
  }, 60_000);

  it("chave estrangeira simples aponta para a tabela e coluna certas", async () => {
    if (!temDocker) return;
    const e = await introspectarCompleto(alvo, "main");
    const alb = e.schemas[0]?.relations.find((r) => r.name === "alb");
    const fk = alb?.foreignKeys[0];
    expect(fk?.columns).toEqual(["art_id"]);
    expect(fk?.referencedTable).toBe("art");
    expect(fk?.referencedColumns).toEqual(["id"]);
  }, 60_000);

  /*
   * As colunas do índice exigem uma segunda rodada de consultas. Uma lista
   * vazia aqui seria mentira por omissão — um índice sobre nada.
   */
  it("índices trazem as colunas, na ordem, e o sinal de único", async () => {
    if (!temDocker) return;
    const e = await introspectarCompleto(alvo, "main");
    const art = e.schemas[0]?.relations.find((r) => r.name === "art");
    const uq = art?.indexes.find((i) => i.name === "uq_art_nome");
    expect(uq?.isUnique).toBe(true);
    expect(uq?.columns).toEqual(["nome"]);
    expect(uq?.definition).toContain("UNIQUE");

    const alb = e.schemas[0]?.relations.find((r) => r.name === "alb");
    const ix = alb?.indexes.find((i) => i.name === "ix_alb");
    expect(ix?.isUnique).toBe(false);
    // A ordem das colunas do índice é o que o torna útil para o keyset.
    expect(ix?.columns).toEqual(["ano", "tit"]);
  }, 60_000);

  it("view aparece com colunas e sem chave primária", async () => {
    if (!temDocker) return;
    const e = await introspectarCompleto(alvo, "main");
    const v = e.schemas[0]?.relations.find((r) => r.name === "v_art");
    expect(v?.columns.map((c) => c.name)).toEqual(["nome"]);
    expect(v?.primaryKey).toEqual([]);
    expect(v?.foreignKeys).toEqual([]);
  }, 60_000);
});
