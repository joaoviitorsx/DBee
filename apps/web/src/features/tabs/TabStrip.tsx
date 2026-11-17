import type { Connection } from "@dbee/shared";
import { Activity, ChevronDown, Download, Code2, GitCompareArrows, Database, Eye, Layers, Plus, ScrollText, Share2, Table2, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { PopoverAncorado } from "../../components/PopoverAncorado";
import { filtrarAbas } from "./listaAbas.puro";

import { cn } from "../../lib/cn";
import { useIndicador } from "../../lib/useIndicador";
import { useT } from "../../i18n";
import { isDangerous, tabConnectionId, tabTitle, type Tab } from "../../app/workspace";
import { SeloAmbiente } from "../ambiente/SeloAmbiente";

const ICON = {
  table: Table2,
  partitioned_table: Table2,
  foreign_table: Table2,
  view: Eye,
  materialized_view: Layers,
} as const;

/**
 * Barra de abas — tabela e query convivem na mesma faixa.
 *
 * A aba de query ainda não é criada por nenhum caminho; o tipo já é tratado
 * aqui para o executor entrar sem redesenhar a barra.
 *
 * Aba sobre conexão gravável herda a tarja de perigo: o alerta é da conexão,
 * não da árvore, então ele acompanha o usuário para onde ele for.
 */
export function TabStrip({
  tabs,
  activeTabId,
  connections,
  onFocus,
  onClose,
  onContextMenu,
  onNew,
}: {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string | null;
  readonly connections: readonly Connection[];
  readonly onFocus: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onContextMenu: (id: string, anchor: { x: number; y: number }) => void;
  /** `undefined` quando não há alvo — sem conexão ativa não há onde consultar. */
  readonly onNew?: (() => void) | undefined;
}) {
  const t = useT();
  const fila = useRef<HTMLDivElement>(null);
  const indicador = useRef<HTMLDivElement>(null);
  const botaoLista = useRef<HTMLButtonElement>(null);
  useIndicador(fila, indicador, `${activeTabId ?? ""}:${String(tabs.length)}`);
  const transborda = useTransborda(fila, tabs.length);
  const [lista, setLista] = useState<DOMRect | null>(null);

  // Ctrl+Shift+A abre a lista de abas (I6), haja transbordo ou não.
  const temAbas = tabs.length > 0;
  useEffect(() => {
    if (!temAbas) return;
    const tecla = (e: globalThis.KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "a") return;
      e.preventDefault();
      const r = (botaoLista.current ?? fila.current)?.getBoundingClientRect();
      if (r === undefined) return;
      setLista((l) => (l === null ? new DOMRect(Math.max(8, r.right - 320), r.top, 320, r.height) : null));
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); };
  }, [temAbas]);

  if (tabs.length === 0) return null;
  const ativaPerigosa = tabs.some((x) => x.id === activeTabId && isDangerous(x, connections));

  return (
    <div className="flex shrink-0 items-stretch border-b border-line bg-sunken">
    <div
      ref={fila}
      role="tablist"
      className="fila-rolavel relative flex min-w-0 flex-1 items-stretch overflow-x-auto"
    >
      {/*
        Indicador único, deslizando entre abas (ui-detalhes §3.3). Tinta neutra;
        âmbar só quando a aba ativa está em modo escrita (§1.4).
      */}
      <div
        ref={indicador}
        aria-hidden
        className={cn("indicador-aba top-0 z-10", ativaPerigosa ? "bg-accent" : "bg-ink")}
      />
      {tabs.map((tab) => {
        const ativa = tab.id === activeTabId;
        const perigo = isDangerous(tab, connections);
        const Icon =
          tab.kind === "table"
            ? ICON[tab.target.kind]
            : tab.kind === "diagram"
              ? Share2
              : tab.kind === "export"
                ? Download
                : tab.kind === "overview"
                  ? Database
                  : tab.kind === "activity"
                    ? Activity
                    : tab.kind === "audit"
                      ? ScrollText
                      : tab.kind === "compare"
                        ? GitCompareArrows
                        : Code2;

        return (
          <div
            key={tab.id}
            data-aba
            // Aba nova entra curta; as que já existiam não se mexem.
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(tab.id, { x: e.clientX, y: e.clientY }); }}
            className={cn(
              // Faixa superior de 2px sempre presente (transparente quando
              // inativa) para a aba não pular quando ganha a cor.
              "motion-pop group/tab flex shrink-0 items-center gap-1.5 border-r border-t-2 border-t-transparent border-line pl-3 pr-1.5 transition-colors duration-(--motion-fast)",
              /*
               * Escrita habilitada é **âmbar**, igual à barra superior e à
               * árvore — não vermelho.
               *
               * Esta aba era a última peça na doutrina antiga ("vermelho vence
               * o âmbar"), e o resultado era a mesma tela afirmando o mesmo
               * estado em duas famílias de cor a 20 px de distância: barra
               * âmbar, aba vermelha. Pior, o `danger-surface` tinha três donos
               * na mesma vista — a aba, a faixa de "sem chave primária" logo
               * abaixo, e o texto de erro de conexão na árvore ao lado —, e
               * dois blocos vermelhos encostados leem como um alerta só.
               *
               * Vermelho fica reservado ao **ato destrutivo** (design-system
               * §1.4): confirmar um DELETE. Escrita habilitada é cautela.
               */
              // A barra de cima de aba ativa agora é o indicador deslizante; a
              // inativa em escrita mantém o filete âmbar fraco como lembrete.
              perigo
                ? cn(!ativa && "border-t-accent-line", ativa && "bg-accent-soft")
                : ativa
                  ? "bg-surface"
                  : "hover:bg-raised",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => { onFocus(tab.id); }}
              className="press flex cursor-pointer items-center gap-1.5 py-2"
            >
              <Icon
                aria-hidden
                className={cn("h-3.5 w-3.5", perigo ? "text-accent" : "text-subtle")}
              />
              <span
                className={cn(
                  "max-w-[16rem] truncate font-mono text-xs",
                  ativa ? "text-ink" : "text-muted",
                )}
              >
                {tabTitle(tab, t)}
              </span>
              {/* Selo de ambiente (ADR 022); comparar lê duas conexões, sem selo. */}
              {tab.kind === "compare" ? null : (
                <SeloAmbiente compacto environment={connections.find((c) => c.id === tabConnectionId(tab))?.environment} />
              )}
            </button>
            <button
              type="button"
              aria-label={`${t("comum.fechar")} ${tabTitle(tab, t)}`}
              onClick={() => { onClose(tab.id); }}
              className={cn(
                "press cursor-pointer rounded p-0.5 text-subtle hover:text-ink",
                ativa ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
              )}
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {onNew === undefined ? null : (
        <button
          type="button"
          onClick={onNew}
          aria-label={t("aba.novaConsulta")}
          title={t("aba.novaConsultaAtalho")}
          className="press flex shrink-0 cursor-pointer items-center px-3 text-subtle transition-colors duration-(--motion-fast) hover:text-ink"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
      {transborda ? (
        <button
          ref={botaoLista}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={lista !== null}
          aria-label={t("abas.lista")}
          title={t("abas.listaAtalho")}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setLista((l) => (l === null ? r : null)); }}
          className="press flex shrink-0 cursor-pointer items-center gap-1 border-l border-line px-2.5 text-xs text-subtle transition-colors duration-(--motion-fast) hover:text-ink"
        >
          <span className="tabular-nums">{tabs.length}</span>
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {lista !== null ? (
        <ListaAbas
          ancora={lista}
          tabs={tabs}
          activeTabId={activeTabId}
          connections={connections}
          onEscolher={(id) => { setLista(null); onFocus(id); }}
          onFechar={() => { setLista(null); }}
        />
      ) : null}
    </div>
  );
}

/** A fila rola para o lado? Recalcula ao redimensionar e quando o número de abas muda. */
function useTransborda(fila: React.RefObject<HTMLDivElement | null>, n: number): boolean {
  const [sim, setSim] = useState(false);
  useEffect(() => {
    const el = fila.current;
    if (el === null) return;
    const medir = (): void => { setSim(el.scrollWidth > el.clientWidth + 1); };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [fila, n]);
  return sim;
}

/**
 * Lista de todas as abas com filtro (ideia I6, DBeaver #7114). Mostra o título,
 * a conexão e o tipo — duas "Consulta 3" em conexões diferentes precisam ser
 * distinguíveis. Setas + Enter, como a paleta Ctrl+K.
 */
function ListaAbas({
  ancora,
  tabs,
  activeTabId,
  connections,
  onEscolher,
  onFechar,
}: {
  readonly ancora: DOMRect;
  readonly tabs: readonly Tab[];
  readonly activeTabId: string | null;
  readonly connections: readonly Connection[];
  readonly onEscolher: (id: string) => void;
  readonly onFechar: () => void;
}) {
  const t = useT();
  const [texto, setTexto] = useState("");
  const [atual, setAtual] = useState(0);
  const linhas = tabs.map((tab) => ({
    tab,
    titulo: tabTitle(tab, t),
    conexao: connections.find((c) => c.id === conexaoDaAba(tab))?.name ?? "",
    tipo: t(`abas.tipo.${tab.kind}`),
  }));
  const visiveis = filtrarAbas(linhas, texto);
  const teclar = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = visiveis.length;
      if (n > 0) setAtual((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      const l = visiveis[atual];
      if (l !== undefined) { e.preventDefault(); onEscolher(l.tab.id); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
    }
  };
  return (
    <PopoverAncorado aberto ancora={ancora} onFora={onFechar} rotulo={t("abas.lista")} className="w-[min(22rem,calc(100vw-1rem))]">
      <input
        autoFocus
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setAtual(0); }}
        onKeyDown={teclar}
        placeholder={t("abas.filtrar")}
        aria-label={t("abas.filtrar")}
        className="h-10 shrink-0 border-b border-line bg-transparent px-3 text-sm text-ink placeholder:text-subtle focus:outline-none"
      />
      <ul role="listbox" aria-label={t("abas.lista")} className="min-h-0 flex-1 overflow-y-auto py-1">
        {visiveis.length === 0 ? <li className="px-3 py-3 text-center text-xs text-subtle">{t("abas.nada")}</li> : null}
        {visiveis.map((l, i) => {
          const perigo = isDangerous(l.tab, connections);
          return (
            <li
              key={l.tab.id}
              role="option"
              aria-selected={i === atual}
              onMouseMove={() => { if (i !== atual) setAtual(i); }}
              onClick={() => { onEscolher(l.tab.id); }}
              className={cn("mx-1 flex cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-1.5", i === atual && "bg-raised")}
            >
              <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", l.tab.id === activeTabId ? "text-ink" : "text-muted")}>{l.titulo}</span>
              <span className={cn("max-w-[45%] shrink-0 truncate text-2xs", perigo ? "text-accent" : "text-subtle")}>
                {l.conexao === "" ? l.tipo : `${l.conexao} · ${l.tipo}`}
              </span>
            </li>
          );
        })}
      </ul>
    </PopoverAncorado>
  );
}

function conexaoDaAba(tab: Tab): string {
  return tab.kind === "table" ? tab.target.connectionId : tab.connectionId;
}

/** Sub-abas da aba de tabela. */
type TableView = "data" | "structure" | "indexes" | "diagram";

/**
 * Sub-abas de uma tabela, numa **barra única** com as ações da vista à direita.
 *
 * Antes as sub-abas e a barra de "Consultar" eram dois contêineres empilhados,
 * cada um com sua borda inferior — dois filetes quase colados, dividindo o que é
 * um cabeçalho só. Agora as sub-abas ficam à esquerda e as ações da vista
 * (`trailing`) à direita, na mesma linha, com uma borda só.
 */
export function SubTabs({
  value,
  onChange,
  counts,
  trailing,
  semDiagrama = false,
}: {
  readonly value: TableView;
  readonly onChange: (view: TableView) => void;
  readonly counts: { readonly columns: number; readonly indexes: number };
  /** Ações da vista atual — Consultar, filtro, export — na mesma barra. */
  readonly trailing?: ReactNode;
  /** Esconde a aba Diagrama nas engines sem ERD (Mongo). */
  readonly semDiagrama?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line pl-3 pr-2">
      <SubTabButtons value={value} onChange={onChange} counts={counts} semDiagrama={semDiagrama} />
      {trailing !== undefined ? (
        <div className="ml-auto flex min-w-0 items-center gap-2 py-1.5">{trailing}</div>
      ) : null}
    </div>
  );
}

/**
 * Só os botões das sub-abas, sem barra nem borda.
 *
 * Extraído para a aba Dados poder montá-los **dentro da própria toolbar** — as
 * sub-abas à esquerda, Consultar/filtro/export à direita, uma linha só. Sem
 * isto, sub-abas e toolbar eram dois contêineres com duas bordas.
 */
export function SubTabButtons({
  value,
  onChange,
  counts,
  semDiagrama = false,
}: {
  readonly value: TableView;
  readonly onChange: (view: TableView) => void;
  readonly counts: { readonly columns: number; readonly indexes: number };
  /** Esconde a aba Diagrama nas engines sem ERD (Mongo: sem schema, sem FK). */
  readonly semDiagrama?: boolean;
}) {
  const t = useT();
  const itens = (
    [
      { id: "data", label: t("aba.dados"), badge: null },
      { id: "structure", label: t("aba.estrutura"), badge: counts.columns },
      { id: "indexes", label: t("aba.indices"), badge: counts.indexes },
      { id: "diagram", label: t("aba.diagrama"), badge: null },
    ] as const
  ).filter((i) => !(semDiagrama && i.id === "diagram"));
  const fila = useRef<HTMLDivElement>(null);
  const indicador = useRef<HTMLDivElement>(null);
  useIndicador(fila, indicador, `${value}:${String(itens.length)}`);

  /*
   * `overflow-x-auto` em vez de `shrink-0`: a 320 px a fila de sub-abas
   * estourava a viewport e empurrava "Abrir inspetor" 50 px para fora, levando
   * a página junto. Depende do idioma — em português estoura, em inglês passa
   * raspando —, e o português é o padrão do produto.
   */
  // Setas movem entre sub-abas (padrão `tablist`), com ativação automática.
  const mover = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = itens.findIndex((x) => x.id === value);
    const n = itens.length;
    const alvo =
      e.key === "ArrowRight" ? itens[(i + 1) % n]
      : e.key === "ArrowLeft" ? itens[(i - 1 + n) % n]
      : e.key === "Home" ? itens[0]
      : e.key === "End" ? itens[n - 1]
      : undefined;
    if (alvo === undefined) return;
    e.preventDefault();
    onChange(alvo.id);
    requestAnimationFrame(() => {
      fila.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    });
  };

  return (
    <div ref={fila} role="tablist" onKeyDown={mover} className="relative flex min-w-0 items-center gap-1 overflow-x-auto">
      <div ref={indicador} aria-hidden className="indicador-aba bottom-0 bg-ink" />
      {itens.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => { onChange(item.id); }}
          className={cn(
            "cursor-pointer rounded-t-[4px] px-2.5 py-2 text-xs transition-colors duration-(--motion-fast)",
            value === item.id
              ? "bg-raised text-ink"
              : "text-muted hover:bg-raised/60 hover:text-ink",
          )}
        >
          {item.label}
          {item.badge !== null ? (
            <span className="ml-1.5 text-2xs text-subtle">{item.badge}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
