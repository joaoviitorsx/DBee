import type { Connection } from "@dbee/shared";
import { Code2, PanelLeft, PanelRight, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConnectionWarning } from "@dbee/shared";
import { ContextMenu, type MenuAnchor, type MenuSection } from "../components/ContextMenu";
import { HoneycombCluster } from "../components/HoneycombCluster";
import { Marca } from "../components/Marca";
import { Button } from "../components/ui";
import { cn } from "../lib/cn";
import { useLayoutLargo } from "../lib/useMediaQuery";
import { Inspector } from "../features/inspector/Inspector";
import { ActivityTab } from "../features/overview/ActivityTab";
import { AuditTab } from "../features/overview/AuditTab";
import { DatabasesOverviewTab } from "../features/overview/DatabasesOverview";
import { DiagramTabContent } from "../features/diagram/DiagramTabContent";
import { DiagramView } from "../features/diagram/DiagramView";
import { QueryTabContent } from "../features/query/QueryTabContent";
import { UserChip } from "../features/auth/UserChip";
import { Trabalhando } from "../features/motion/Trabalhando";
import { IdiomaToggle } from "../features/idioma/IdiomaToggle";
import { useT } from "../i18n";
import { ThemeToggle } from "../features/theme/ThemeToggle";
import { DataTab } from "../features/tabs/DataTab";
import { IndexesTab } from "../features/tabs/IndexesTab";
import { StructureTab } from "../features/tabs/StructureTab";
import { SubTabButtons, SubTabs, TabStrip } from "../features/tabs/TabStrip";
import { ConnectionTree, type ConnectionHealth, type TreeTarget } from "../features/tree/ConnectionTree";
import { treeMenuSections, treeMenuTitle, type TreeMenuActions } from "../features/tree/treeMenu";
import { useSchema, useTreeExpansion } from "../features/tree/useTree";
import {
  activeTab,
  closeTab,
  emptyWorkspace,
  focusTab,
  openCluster,
  openDiagram,
  openQuery,
  openTable,
  selectColumn,
  setView,
  tabsOfLiveConnections,
  toggleInspector,
  type QueryTab,
  type TableTab,
  type TableTarget,
  type TableView,
  type Workspace,
} from "./workspace";

const LARGURA_MIN = 200;
const LARGURA_MAX = 480;

export interface AppShellProps {
  readonly connections: readonly Connection[];
  readonly health: Readonly<Record<string, ConnectionHealth>>;
  readonly warnings: Readonly<Record<string, readonly ConnectionWarning[]>>;
  readonly onNewConnection: () => void;
  /** Ações que o menu da árvore dispara sobre uma conexão. */
  readonly connectionActions: (
    connection: Connection,
  ) => Omit<
    TreeMenuActions,
    "onOpenRelation" | "onRefreshSchema" | "onNewQuery" | "onOpenDiagram" | "onOpenCluster"
  >;
  readonly onRefreshSchema: (connectionId: string, database: string) => void;
}

/**
 * Shell de três zonas.
 *
 * A conexão deixou de ser página e virou a raiz da navegação — antes, todo
 * caminho para os dados exigia sair da tela de conexões, o que é um beco sem
 * saída numa ferramenta cujo trabalho é justamente chegar aos dados.
 */
export function AppShell({
  connections,
  health,
  warnings,
  onNewConnection,
  connectionActions,
  onRefreshSchema,
}: AppShellProps) {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [larguraArvore, setLarguraArvore] = useState(260);
  const [menu, setMenu] = useState<{ target: TreeTarget; anchor: MenuAnchor } | null>(null);
  const [menuAba, setMenuAba] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  // Botão direito no vazio da árvore: a única ação que cabe ali é acrescentar.
  const [menuFundo, setMenuFundo] = useState<MenuAnchor | null>(null);
  const [arvoreAberta, setArvoreAberta] = useState(false);
  const largo = useLayoutLargo();
  const tree = useTreeExpansion();
  const t = useT();
  // A área da árvore+centro. O Resizer escreve a largura numa CSS var neste nó
  // durante o arrasto (por ref, sem re-render), e só chama `setState` ao soltar.
  const areaRef = useRef<HTMLDivElement>(null);

  /**
   * Aba de conexão excluída some por **derivação**, não por efeito.
   *
   * Sincronizar estado com `setState` dentro de `useEffect` provoca renderização
   * em cascata e cria uma janela em que a aba aponta para uma conexão que já
   * não existe. Derivar da lista viva não tem essa janela.
   */
  const vivas = useMemo(() => new Set(connections.map((c) => c.id)), [connections]);
  const visivel = useMemo(
    () => tabsOfLiveConnections(ws, vivas),
    [ws, vivas],
  );

  const abrir = useCallback((target: TableTarget) => {
    setWs((atual) => openTable(atual, target));
  }, []);

  const novaConsulta = useCallback(
    (connectionId: string, database: string, sql?: string, source?: TableTarget) => {
    setWs((atual) => openQuery(atual, connectionId, database, sql, source));
    },
    [],
  );

  const abrirDiagrama = useCallback((connectionId: string, database: string) => {
    setWs((atual) => openDiagram(atual, connectionId, database));
  }, []);

  const abrirCluster = useCallback(
    (connectionId: string, kind: "overview" | "activity" | "audit") => {
      setWs((atual) => openCluster(atual, connectionId, kind));
    },
    [],
  );

  /**
   * `Ctrl+T` / `Cmd+T` abre consulta no alvo da aba ativa.
   *
   * Sem aba ativa não há alvo, e abrir uma consulta "sem banco" seria uma aba
   * que não pode executar nada — então o atalho não faz nada nesse caso.
   */
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "t") return;
      const atual = activeTab(ws);
      if (atual === null) return;
      // Abas de cluster (databases/processos) não têm database — não há consulta
      // a abrir a partir delas.
      const alvo =
        atual.kind === "table"
          ? { c: atual.target.connectionId, d: atual.target.database }
          : atual.kind === "query" || atual.kind === "diagram"
            ? { c: atual.connectionId, d: atual.database }
            : null;
      if (alvo === null) return;
      e.preventDefault();
      novaConsulta(alvo.c, alvo.d);
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); };
  }, [ws, novaConsulta]);

  const aba = activeTab(visivel);
  const abaTabela: TableTab | null = aba?.kind === "table" ? aba : null;
  const abaQuery: QueryTab | null = aba?.kind === "query" ? aba : null;
  const abaDiagrama = aba?.kind === "diagram" ? aba : null;
  const abaCluster =
    aba?.kind === "overview" || aba?.kind === "activity" || aba?.kind === "audit" ? aba : null;

  const alvoAtivo =
    abaTabela !== null
      ? { connectionId: abaTabela.target.connectionId, database: abaTabela.target.database }
      : abaQuery !== null
        ? { connectionId: abaQuery.connectionId, database: abaQuery.database }
        : null;

  const idConexaoAtiva = alvoAtivo?.connectionId;
  const conexaoAtiva = connections.find((c) => c.id === idConexaoAtiva) ?? null;
  const perigo = conexaoAtiva?.writeEnabled === true;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        target={abaTabela?.target ?? null}
        database={abaTabela?.target.database ?? abaQuery?.database ?? null}
        connection={conexaoAtiva}
        onToggleTree={largo ? null : () => { setArvoreAberta((a) => !a); }}
      />

      <div
        ref={areaRef}
        className="relative flex min-h-0 flex-1"
        style={{ ["--w-arvore" as string]: `${String(larguraArvore)}px` }}
      >
        {/*
          * Abaixo de 1024px a árvore vira sobreposição.
          *
          * Como coluna fixa de 260px, num aparelho de 375px sobravam ~115px
          * para o centro — a tela do meio simplesmente desaparecia. Sobreposta,
          * ela some quando não está em uso e o centro fica inteiro.
          */}
        {!largo && arvoreAberta ? (
          <button
            type="button"
            aria-label={t("arvore.fechar")}
            onClick={() => { setArvoreAberta(false); }}
            className="fixed inset-0 z-30 cursor-default bg-black/50"
          />
        ) : null}

        <aside
          style={largo ? { width: "var(--w-arvore)" } : undefined}
          className={cn(
            "border-r border-line bg-surface",
            largo
              ? "shrink-0"
              : cn(
                  "fixed inset-y-0 left-0 z-40 w-[min(19rem,85vw)] transition-transform duration-200",
                  arvoreAberta ? "translate-x-0" : "-translate-x-full",
                ),
          )}
        >
          <ConnectionTree
            connections={connections}
            health={health}
            warnings={warnings}
            tree={tree}
            onOpenRelation={(alvo) => { abrir(alvo); if (!largo) setArvoreAberta(false); }}
            onNewConnection={onNewConnection}
            onContextMenu={(target, anchor) => { setMenu({ target, anchor }); }}
            onBackgroundContextMenu={setMenuFundo}
            activeTarget={abaTabela?.target ?? null}
          />
        </aside>

        {largo ? (
          <Resizer
            largura={larguraArvore}
            onArrasto={(px) => { areaRef.current?.style.setProperty("--w-arvore", `${String(px)}px`); }}
            onFim={setLarguraArvore}
          />
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col bg-sunken">
          <TabStrip
            tabs={visivel.tabs}
            activeTabId={visivel.activeTabId}
            connections={connections}
            onFocus={(id) => { setWs((a) => focusTab(a, id)); }}
            onClose={(id) => { setWs((a) => closeTab(a, id)); }}
            onContextMenu={(id, anchor) => { setMenuAba({ id, anchor }); }}
            onNew={
              conexaoAtiva === null || alvoAtivo === null
                ? undefined
                : () => { novaConsulta(alvoAtivo.connectionId, alvoAtivo.database); }
            }
          />

          {abaCluster !== null ? (
            abaCluster.kind === "overview" ? (
              <DatabasesOverviewTab key={abaCluster.id} connectionId={abaCluster.connectionId} />
            ) : abaCluster.kind === "activity" ? (
              <ActivityTab key={abaCluster.id} connectionId={abaCluster.connectionId} />
            ) : (
              <AuditTab
                key={abaCluster.id}
                connectionId={abaCluster.connectionId}
                connections={connections}
              />
            )
          ) : abaDiagrama !== null ? (
            <DiagramTabContent
              key={abaDiagrama.id}
              connectionId={abaDiagrama.connectionId}
              database={abaDiagrama.database}
              onOpenTable={(alvo) => { abrir(alvo); if (!largo) setArvoreAberta(false); }}
            />
          ) : abaQuery !== null ? (
            <QueryTabContent
              key={abaQuery.id}
              tab={abaQuery}
              writeEnabled={conexaoAtiva?.writeEnabled === true}
            />
          ) : abaTabela === null ? (
            <TelaVazia
              temConexoes={connections.length > 0}
              onNovaConsulta={
                alvoAtivo === null
                  ? null
                  : () => { novaConsulta(alvoAtivo.connectionId, alvoAtivo.database); }
              }
            />
          ) : (
            <TableTabContent
              key={abaTabela.id}
              tab={abaTabela}
              danger={perigo}
              onConsultar={() => {
                novaConsulta(
                  abaTabela.target.connectionId,
                  abaTabela.target.database,
                  `SELECT *\nFROM ${abaTabela.target.schema}.${abaTabela.target.relation}\nLIMIT 100;`,
                  // A origem viaja junto: é o que deixa o painel de baixo
                  // mostrar os dados desta tabela enquanto se escreve o SQL.
                  abaTabela.target,
                );
              }}
              onView={(view) => { setWs((a) => setView(a, abaTabela.id, view)); }}
              onOpenTable={(alvo) => { abrir(alvo); }}
              onSelectColumn={(nome) => { setWs((a) => selectColumn(a, abaTabela.id, nome)); }}
              inspectorOpen={visivel.inspectorOpen}
              onToggleInspector={() => { setWs(toggleInspector); }}
            />
          )}
        </main>

        {/* Estreito: o inspetor também sobrepõe, em vez de espremer o centro. */}
        {visivel.inspectorOpen ? (
          <div
            className={cn(
              largo ? "w-[280px] shrink-0" : "fixed inset-y-0 right-0 z-40 w-[min(19rem,85vw)]",
            )}
          >
            <InspectorZone tab={abaTabela} onClose={() => { setWs(toggleInspector); }} />
          </div>
        ) : null}
      </div>

      {menu !== null ? (
        <ContextMenu
          anchor={menu.anchor}
          title={treeMenuTitle(menu.target)}
          sections={treeMenuSections(menu.target, {
            ...connectionActions(menu.target.connection),
            onOpenRelation: abrir,
            onRefreshSchema,
            onNewQuery: novaConsulta,
            onOpenDiagram: abrirDiagrama,
            onOpenCluster: abrirCluster,
          }, t)}
          onClose={() => { setMenu(null); }}
        />
      ) : null}

      {menuAba !== null ? (
        <ContextMenu
          anchor={menuAba.anchor}
          sections={tabMenuSections(menuAba.id, visivel.tabs, setWs)}
          onClose={() => { setMenuAba(null); }}
        />
      ) : null}

      {menuFundo !== null ? (
        <ContextMenu
          anchor={menuFundo}
          sections={[
            {
              items: [
                {
                  id: "nova-conexao",
                  label: "Nova conexão",
                  icon: <Plus aria-hidden className="h-3.5 w-3.5" />,
                  onSelect: onNewConnection,
                },
              ],
            },
          ]}
          onClose={() => { setMenuFundo(null); }}
        />
      ) : null}
    </div>
  );
}

/** Menu da aba: fechar, fechar as outras, fechar todas. */
function tabMenuSections(
  id: string,
  tabs: readonly { id: string }[],
  setWs: (fn: (ws: Workspace) => Workspace) => void,
): MenuSection[] {
  const outras = tabs.filter((t) => t.id !== id);
  return [
    {
      items: [
        { id: "close", label: "Fechar", onSelect: () => { setWs((a) => closeTab(a, id)); } },
        {
          id: "close-others",
          label: "Fechar as outras",
          disabled: outras.length === 0,
          onSelect: () => {
            setWs((a) => outras.reduce((acc, t) => closeTab(acc, t.id), a));
          },
        },
        {
          id: "close-all",
          label: "Fechar todas",
          onSelect: () => { setWs((a) => tabs.reduce((acc, t) => closeTab(acc, t.id), a)); },
        },
      ],
    },
  ];
}

/**
 * Barra superior: a marca e **o banco ativo, sempre visível**.
 *
 * "O usuário nunca deve precisar procurar em qual banco está" é requisito, não
 * conforto. Com escrita habilitada, a barra inteira vira alerta.
 */
function TopBar({
  target,
  database,
  connection,
  onToggleTree,
}: {
  readonly target: TableTarget | null;
  /** O database ativo, venha ele de uma aba de tabela ou de query. */
  readonly database: string | null;
  readonly connection: Connection | null;
  /** Só existe no layout estreito, onde a árvore é sobreposição. */
  readonly onToggleTree: (() => void) | null;
}) {
  const perigo = connection?.writeEnabled === true;
  const t = useT();

  return (
    <header
      className={cn(
        "relative flex shrink-0 items-center gap-3 overflow-hidden border-b px-3 py-2",
        perigo ? "border-danger-line bg-danger-surface" : "border-line bg-surface",
      )}
    >
      {/*
        * Favo de mel no canto direito, atrás dos controles — o motivo da
        * abelha assinando o cabeçalho de leve. `mask` desvanece para a esquerda
        * para não competir com o miolo. Some no estado de perigo, onde a cor já
        * carrega a mensagem sozinha.
        */}
      {!perigo ? (
        <HoneycombCluster
          aria-hidden
          className="pointer-events-none absolute -right-3 -top-2 h-14 -scale-x-100 text-accent opacity-[0.14]"
          size={9}
        />
      ) : null}

      {/*
        * Cacho hexagonal no canto superior esquerdo, casando com a marca —
        * hexágonos flat-top cheios/contorno atrás do "DBee", desvanecendo para
        * a direita para não invadir o breadcrumb. Some no perigo, onde o
        * vermelho já carrega a mensagem.
        */}
      {!perigo ? (
        <HoneycombCluster
          aria-hidden
          className="pointer-events-none absolute -left-3 -top-2 h-14 text-accent opacity-[0.14]"
          size={9}
        />
      ) : null}

      {onToggleTree !== null ? (
        <Button size="icon" variant="ghost" aria-label={t("arvore.abrir")} onClick={onToggleTree}>
          <PanelLeft aria-hidden className="h-4 w-4" />
        </Button>
      ) : null}

      <div className="relative flex items-center gap-2">
        <Marca className="h-6 w-6" />
        {/* Mesma marca do login: "Bee" em âmbar, distinção só de cor. */}
        <span className="text-sm font-semibold tracking-[-0.025em]">
          <span className="text-ink">D</span>
          <span className="text-accent">Bee</span>
        </span>
      </div>

      {connection !== null && database !== null ? (
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-subtle">/</span>
          {connection.color !== null ? (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: connection.color }}
            />
          ) : null}
          <span className="truncate text-xs text-ink">{connection.name}</span>
          <span className="truncate font-mono text-xs text-muted">
            {target === null ? database : `${database}.${target.schema}.${target.relation}`}
          </span>
        </div>
      ) : null}

      {perigo ? (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-[4px] bg-danger px-2 py-1 text-2xs font-semibold text-ink">
          <TriangleAlert aria-hidden className="h-3 w-3" />
          {t("conexao.escritaHabilitada")}
        </span>
      ) : null}

      <div className={cn("relative flex shrink-0 items-center gap-2", perigo ? "" : "ml-auto")}>
        <span className="hidden text-2xs text-subtle sm:inline">v{__APP_VERSION__}</span>
        <IdiomaToggle />
        <ThemeToggle />
        {/* Quem está logado é o `actor` do query_log — informação, não perfil. */}
        <UserChip />
      </div>
    </header>
  );
}

/**
 * Divisor arrastável entre a árvore e o centro.
 *
 * O arrasto escreve a largura numa **CSS var por ref** (`onArrasto`), sem tocar
 * no estado do React: arrastar a 60 fps não re-renderiza o grid. O `setState`
 * (`onFim`) acontece **uma vez, ao soltar**, para a largura persistir. Antes,
 * um `setState` por `mousemove` re-renderizava a árvore inteira a cada quadro —
 * 67 ms por evento, 15 fps, medido com 800 linhas no DOM (ATRITO).
 */
function Resizer({
  largura,
  onArrasto,
  onFim,
}: {
  readonly largura: number;
  readonly onArrasto: (largura: number) => void;
  readonly onFim: (largura: number) => void;
}) {
  const t = useT();
  const arrastando = useRef(false);
  const atual = useRef(largura);

  useEffect(() => {
    const clamp = (x: number): number => Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, x));
    const mover = (e: MouseEvent): void => {
      if (!arrastando.current) return;
      atual.current = clamp(e.clientX);
      onArrasto(atual.current);
    };
    const soltar = (): void => {
      if (!arrastando.current) return;
      arrastando.current = false;
      onFim(atual.current);
    };

    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
    };
  }, [onArrasto, onFim]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("arvore.redimensionar")}
      aria-valuenow={largura}
      aria-valuemin={LARGURA_MIN}
      aria-valuemax={LARGURA_MAX}
      tabIndex={0}
      onMouseDown={() => { arrastando.current = true; atual.current = largura; }}
      // Teclado também redimensiona: a ferramenta é operada por teclado. Passo
      // discreto, então commita direto — não há arrasto a suavizar.
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onFim(Math.max(LARGURA_MIN, largura - 16));
        if (e.key === "ArrowRight") onFim(Math.min(LARGURA_MAX, largura + 16));
      }}
      className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors duration-150 hover:bg-amber/40"
    />
  );
}

function TableTabContent({
  tab,
  danger,
  onConsultar,
  onView,
  onOpenTable,
  onSelectColumn,
  inspectorOpen,
  onToggleInspector,
}: {
  readonly tab: TableTab;
  readonly danger: boolean;
  readonly onConsultar: () => void;
  readonly onView: (view: TableView) => void;
  readonly onOpenTable: (target: TableTarget) => void;
  readonly onSelectColumn: (name: string) => void;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
}) {
  const t = useT();
  const { connectionId, database, schema, relation } = tab.target;
  const arvore = useSchema(connectionId, database, true);

  const rel =
    arvore.data?.schemas.find((s) => s.name === schema)?.relations.find((r) => r.name === relation) ??
    null;

  const counts = { columns: rel?.columns.length ?? 0, indexes: rel?.indexes.length ?? 0 };
  const inspetorBtn = (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7 shrink-0"
      aria-label={inspectorOpen ? "Fechar inspetor" : "Abrir inspetor"}
      aria-pressed={inspectorOpen}
      onClick={onToggleInspector}
    >
      <PanelRight aria-hidden className="h-4 w-4" />
    </Button>
  );

  /*
   * A aba Dados monta as sub-abas **dentro da própria toolbar**: sub-abas à
   * esquerda, Consultar/filtro/export à direita, o inspetor no fim — uma linha
   * só. Antes eram dois contêineres, cada um com sua borda, dois filetes
   * colados. As outras vistas não têm toolbar, então usam a barra `SubTabs`
   * comum, com o inspetor no `trailing`.
   */
  const barraComum = (
    <SubTabs value={tab.view} onChange={onView} counts={counts} trailing={inspetorBtn} />
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", danger && "border-l-2 border-l-danger")}>
      {arvore.isPending ? (
        <>
          {barraComum}
          <Trabalhando rotulo={t("arvore.lendoCatalogo")} cronometro />
        </>
      ) : arvore.isError ? (
        <>
          {barraComum}
          <p className="px-4 py-8 text-xs text-danger">{arvore.error.message}</p>
        </>
      ) : rel === null ? (
        <>
          {barraComum}
          <p className="px-4 py-8 text-xs text-subtle">
            A relação não está mais no catálogo. Atualize a árvore.
          </p>
        </>
      ) : tab.view === "diagram" ? (
        <>
          {barraComum}
          <DiagramView
            schema={arvore.data}
            connectionId={tab.target.connectionId}
            database={tab.target.database}
            onOpenTable={onOpenTable}
          />
        </>
      ) : tab.view === "structure" ? (
        <>
          {barraComum}
          <div className="min-h-0 flex-1 overflow-auto">
            <StructureTab
              relation={rel}
              selectedColumn={tab.selectedColumn}
              onSelectColumn={onSelectColumn}
            />
          </div>
        </>
      ) : tab.view === "indexes" ? (
        <>
          {barraComum}
          <div className="min-h-0 flex-1 overflow-auto">
            <IndexesTab relation={rel} />
          </div>
        </>
      ) : (
        <DataTab
          target={tab.target}
          onConsultar={onConsultar}
          estimatedRows={rel.estimatedRows}
          leading={<SubTabButtons value={tab.view} onChange={onView} counts={counts} />}
          trailing={inspetorBtn}
        />
      )}
    </div>
  );
}

function InspectorZone({
  tab,
  onClose,
}: {
  readonly tab: TableTab | null;
  readonly onClose: () => void;
}) {
  const arvore = useSchema(
    tab?.target.connectionId ?? "",
    tab?.target.database ?? "",
    tab !== null,
  );

  const rel =
    tab === null
      ? null
      : (arvore.data?.schemas
          .find((s) => s.name === tab.target.schema)
          ?.relations.find((r) => r.name === tab.target.relation) ?? null);

  const column = rel?.columns.find((c) => c.name === tab?.selectedColumn) ?? null;

  return <Inspector relation={rel} column={column} onClose={onClose} />;
}

function TelaVazia({
  temConexoes,
  onNovaConsulta,
}: {
  readonly temConexoes: boolean;
  readonly onNovaConsulta: (() => void) | null;
}) {
  return (
    <div className="mx-auto mt-28 max-w-sm px-6 text-center">
      <Marca className="mx-auto h-12 w-12" apagada />
      <h2 className="mt-4 text-base text-ink">
        {temConexoes ? "Escolha uma tabela na árvore" : "Comece cadastrando uma conexão"}
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        {temConexoes
          ? "Expanda uma conexão para ver os databases, e um database para ver os schemas. A árvore só consulta o banco quando você abre o nó."
          : "A senha é cifrada antes de ir para o disco, e a conexão nasce em modo leitura."}
      </p>

      {/* Estado vazio como convite: as ações possíveis daqui, não só um aviso. */}
      {temConexoes ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          {onNovaConsulta !== null ? (
            <Button variant="primary" size="sm" onClick={onNovaConsulta}>
              <Code2 aria-hidden className="h-3.5 w-3.5" />
              Nova consulta
            </Button>
          ) : null}
          <p className="text-2xs text-subtle">
            {onNovaConsulta === null
              ? "Abra uma tabela na árvore, ou use o botão + na barra de abas."
              : "Cmd+T abre outra consulta · Cmd+Enter executa o statement sob o cursor"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
