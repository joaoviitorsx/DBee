import { describe, expect, it } from "bun:test";

import { paraTexto } from "./protocolo";

describe("conversão de célula do libSQL", () => {
  it("inteiro chega como string e não passa por number", () => {
    // 2^63-1: se passasse por `number`, viraria 9223372036854775808.
    expect(paraTexto({ type: "integer", value: "9223372036854775807" })).toBe(
      "9223372036854775807",
    );
    expect(paraTexto({ type: "integer", value: "42" })).toBe("42");
  });

  it("texto passa inteiro, com acento, CJK e emoji", () => {
    expect(paraTexto({ type: "text", value: "Björk 坂本 🎧" })).toBe("Björk 坂本 🎧");
    expect(paraTexto({ type: "text", value: "" })).toBe("");
  });

  it("NULL é null, e só o NULL de verdade", () => {
    expect(paraTexto({ type: "null" })).toBeNull();
    expect(paraTexto({ type: "null", value: null })).toBeNull();
  });

  it("blob vira hexadecimal com prefixo, como o bytea e o BLOB", () => {
    // base64 "AQL/" são os bytes 01 02 FF.
    expect(paraTexto({ type: "blob", base64: "AQL/" })).toBe("0x0102ff");
    expect(paraTexto({ type: "blob", base64: "" })).toBe("0x");
  });

  it("float mantém a precisão do double", () => {
    expect(paraTexto({ type: "float", value: 0.30000000000000004 })).toBe(
      "0.30000000000000004",
    );
    expect(paraTexto({ type: "float", value: -0.5 })).toBe("-0.5");
    expect(paraTexto({ type: "float", value: 2.2250738585072014e-308 })).toBe(
      "2.2250738585072014e-308",
    );
  });

  /*
   * O caso em que o protocolo perde dado, e o motivo de não devolver `null`.
   *
   * O SQLite guarda infinito num REAL sem reclamar. JSON não representa
   * infinito, e o servidor manda `{"type":"float","value":null}`. Devolver
   * `null` aqui diria que a célula é NULL — e ela não é: NULL de verdade chega
   * com `type: "null"`. O tipo distingue as duas, e é isso que torna possível
   * não mentir.
   */
  it("infinito não vira null — ele não é NULL", () => {
    const infinito = paraTexto({ type: "float", value: null });
    expect(infinito).not.toBeNull();
    expect(infinito).toBe("±Inf");
    // E o NULL de verdade continua null: as duas coisas não se confundem.
    expect(paraTexto({ type: "null" })).toBeNull();
  });

  it("célula malformada vira null em vez de deixar undefined viajar", () => {
    expect(paraTexto({ type: "text" })).toBeNull();
    expect(paraTexto({ type: "integer", value: null })).toBeNull();
  });
});
