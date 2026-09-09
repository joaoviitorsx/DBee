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
  it("engine sem medição não recebe as capacidades de outra", () => {
    for (const e of ["sqlite", "libsql", "mongodb", "redis"] as const) {
      // `null`, e não as do Postgres: devolver as do Postgres faria a tela
      // oferecer transação somente-leitura para uma engine que não a tem.
      expect(`${e}: ${capacidadesDe(e) === null ? "null" : "tem capacidade"}`).toBe(`${e}: null`);
    }
  });

  /*
   * A invariante mudou quando o MySQL foi medido, e a direção importa.
   *
   * Antes era "capacidade declarada **se e somente se** implementada", o que
   * era verdade por acidente: só existia o Postgres. As duas coisas acontecem
   * em momentos diferentes — a capacidade entra quando a engine é **medida**, a
   * implementação quando ela é **fiada na tela**. O MySQL passou meses no meio.
   *
   * O que **não** pode acontecer é o contrário: engine oferecida na tela sem
   * capacidade declarada deixaria o formulário sem saber quais campos mostrar.
   */
  it("toda engine implementada tem capacidade declarada", () => {
    const comCapacidade = new Set(Object.keys(CAPACIDADES));
    for (const e of ENGINES_IMPLEMENTADAS) {
      expect(comCapacidade.has(e), `${e} está implementada e não tem capacidade`).toBe(true);
    }
    expect(engineImplementada("postgres")).toBe(true);
    expect(engineImplementada("redis")).toBe(false);
  });

  /**
   * Só o Postgres tem garantia por transação — medido
   * (`docs/multi-engine.md` §1). Se outra for marcada assim, o interruptor
   * "permitir escrita nesta execução" apareceria numa engine que não tem nada
   * por execução para ligar.
   *
   * A versão anterior deste caso afirmava que **todas** eram `transacao`, o que
   * passava por só existir uma entrada. Agora ele afirma a diferença.
   */
  it("só o Postgres tem garantia por transação; as outras, por credencial", () => {
    expect(CAPACIDADES.postgres.escopoReadOnly).toBe("transacao");
    for (const [nome, cap] of Object.entries(CAPACIDADES)) {
      if (nome === "postgres") continue;
      expect(`${nome}: ${cap.escopoReadOnly}`).not.toBe(`${nome}: transacao`);
    }
  });

  /*
   * A consequência disso na tela, e a que mais importa: sem garantia por
   * transação não há interruptor de escrita para oferecer. Um campo
   * `writeEnabled` numa engine de credencial seria a tela dizendo que ligou
   * algo que não existe.
   */
  it("engine de credencial não oferece o interruptor de escrita", () => {
    for (const [nome, cap] of Object.entries(CAPACIDADES)) {
      if (cap.escopoReadOnly === "transacao") continue;
      expect(cap.campos, `${nome} não pode oferecer escrita por execução`).not.toContain("writeEnabled");
    }
    // E o Postgres continua oferecendo.
    expect(CAPACIDADES.postgres.campos).toContain("writeEnabled");
  });

  /* A porta convencional de cada uma, para o formulário preencher sozinho. */
  it("cada engine medida traz a sua porta padrão", () => {
    expect(CAPACIDADES.postgres.portaPadrao).toBe(5432);
    expect(CAPACIDADES.mysql.portaPadrao).toBe(3306);
    expect(CAPACIDADES.mariadb.portaPadrao).toBe(3306);
  });

  /* O nível que o MySQL não tem, dito na capacidade e não num `if` na tela. */
  it("MySQL e MariaDB não têm o nível de schema", () => {
    expect(CAPACIDADES.postgres.niveis).toBe("conexao/database/schema/tabela");
    expect(CAPACIDADES.mysql.niveis).toBe("conexao/database/tabela");
    expect(CAPACIDADES.mariadb.niveis).toBe("conexao/database/tabela");
  });
});
