import { expect, test } from "bun:test";

import { destinoValido, idDoTunelValido, portaLocal } from "./regras.puro";

test("id do túnel", () => {
  expect(idDoTunelValido("abc_123.cliente-a")).toBe(true);
  expect(idDoTunelValido("../x.cliente-a")).toBe(false);
  expect(idDoTunelValido("abc.cliente A")).toBe(false);
  expect(idDoTunelValido("abc")).toBe(false);
});

test("destino recusa o que viraria opção do socat", () => {
  expect(destinoValido("10.0.0.5", 5432)).toBe(true);
  expect(destinoValido("db.cliente.local", 3306)).toBe(true);
  expect(destinoValido("10.0.0.5,fork", 5432)).toBe(false);
  expect(destinoValido("10.0.0.5:22", 5432)).toBe(false);
  expect(destinoValido("x y", 5432)).toBe(false);
  expect(destinoValido("x", 0)).toBe(false);
  expect(destinoValido("x", 70000)).toBe(false);
});

test("portas locais não colidem entre túneis", () => {
  expect(portaLocal(1, 49)).toBeLessThan(portaLocal(2, 0));
});
