import { describe, expect, test } from "bun:test";

import { citar, credencialRecusada, emEspera, lerEstado, pedeCredencial } from "./protocolo.puro";

describe("citar", () => {
  test("escapa barra e aspas", () => {
    expect(citar('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
  test("recusa quebra de linha — viraria segundo comando", () => {
    expect(() => citar("123456\nsignal SIGTERM")).toThrow();
    expect(() => citar("x\ry")).toThrow();
  });
});

describe("lerEstado", () => {
  test("CONNECTED com IP", () => {
    expect(lerEstado("1700000000,CONNECTED,SUCCESS,10.8.0.6,45.1.1.1,1194,,")).toEqual({
      estado: "conectada",
      ipLocal: "10.8.0.6",
      desde: 1700000000,
    });
  });
  test("notificação >STATE:", () => {
    expect(lerEstado(">STATE:1700000001,AUTH,,,,,,")?.estado).toBe("conectando");
  });
  test("EXITING é desconectada", () => {
    expect(lerEstado("1700000002,EXITING,SIGTERM,,,,,")?.estado).toBe("desconectada");
  });
  test("lixo é null", () => {
    expect(lerEstado("END")).toBeNull();
    expect(lerEstado("SUCCESS: hold release succeeded")).toBeNull();
  });
});

test("classificação de notificações", () => {
  expect(pedeCredencial(">PASSWORD:Need 'Auth' username/password")).toBe(true);
  expect(credencialRecusada(">PASSWORD:Verification Failed: 'Auth'")).toBe(true);
  expect(emEspera(">HOLD:Waiting for hold release:0")).toBe(true);
  expect(pedeCredencial(">INFO:OpenVPN Management Interface")).toBe(false);
});
