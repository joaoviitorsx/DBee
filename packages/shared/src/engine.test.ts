import { describe, expect, it } from "bun:test";

import { Connection, CreateConnection, UpdateConnection } from "./connections";
import { CAPACIDADES, capacidadesDe, ENGINES_IMPLEMENTADAS, engineImplementada } from "./engine";

/**
 * `engine` é imutável depois que a conexão existe.
 *
 * Não é preferência de interface: é o ADR 005. A senha é cifrada com AAD
 * amarrado ao **id**, então um `PATCH` que trocasse a engine mantendo o
 * `password_enc` continuaria decifrando e passaria a mandar o segredo para
 * outro tipo de servidor — senha de Postgres entregue a um endpoint libSQL de
 * terceiro é exfiltração completa. O ADR 005 aceitou que editar host é operação
 * normal; editar engine não é.
 *
 * A trava é o campo não existir em `UpdateConnection`. Este teste existe porque
 * "não existe no schema" é fácil de desfazer sem querer — basta alguém mover
 * `engine` para dentro de `FIELDS`.
 */
describe("engine é imutável", () => {
  it("NÃO está no schema de atualização", () => {
    expect(Object.keys(UpdateConnection.properties)).not.toContain("engine");
  });

  it("está na criação, e é opcional — cliente velho continua criando Postgres", () => {
    expect(Object.keys(CreateConnection.properties)).toContain("engine");
    // Opcional: um cliente que não conhece o campo continua criando conexão, e
    // o repositório resolve para postgres.
    expect(CreateConnection.required).not.toContain("engine");
  });

  it("é obrigatório na resposta — nada de `?? postgres` espalhado no front", () => {
    expect(Connection.required).toContain("engine");
  });
});

describe("capacidades", () => {
  it("só devolve capacidade para engine implementada", () => {
    expect(capacidadesDe("postgres")).not.toBeNull();
    for (const e of ["mysql", "mariadb", "sqlite", "libsql", "mongodb", "redis"] as const) {
      // `null`, e não as do Postgres: devolver as do Postgres faria a tela
      // oferecer transação somente-leitura para uma engine que não a tem.
      expect(`${e}: ${capacidadesDe(e) === null ? "null" : "tem capacidade"}`).toBe(`${e}: null`);
    }
  });

  it("a lista de implementadas casa com quem tem capacidade", () => {
    const comCapacidade: string[] = Object.keys(CAPACIDADES);
    const declaradas: string[] = [...ENGINES_IMPLEMENTADAS];
    expect(declaradas.sort()).toEqual(comCapacidade.sort());
    expect(engineImplementada("postgres")).toBe(true);
    expect(engineImplementada("redis")).toBe(false);
  });

  /**
   * O Postgres é a única engine cuja garantia é da transação. Se alguém marcar
   * outra assim, o interruptor "permitir escrita nesta execução" apareceria
   * numa engine que não tem nada por execução para ligar.
   */
  it("só o Postgres declara garantia por transação", () => {
    for (const [nome, cap] of Object.entries(CAPACIDADES)) {
      expect(`${nome}: ${cap.escopoReadOnly}`).toBe(`${nome}: transacao`);
    }
  });
});
