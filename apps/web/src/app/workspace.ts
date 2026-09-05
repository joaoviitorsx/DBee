import type { Connection, RelationKind, RowFilter } from "@dbee/shared";

import type { Tradutor } from "../i18n";

/**
 * Estado do workspace — abas, seleção e inspetor.
 *
 * Escrito como funções puras sobre um valor, sem React, por dois motivos: dá
 * para testar a lógica de aba sem montar componente, e a fatia do executor de
 * query vai acrescentar um tipo de aba aqui sem tocar em renderização.
 */

/** Onde uma aba de tabela está aberta. Identifica a relação sem ambiguidade. */
export interface TableTarget {
  readonly connectionId: string;
  readonly database: string;
  readonly schema: string;
  readonly relation: string;
  readonly kind: RelationKind;
}

/** Sub-abas da aba de tabela. `data` é placeholder até o executor existir. */
export type TableView = "data" | "structure" | "indexes" | "diagram";

export interface TableTab {
  readonly kind: "table";
  readonly id: string;
  readonly target: TableTarget;
  /** Preservada ao alternar de aba — trocar de aba não perde onde você estava. */
  readonly view: TableView;
  /** Coluna selecionada, que alimenta o inspetor. */
  readonly selectedColumn: string | null;
  /**
   * Filtros iniciais da aba Dados, quando ela nasce de um salto por FK — a
   * tabela referenciada abre já filtrada pela linha de origem. Semeia o estado
   * do `DataTab` uma vez, na montagem; depois o usuário manda nos filtros.
   */
  readonly initialFilters?: readonly RowFilter[];
}

/**
 * Aba de query.
 *
 * O alvo — conexão e database — é fixado na criação e **imutável**: não há
 * seletor dentro da aba. Trocar de banco no meio de uma consulta é a forma mais
 * fácil de rodar a query certa no lugar errado.
 */
export interface QueryTab {
  readonly kind: "query";
  readonly id: string;
  readonly connectionId: string;
  readonly database: string;
  readonly title: string;
  /** Preenchido pelas portas que abrem a aba já com SQL (botão Consultar). */
  readonly initialSql: string;
  /**
   * A tabela de origem, quando a aba nasceu de "Consultar" sobre uma tabela.
   *
   * É o que permite o painel de baixo alternar entre o resultado da consulta e
   * **os dados da própria tabela** — para não ter que decorar o nome enquanto
   * escreve. Ausente na aba de query aberta do zero (pelo `+`), onde não há
   * tabela de origem para mostrar.
   */
  readonly source?: TableTarget;
}

/**
 * Aba de diagrama (ERD) de um database.
 *
 * Mostra as tabelas e as FKs entre elas. Uma por database: abrir o mesmo
 * diagrama duas vezes foca a aba existente, como as tabelas.
 */
export interface DiagramTab {
  readonly kind: "diagram";
  readonly id: string;
  readonly connectionId: string;
  readonly database: string;
}

/**
 * Aba no nível da conexão — visão geral dos databases, ou processos.
 *
 * Uma por conexão e tipo: reabrir foca a existente, como as tabelas. Não carrega
 * database porque olha o cluster inteiro.
 */
export interface ClusterTab {
  readonly kind: "overview" | "activity" | "audit";
  readonly id: string;
  readonly connectionId: string;
}

export type Tab = TableTab | QueryTab | DiagramTab | ClusterTab;

export interface Workspace {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string | null;
  readonly inspectorOpen: boolean;
}

export const emptyWorkspace: Workspace = {
  tabs: [],
  activeTabId: null,
  inspectorOpen: false,
};

/**
 * Id determinístico a partir do alvo.
 *
 * É o que faz reabrir a mesma tabela focar a aba existente em vez de duplicar —
 * abrir `public.clientes` cinco vezes numa árvore grande é o comportamento
 * normal de quem está navegando.
 *
 * `JSON.stringify` e não um separador: nome de database e de schema podem
 * conter quase qualquer coisa, e a primeira versão disto usou um byte 0x1F
 * invisível como separador — o mesmo defeito que o §11.24 registra, pego pelo
 * `check:bytes` em vez de por revisão. JSON não tem caractere invisível e é
 * legível no devtools.
 */
export function tableTabId(target: TableTarget): string {
  return JSON.stringify([
    "table",
    target.connectionId,
    target.database,
    target.schema,
    target.relation,
  ]);
}

export function activeTab(ws: Workspace): Tab | null {
  return ws.tabs.find((tab) => tab.id === ws.activeTabId) ?? null;
}

/** Abre a tabela, ou foca a aba já aberta. */
export function openTable(ws: Workspace, target: TableTarget): Workspace {
  const id = tableTabId(target);
  if (ws.tabs.some((tab) => tab.id === id)) return { ...ws, activeTabId: id };

  /*
   * Nasce em **Dados**, não em Estrutura.
   *
   * Abrir uma tabela é quase sempre querer ver o que tem dentro dela. Nascer
   * em Estrutura obrigava um clique a mais em cada abertura para chegar ao
   * uso comum, e deixava a pessoa olhando para uma lista de tipos quando o que
   * ela pediu foi a tabela.
   */
  const tab: TableTab = { kind: "table", id, target, view: "data", selectedColumn: null };
  return { ...ws, tabs: [...ws.tabs, tab], activeTabId: id };
}

let sequencia = 0;

/**
 * Salto por FK: abre a tabela referenciada numa aba **nova**, já filtrada pela
 * linha de origem, sem tocar na aba atual (o caminho de volta).
 *
 * Diferente de `openTable`, **sempre cria** — dois saltos para a mesma tabela
 * carregam filtros diferentes, então são duas abas. O id é único (não o
 * `tableTabId` determinístico), justamente para coexistirem.
 */
export function openTableFiltered(
  ws: Workspace,
  target: TableTarget,
  filters: readonly RowFilter[],
): Workspace {
  sequencia++;
  const tab: TableTab = {
    kind: "table",
    id: `table-fk:${String(sequencia)}`,
    target,
    view: "data",
    selectedColumn: null,
    initialFilters: filters,
  };
  return { ...ws, tabs: [...ws.tabs, tab], activeTabId: tab.id };
}

/**
 * Abre uma aba de query nova.
 *
 * Diferente de `openTable`, **sempre cria**: duas consultas contra o mesmo
 * database são duas abas, porque o conteúdo é o trabalho do usuário e não uma
 * view de algo que já existe.
 */
export function openCluster(
  ws: Workspace,
  connectionId: string,
  kind: "overview" | "activity" | "audit",
): Workspace {
  const id = `${kind}:${connectionId}`;
  if (ws.tabs.some((tab) => tab.id === id)) return { ...ws, activeTabId: id };
  const tab: ClusterTab = { kind, id, connectionId };
  return { ...ws, tabs: [...ws.tabs, tab], activeTabId: id };
}

export function openDiagram(ws: Workspace, connectionId: string, database: string): Workspace {
  const id = `diagram:${connectionId}:${database}`;
  if (ws.tabs.some((tab) => tab.id === id)) return { ...ws, activeTabId: id };
  const tab: DiagramTab = { kind: "diagram", id, connectionId, database };
  return { ...ws, tabs: [...ws.tabs, tab], activeTabId: id };
}

export function openQuery(
  ws: Workspace,
  connectionId: string,
  database: string,
  initialSql = "",
  source?: TableTarget,
): Workspace {
  sequencia++;
  const tab: QueryTab = {
    kind: "query",
    id: `query:${String(sequencia)}`,
    connectionId,
    database,
    title: `Consulta ${String(sequencia)}`,
    initialSql,
    ...(source === undefined ? {} : { source }),
  };
  return { ...ws, tabs: [...ws.tabs, tab], activeTabId: tab.id };
}

export function focusTab(ws: Workspace, id: string): Workspace {
  return ws.tabs.some((tab) => tab.id === id) ? { ...ws, activeTabId: id } : ws;
}

/**
 * Fecha a aba e escolhe a vizinha — a da direita, ou a da esquerda se era a
 * última. Fechar uma aba não pode largar o usuário numa tela vazia com outras
 * abas abertas.
 */
export function closeTab(ws: Workspace, id: string): Workspace {
  const index = ws.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return ws;

  const tabs = ws.tabs.filter((tab) => tab.id !== id);
  if (ws.activeTabId !== id) return { ...ws, tabs };

  const vizinha = tabs[index] ?? tabs[index - 1] ?? null;
  return { ...ws, tabs, activeTabId: vizinha?.id ?? null };
}

/**
 * Workspace visível: só as abas cujas conexões ainda existem.
 *
 * Derivação, não sincronização. Excluir uma conexão faz as abas dela sumirem
 * porque elas deixam de ser deriváveis, sem `useEffect` e sem a janela em que
 * uma aba aponta para um banco que já não existe.
 */
export function tabsOfLiveConnections(ws: Workspace, vivas: ReadonlySet<string>): Workspace {
  const tabs = ws.tabs.filter((tab) => vivas.has(tabConnectionId(tab)));
  if (tabs.length === ws.tabs.length) return ws;

  const aindaAtiva = tabs.some((tab) => tab.id === ws.activeTabId);
  return {
    ...ws,
    tabs,
    activeTabId: aindaAtiva ? ws.activeTabId : (tabs[tabs.length - 1]?.id ?? null),
  };
}

/** Fecha todas as abas de uma conexão — usada ao excluir a conexão. */
export function closeTabsOfConnection(ws: Workspace, connectionId: string): Workspace {
  const alvo = (tab: Tab): string =>
    tab.kind === "table" ? tab.target.connectionId : tab.connectionId;

  return ws.tabs
    .filter((tab) => alvo(tab) === connectionId)
    .reduce((acc, tab) => closeTab(acc, tab.id), ws);
}

function patchTable(ws: Workspace, id: string, patch: Partial<Omit<TableTab, "kind" | "id">>): Workspace {
  return {
    ...ws,
    tabs: ws.tabs.map((tab) =>
      tab.id === id && tab.kind === "table" ? { ...tab, ...patch } : tab,
    ),
  };
}

/** Troca a sub-aba, preservando o resto do estado daquela aba. */
export function setView(ws: Workspace, id: string, view: TableView): Workspace {
  return patchTable(ws, id, { view });
}

/**
 * Seleciona a coluna e abre o inspetor.
 *
 * Selecionar sem abrir deixaria o clique sem resposta visível; o inspetor
 * começa fechado justamente para só aparecer quando há o que inspecionar.
 */
export function selectColumn(ws: Workspace, id: string, column: string | null): Workspace {
  const next = patchTable(ws, id, { selectedColumn: column });
  return column === null ? next : { ...next, inspectorOpen: true };
}

export function toggleInspector(ws: Workspace): Workspace {
  return { ...ws, inspectorOpen: !ws.inspectorOpen };
}

/** Rótulo curto da aba. Os títulos fixos passam por `t`; nome de tabela e de
 * consulta são dados, não texto de UI, então vão como estão. */
export function tabTitle(tab: Tab, t: Tradutor): string {
  switch (tab.kind) {
    case "table":
      return `${tab.target.schema}.${tab.target.relation}`;
    case "diagram":
      return t("aba.tituloDiagrama", { db: tab.database });
    case "overview":
      return t("aba.tituloDatabases");
    case "activity":
      return t("aba.tituloProcessos");
    case "audit":
      return t("aba.tituloAuditoria");
    case "query":
      return tab.title;
  }
}

/** Conexão a que a aba pertence — o que decide se ela herda a tarja de perigo. */
export function tabConnectionId(tab: Tab): string {
  return tab.kind === "table" ? tab.target.connectionId : tab.connectionId;
}

/**
 * Uma aba está em modo de escrita quando a conexão dela está.
 *
 * O estado de perigo é da conexão, não da aba: qualquer aba aberta sobre uma
 * conexão gravável herda a tarja (DBee.md §2.1).
 */
export function isDangerous(tab: Tab, connections: readonly Connection[]): boolean {
  const id = tabConnectionId(tab);
  return connections.find((c) => c.id === id)?.writeEnabled === true;
}
