import { describe, expect, it } from "bun:test";

import { proximaPreferencia, resolver } from "./theme";

describe("preferência de tema", () => {
  it("cicla escuro → claro → sistema → escuro", () => {
    expect(proximaPreferencia("dark")).toBe("light");
    expect(proximaPreferencia("light")).toBe("system");
    expect(proximaPreferencia("system")).toBe("dark");
  });

  it("sistema resolve pelo prefers-color-scheme; as outras ignoram o sistema", () => {
    expect(resolver("system", true)).toBe("light");
    expect(resolver("system", false)).toBe("dark");
    expect(resolver("dark", true)).toBe("dark");
    expect(resolver("light", false)).toBe("light");
  });
});
