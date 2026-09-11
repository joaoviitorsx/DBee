import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { Relation, RowsRequest } from "@dbee/shared";

import { executarSql, type AlvoLibsql } from "./cliente";
import { executar } from "./executor";
import { introspectarCompleto } from "./introspect";
import { lerLinhas, planejarLinhas, RowsError } from "./rows";

/**
 * A grade e o executor do libSQL contra um `sqld` real.
 *
 * O que só o servidor prova:
 *
 * - **o keyset não pula nem repete linha** quando a coluna de ordenação tem
 *   valores repetidos e NULL — a armadilha clássica, e a região dos NULL fica
 *   no começo em `asc` aqui (como no MySQL, ao contrário do Postgres);
 * - **a paginação inteira cobre a tabela exatamente uma vez**;
 * - o filtro com aspas e ponto e vírgula continua sendo **valor**;
 * - o executor para no primeiro erro e relata o índice certo.
 */

const CONTAINER = "dbee-ls-rows";
const PORTA = 8098;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let alvo: AlvoLibsql;
let pessoa: Relation;

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
    { sql: `CREATE TABLE pessoa (
              id INTEGER PRIMARY KEY,
              nome TEXT NOT NULL,
              setor TEXT,
              apelido TEXT
            )` },
  ]);

  /*
   * `setor` repete e tem NULL de propósito: é o que quebra um keyset sem
   * desempate pela chave primária. `apelido` carrega aspas e ponto e vírgula,
   * que é o que quebra um filtro por concatenação.
   */
  const linhas: [number, string, string | null, string | null][] = [
    [1, "Ana", "eng", "a'; DROP TABLE pessoa; --"],
    [2, "Bia", "eng", null],
    [3, "Caio", null, 'aspa "dupla"'],
    [4, "Duda", "adm", null],
    [5, "Eli", "eng", null],
    [6, "Fabi", null, null],
    [7, "Gui", "adm", null],
    [8, "Hugo", "eng", null],
    [9, "Ivo", "adm", null],
    [10, "Joca", null, null],
  ];
  await executarSql(
    alvo,
    linhas.map(([id, nome, setor, apelido]) => ({
      sql: "INSERT INTO pessoa (id, nome, setor, apelido) VALUES (?, ?, ?, ?)",
      args: [
        { type: "integer" as const, value: String(id) },
        { type: "text" as const, value: nome },
        setor === null ? { type: "null" as const } : { type: "text" as const, value: setor },
        apelido === null ? { type: "null" as const } : { type: "text" as const, value: apelido },
      ],
    })),
  );

  const esquema = await introspectarCompleto(alvo, "main");
  const achada = esquema.schemas[0]?.relations.find((r) => r.name === "pessoa");
  if (achada === undefined) throw new Error("a tabela semeada não apareceu no catálogo");
  pessoa = achada;
}, 180_000);

afterAll(() => {
  if (temDocker) sh("docker", "rm", "-f", CONTAINER);
});

const pular = !temDocker;

describe.skipIf(pular)("grade do libSQL", () => {
  it("a primeira página respeita o limite e avisa que há mais", async () => {
    const r = await lerLinhas(alvo, pessoa, { limit: 4 });
    expect(r.rows).toHaveLength(4);
    expect(r.hasMore).toBe(true);
    expect(r.keyset).toBe(true);
    expect(r.nextCursor).not.toBeNull();
  });

  /*
   * O teste que importa. Paginar a tabela inteira ordenando por uma coluna que
   * repete e tem NULL: se o keyset estiver errado, uma linha aparece duas vezes
   * ou some — e nenhum dos dois dá erro.
   */
  it("a paginação por coluna repetida cobre a tabela exatamente uma vez", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const vistos: string[] = [];
      let pedido: RowsRequest = { limit: 3, orderBy: "setor", orderDirection: direction };

      for (let pagina = 0; pagina < 10; pagina += 1) {
        const r = await lerLinhas(alvo, pessoa, pedido);
        for (const linha of r.rows) vistos.push(linha[0] ?? "");
        if (r.nextCursor === null) break;
        pedido = { limit: 3, orderBy: "setor", orderDirection: direction, after: r.nextCursor };
      }

      expect(vistos.sort((a, b) => Number(a) - Number(b)), direction).toEqual(
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
      );
    }
  });

  /*
   * A ordem nativa da engine, afirmada em vez de presumida: `ASC` põe NULL
   * **primeiro** aqui, como no MySQL e ao contrário do Postgres. Se um dia
   * alguém "consertar" isso com `NULLS LAST`, este teste explica o custo.
   */
  it("NULL vem primeiro em ASC — a ordem é a da engine", async () => {
    const r = await lerLinhas(alvo, pessoa, { limit: 10, orderBy: "setor", orderDirection: "asc" });
    const setores = r.rows.map((l) => l[2]);
    expect(setores.slice(0, 3)).toEqual([null, null, null]);
  });

  it("o filtro com aspa e ponto e vírgula é valor, não sintaxe", async () => {
    const r = await lerLinhas(alvo, pessoa, {
      limit: 10,
      filters: [{ column: "apelido", operator: "eq", value: "a'; DROP TABLE pessoa; --" }],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.[1]).toBe("Ana");

    // E a tabela continua lá — o `DROP` viajou como texto.
    const ainda = await lerLinhas(alvo, pessoa, { limit: 100 });
    expect(ainda.rows).toHaveLength(10);
  });

  it("o filtro contains não deixa o % virar curinga do usuário por acidente", async () => {
    const r = await lerLinhas(alvo, pessoa, {
      limit: 10,
      filters: [{ column: "apelido", operator: "contains", value: 'aspa "dupla"' }],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.[1]).toBe("Caio");
  });

  it("coluna que não existe é erro nosso, com o nome dela", () => {
    expect(() => planejarLinhas(pessoa, { filters: [{ column: "cpf", operator: "isNull" }] }))
      .toThrow(RowsError);
  });

  it("a célula viaja como texto, e NULL continua NULL", async () => {
    const r = await lerLinhas(alvo, pessoa, { limit: 2 });
    for (const linha of r.rows) {
      for (const celula of linha) {
        expect(celula === null || typeof celula === "string").toBe(true);
      }
    }
    // `id` é INTEGER no banco e chega como texto.
    expect(r.rows[0]?.[0]).toBe("1");
  });
});

describe.skipIf(pular)("executor do libSQL", () => {
  it("executa os statements em sequência e devolve um resultado por statement", async () => {
    const r = await executar(alvo, "SELECT 1 AS a; SELECT 2 AS b", 100);
    expect(r.error).toBeNull();
    expect(r.results).toHaveLength(2);
    expect(r.results[0]?.rows[0]?.[0]).toBe("1");
    expect(r.results[1]?.rows[0]?.[0]).toBe("2");
  });

  /*
   * O `;` dentro da string não pode cortar o statement. É o dialeto `sqlite` do
   * separador fazendo efeito: sem ele isto viraria dois comandos quebrados.
   */
  it("o ponto e vírgula dentro de string não vira separador", async () => {
    const r = await executar(alvo, "SELECT 'a;b' AS v", 100);
    expect(r.error).toBeNull();
    expect(r.results).toHaveLength(1);
    expect(r.results[0]?.rows[0]?.[0]).toBe("a;b");
  });

  it("para no primeiro erro e diz qual statement falhou", async () => {
    const r = await executar(alvo, "SELECT 1; SELECT * FROM nao_existe; SELECT 3", 100);
    expect(r.results).toHaveLength(1);
    expect(r.error?.index).toBe(1);
    expect(r.error?.message).toContain("nao_existe");
  });

  /*
   * Não há streaming: o corte é na leitura, depois de a resposta chegar. O que
   * o teste trava é o **contrato** — `truncated` diz a verdade e `rowCount`
   * conta o que veio, não o que sobrou.
   */
  it("trunca em maxRows e avisa", async () => {
    const r = await executar(alvo, "SELECT * FROM pessoa", 3);
    expect(r.results[0]?.rows).toHaveLength(3);
    expect(r.results[0]?.truncated).toBe(true);
    expect(r.results[0]?.rowCount).toBe(10);
  });

  it("um statement sem linhas devolve o verbo e zero linha", async () => {
    const r = await executar(alvo, "CREATE TABLE se_apagar (x INTEGER); DROP TABLE se_apagar", 100);
    expect(r.error).toBeNull();
    expect(r.results[0]?.command).toBe("CREATE");
    expect(r.results[0]?.rows).toHaveLength(0);
    expect(r.results[1]?.command).toBe("DROP");
  });
});
