import type { Connection } from "@dbee/shared";
import { describe, expect, it } from "bun:test";

import {
  activeTab,
  closeTab,
  closeTabsOfConnection,
  emptyWorkspace,
  focusTab,
  isDangerous,
  openTable,
  selectColumn,
  setView,
  tabTitle,
  tableTabId,
  toggleInspector,
  type QueryTab,
  type Tab,
  type TableTab,
  type TableTarget,
  type Workspace,
} from "./workspace";

const alvo = (over: Partial<TableTarget> = {}): TableTarget => ({
  connectionId: "c1",
  database: "app",
  schema: "public",
  relation: "clientes",
  kind: "table",
  ...over,
});

const tabelaAtiva = (ws: Workspace): TableTab => {
  const tab = activeTab(ws);
  if (tab?.kind !== "table") throw new Error("aba de tabela esperada");
  return tab;
};

/** Id da aba ativa, com falha clara em vez de asserção não-nula. */
const idAtivo = (ws: Workspace): string => {
  if (ws.activeTabId === null) throw new Error("esperava uma aba ativa");
  return ws.activeTabId;
};

const primeira = (ws: Workspace): Tab => {
  const tab = ws.tabs[0];
  if (tab === undefined) throw new Error("esperava ao menos uma aba");
  return tab;
};

describe("abrir aba", () => {
  it("abre e foca", () => {
    const ws = openTable(emptyWorkspace, alvo());
    expect(ws.tabs).toHaveLength(1);
    expect(ws.activeTabId).toBe(tableTabId(alvo()));
    expect(tabTitle(primeira(ws))).toBe("public.clientes");
  });

  it("abre em Estrutura — Dados é placeholder nesta fatia", () => {
    expect(tabelaAtiva(openTable(emptyWorkspace, alvo())).view).toBe("structure");
  });

  it("reabrir a mesma tabela foca em vez de duplicar", () => {
    // Numa árvore grande, clicar duas vezes na mesma tabela é normal.
    let ws = openTable(emptyWorkspace, alvo());
    ws = openTable(ws, alvo({ relation: "pedidos" }));
    ws = openTable(ws, alvo());

    expect(ws.tabs).toHaveLength(2);
    expect(ws.activeTabId).toBe(tableTabId(alvo()));
  });

  it("tabelas de mesmo nome em schemas ou databases diferentes são abas distintas", () => {
    let ws = openTable(emptyWorkspace, alvo({ schema: "public" }));
    ws = openTable(ws, alvo({ schema: "vendas" }));
    ws = openTable(ws, alvo({ database: "outro" }));
    ws = openTable(ws, alvo({ connectionId: "c2" }));
    expect(ws.tabs).toHaveLength(4);
  });
});

describe("estado preservado ao alternar", () => {
  it("sub-aba e coluna sobrevivem a trocar de aba e voltar", () => {
    let ws = openTable(emptyWorkspace, alvo());
    const idA = idAtivo(ws);
    ws = setView(ws, idA, "indexes");
    ws = selectColumn(ws, idA, "email");

    ws = openTable(ws, alvo({ relation: "pedidos" }));
    expect(tabelaAtiva(ws).view).toBe("structure"); // a nova nasce em Estrutura

    ws = focusTab(ws, idA);
    const voltou = tabelaAtiva(ws);
    expect(voltou.view).toBe("indexes");
    expect(voltou.selectedColumn).toBe("email");
  });

  it("mexer numa aba não afeta a outra", () => {
    let ws = openTable(emptyWorkspace, alvo());
    const idA = idAtivo(ws);
    ws = openTable(ws, alvo({ relation: "pedidos" }));
    const idB = idAtivo(ws);

    ws = setView(ws, idB, "data");

    expect(ws.tabs.find((t) => t.id === idA)).toMatchObject({ view: "structure" });
    expect(ws.tabs.find((t) => t.id === idB)).toMatchObject({ view: "data" });
  });
});

describe("fechar aba", () => {
  it("fechar a ativa foca a vizinha da direita", () => {
    let ws = openTable(emptyWorkspace, alvo({ relation: "a" }));
    ws = openTable(ws, alvo({ relation: "b" }));
    ws = openTable(ws, alvo({ relation: "c" }));
    ws = focusTab(ws, tableTabId(alvo({ relation: "b" })));

    ws = closeTab(ws, tableTabId(alvo({ relation: "b" })));

    expect(ws.activeTabId).toBe(tableTabId(alvo({ relation: "c" })));
    expect(ws.tabs).toHaveLength(2);
  });

  it("fechar a última foca a da esquerda", () => {
    let ws = openTable(emptyWorkspace, alvo({ relation: "a" }));
    ws = openTable(ws, alvo({ relation: "b" }));

    ws = closeTab(ws, tableTabId(alvo({ relation: "b" })));

    expect(ws.activeTabId).toBe(tableTabId(alvo({ relation: "a" })));
  });

  it("fechar uma inativa não muda o foco", () => {
    let ws = openTable(emptyWorkspace, alvo({ relation: "a" }));
    ws = openTable(ws, alvo({ relation: "b" }));
    const ativa = ws.activeTabId;

    ws = closeTab(ws, tableTabId(alvo({ relation: "a" })));

    expect(ws.activeTabId).toBe(ativa);
  });

  it("fechar a única deixa o workspace sem aba ativa", () => {
    const ws = closeTab(openTable(emptyWorkspace, alvo()), tableTabId(alvo()));
    expect(ws.tabs).toEqual([]);
    expect(ws.activeTabId).toBeNull();
    expect(activeTab(ws)).toBeNull();
  });

  it("fechar id inexistente não faz nada", () => {
    const ws = openTable(emptyWorkspace, alvo());
    expect(closeTab(ws, "nao-existe")).toBe(ws);
  });

  it("excluir a conexão fecha só as abas dela", () => {
    let ws = openTable(emptyWorkspace, alvo({ connectionId: "c1", relation: "a" }));
    ws = openTable(ws, alvo({ connectionId: "c1", relation: "b" }));
    ws = openTable(ws, alvo({ connectionId: "c2", relation: "c" }));

    ws = closeTabsOfConnection(ws, "c1");

    expect(ws.tabs).toHaveLength(1);
    expect(ws.activeTabId).toBe(tableTabId(alvo({ connectionId: "c2", relation: "c" })));
  });
});

describe("inspetor", () => {
  it("começa fechado", () => {
    expect(emptyWorkspace.inspectorOpen).toBe(false);
  });

  it("selecionar coluna abre", () => {
    let ws = openTable(emptyWorkspace, alvo());
    ws = selectColumn(ws, idAtivo(ws), "email");
    expect(ws.inspectorOpen).toBe(true);
    expect(tabelaAtiva(ws).selectedColumn).toBe("email");
  });

  it("limpar a seleção não fecha — fechar é ação do usuário", () => {
    let ws = openTable(emptyWorkspace, alvo());
    ws = selectColumn(ws, idAtivo(ws), "email");
    ws = selectColumn(ws, idAtivo(ws), null);
    expect(ws.inspectorOpen).toBe(true);
    expect(tabelaAtiva(ws).selectedColumn).toBeNull();
  });

  it("alterna", () => {
    expect(toggleInspector(emptyWorkspace).inspectorOpen).toBe(true);
    expect(toggleInspector(toggleInspector(emptyWorkspace)).inspectorOpen).toBe(false);
  });
});

describe("estado de perigo é da conexão, não da aba", () => {
  const conexoes = [
    { id: "c1", writeEnabled: true },
    { id: "c2", writeEnabled: false },
  ] as unknown as Connection[];

  it("toda aba sobre conexão gravável herda a tarja", () => {
    let ws = openTable(emptyWorkspace, alvo({ connectionId: "c1", relation: "a" }));
    ws = openTable(ws, alvo({ connectionId: "c1", relation: "b" }));
    ws = openTable(ws, alvo({ connectionId: "c2", relation: "c" }));

    expect(ws.tabs.map((t) => isDangerous(t, conexoes))).toEqual([true, true, false]);
  });

  it("conexão desconhecida não é tratada como perigosa", () => {
    const ws = openTable(emptyWorkspace, alvo({ connectionId: "sumiu" }));
    expect(isDangerous(primeira(ws), conexoes)).toBe(false);
  });
});

describe("aba de query é atrelada à conexão e ao database", () => {
  const queryTab = (): QueryTab => ({
    kind: "query",
    id: "q1",
    connectionId: "c1",
    database: "app",
    title: "Consulta 1",
    initialSql: "",
  });

  it("os campos de destino são readonly no tipo", () => {
    // Trava de tipo, não de runtime: o compilador recusa a reatribuição.
    const tab = queryTab();
    // @ts-expect-error connectionId é readonly — a aba não troca de conexão
    tab.connectionId = "c2";
    // @ts-expect-error database é readonly — a aba não troca de database
    tab.database = "outro";
    expect(tab.kind).toBe("query");
  });

  it("setView e selectColumn não tocam numa aba de query", () => {
    // Só existem para TableTab; se um dia aceitarem QueryTab, isto quebra.
    const ws: Workspace = { tabs: [queryTab()], activeTabId: "q1", inspectorOpen: false };
    expect(setView(ws, "q1", "data")).toEqual(ws);
    expect(selectColumn(ws, "q1", "x")).toMatchObject({ tabs: ws.tabs });
  });

  it("o título da aba de query vem do próprio título, não do alvo", () => {
    expect(tabTitle(queryTab())).toBe("Consulta 1");
  });

  it("a conexão da aba de query é a que decide a tarja de perigo", () => {
    const conexoes = [{ id: "c1", writeEnabled: true }] as unknown as Connection[];
    expect(isDangerous(queryTab(), conexoes)).toBe(true);
  });
});
