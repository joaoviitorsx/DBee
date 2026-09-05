import { describe, expect, it } from "bun:test";

import { alternar } from "./theme";

describe("alternância do tema", () => {
  it("vai e volta entre os dois — não há terceiro estado", () => {
    expect(alternar("dark")).toBe("light");
    expect(alternar("light")).toBe("dark");
    expect(alternar(alternar("dark"))).toBe("dark");
  });
});
