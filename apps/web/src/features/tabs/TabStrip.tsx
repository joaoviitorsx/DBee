import type { Connection } from "@dbee/shared";
import { Activity, Code2, Database, Eye, Layers, Plus, ScrollText, Share2, Table2, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { useT } from "../../i18n";
import { isDangerous, tabTitle, type Tab } from "../../app/workspace";

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
  if (tabs.length === 0) return null;

  return (
    <div role="tablist" className="flex shrink-0 items-stretch overflow-x-auto border-b border-line bg-sunken">
      {tabs.map((tab) => {
        const ativa = tab.id === activeTabId;
        const perigo = isDangerous(tab, connections);
        const Icon =
          tab.kind === "table"
            ? ICON[tab.target.kind]
            : tab.kind === "diagram"
              ? Share2
              : tab.kind === "overview"
                ? Database
                : tab.kind === "activity"
                  ? Activity
                  : tab.kind === "audit"
                    ? ScrollText
                    : Code2;

        return (
          <div
            key={tab.id}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(tab.id, { x: e.clientX, y: e.clientY }); }}
            className={cn(
              // Faixa superior de 2px sempre presente (transparente quando
              // inativa) para a aba não pular quando ganha a cor.
              "group/tab flex shrink-0 items-center gap-1.5 border-r border-t-2 border-t-transparent border-line pl-3 pr-1.5 transition-colors duration-150",
              // Aba ativa assume a cor da marca: topo âmbar e leito `accent-soft`.
              // Perigo (conexão gravável) vence o âmbar — vermelho é o sinal
              // mais forte e não pode ser diluído pela cor de marca.
              perigo
                ? cn("border-t-danger", ativa && "bg-danger-surface")
                : ativa
                  ? "border-t-accent bg-accent-soft"
                  : "hover:bg-accent-soft/50",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => { onFocus(tab.id); }}
              className="flex cursor-pointer items-center gap-1.5 py-2"
            >
              <Icon
                aria-hidden
                className={cn("h-3.5 w-3.5", perigo ? "text-danger-ink" : "text-subtle")}
              />
              <span
                className={cn(
                  "max-w-[16rem] truncate font-mono text-xs",
                  ativa ? "text-ink" : "text-muted",
                )}
              >
                {tabTitle(tab, t)}
              </span>
            </button>
            <button
              type="button"
              aria-label={`${t("comum.fechar")} ${tabTitle(tab, t)}`}
              onClick={() => { onClose(tab.id); }}
              className={cn(
                "cursor-pointer rounded p-0.5 text-subtle transition-opacity duration-150 hover:text-ink",
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
          className="flex shrink-0 cursor-pointer items-center px-3 text-subtle transition-colors duration-150 hover:text-ink"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
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
}: {
  readonly value: TableView;
  readonly onChange: (view: TableView) => void;
  readonly counts: { readonly columns: number; readonly indexes: number };
  /** Ações da vista atual — Consultar, filtro, export — na mesma barra. */
  readonly trailing?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line pl-3 pr-2">
      <SubTabButtons value={value} onChange={onChange} counts={counts} />
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
}: {
  readonly value: TableView;
  readonly onChange: (view: TableView) => void;
  readonly counts: { readonly columns: number; readonly indexes: number };
}) {
  const t = useT();
  const itens = [
    { id: "data", label: t("aba.dados"), badge: null },
    { id: "structure", label: t("aba.estrutura"), badge: counts.columns },
    { id: "indexes", label: t("aba.indices"), badge: counts.indexes },
    { id: "diagram", label: t("aba.diagrama"), badge: null },
  ] as const;

  return (
    <div role="tablist" className="flex shrink-0 items-center gap-1">
      {itens.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => { onChange(item.id); }}
          className={cn(
            "-mb-px cursor-pointer rounded-t-[4px] border-b-2 px-2.5 py-2 text-xs transition-colors duration-150",
            value === item.id
              ? "border-accent bg-accent-soft text-ink"
              : "border-transparent text-muted hover:bg-accent-soft/50 hover:text-ink",
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
