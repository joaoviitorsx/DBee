import type { Connection } from "@dbee/shared";
import { PanelLeft, PanelRight, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu, type MenuAnchor, type MenuSection } from "../components/ContextMenu";
import { Mark } from "../components/Mark";
import { Button } from "../components/ui";
import { cn } from "../lib/cn";
import { useLayoutLargo } from "../lib/useMediaQuery";
import { Inspector } from "../features/inspector/Inspector";
import { DataTab } from "../features/tabs/DataTab";
import { IndexesTab } from "../features/tabs/IndexesTab";
import { StructureTab } from "../features/tabs/StructureTab";
import { SubTabs, TabStrip } from "../features/tabs/TabStrip";
import { ConnectionTree, type ConnectionHealth, type TreeTarget } from "../features/tree/ConnectionTree";
import { treeMenuSections, treeMenuTitle, type TreeMenuActions } from "../features/tree/treeMenu";
import { useSchema, useTreeExpansion } from "../features/tree/useTree";
import {
  activeTab,
  closeTab,
  emptyWorkspace,
  focusTab,
  openTable,
  selectColumn,
  setView,
  tabsOfLiveConnections,
  toggleInspector,
  type TableTab,
  type TableTarget,
  type Workspace,
} from "./workspace";

const LARGURA_MIN = 200;
const LARGURA_MAX = 480;

export interface AppShellProps {
  readonly connections: readonly Connection[];
  readonly health: Readonly<Record<string, ConnectionHealth>>;
  readonly onNewConnection: () => void;
  /** Ações que o menu da árvore dispara sobre uma conexão. */
  readonly connectionActions: (connection: Connection) => Omit<TreeMenuActions, "onOpenRelation" | "onRefreshSchema">;
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
  onNewConnection,
  connectionActions,
  onRefreshSchema,
}: AppShellProps) {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [larguraArvore, setLarguraArvore] = useState(260);
  const [menu, setMenu] = useState<{ target: TreeTarget; anchor: MenuAnchor } | null>(null);
  const [menuAba, setMenuAba] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [arvoreAberta, setArvoreAberta] = useState(false);
  const largo = useLayoutLargo();
  const tree = useTreeExpansion();

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

  const aba = activeTab(visivel);
  const abaTabela: TableTab | null = aba?.kind === "table" ? aba : null;
  const conexaoAtiva = connections.find((c) => c.id === abaTabela?.target.connectionId) ?? null;
  const perigo = conexaoAtiva?.writeEnabled === true;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        target={abaTabela?.target ?? null}
        connection={conexaoAtiva}
        onToggleTree={largo ? null : () => { setArvoreAberta((a) => !a); }}
      />

      <div className="relative flex min-h-0 flex-1">
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
            aria-label="Fechar árvore"
            onClick={() => { setArvoreAberta(false); }}
            className="fixed inset-0 z-30 cursor-default bg-black/50"
          />
        ) : null}

        <aside
          style={largo ? { width: `${String(larguraArvore)}px` } : undefined}
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
            tree={tree}
            onOpenRelation={(alvo) => { abrir(alvo); if (!largo) setArvoreAberta(false); }}
            onNewConnection={onNewConnection}
            onContextMenu={(target, anchor) => { setMenu({ target, anchor }); }}
            activeTarget={abaTabela?.target ?? null}
          />
        </aside>

        {largo ? <Resizer largura={larguraArvore} onChange={setLarguraArvore} /> : null}

        <main className="flex min-w-0 flex-1 flex-col bg-sunken">
          <TabStrip
            tabs={visivel.tabs}
            activeTabId={visivel.activeTabId}
            connections={connections}
            onFocus={(id) => { setWs((a) => focusTab(a, id)); }}
            onClose={(id) => { setWs((a) => closeTab(a, id)); }}
            onContextMenu={(id, anchor) => { setMenuAba({ id, anchor }); }}
          />

          {abaTabela === null ? (
            <TelaVazia temConexoes={connections.length > 0} />
          ) : (
            <TableTabContent
              key={abaTabela.id}
              tab={abaTabela}
              danger={perigo}
              onView={(view) => { setWs((a) => setView(a, abaTabela.id, view)); }}
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
          })}
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
  connection,
  onToggleTree,
}: {
  readonly target: TableTarget | null;
  readonly connection: Connection | null;
  /** Só existe no layout estreito, onde a árvore é sobreposição. */
  readonly onToggleTree: (() => void) | null;
}) {
  const perigo = connection?.writeEnabled === true;

  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-3 border-b px-3 py-2",
        perigo ? "border-danger-line bg-danger-surface" : "border-line bg-surface",
      )}
    >
      {onToggleTree !== null ? (
        <Button size="icon" variant="ghost" aria-label="Abrir árvore" onClick={onToggleTree}>
          <PanelLeft aria-hidden className="h-4 w-4" />
        </Button>
      ) : null}

      <div className="flex items-center gap-2">
        <Mark className={cn("h-5 w-5", perigo ? "text-danger-ink" : "text-amber")} />
        <span className="text-sm font-semibold tracking-[-0.025em] text-ink">DBee</span>
      </div>

      {connection !== null && target !== null ? (
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
            {target.database}.{target.schema}.{target.relation}
          </span>
        </div>
      ) : null}

      {perigo ? (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-[4px] bg-danger px-2 py-1 text-2xs font-semibold text-ink">
          <TriangleAlert aria-hidden className="h-3 w-3" />
          Escrita habilitada
        </span>
      ) : (
        <span className="ml-auto shrink-0 text-2xs text-subtle">v{__APP_VERSION__}</span>
      )}
    </header>
  );
}

/** Divisor arrastável entre a árvore e o centro. */
function Resizer({
  largura,
  onChange,
}: {
  readonly largura: number;
  readonly onChange: (largura: number) => void;
}) {
  const arrastando = useRef(false);

  useEffect(() => {
    const mover = (e: MouseEvent): void => {
      if (!arrastando.current) return;
      onChange(Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, e.clientX)));
    };
    const soltar = (): void => { arrastando.current = false; };

    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
    };
  }, [onChange]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar árvore"
      aria-valuenow={largura}
      aria-valuemin={LARGURA_MIN}
      aria-valuemax={LARGURA_MAX}
      tabIndex={0}
      onMouseDown={() => { arrastando.current = true; }}
      // Teclado também redimensiona: a ferramenta é operada por teclado.
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(Math.max(LARGURA_MIN, largura - 16));
        if (e.key === "ArrowRight") onChange(Math.min(LARGURA_MAX, largura + 16));
      }}
      className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors duration-150 hover:bg-amber/40"
    />
  );
}

function TableTabContent({
  tab,
  danger,
  onView,
  onSelectColumn,
  inspectorOpen,
  onToggleInspector,
}: {
  readonly tab: TableTab;
  readonly danger: boolean;
  readonly onView: (view: "data" | "structure" | "indexes") => void;
  readonly onSelectColumn: (name: string) => void;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
}) {
  const { connectionId, database, schema, relation } = tab.target;
  const arvore = useSchema(connectionId, database, true);

  const rel =
    arvore.data?.schemas.find((s) => s.name === schema)?.relations.find((r) => r.name === relation) ??
    null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", danger && "border-l-2 border-l-danger")}>
      <div className="flex items-center justify-between border-b border-line">
        <SubTabs
          value={tab.view}
          onChange={onView}
          counts={{ columns: rel?.columns.length ?? 0, indexes: rel?.indexes.length ?? 0 }}
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label={inspectorOpen ? "Fechar inspetor" : "Abrir inspetor"}
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
          className="mr-2"
        >
          <PanelRight aria-hidden className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {arvore.isPending ? (
          <p className="px-4 py-8 text-xs text-muted">Lendo o catálogo…</p>
        ) : arvore.isError ? (
          <p className="px-4 py-8 text-xs text-danger">{arvore.error.message}</p>
        ) : rel === null ? (
          <p className="px-4 py-8 text-xs text-subtle">
            A relação não está mais no catálogo. Atualize a árvore.
          </p>
        ) : tab.view === "structure" ? (
          <StructureTab
            relation={rel}
            selectedColumn={tab.selectedColumn}
            onSelectColumn={onSelectColumn}
          />
        ) : tab.view === "indexes" ? (
          <IndexesTab relation={rel} />
        ) : (
          <DataTab />
        )}
      </div>
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

function TelaVazia({ temConexoes }: { readonly temConexoes: boolean }) {
  return (
    <div className="mx-auto mt-28 max-w-sm px-6 text-center">
      <Mark className="mx-auto h-9 w-9 text-line-strong" />
      <h2 className="mt-4 text-base text-ink">
        {temConexoes ? "Escolha uma tabela na árvore" : "Comece cadastrando uma conexão"}
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        {temConexoes
          ? "Expanda uma conexão para ver os databases, e um database para ver os schemas. A árvore só consulta o banco quando você abre o nó."
          : "A senha é cifrada antes de ir para o disco, e a conexão nasce em modo leitura."}
      </p>
    </div>
  );
}
