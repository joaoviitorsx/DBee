import { describe, expect, it } from "bun:test";

import { abertosAte, achatar, buscar, formatarCaminho, idDe, todosAbertos, valorDoNo } from "./jsonArvore.puro";

const doc = { preferencias: { tags: ["vip", "b2b"], "com espaço": null }, ativo: true, n: 1.5 };

describe("formatarCaminho", () => {
  it("identificador com ponto, índice com colchete, chave estranha entre aspas", () => {
    expect(formatarCaminho(["preferencias", "tags", 0])).toBe("preferencias.tags[0]");
    expect(formatarCaminho(["preferencias", "com espaço"])).toBe('preferencias["com espaço"]');
    expect(formatarCaminho([0, "a"])).toBe("[0].a");
  });
});

describe("achatar", () => {
  it("abre até o nível 2 por padrão e conta filhos do recolhido", () => {
    const nos = achatar(doc, abertosAte(doc, 2));
    expect(nos.map((n) => n.id)).toEqual([
      idDe([]),
      idDe(["preferencias"]),
      idDe(["preferencias", "tags"]),
      idDe(["preferencias", "com espaço"]),
      idDe(["ativo"]),
      idDe(["n"]),
    ]);
    const tags = nos.find((n) => n.id === idDe(["preferencias", "tags"]));
    expect(tags).toMatchObject({ tipo: "array", filhos: 2, aberto: false, nivel: 2 });
  });

  it("expandir tudo mostra as folhas com o texto de exibição", () => {
    const nos = achatar(doc, todosAbertos(doc));
    expect(nos.find((n) => n.chave === 0)?.texto).toBe('"vip"');
    expect(nos.find((n) => n.chave === "ativo")).toMatchObject({ tipo: "bool", texto: "true" });
  });
});

describe("buscar", () => {
  it("acha chave e valor e abre os ancestrais", () => {
    const r = buscar(doc, "B2B");
    expect(r.achados).toEqual([idDe(["preferencias", "tags", 1])]);
    expect([...r.abrir]).toEqual([idDe([]), idDe(["preferencias"]), idDe(["preferencias", "tags"])]);
    expect(buscar(doc, "  ").achados).toEqual([]);
  });
});

describe("valorDoNo", () => {
  it("string sai sem aspas; contêiner sai reformatado e avisa", () => {
    expect(valorDoNo(doc, ["preferencias", "tags", 0])).toEqual({ texto: "vip", reformatado: false });
    expect(valorDoNo(doc, ["preferencias", "tags"]).reformatado).toBe(true);
  });
});
