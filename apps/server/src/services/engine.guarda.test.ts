import { describe, expect, it } from "bun:test";

import { exigirPostgres } from "./engine.guarda";

describe("guarda de engine", () => {
  it("deixa o Postgres passar", () => {
    expect(exigirPostgres("postgres", "exportação")).toBeNull();
  });

  /*
   * A mensagem tem que dizer o que falta e o que dá para fazer. Erro que só
   * diz "não suportado" vira ticket, e quem abre o ticket somos nós.
   */
  it("engine com driver: nomeia o recurso, a engine e o que ainda dá para fazer", () => {
    for (const engine of ["mysql", "mariadb"] as const) {
      const r = exigirPostgres(engine, "exportação");
      expect(r, engine).not.toBeNull();
      if (r === null || r.ok) continue;
      expect(r.failure).toBe("bad_request");
      expect(r.detail).toContain("exportação");
      expect(r.detail).toContain(engine);
      expect(r.detail).toContain("leitura");
    }
  });

  /*
   * Engine sem driver **não** pode ganhar a frase sobre leitura. A primeira
   * versão desta guarda a dava para todo mundo, e prometia que uma conexão
   * `sqlite` lê a árvore — ela não lê nada.
   */
  it("engine sem driver não promete leitura, porque não lê nada", () => {
    for (const engine of ["sqlite", "libsql", "mongodb", "redis"] as const) {
      const r = exigirPostgres(engine, "exportação");
      expect(r, engine).not.toBeNull();
      if (r === null || r.ok) continue;
      expect(r.detail).toContain("ainda não fala");
      expect(r.detail).toContain(engine);
      expect(r.detail, "não pode prometer leitura").not.toContain("leitura");
    }
  });

  it("o Postgres não é barrado por nenhum recurso", () => {
    for (const recurso of ["exportação", "DDL", "mutação", "atividade"]) {
      expect(exigirPostgres("postgres", recurso)).toBeNull();
    }
  });
});
