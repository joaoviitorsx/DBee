import type { Connection, RowFilter } from "@dbee/shared";
import { Code2, GitCompareArrows, Link2, PanelLeftClose, PanelLeftOpen, PanelRight, Plus, Unlock } from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ConnectionWarning } from "@dbee/shared";
import { ContextMenu, type MenuAnchor, type MenuSection } from "../components/ContextMenu";
import { Marca } from "../components/Marca";
import { connectionNode } from "../features/tree/keys";
import { deslocamentoFlip, LARGURA_TRILHO, posicoesDoTrilho } from "./trilho.puro";
import { IconeEngine } from "../components/IconeEngine";
import { Button } from "../components/ui";
import { cn } from "../lib/cn";
import { useLayoutLargo } from "../lib/useMediaQuery";
import { ComSaida } from "../components/ComSaida";
import { SeloAmbiente } from "../features/ambiente/SeloAmbiente";
import { Inspector } from "../features/inspector/Inspector";
import { ActivityTab } from "../features/overview/ActivityTab";
import { AuditTab } from "../features/overview/AuditTab";
import { DatabasesOverviewTab } from "../features/overview/DatabasesOverview";
import { DiagramTabContent } from "../features/diagram/DiagramTabContent";
import { DiagramView } from "../features/diagram/DiagramView";
import { CreateDatabaseDialog } from "../features/ddl/CreateDatabaseDialog";
import { CreateTableDialog } from "../features/ddl/CreateTableDialog";
import { ExportTabContent } from "../features/export/ExportTabContent";
import { QueryTabContent } from "../features/query/QueryTabContent";
import { UserChip } from "../features/auth/UserChip";
import { Trabalhando } from "../features/motion/Trabalhando";
import { IdiomaToggle } from "../features/idioma/IdiomaToggle";
import { type Tradutor, useT } from "../i18n";
import { ThemeToggle } from "../features/theme/ThemeToggle";
import { UpdateBadge } from "../features/update/UpdateBadge";
import { VersaoChip } from "../features/update/VersaoChip";
import { UsuariosBotao } from "../features/usuarios/UsuariosBotao";
import { TokensBotao } from "../features/tokens/TokensBotao";
import { VpnBotao } from "../features/vpn/VpnBotao";
import { DataTab } from "../features/tabs/DataTab";
import { IndexesTab } from "../features/tabs/IndexesTab";
import { StructureTab } from "../features/tabs/StructureTab";
import { SubTabButtons, SubTabs, TabStrip } from "../features/tabs/TabStrip";
import { FronteiraDeErro } from "../components/FronteiraDeErro";
import { ConnectionTree, type ConnectionHealth, type TreeTarget } from "../features/tree/ConnectionTree";
import { PaletaBusca } from "../features/busca/PaletaBusca";
import { BuscaValorDialog, type AlvoBuscaValor } from "../features/busca-valor/BuscaValorDialog";
import { CopiarTabelaDialog, type OrigemCopia } from "../features/copiar-tabela/CopiarTabelaDialog";
import { ComparadorTela } from "../features/comparar/ComparadorTela";
import { useGuardarWorkspace, useWorkspaceInicial } from "../features/estados/useWorkspacePersistido";
import { linkDeTabela } from "../features/links/links.puro";
import { copiarLink, useLinkCompartilhado } from "../features/links/useLinkCompartilhado";
import { treeMenuSections, treeMenuTitle, type TreeMenuActions } from "../features/tree/treeMenu";
import { capacidadesDe, dialetoDe } from "@dbee/shared/puro";
import { useConnections, useSchema, useTreeExpansion } from "../features/tree/useTree";
import {
  activeTab,
  closeTab,
  focusTab,
  openCluster,
  openCompare,
  openDiagram,
  openExport,
  openQuery,
  openTable,
  openTableFiltered,
  openTableFromLink,
  selectColumn,
  setView,
  tabsOfLiveConnections,
  toggleInspector,
  type QueryTab,
  type Tab,
  type TableTab,
  type TableTarget,
  type TableView,
  type Workspace,
  setQuerySql,
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
    | "onOpenRelation"
    | "onRefreshSchema"
    | "onNewQuery"
    | "onOpenDiagram"
    | "onOpenCluster"
    // Abrem aba ou diálogo — quem sabe disso é o shell, não a página de conexões.
    | "onCreateTable"
    | "onCreateDatabase"
    | "onOpenExport"
    | "onBuscarValor"
    | "onCopiarTabela"
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
  // Persistido por usuário: sobrevive a reload e re-login (F8, §3.7).
  const [ws, setWs] = useState<Workspace>(useWorkspaceInicial());
  useGuardarWorkspace(ws);
  const [larguraArvore, setLarguraArvore] = useState(LARGURA_PADRAO);
  const [menu, setMenu] = useState<{ target: TreeTarget; anchor: MenuAnchor } | null>(null);
  const [menuAba, setMenuAba] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  // Botão direito no vazio da árvore: a única ação que cabe ali é acrescentar.
  const [menuFundo, setMenuFundo] = useState<MenuAnchor | null>(null);
  const [arvoreAberta, setArvoreAberta] = useState(false);
  // ≥lg: a árvore pode ser recolhida (Ctrl+B) para dar a largura toda ao grid.
  const [arvoreRecolhida, setArvoreRecolhida] = useState(false);
  // Diálogos de DDL — abertos pelo menu da árvore, fechados por si mesmos.
  const [criandoTabela, setCriandoTabela] = useState<{ connectionId: string; database: string; schema: string } | null>(null);
  const [criandoDatabase, setCriandoDatabase] = useState<string | null>(null);
  const [buscandoValor, setBuscandoValor] = useState<AlvoBuscaValor | null>(null);
  const [copiando, setCopiando] = useState<OrigemCopia | null>(null);
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

  // Salto por FK: tabela referenciada em aba nova, já filtrada, sem trocar a atual.
  const abrirFiltrada = useCallback((target: TableTarget, filters: readonly RowFilter[]) => {
    setWs((atual) => openTableFiltered(atual, target, filters));
  }, []);

  const novaConsulta = useCallback(
    (connectionId: string, database: string, sql?: string, source?: TableTarget) => {
    setWs((atual) => openQuery(atual, connectionId, database, sql, source));
    },
    [],
  );

  // Abrir uma query salva: aba nova atrelada à conexão de origem, no database
  // dela. Se a conexão sumiu (FK ON DELETE SET NULL), não há onde atrelar.
  const abrirSalva = useCallback(
    (q: { connectionId: string | null; sql: string }) => {
      const conn = connections.find((c) => c.id === q.connectionId);
      if (conn === undefined) return;
      setWs((atual) => openQuery(atual, conn.id, conn.database, q.sql));
    },
    [connections],
  );
  // Link do hash (ADR 020): abre a aba, nunca executa.
  useLinkCompartilhado({
    connections,
    prontas: connections.length > 0,
    abrirTabela: (alvo, filtros, ordem) => { setWs((atual) => openTableFromLink(atual, alvo, filtros, ordem)); },
    abrirSalva,
    t,
  });

  const nomeConexao = useCallback(
    (id: string | null) => connections.find((c) => c.id === id)?.name ?? null,
    [connections],
  );

  const abrirExport = useCallback((connectionId: string, database: string) => {
    setWs((atual) => openExport(atual, connectionId, database));
  }, []);

  const abrirCriarTabela = useCallback(
    (connectionId: string, database: string, schema: string) => {
      setCriandoTabela({ connectionId, database, schema });
    },
    [],
  );

  const abrirCriarDatabase = useCallback((connectionId: string) => {
    setCriandoDatabase(connectionId);
  }, []);

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
  // Ctrl+B recolhe/abre a árvore; Ctrl+I abre/fecha o inspetor (ui-detalhes §3.2).
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        if (largo) setArvoreRecolhida((a) => !a);
        else setArvoreAberta((a) => !a);
      }
      if (k === "i" && activeTab(ws)?.kind === "table") {
        e.preventDefault();
        setWs(toggleInspector);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); };
  }, [largo, ws]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "t") return;
      const atual = activeTab(ws);
      // Sem aba ativa (tela vazia): a primeira conexão em leitura, no database
      // padrão dela — o atalho anunciado na tela vazia (§3.7) tem de funcionar ali.
      if (atual === null) {
        const primeira = conexaoPadrao(connections);
        if (primeira === undefined) return;
        e.preventDefault();
        novaConsulta(primeira.id, primeira.database);
        return;
      }
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
  }, [ws, novaConsulta, connections]);

  const aba = activeTab(visivel);
  const abaTabela: TableTab | null = aba?.kind === "table" ? aba : null;
  const abaQuery: QueryTab | null = aba?.kind === "query" ? aba : null;
  const abaDiagrama = aba?.kind === "diagram" ? aba : null;
  const abaExport = aba?.kind === "export" ? aba : null;
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


  /*
   * A árvore é uma só, montada em um lugar por vez: na coluna (aberta), ou no
   * "peek" sobre o trilho (recolhida). A árvore lê o catálogo de bancos que
   * não são deste projeto, então é a superfície mais exposta a schema de forma
   * inesperada. Fronteira própria: catálogo hostil derruba a navegação, não as
   * abas abertas nem o SQL que está sendo escrito ao lado.
   */
  const arvore = (
    <FronteiraDeErro variante="painel">
      <ConnectionTree
        connections={connections}
        health={health}
        warnings={warnings}
        tree={tree}
        onOpenRelation={(alvo) => {
          abrir(alvo);
          if (!largo) setArvoreAberta(false);
        }}
        onNewConnection={onNewConnection}
        onContextMenu={(target, anchor) => { setMenu({ target, anchor }); }}
        onBackgroundContextMenu={setMenuFundo}
        activeTarget={abaTabela?.target ?? null}
      />
    </FronteiraDeErro>
  );
  return (
    /*
      `overflow-x-hidden` é rede de segurança, não layout.

      Rolagem horizontal de PÁGINA nunca deveria ser possível aqui: a grade tem
      o scroller dela, e as tabelas largas têm o delas. Quando um `flex` sem
      `min-w-0` estourava, a página inteira deslizava e a barra superior — que
      no modo escrita É o alerta âmbar — saía de vista. Com isto, o mesmo erro
      vira conteúdo cortado: visível, e mensurável por teste.
    */
    <div className="flex h-dvh flex-col overflow-x-hidden">
      <TopBar
        target={abaTabela?.target ?? null}
        database={abaTabela?.target.database ?? abaQuery?.database ?? null}
        connection={conexaoAtiva}
        arvoreVisivel={largo ? !arvoreRecolhida : arvoreAberta}
        onToggleTree={
          largo ? () => { setArvoreRecolhida((a) => !a); } : () => { setArvoreAberta((a) => !a); }
        }
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
        <ComSaida aberto={!largo && arvoreAberta} className="motion-veu fixed inset-0 z-30">
          <button
            type="button"
            aria-label={t("arvore.fechar")}
            onClick={() => { setArvoreAberta(false); }}
            className="h-full w-full cursor-default bg-sunken/80"
          />
        </ComSaida>

        {largo ? (
          <>
            <ArvoreLateral
              recolhida={arvoreRecolhida}
              connections={connections}
              health={health}
              onEscolher={(id) => {
                // Abre a árvore já com a conexão expandida e a traz à vista.
                tree.expand(connectionNode(id));
                setArvoreRecolhida(false);
                requestAnimationFrame(() => {
                  document
                    .querySelector(`[data-icone-conexao="${id}"]`)
                    ?.closest("button")
                    ?.focus({ preventScroll: false });
                });
              }}
            >
              {arvore}
            </ArvoreLateral>
            {arvoreRecolhida ? null : (
              <Resizer
                largura={larguraArvore}
                onArrasto={(px) => { areaRef.current?.style.setProperty("--w-arvore", `${String(px)}px`); }}
                onFim={setLarguraArvore}
              />
            )}
          </>
        ) : (
          // Abaixo de 1024 px a árvore é gaveta sobreposta (translate nos dois
          // sentidos — já simétrica).
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-40 w-[min(19rem,85vw)] border-r border-line bg-surface transition-transform duration-(--motion-slow)",
              arvoreAberta ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {arvore}
          </aside>
        )}

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

          {/*
            A fronteira que mais importa.

            É aqui que o defeito de UMA aba deixa de ser a sessão inteira: a
            aba Diagrama derrubou o app em produção porque uma exceção em
            render desmonta a árvore toda. Com a fronteira, a barra de abas, a
            árvore e o cabeçalho continuam vivos — as outras abas não são nem
            tocadas, porque só a ativa está montada.

            `resetKey` é o id da aba: trocar de aba rearma. Sem isso, a
            fronteira ficaria presa no estado de erro e a aba seguinte, sadia,
            nasceria mostrando o painel de falha da anterior.
          */}
          <FronteiraDeErro variante="painel" resetKey={aba?.id ?? null}>
          {/*
            Troca de aba: crossfade de 180ms no container, que remonta com a
            chave da aba. Só opacidade no bloco inteiro — nenhuma linha do grid
            anima sozinha, a virtualização não percebe (regra 11).
          */}
          <div key={aba?.id ?? "vazio"} className="motion-fade flex min-h-0 min-w-0 flex-1 flex-col">
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
          ) : abaExport !== null ? (
            <ExportTabContent
              key={abaExport.id}
              connectionId={abaExport.connectionId}
              database={abaExport.database}
              postgres={connections.find((c) => c.id === abaExport.connectionId)?.engine === "postgres"}
            />
          ) : abaDiagrama !== null ? (
            <DiagramTabContent
              key={abaDiagrama.id}
              connectionId={abaDiagrama.connectionId}
              database={abaDiagrama.database}
              onOpenTable={(alvo) => { abrir(alvo); if (!largo) setArvoreAberta(false); }}
            />
          ) : aba?.kind === "compare" ? (
            <ComparadorTela
              key={`${aba.id}:${aba.connectionId}:${aba.schema}:${aba.table ?? ""}`}
              tab={aba}
              connections={connections}
              onAbrirSql={(connectionId, database, sql) => { novaConsulta(connectionId, database, sql); }}
            />
          ) : abaQuery !== null ? (
            <QueryTabContent
              key={abaQuery.id}
              tab={abaQuery}
              writeEnabled={conexaoAtiva?.writeEnabled === true}
              onOpenTableFiltered={abrirFiltrada}
              onAbrirSalva={abrirSalva}
              nomeConexao={nomeConexao}
              onSqlChange={(texto) => { setWs((a) => setQuerySql(a, abaQuery.id, texto)); }}
            />
          ) : abaTabela === null ? (
            <TelaVazia
              temConexoes={connections.length > 0}
              onNovaConsulta={
                conexaoPadrao(connections) === undefined
                  ? null
                  : () => { const c = conexaoPadrao(connections); if (c !== undefined) novaConsulta(c.id, c.database); }
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
              onOpenTableFiltered={abrirFiltrada}
              onSelectColumn={(nome) => { setWs((a) => selectColumn(a, abaTabela.id, nome)); }}
              inspectorOpen={visivel.inspectorOpen}
              onToggleInspector={() => { setWs(toggleInspector); }}
            />
          )}
          </div>
          </FronteiraDeErro>
        </main>

        {/*
          Estreito: o inspetor também sobrepõe, em vez de espremer o centro.

          Faltavam duas coisas que a árvore ao lado já tinha, e a diferença
          aparecia medida: ele começava em `y=0` e cobria a barra superior
          inteira — 304 de 375 px, levando junto o selo de escrita e o nome do
          banco ativo —, e não tinha *scrim*, então fechar exigia achar o ⇥
          dentro do próprio painel.
        */}
        <ComSaida aberto={!largo && visivel.inspectorOpen} className="motion-veu fixed inset-0 z-30">
          <button
            type="button"
            aria-label={t("inspetor.fechar")}
            onClick={() => { setWs(toggleInspector); }}
            className="h-full w-full cursor-default bg-sunken/80"
          />
        </ComSaida>

        <ComSaida
          aberto={visivel.inspectorOpen}
          className={cn(
            "motion-gaveta",
            largo
              ? "w-[280px] shrink-0"
              : "fixed bottom-0 right-0 top-[var(--h-topbar,49px)] z-40 w-[min(19rem,85vw)]",
          )}
        >
          <InspectorZone tab={abaTabela} onClose={() => { setWs(toggleInspector); }} />
        </ComSaida>
      </div>

      {/* Busca global Cmd+K / Ctrl+K (F8): o atalho vive no próprio componente. */}
      <PaletaBusca
        connections={connections}
        tree={tree}
        onOpenRelation={abrir}
        onBuscarValor={(() => {
          // Alvo da paleta: a conexão ativa se for Postgres, senão a primeira Postgres.
          const c = (conexaoAtiva?.engine === "postgres" ? conexaoAtiva : null) ?? connections.find((x) => x.engine === "postgres");
          if (c === undefined) return undefined;
          const db = c.id === alvoAtivo?.connectionId ? alvoAtivo.database : c.database;
          return () => { setBuscandoValor({ connectionId: c.id, database: db }); };
        })()}
      />

      {buscandoValor !== null ? (
        <BuscaValorDialog
          connections={connections}
          alvo={buscandoValor}
          onClose={() => { setBuscandoValor(null); }}
          onAbrirLinha={abrirFiltrada}
        />
      ) : null}

      {copiando !== null ? (
        <CopiarTabelaDialog
          connections={connections}
          origem={copiando}
          onClose={() => { setCopiando(null); }}
          onAbrirScript={(id, db, sql) => { novaConsulta(id, db, sql); }}
        />
      ) : null}

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
            onCreateTable: abrirCriarTabela,
            onCreateDatabase: abrirCriarDatabase,
            onOpenExport: abrirExport,
            onBuscarValor: (connectionId, database, schema) => {
              setBuscandoValor(schema === undefined ? { connectionId, database } : { connectionId, database, schema });
            },
            onCopiarTabela: setCopiando,
          }, t)}
          onClose={() => { setMenu(null); }}
        />
      ) : null}

      {criandoTabela !== null ? (
        <CreateTableDialog
          connectionId={criandoTabela.connectionId}
          database={criandoTabela.database}
          schema={criandoTabela.schema}
          dialeto={dialetoDe(connections.find((c) => c.id === criandoTabela.connectionId)?.engine ?? "postgres")}
          onClose={() => { setCriandoTabela(null); }}
        />
      ) : null}

      {criandoDatabase !== null ? (
        <CreateDatabaseDialog
          connectionId={criandoDatabase}
          dialeto={dialetoDe(connections.find((c) => c.id === criandoDatabase)?.engine ?? "postgres")}
          onClose={() => { setCriandoDatabase(null); }}
        />
      ) : null}

      {menuAba !== null ? (
        <ContextMenu
          anchor={menuAba.anchor}
          sections={[
            ...extrasDoMenuDeAba(visivel.tabs.find((x) => x.id === menuAba.id) ?? null, setWs, t),
            ...tabMenuSections(menuAba.id, visivel.tabs, setWs, t),
          ]}
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
                  label: t("arvore.novaConexao"),
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

/**
 * Itens de aba de tabela/consulta (F8): copiar link (ADR 020) e comparar
 * (ADR 018) partindo desta tabela como lado A. Query livre não tem link — só
 * query salva tem (ADR 020 §2); a aba de consulta não sabe se veio de uma.
 */
function extrasDoMenuDeAba(
  tab: Tab | null,
  setWs: (fn: (ws: Workspace) => Workspace) => void,
  t: Tradutor,
): MenuSection[] {
  if (tab?.kind !== "table") return [];
  const { target } = tab;
  const lado = { connectionId: target.connectionId, database: target.database, schema: target.schema };
  return [
    {
      items: [
        {
          id: "copy-link",
          label: t("links.copiar"),
          icon: <Link2 aria-hidden className="h-3.5 w-3.5" />,
          onSelect: () => {
            copiarLink(
              linkDeTabela({
                connectionId: target.connectionId,
                database: target.database,
                schema: target.schema,
                tabela: target.relation,
                ...(tab.initialFilters === undefined ? {} : { filtros: tab.initialFilters }),
                ordem: tab.initialSort ?? null,
              }),
              t,
            );
          },
        },
        {
          id: "compare-data",
          label: t("comparar.menuDados"),
          icon: <GitCompareArrows aria-hidden className="h-3.5 w-3.5" />,
          onSelect: () => { setWs((a) => openCompare(a, "data", { ...lado, table: target.relation })); },
        },
        {
          id: "compare-schema",
          label: t("comparar.menuSchema"),
          onSelect: () => { setWs((a) => openCompare(a, "schema", { ...lado, table: null })); },
        },
      ],
    },
  ];
}

/** Menu da aba: fechar, fechar as outras, fechar todas. */
function tabMenuSections(
  id: string,
  tabs: readonly { id: string }[],
  setWs: (fn: (ws: Workspace) => Workspace) => void,
  t: Tradutor,
): MenuSection[] {
  // `aba` e não `t`: o parâmetro do filtro sombreava o tradutor.
  const outras = tabs.filter((aba) => aba.id !== id);
  return [
    {
      items: [
        { id: "close", label: t("aba.fechar"), onSelect: () => { setWs((a) => closeTab(a, id)); } },
        {
          id: "close-others",
          label: t("aba.fecharOutras"),
          disabled: outras.length === 0,
          onSelect: () => {
            setWs((a) => outras.reduce((acc, t) => closeTab(acc, t.id), a));
          },
        },
        {
          id: "close-all",
          label: t("aba.fecharTodas"),
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
  arvoreVisivel,
}: {
  readonly target: TableTarget | null;
  /** O database ativo, venha ele de uma aba de tabela ou de query. */
  readonly database: string | null;
  readonly connection: Connection | null;
  /** Só existe no layout estreito, onde a árvore é sobreposição. */
  readonly onToggleTree: (() => void) | null;
  /** Estado da árvore, para o único controle de recolher/expandir. */
  readonly arvoreVisivel: boolean;
}) {
  const perigo = connection?.writeEnabled === true;
  const t = useT();

  /** Mede o cabeçalho e publica em `--h-topbar` para a gaveta se alinhar. */
  const medirAltura = useCallback((el: HTMLElement | null) => {
    if (el === null) return;
    const aplicar = (): void => {
      el.ownerDocument.documentElement.style.setProperty(
        "--h-topbar",
        `${String(Math.round(el.getBoundingClientRect().height))}px`,
      );
    };
    aplicar();
    const obs = new ResizeObserver(aplicar);
    obs.observe(el);
    return () => { obs.disconnect(); };
  }, []);

  return (
    <header
      /*
       * Publica a própria altura em `--h-topbar`.
       *
       * A gaveta do inspetor precisa começar **abaixo** do cabeçalho, e um
       * número fixo no CSS mentiria no dia em que o padding ou a fonte
       * mudassem. O `ResizeObserver` custa uma escrita por redimensionamento.
       */
      ref={medirAltura}
      className={cn(
        // `overflow-hidden` fica: os favos decorativos sangram de propósito
        // pelas bordas, e trocar por `auto` os tornaria conteúdo rolável.
        // Quem tinha de ceder era o lockup da marca — ver abaixo.
        "relative flex shrink-0 items-center gap-3 overflow-hidden border-b px-3 py-2",
        // Escrita habilitada é CAUTELA, não erro: uma faixa âmbar quente e suave,
        // não o vermelho de perigo (que fica reservado para o ato destrutivo —
        // confirmar um DELETE). O tom diz "cuidado, dá para gravar" sem alarme.
        perigo ? "border-accent-line bg-accent-soft" : "border-line bg-surface",
      )}
    >


      {onToggleTree !== null ? (
        // `shrink-0`: sem ele a hambúrguer era espremida a **16 px de largura**
        // entre 768 e 1023, e de novo abaixo de 375 quando o selo de escrita
        // aparece — justamente a faixa em que ela É a navegação.
        // Único controle de recolher/expandir (o trilho não tem botão próprio):
        // o ícone diz o que o clique vai fazer, e o atalho vem no título.
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          aria-label={arvoreVisivel ? t("arvore.recolher") : t("arvore.abrir")}
          aria-expanded={arvoreVisivel}
          title={`${arvoreVisivel ? t("arvore.recolher") : t("arvore.abrir")} (Ctrl+B)`}
          onClick={onToggleTree}
        >
          <span className="relative h-4 w-4">
            <PanelLeftClose aria-hidden data-ativo={arvoreVisivel ? "" : undefined} className="motion-troca absolute inset-0 h-4 w-4" />
            <PanelLeftOpen aria-hidden data-ativo={arvoreVisivel ? undefined : ""} className="motion-troca absolute inset-0 h-4 w-4" />
          </span>
        </Button>
      ) : null}

      {/*
        O lockup é quem cede.

        Era `shrink-0`, e a 320 px empurrava os botões de contas e de sair para
        fora de um cabeçalho `overflow-hidden` — permanentemente inalcançáveis,
        sem outro caminho para sair da conta. O ícone identifica a marca
        sozinho; o wordmark volta a partir de `sm`.
      */}
      <div className="relative flex min-w-0 items-center gap-2.5">
        {/* Ícone maior, com um leve halo âmbar para ganhar presença sem virar
            enfeite — a marca é a âncora do cabeçalho, não mais um controle. */}
        <Marca zumbe className="h-8 w-8 drop-shadow-[0_1px_5px_rgba(245,166,35,0.28)]" />
        {/* Mesma marca do login: "Bee" em âmbar, distinção só de cor. Tipo
            próprio (Space Grotesk) só no lockup — ver `.font-marca`. */}
        <span className="hidden font-marca text-xl font-bold leading-none tracking-[-0.03em] sm:inline">
          <span className="text-ink">D</span>
          <span className="text-accent">Bee</span>
        </span>
      </div>

      {/* Breadcrumb some no mobile: a barra de abas já nomeia a tabela aberta,
          e aqui ele disputava espaço com a marca e o selo de escrita, forçando
          o lockup a cortar. Volta a partir de `md`, onde há largura. */}
      {connection !== null && database !== null ? (
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <span aria-hidden className="text-subtle">/</span>
          {connection.color !== null ? (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: connection.color }}
            />
          ) : null}
          <span className="truncate text-xs text-ink">{connection.name}</span>
          <SeloAmbiente environment={connection.environment} />
          <span className="truncate font-mono text-xs text-muted">
            {/*
              Nas engines sem nível de schema (MySQL, MariaDB, libSQL) o schema
              É o database — o catálogo repete o nome para a API manter a forma.
              Mostrar `main.main.artista` ou `loja.loja.peca` é o breadcrumb
              afirmando um nível que a árvore não tem. Colapsa quando os dois
              coincidem: `database.relação`.
            */}
            {target === null
              ? database
              : target.schema === database
                ? `${database}.${target.relation}`
                : `${database}.${target.schema}.${target.relation}`}
          </span>
        </div>
      ) : null}

      {/* Selo de escrita canônico (design-system §313): âmbar sólido com texto
          escuro. Quente e claro, sem o vermelho de perigo — o cadeado aberto diz
          "dá para gravar", o âmbar diz "com cuidado". */}
      {perigo ? (
        // No mobile encolhe para só o cadeado (rótulo por aria-label), senão o
        // selo empurrava a marca para fora. O texto volta a partir de `sm`.
        <span
          aria-label={t("conexao.escritaHabilitada")}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-amber px-2 py-1 text-2xs font-semibold text-accent-ink sm:px-2.5"
        >
          <Unlock aria-hidden className="h-3 w-3" />
          <span className="hidden sm:inline">{t("conexao.escritaHabilitada")}</span>
        </span>
      ) : null}

      <div className={cn("relative flex shrink-0 items-center gap-1", perigo ? "" : "ml-auto")}>
        <VersaoChip />
        <UpdateBadge />
        <IdiomaToggle />
        <ThemeToggle />
        {/* Administração de contas — só para admin, e só por conveniência: o
            controle é o `exigirAdmin` no servidor. */}
        <UsuariosBotao />
        {/* Tokens do MCP (ADR 015) — cada conta gerencia os seus. */}
        <TokensBotao />
        {/* Estado da VPN do servidor (ADR 014) — some quando não há VPN. */}
        <VpnBotao />
        {/* Quem está logado é o `actor` do query_log — informação, não perfil. */}
        <UserChip />
      </div>
      <BarraDeAtividade />
    </header>
  );
}

/**
 * Traço de 2px na base do cabeçalho enquanto o app espera algo que ainda não
 * está na tela: primeira carga de uma query, ou uma mutação (executar SQL,
 * salvar linha, testar conexão). Refetch em segundo plano (VPN a cada 15 s,
 * atividade) **não** conta — barra que pisca sozinha vira ruído e o olho para
 * de acreditar nela. Cor `muted`, não âmbar: âmbar é modo escrita.
 */
function BarraDeAtividade() {
  const buscando = useIsFetching({ predicate: (q) => q.state.data === undefined });
  const mutando = useIsMutating();
  const ocupado = buscando + mutando > 0;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity duration-(--motion-base)",
        // Atraso na entrada: espera de menos de 120ms não merece aviso.
        ocupado ? "opacity-100 delay-(--motion-fast)" : "opacity-0",
      )}
    >
      {ocupado ? <div className="animate-progresso h-full w-1/2 bg-muted" /> : null}
    </div>
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
        const passo = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") onFim(Math.max(LARGURA_MIN, largura - passo));
        if (e.key === "ArrowRight") onFim(Math.min(LARGURA_MAX, largura + passo));
      }}
      // Duplo-clique volta à largura padrão — a saída de um arrasto ruim.
      onDoubleClick={() => { onFim(LARGURA_PADRAO); }}
      // `info`, não âmbar: arrastar um divisor não é escrita (§1.4).
      className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors duration-(--motion-fast) hover:bg-info/40 focus-visible:bg-info/60 focus-visible:outline-none"
    />
  );
}

const LARGURA_PADRAO = 260;


function TableTabContent({
  tab,
  danger,
  onConsultar,
  onView,
  onOpenTable,
  onOpenTableFiltered,
  onSelectColumn,
  inspectorOpen,
  onToggleInspector,
}: {
  readonly tab: TableTab;
  readonly danger: boolean;
  readonly onConsultar: () => void;
  readonly onView: (view: TableView) => void;
  readonly onOpenTable: (target: TableTarget) => void;
  readonly onOpenTableFiltered: (target: TableTarget, filters: readonly RowFilter[]) => void;
  readonly onSelectColumn: (name: string) => void;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
}) {
  const t = useT();
  const { connectionId, database, schema, relation } = tab.target;
  const arvore = useSchema(connectionId, database, true);
  // A aba Diagrama não existe nas engines sem ERD (Mongo: sem schema, sem FK).
  const conexoesAba = useConnections();
  const engineDaAba = conexoesAba.data?.find((c) => c.id === connectionId)?.engine ?? "postgres";
  const semDiagrama = capacidadesDe(engineDaAba)?.diagramaErd === false;
  const permiteConsulta = capacidadesDe(engineDaAba)?.sqlLivre !== false;
  const exportavel = capacidadesDe(engineDaAba)?.exportar === true;
  const redisEstruturado = engineDaAba === "redis";
  const mongoDocumento = engineDaAba === "mongodb";

  const rel =
    arvore.data?.schemas.find((s) => s.name === schema)?.relations.find((r) => r.name === relation) ??
    null;

  const counts = { columns: rel?.columns.length ?? 0, indexes: rel?.indexes.length ?? 0 };
  const inspetorBtn = (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7 shrink-0"
      aria-label={inspectorOpen ? t("inspetor.fechar") : t("inspetor.abrir")}
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
    <SubTabs value={tab.view} onChange={onView} counts={counts} trailing={inspetorBtn} semDiagrama={semDiagrama} />
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", danger && "border-l-2 border-l-accent")}>
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
              onOpenReference={(fk) => {
                onOpenTable({
                  connectionId,
                  database,
                  schema: fk.referencedSchema,
                  relation: fk.referencedTable,
                  kind: "table",
                });
              }}
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
          permiteConsulta={permiteConsulta}
          exportavel={exportavel}
          redisEstruturado={redisEstruturado}
          mongoDocumento={mongoDocumento}
          estimatedRows={rel.estimatedRows}
          writeEnabled={danger}
          colunasSchema={rel.columns}
          foreignKeys={rel.foreignKeys}
          onOpenTableFiltered={onOpenTableFiltered}
          {...(tab.initialFilters !== undefined ? { initialFilters: tab.initialFilters } : {})}
          {...(tab.initialSort !== undefined ? { initialSort: tab.initialSort } : {})}
          leading={<SubTabButtons value={tab.view} onChange={onView} counts={counts} semDiagrama={semDiagrama} />}
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

/**
 * Alvo de "nova consulta" sem aba ativa: a primeira conexão **em leitura**.
 * Cair numa conexão gravável por atalho, sem ter escolhido, é o acidente que
 * a tarja âmbar existe para evitar (DBee.md §2.1).
 */
function conexaoPadrao(connections: readonly Connection[]): Connection | undefined {
  return connections.find((c) => !c.writeEnabled) ?? connections[0];
}

function TelaVazia({
  temConexoes,
  onNovaConsulta,
}: {
  readonly temConexoes: boolean;
  readonly onNovaConsulta: (() => void) | null;
}) {
  const t = useT();
  /*
   * Vazio do miolo (ui-detalhes §3.7, F6): título único + atalhos REAIS.
   * Sem mascote — ele aparecia a cada vez que a última aba fechava, e numa
   * tela de trabalho isso vira insistência. Os três atalhos funcionam daqui:
   * Ctrl+T cai na primeira conexão quando não há aba ativa, Ctrl+K é a
   * paleta de busca, Ctrl+B a árvore. Sem conexão nenhum deles tem alvo,
   * então só a frase de cadastro aparece — ensinar atalho morto é pior.
   */
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";
  const atalhos: readonly (readonly [string, string])[] = [
    [t("estados.atalhoConsulta"), "T"],
    [t("estados.atalhoBusca"), "K"],
    [t("estados.atalhoArvore"), "B"],
  ];
  return (
    <div className="motion-fade flex h-full min-h-0 items-center justify-center overflow-hidden">
      <div className="mx-auto w-full max-w-xs px-6 text-center">
        <h2 className="text-base font-medium text-ink">
          {temConexoes ? t("estados.vazioTitulo") : t("vazio.semConexao")}
        </h2>
        {temConexoes ? (
          <dl className="mt-4 grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 text-left text-xs">
            {atalhos.map(([rotulo, tecla]) => (
              <div key={tecla} className="contents">
                <dt className="text-muted">{rotulo}</dt>
                <dd className="flex justify-end gap-1">
                  <kbd className="rounded-[4px] border border-line bg-raised px-1.5 py-0.5 font-sans text-2xs text-ink">{mod}</kbd>
                  <kbd className="rounded-[4px] border border-line bg-raised px-1.5 py-0.5 font-sans text-2xs text-ink">{tecla}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-muted">{t("vazio.dicaSemConexao")}</p>
        )}
        {temConexoes && onNovaConsulta !== null ? (
          <Button variant="secondary" size="sm" className="mt-5" onClick={onNovaConsulta}>
            <Code2 aria-hidden className="h-3.5 w-3.5" />
            {t("aba.novaConsulta")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Árvore lateral em ≥1024 px: UMA superfície que encolhe para o trilho e
 * cresce de volta (docs/ui-detalhes.md §3.2).
 *
 * - O contêiner de layout troca de largura em UM passo: no início ao abrir,
 *   no fim ao fechar (`transitionend` do recorte). O grid reflui uma vez.
 * - A superfície visível tem sempre a largura cheia e anima `clip-path`
 *   (recorte, não escala: texto não distorce). A borda direita é um traço que
 *   anda junto com o recorte — nunca duas bordas, nunca dois fundos.
 * - Conteúdo cruzado: o texto da árvore sai nos primeiros 40 % do fechamento;
 *   os ícones do trilho entram nos últimos 40 %, desenhados na MESMA posição
 *   (x e y medidos) dos ícones de conexão da árvore aberta — são "os mesmos
 *   objetos que ficam". Na abertura, o inverso.
 * - Peek: com a árvore recolhida, passar o ponteiro (300 ms) ou focar o
 *   trilho abre a mesma superfície por cima do grid, sem mexer no layout.
 * - Reduced-motion: tudo instantâneo (duração e atrasos zerados no CSS).
 */
function ArvoreLateral({
  recolhida,
  connections,
  health,
  onEscolher,
  children,
}: {
  readonly recolhida: boolean;
  readonly connections: readonly Connection[];
  readonly health: Readonly<Record<string, ConnectionHealth>>;
  /** Clique num ícone do trilho: abre a árvore com a conexão expandida. */
  readonly onEscolher: (id: string) => void;
  readonly children: ReactNode;
}) {
  const t = useT();
  const superficie = useRef<HTMLDivElement>(null);
  const [layoutRecolhido, setLayoutRecolhido] = useState(recolhida);
  if (!recolhida && layoutRecolhido) setLayoutRecolhido(false);
  const [peek, setPeek] = useState(false);
  if (!recolhida && peek) setPeek(false);
  /*
   * O estado VISUAL anda um quadro atrás do pedido: primeiro mede onde estão
   * os ícones na árvore e pinta o trilho nesse deslocamento (invisível);
   * no quadro seguinte troca o estado e a transição leva cada ícone até a
   * posição compacta (FLIP). Trocar no mesmo quadro não animaria: o navegador
   * nunca veria o ponto de partida.
   */
  const [fechadoVisual, setFechadoVisual] = useState(recolhida);
  const fechado = fechadoVisual && !peek;
  const [flip, setFlip] = useState<Record<string, { x: number; y: number }>>({});
  const compacto = posicoesDoTrilho(connections.length);

  useLayoutEffect(() => {
    const el = superficie.current;
    if (el === null) return;
    const base = el.getBoundingClientRect();
    const naArvore: Record<string, { x: number; y: number }> = {};
    el.querySelectorAll<HTMLElement>("[data-icone-conexao]").forEach((i) => {
      const id = i.dataset["iconeConexao"];
      const r = i.getBoundingClientRect();
      if (id === undefined || r.height === 0 || r.bottom < base.top || r.top > base.bottom) return;
      naArvore[id] = { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
    });
    const pos = posicoesDoTrilho(connections.length);
    setFlip(Object.fromEntries(connections.map((c, k) => [c.id, deslocamentoFlip(naArvore[c.id], pos[k] ?? { x: 0, y: 0 })])));
    const quadro = requestAnimationFrame(() => {
      requestAnimationFrame(() => { setFechadoVisual(recolhida); });
    });
    return () => { cancelAnimationFrame(quadro); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recolhida]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agendar = (aberto: boolean, ms: number): void => {
    if (!recolhida) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setPeek(aberto); }, ms);
  };
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  return (
    <aside
      className="relative z-30 shrink-0"
      style={{
        width: layoutRecolhido ? LARGURA_TRILHO : "var(--w-arvore)",
        ["--w-trilho" as string]: `${String(LARGURA_TRILHO)}px`,
      }}
      onMouseEnter={() => { agendar(true, 300); }}
      onMouseLeave={() => { agendar(false, 200); }}
      onKeyDown={(e) => { if (e.key === "Escape") setPeek(false); }}
    >
      <div
        ref={superficie}
        data-fechado={fechado ? "" : undefined}
        onTransitionEnd={(e) => {
          if (e.target !== e.currentTarget || e.propertyName !== "clip-path") return;
          if (recolhida && !peek) setLayoutRecolhido(true);
        }}
        className="arvore-superficie absolute inset-y-0 left-0 w-(--w-arvore) bg-surface"
      >
        <div className="arvore-conteudo h-full pr-px">{children}</div>
        <nav aria-label={t("arvore.trilho")} aria-hidden={!fechado} className="arvore-trilho absolute inset-0">
          {connections.map((c, k) => {
            const p = compacto[k] ?? { x: 0, y: 0 };
            const d = flip[c.id] ?? { x: 0, y: 0 };
            const saude = health[c.id] ?? "untested";
            return (
              <button
                key={c.id}
                type="button"
                tabIndex={fechado ? 0 : -1}
                title={c.name}
                aria-label={c.name}
                onClick={() => { onEscolher(c.id); }}
                style={{
                  left: p.x,
                  top: p.y,
                  ["--dx" as string]: `${String(d.x)}px`,
                  ["--dy" as string]: `${String(d.y)}px`,
                }}
                className="absolute flex h-7 w-7 cursor-pointer items-center justify-center rounded-[6px] text-muted transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:bg-raised"
              >
                <IconeEngine engine={c.engine} className="h-3.5 w-3.5" />
                {/* Saúde no canto inferior esquerdo; escrita no superior direito. */}
                {saude === "ok" || saude === "error" ? (
                  <span
                    aria-hidden
                    className={cn("absolute bottom-0.5 left-0.5 h-1.5 w-1.5 rounded-full", saude === "ok" ? "bg-ok" : "bg-danger")}
                  />
                ) : null}
                {c.writeEnabled ? (
                  <span aria-hidden className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber" />
                ) : null}
              </button>
            );
          })}
        </nav>
        <div aria-hidden className="arvore-borda absolute inset-y-0 left-0 w-px bg-line" />
      </div>
    </aside>
  );
}
