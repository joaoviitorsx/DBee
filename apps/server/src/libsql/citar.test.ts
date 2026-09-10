import { describe, expect, it } from "bun:test";

import { citar } from "./citar";

describe("citar (SQLite)", () => {
  it("envolve em aspas duplas", () => {
    expect(citar("clientes")).toBe('"clientes"');
  });

  /*
   * O caso que a interpolação à mão errava: sem dobrar, o identificador fecha
   * no meio do nome e o resto vira sintaxe.
   */
  it("dobra a aspa de dentro do nome", () => {
    expect(citar('a"b')).toBe('"a""b"');
  });

  it("um nome inteiro de aspas continua sendo um identificador", () => {
    expect(citar('"; DROP TABLE t; --')).toBe('"""; DROP TABLE t; --"');
  });

  it("espaço, acento e palavra reservada passam intactos", () => {
    expect(citar("minha tabela")).toBe('"minha tabela"');
    expect(citar("ação")).toBe('"ação"');
    expect(citar("select")).toBe('"select"');
  });

  it("recusa byte nulo em vez de escapá-lo", () => {
    expect(() => citar("a\0b")).toThrow("byte nulo");
  });
});
