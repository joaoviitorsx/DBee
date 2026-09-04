import { describe, expect, it } from "bun:test";

import { loadConfig } from "./config";

const base = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

describe("config — variável em branco é ausência", () => {
  it("APP_SECRET só com espaços é tratado como ausente", () => {
    // Passava e cifrava com um segredo em branco.
    expect(() => loadConfig({ ...base, NODE_ENV: "production", APP_SECRET: "   " })).toThrow(
      /APP_SECRET/,
    );
    expect(() => loadConfig({ ...base, NODE_ENV: "production", APP_SECRET: "" })).toThrow();
  });

  it("APP_SECRET válido passa e é aparado", () => {
    expect(loadConfig({ ...base, APP_SECRET: "  segredo  " }).appSecret).toBe("segredo");
  });

  it("DBEE_CA_CERT vazio vira undefined, não string vazia", () => {
    // `ca: ""` substitui o CA store do sistema por uma lista VAZIA e faz todo
    // verify-full falhar. E `${DBEE_CA_CERT:-}` no compose entrega exatamente
    // string vazia.
    expect(loadConfig({ ...base, DBEE_CA_CERT: "" }).caCert).toBeUndefined();
    expect(loadConfig({ ...base, DBEE_CA_CERT: "   " }).caCert).toBeUndefined();
    expect(loadConfig({ ...base, DBEE_CA_CERT: "-----BEGIN" }).caCert).toBe("-----BEGIN");
  });
});

describe("config — PORT", () => {
  it("default é 3001", () => {
    expect(loadConfig(base).port).toBe(3001);
  });

  it.each([["abc"], ["0"], ["-1"], ["70000"], ["3001.5"], ["   "]])(
    "PORT=%s é recusado no boot",
    (valor) => {
      // PORT vazio virava 0 (porta aleatória) e o `dbee --healthcheck` batia
      // numa porta inexistente: container marcado unhealthy com o app de pé.
      if (valor.trim() === "") {
        expect(loadConfig({ ...base, PORT: valor }).port).toBe(3001);
        return;
      }
      expect(() => loadConfig({ ...base, PORT: valor })).toThrow(/PORT inválido/);
    },
  );

  it("PORT válido é aceito", () => {
    expect(loadConfig({ ...base, PORT: "8080" }).port).toBe(8080);
  });
});
