import { Elysia, type TSchema } from "elysia";
import { describe, expect, it } from "bun:test";

import * as shared from "./index";

/**
 * Proteção estrutural do ADR 004: nenhum schema de entrada declara `default`.
 *
 * Genérico de propósito. Um teste que checasse os campos de hoje teria passado
 * antes do bug — o campo culpado (`port`) nem estava coberto em PATCH. Estes
 * percorrem o que estiver exportado, então valem para o schema que ainda não
 * foi escrito.
 *
 * Duas camadas, e a de comportamento é a que manda:
 *
 * 1. **Comportamento** — manda `{}` pela validação do Elysia e exige `{}` de
 *    volta. É a garantia real, e é imune a como o TypeBox representa as coisas
 *    por dentro.
 * 2. **Estrutura** — procura `default` no nível da propriedade. Redundante com
 *    a primeira, mas aponta o campo culpado pelo nome quando quebra.
 */

/** Passa um corpo pela validação do Elysia e devolve o que o handler recebeu. */
async function throughValidation(schema: TSchema, body: unknown): Promise<unknown> {
  let received: unknown;
  const app = new Elysia().patch(
    "/probe",
    ({ body: parsed }) => {
      received = parsed;
      return "ok";
    },
    { body: schema },
  );

  const res = await app.handle(
    new Request("http://localhost/probe", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  if (res.status !== 200) throw new Error(`validação recusou o corpo: ${res.status}`);
  return received;
}

/**
 * `default` declarado no nível da propriedade — o único que o Elysia
 * materializa.
 *
 * Não desce em `anyOf`: o Elysia embrulha `t.Integer()` num `anyOf` cujo ramo
 * de coerção de string carrega um `default: 0` interno, que **não** é
 * materializado (verificado). Descer ali daria falso positivo em todo campo
 * numérico. Um default de verdade aparece aqui em cima — verificado também:
 * `t.Integer({ default: 5432 })` produz `{ default: 5432, anyOf: [...] }`.
 */
function propertyDefaults(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (properties === undefined) return [];

  return Object.entries(properties).flatMap(([name, prop]) => {
    if (typeof prop !== "object" || prop === null) return [];
    return "default" in prop
      ? [`${name} (default = ${JSON.stringify(prop.default)})`]
      : [];
  });
}

const isObjectSchema = (value: unknown): value is TSchema =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "object" &&
  "properties" in value;

/** Todo schema exportado cujo nome indica entrada de escrita. */
const inputSchemas = Object.entries(shared as Record<string, unknown>).filter(
  ([name, value]) => /^(Create|Update|Patch)/.test(name) && isObjectSchema(value),
);

const updateSchemas = Object.entries(shared.UPDATE_SCHEMAS);

describe("ADR 004 — comportamento", () => {
  it("há schemas de entrada para verificar", () => {
    expect(inputSchemas.length).toBeGreaterThan(0);
    expect(updateSchemas.length).toBeGreaterThan(0);
  });

  it.each(updateSchemas)("%s: um corpo vazio continua vazio", async (_name, schema) => {
    // O bug original: PATCH {} chegava ao handler como
    // { port: 5432, statementTimeoutMs: 30000, timezone: "UTC" }.
    expect(await throughValidation(schema, {})).toEqual({});
  });

  it.each(updateSchemas)("%s: um corpo com um campo só chega com um campo só", async (_name, schema) => {
    const received = await throughValidation(schema, { name: "x" });
    expect(Object.keys(received as object)).toEqual(["name"]);
  });

  it("o detector de comportamento realmente detecta — caso de controle", async () => {
    const { t } = await import("elysia");
    const comDefault = t.Object({
      port: t.Optional(t.Integer({ minimum: 1, default: 5432 })),
      timezone: t.Optional(t.String({ default: "UTC" })),
    });

    // Sem este controle, um throughValidation quebrado faria tudo passar.
    expect(await throughValidation(comDefault, {})).toEqual({ port: 5432, timezone: "UTC" });
  });
});

describe("ADR 004 — estrutura", () => {
  it.each(inputSchemas)("%s não declara default em campo nenhum", (name, schema) => {
    expect({ schema: name, defaults: propertyDefaults(schema) }).toEqual({
      schema: name,
      defaults: [],
    });
  });

  it("o detector de estrutura realmente detecta — caso de controle", async () => {
    const { t } = await import("elysia");
    const comDefault = t.Object({
      port: t.Optional(t.Integer({ minimum: 1, default: 5432 })),
      nome: t.Optional(t.String()),
    });

    expect(propertyDefaults(comDefault)).toEqual(["port (default = 5432)"]);
  });

  it("o ramo de coerção do Elysia não conta como default", async () => {
    const { t } = await import("elysia");
    // t.Integer() vira anyOf com um ramo string que carrega default: 0 interno.
    // Verificado: esse não é materializado. Se o detector o acusasse, todo
    // campo numérico daria falso positivo e a proteção viraria ruído.
    const semDefault = t.Object({ port: t.Optional(t.Integer({ minimum: 1 })) });
    expect(propertyDefaults(semDefault)).toEqual([]);
    expect(await throughValidation(semDefault, {})).toEqual({});
  });
});

describe("ADR 004 — update não deriva de create", () => {
  it("são objetos distintos", () => {
    // Derivar com Partial/Omit copiaria metadados, default incluído.
    expect(shared.UpdateConnection).not.toBe(shared.CreateConnection);
  });

  it("o update é todo opcional e o create não", () => {
    const create = shared.CreateConnection as unknown as { required?: string[] };
    const update = shared.UpdateConnection as unknown as { required?: string[] };
    expect(create.required ?? []).not.toEqual([]);
    expect(update.required ?? []).toEqual([]);
  });
});
