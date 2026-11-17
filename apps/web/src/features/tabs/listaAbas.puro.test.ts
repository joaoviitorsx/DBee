import { describe, expect, it } from "bun:test";

import { filtrarAbas } from "./listaAbas.puro";

const l = (titulo: string, conexao: string, tipo: string) => ({ titulo, conexao, tipo });

describe("filtro da lista de abas", () => {
  const [a, b] = [l("public.clientes", "Produção", "Tabela"), l("Consulta 3", "dev", "Consulta")] as const;
  const abas = [a, b];
  it("vazio devolve tudo, na ordem", () => {
    expect(filtrarAbas(abas, "  ")).toEqual(abas);
  });
  it("casa título, conexão e tipo sem caixa nem acento", () => {
    expect(filtrarAbas(abas, "CLIENTES")).toEqual([a]);
    expect(filtrarAbas(abas, "producao")).toEqual([a]);
    expect(filtrarAbas(abas, "consulta")).toEqual([b]);
  });
});
