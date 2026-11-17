import type { Connection, DatabaseTree, RelationKind, RelationTree , ConnectionWarning } from "@dbee/shared";
import {
  ChevronRight,
  Database,
  Eye,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useMemo, type KeyboardEvent as KE, type ReactNode } from "react";

import { Button, Input, Skeleton } from "../../components/ui";
import { ComSaida } from "../../components/ComSaida";
import { capacidadesDe } from "@dbee/shared/puro";

import { IconeEngine, NOME_ENGINE } from "../../components/IconeEngine";
import { anchorFromEvent, anchorFromRect, type MenuAnchor } from "../../components/ContextMenu";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import type { TableTarget } from "../../app/workspace";
import { trechos } from "./destaque.puro";
import { countRelations, filterSchema } from "./filter";
import { connectionNode, databaseNode, schemaNode } from "./keys";
import { plannedSchemaTargets } from "./plan";
import { acaoDaTecla, buscaPorPrefixo, type ItemArvore } from "./teclado.puro";
import { useDatabases, useExpandedSchemas, type TreeState } from "./useTree";
import { SeloAmbiente } from "../ambiente/SeloAmbiente";

/** Ícone por tipo de relação — table, view e matview têm que se distinguir. */
const RELATION_ICON: Readonly<Record<RelationKind, typeof Table2>> = {
  table: Table2,
  partitioned_table: Table2,
  foreign_table: Table2,
  view: Eye,
  materialized_view: Layers,
};

const RELATION_LABEL: Readonly<Record<RelationKind, string>> = {
  table: "tabela",
  partitioned_table: "tabela particionada",
  foreign_table: "tabela externa",
  view: "view",
  materialized_view: "view materializada",
};

/** Teto de relações casadas para a busca auto-expandir os schemas (ATRITO). */
const MAX_AUTO_EXPAND = 200;

/** Estado do último teste, por conexão. */
export type ConnectionHealth = "untested" | "conectando" | "ok" | "error";

/** O que o menu de contexto está descrevendo. */
export type TreeTarget =
  | { readonly kind: "connection"; readonly connection: Connection }
  | { readonly kind: "database"; readonly connection: Connection; readonly database: string }
  | { readonly kind: "schema"; readonly connection: Connection; readonly database: string; readonly schema: string }
  | {
      readonly kind: "relation";
      readonly connection: Connection;
      readonly database: string;
      readonly schema: string;
      readonly relation: RelationTree;
    };

interface ConnectionTreeProps {
  readonly connections: readonly Connection[];
  readonly health: Readonly<Record<string, ConnectionHealth>>;
  readonly warnings: Readonly<Record<string, readonly ConnectionWarning[]>>;
  readonly tree: TreeState;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onNewConnection: () => void;
  /** Botão direito em qualquer nó, ou o botão "···" da conexão. */
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  /**
   * Botão direito no **vazio** da árvore.
   *
   * Separado do de cima porque não descreve nó nenhum: o alvo é a lista, e a
   * única ação que faz sentido ali é acrescentar. Um `TreeTarget` sem conexão
   * obrigaria todo consumidor do menu a tratar um caso sem alvo.
   */
  readonly onBackgroundContextMenu: (anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}

export function ConnectionTree({
  connections,
  health,
  warnings,
  tree,
  onOpenRelation,
  onNewConnection,
  onContextMenu,
  onBackgroundContextMenu,
  activeTarget,
}: ConnectionTreeProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const buscaRef = useRef<HTMLDivElement>(null);
  const prefixo = useRef({ texto: "", ate: 0 });

  // "/" foca a busca (ui-detalhes §3.4) — só fora de campo editável, para não
  // roubar a barra de quem está escrevendo SQL ou um filtro.
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo !== null && (alvo.isContentEditable || alvo.closest("input, textarea, select, .cm-editor") !== null)) return;
      const input = buscaRef.current?.querySelector("input");
      if (input === null || input === undefined) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); };
  }, []);

  /**
   * Teclado `role=tree` (§3.4). A lógica é pura (`teclado.puro.ts`); aqui só
   * se lê o DOM visível em ordem e se aplica foco ou clique. Ler do DOM, e não
   * de um modelo paralelo, garante que a ordem é a que a pessoa está vendo —
   * inclusive durante a busca, que reordena e esconde ramos.
   */
  const aoTeclar = (e: KE<HTMLElement>): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-arvore-item]");
    if (el === null) return;
    const nos = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-arvore-item]"));
    const atual = nos.indexOf(el);
    const itens: ItemArvore[] = nos.map((n) => ({
      nivel: Number(n.getAttribute("aria-level")),
      expansivel: n.hasAttribute("aria-expanded"),
      expandido: n.getAttribute("aria-expanded") === "true",
      rotulo: n.dataset["rotulo"] ?? "",
    }));
    const focar = (i: number): void => {
      const alvo = nos[i];
      if (alvo === undefined) return;
      // Tabindex móvel: só o item corrente entra no Tab.
      for (const n of nos) n.tabIndex = -1;
      alvo.tabIndex = 0;
      alvo.focus();
    };

    if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 16, clientY: r.bottom }),
      );
      return;
    }
    if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const agora = Date.now();
      const texto = (agora < prefixo.current.ate ? prefixo.current.texto : "") + e.key;
      prefixo.current = { texto, ate: agora + 600 };
      const i = buscaPorPrefixo(itens, atual, texto);
      if (i >= 0) { e.preventDefault(); focar(i); }
      return;
    }
    const acao = acaoDaTecla(itens, atual, e.key);
    if (acao.tipo === "nada") return;
    e.preventDefault();
    if (acao.tipo === "focar") focar(acao.indice);
    else nos[acao.indice]?.click();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Busca sempre visível: a árvore passa de cem nós com poucos clientes. */}
      <div ref={buscaRef} className="relative shrink-0 p-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-4.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
        />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
          // Esc limpa e o foco fica no campo (§3.4); vazio, Esc devolve à árvore.
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            if (query !== "") { e.preventDefault(); setQuery(""); return; }
            e.currentTarget.blur();
          }}
          placeholder={t("arvore.buscar")}
          aria-label={t("arvore.buscarAria")}
          className="h-8 w-full pl-8 pr-7 text-xs"
        />
        {query !== "" ? (
          <button
            type="button"
            aria-label={t("arvore.limparBusca")}
            onClick={() => { setQuery(""); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-subtle hover:text-ink"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <nav
        aria-label={t("arvore.conexoes")}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2"
        onKeyDown={aoTeclar}
        onContextMenu={(e) => {
          /*
           * Só quando o clique **não** caiu num nó.
           *
           * Os nós já param o evento com `preventDefault`, mas o `contextmenu`
           * borbulha de qualquer jeito — sem esta checagem, o botão direito
           * numa conexão abriria os dois menus, um por cima do outro.
           */
          if (e.defaultPrevented) return;
          if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("li") !== null) {
            return;
          }
          e.preventDefault();
          onBackgroundContextMenu(anchorFromEvent(e));
        }}
      >
        {connections.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-subtle">
            {t("arvore.nenhumaConexao")}
          </p>
        ) : (
          <ul role="tree" aria-label={t("arvore.conexoes")}>
            {connections.map((connection, i) => (
              <ConnectionBranch
                key={connection.id}
                primeira={i === 0}
                connection={connection}
                health={health[connection.id] ?? "untested"}
                warnings={warnings[connection.id] ?? []}
                tree={tree}
                query={query}
                onOpenRelation={onOpenRelation}
                onContextMenu={onContextMenu}
                activeTarget={activeTarget}
              />
            ))}
          </ul>
        )}
      </nav>

      <div className="relative shrink-0 overflow-hidden border-t border-line p-2">
        <Button
          variant="ghost"
          size="sm"
          className="relative w-full justify-start"
          onClick={onNewConnection}
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {t("arvore.novaConexao")}
        </Button>
      </div>
    </div>
  );
}

/** Linha genérica da árvore: indentação, seta e conteúdo. */
function Row({
  depth,
  expandable,
  expanded,
  danger = false,
  active = false,
  rotulo,
  primeira = false,
  onClick,
  onContextMenu,
  children,
  trailing,
  leading,
}: {
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded?: boolean;
  readonly danger?: boolean;
  readonly active?: boolean;
  /** Texto do type-ahead (o nome do nó, sem os selos). */
  readonly rotulo: string;
  /** O primeiro item da árvore é o ponto de entrada do Tab (tabindex móvel). */
  readonly primeira?: boolean;
  readonly onClick: () => void;
  readonly onContextMenu?: (anchor: MenuAnchor) => void;
  readonly children: React.ReactNode;
  readonly trailing?: React.ReactNode;
  readonly leading?: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Abrir uma aba rola a árvore até o nó, só o necessário (§3.4, `nearest`).
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      // Botão direito em qualquer nó abre o menu daquele nó.
      onContextMenu={
        onContextMenu === undefined
          ? undefined
          : (e) => { e.preventDefault(); onContextMenu(anchorFromEvent(e)); }
      }
      className={cn(
        "relative",
        "group/row flex items-center gap-1 rounded-[4px] pr-1 transition-colors duration-(--motion-fast)",
        danger ? "hover:bg-accent-soft" : "hover:bg-raised",
        active && (danger ? "bg-accent-soft" : "bg-raised"),
      )}
      style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}
    >
      {/*
        * Barra de 2 px na relação aberta (§3.4). Em `info` — âmbar é a cor do
        * modo escrita e de mais nada (design-system); só numa conexão com
        * escrita habilitada a barra é âmbar, porque ali a linha inteira já é.
        *
        * Não vale para os nós expansíveis: ali "ativo" seria "aberto", e todo
        * ramo aberto com uma régua transformaria a árvore num campo de barras.
        */}
      {active && !expandable ? (
        <span
          aria-hidden
          className={cn("absolute inset-y-[3px] left-0 w-[2px] rounded-full", danger ? "bg-accent" : "bg-info")}
        />
      ) : null}
      {leading}
      <button
        ref={ref}
        type="button"
        role="treeitem"
        data-arvore-item=""
        data-rotulo={rotulo}
        aria-level={depth + 1}
        aria-selected={active}
        tabIndex={primeira ? 0 : -1}
        onClick={onClick}
        aria-expanded={expandable ? expanded : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[4px] py-1.5 text-left transition-opacity duration-(--motion-fast) active:opacity-70 max-lg:py-3"
      >
        {expandable ? (
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3 w-3 shrink-0 text-subtle transition-transform duration-(--motion-fast) ease-(--ease-enter)",
              expanded === true && "rotate-90",
            )}
          />
        ) : (
          <span aria-hidden className="w-3 shrink-0" />
        )}
        {children}
      </button>
      {trailing}
    </div>
  );
}

/**
 * Filhos de um ramo (§3.4): entram com `motion-filhos` (opacidade + 2 px, em
 * `base`, sem stagger) e, ao recolher, ficam montados até o fade `fast` acabar.
 */
function Filhos({ aberto, children }: { readonly aberto: boolean; readonly children: ReactNode }) {
  return (
    <ComSaida aberto={aberto} role="group" className="motion-filhos">
      {children}
    </ComSaida>
  );
}

/**
 * Verdadeiro só depois de `ms` com `ativo` ligado (§3.4: esqueleto após
 * `fast`). Resposta rápida não pisca esqueleto nenhum.
 */
function useAtrasado(ativo: boolean, ms = 120): boolean {
  const [passou, setPassou] = useState(false);
  useEffect(() => {
    if (!ativo) return;
    const id = window.setTimeout(() => { setPassou(true); }, ms);
    return () => { window.clearTimeout(id); setPassou(false); };
  }, [ativo, ms]);
  return ativo && passou;
}

/** Erro de carga de um ramo: a mensagem do banco inteira e "tentar de novo". */
function ErroDeCarga({ mensagem, recuo, onRetry }: { readonly mensagem: string; readonly recuo: string; readonly onRetry: () => void }) {
  const t = useT();
  return (
    <div role="none" className={cn("flex items-start gap-2 py-1.5 pr-2 text-xs text-danger", recuo)}>
      <span className="min-w-0 flex-1 break-words">{mensagem}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded text-muted hover:text-ink"
      >
        <RotateCw aria-hidden className="h-3 w-3" />
        {t("arvore.tentarDeNovo")}
      </button>
    </div>
  );
}

/** O nome com o trecho casado em `font-semibold text-ink`, sem fundo (§3.4). */
function Destacado({ texto, termo }: { readonly texto: string; readonly termo: string }) {
  return (
    <>
      {trechos(texto, termo).map((p, i) =>
        p.casou ? <span key={i} className="font-semibold text-ink">{p.texto}</span> : <span key={i}>{p.texto}</span>,
      )}
    </>
  );
}

/**
 * O indicador de estado da conexão.
 *
 * ## Quatro estados, não três
 *
 * Faltava `conectando`, e a falta aparecia no pior momento: ao expandir uma
 * conexão, enquanto os databases carregam, `saudeVigente` não tinha evidência
 * nova e caía de volta no resultado do último "Testar" — quem tinha um teste
 * falho antigo via **vermelho justamente ao abrir a conexão que estava
 * funcionando**. Foi esse o relato. Espera acima de 300 ms sem sinal é a UI
 * dizendo a coisa errada, não silêncio.
 *
 * ## Nem só cor
 *
 * Verde e vermelho num ponto de 6 px são a mesma coisa para quem não distingue
 * os dois matizes, e o §10 do design-system já resolve colisão assim mudando a
 * **forma**. Então cada estado tem forma própria:
 *
 * - `untested` — anel vazado: nada se sabe ainda.
 * - `conectando` — anel girando: está acontecendo agora.
 * - `ok` — ponto sólido, calmo. É o estado de repouso, e repouso não deve
 *   chamar atenção; um "check" verde em toda linha seria ruído permanente.
 * - `error` — glifo de alerta. A forma muda só onde precisa mudar: é o único
 *   estado que exige ação.
 */
/*
 * Auditoria #8 / ui-detalhes §3.4: um ponto `size-2` só, sempre o mesmo nó,
 * para a troca de estado ser um crossfade de cor em `base` (sem pulso — o
 * único pulso permitido é o da VPN). Forma ainda varia onde importa para quem
 * não distingue verde de vermelho: `ok` é círculo cheio, `error` é quadrado
 * cheio, `untested` é contorno, `conectando` é contorno em `info`. O spinner
 * que havia aqui saiu: carregar filhos é dito pelo esqueleto (§3.4).
 */
const HEALTH_DOT: Readonly<Record<ConnectionHealth, string>> = {
  ok: "rounded-full border-ok bg-ok",
  error: "rounded-[1px] border-danger bg-danger",
  untested: "rounded-full border-line-strong bg-transparent",
  conectando: "rounded-full border-info bg-transparent",
};

/**
 * O estado **de agora**, não o do último clique em "Testar".
 *
 * O ponto vinha só do botão de testar, e isso o deixava mentindo do jeito mais
 * incômodo: quem testou uma vez com a senha errada, corrigiu e passou a usar a
 * conexão normalmente continuava vendo o ponto vermelho para sempre — abrir a
 * conexão, listar databases e rodar query nunca atualizavam nada. Um indicador
 * que não acompanha o que a pessoa acabou de fazer é pior que indicador nenhum.
 *
 * Carregar os databases **é** conectar: se voltou lista, a conexão está de pé
 * neste instante; se falhou, não está. Essa evidência vence o resultado do
 * teste, que é mais antigo por definição. Sem nenhuma das duas, o estado
 * honesto é "não testada".
 */
/** Chave de i18n por estado — o rótulo era string fixa em português. */
const HEALTH_LABEL: Readonly<
  Record<
    ConnectionHealth,
    | "arvore.statusOk"
    | "arvore.statusErro"
    | "arvore.statusConectando"
    | "arvore.statusNaoTestada"
  >
> = {
  ok: "arvore.statusOk",
  error: "arvore.statusErro",
  conectando: "arvore.statusConectando",
  untested: "arvore.statusNaoTestada",
};

function saudeVigente(
  doTeste: ConnectionHealth,
  databases: { isSuccess: boolean; isError: boolean; isFetching: boolean },
): ConnectionHealth {
  if (databases.isSuccess) return "ok";
  if (databases.isError) return "error";
  // Buscando: é o que está acontecendo AGORA, e vence um teste antigo. Sem
  // isto, abrir a conexão mostrava o vermelho do último teste falho até a
  // resposta chegar — o oposto do que estava acontecendo.
  if (databases.isFetching) return "conectando";
  return doTeste;
}

function ConnectionBranch({
  primeira,
  connection,
  health,
  warnings,
  tree,
  query,
  onOpenRelation,
  onContextMenu,
  activeTarget,
}: {
  readonly primeira: boolean;
  readonly connection: Connection;
  readonly health: ConnectionHealth;
  readonly warnings: readonly ConnectionWarning[];
  readonly tree: TreeState;
  readonly query: string;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}) {
  const t = useT();
  const node = connectionNode(connection.id);
  const expanded = tree.isExpanded(node);
  const perigo = connection.writeEnabled;

  // Só busca quando expandida (ver plan.ts).
  const databases = useDatabases(connection.id, expanded);

  // Carregar os databases é a prova de que a conexão está de pé agora; o
  // resultado do botão "Testar" é o que sobra quando ela nunca foi aberta.
  const saude = saudeVigente(health, databases);

  // `?? []` cru criaria um array novo a cada render, o memo abaixo nunca
  // memoizaria e o `useQueries` receberia uma lista nova toda vez — assinatura
  // refeita a cada quadro no caminho mais caro da árvore.
  const dados = databases.data;
  const lista = useMemo(() => dados ?? [], [dados]);

  const alvos = useMemo(
    () =>
      plannedSchemaTargets(
        [{ connectionId: connection.id, databases: lista.map((d) => d.name) }],
        tree.expanded,
      ),
    [connection.id, lista, tree.expanded],
  );
  const arvores = useExpandedSchemas(alvos);
  const esqueleto = useAtrasado(expanded && databases.isPending);

  return (
    <li
      role="none"
      className={cn(
        "rounded-[6px]",
        // O nó INTEIRO em tom âmbar de cautela, não uma barra de 2px: com
        // escrita habilitada o estado precisa ser pego de relance — mas é
        // cautela, não perigo, então âmbar quente, não vermelho (design-system).
        perigo && "my-0.5 border border-accent-line bg-accent-soft",
      )}
    >
      <Row
        depth={0}
        expandable
        expanded={expanded}
        danger={perigo}
        rotulo={connection.name}
        primeira={primeira}
        onClick={() => { tree.toggle(node); }}
        onContextMenu={(anchor) => { onContextMenu({ kind: "connection", connection }, anchor); }}
        leading={
          /*
           * Tag de cor como BARRA vertical, não ponto.
           *
           * Ponto colidia com o indicador de saúde, que é outro ponto a poucos
           * pixels: a tag verde de uma conexão lia como "conectada" e a
           * vermelha como "erro" — vocabulários opostos na mesma forma. Barra
           * e ponto se distinguem de relance.
           */
          connection.color === null ? null : (
            <span
              aria-hidden
              className="absolute inset-y-1 left-0 w-[3px] rounded-full"
              style={{ backgroundColor: connection.color }}
            />
          )
        }
        trailing={
          <button
            type="button"
            aria-label={`Ações de ${connection.name}`}
            onClick={(e) => { onContextMenu({ kind: "connection", connection }, anchorFromRect(e.currentTarget.getBoundingClientRect())); }}
            className="shrink-0 cursor-pointer rounded p-1 text-subtle opacity-0 transition-opacity duration-(--motion-fast) hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          >
            <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
          </button>
        }
      >
        {/*
          O `title` fica no invólucro: os ícones do lucide não aceitam `title`,
          e um wrapper só mantém o texto no mesmo lugar para os três estados.
        */}
        <span role="img" aria-label={t(HEALTH_LABEL[saude])} className="flex h-3 w-3 shrink-0 items-center justify-center" title={t(HEALTH_LABEL[saude])}>
          <span
            aria-hidden
            className={cn(
              "size-2 border transition-[background-color,border-color,border-radius] duration-(--motion-base) ease-(--ease-enter)",
              HEALTH_DOT[saude],
            )}
          />
        </span>
        {/*
          * A marca do motor no lugar onde havia uma tomada genérica.
          *
          * A tomada dizia "isto é uma conexão" — que a árvore já diz por ser a
          * árvore de conexões. A marca diz **qual banco está do outro lado**,
          * que é informação que não estava em lugar nenhum da linha. Um ícone
          * entra e um sai: a densidade da linha não muda.
          */}
        <span className="flex shrink-0 items-center" title={NOME_ENGINE[connection.engine]}>
          {/*
            * Sempre `text-muted`, inclusive com escrita habilitada.
            *
            * A tomada que estava aqui virava rosa no estado de perigo, e a
            * marca herdou isso por um momento. Está errado: qual motor é não
            * muda porque a escrita foi habilitada, e o rosa a três pixels do
            * ponto de saúde lê como "esta conexão deu erro". O estado já é dito
            * pela borda âmbar, pelo fundo e pelo selo do lápis — três vezes.
            * Aqui a regra do conjunto vale: a forma diz qual, a cor diz como.
            */}
          <span data-icone-conexao={connection.id} className="inline-flex shrink-0"><IconeEngine engine={connection.engine} className="h-3.5 w-3.5 text-muted" /></span>
          <span className="sr-only">{NOME_ENGINE[connection.engine]}</span>
        </span>
        <span className="truncate text-sm font-medium text-ink">{connection.name}</span>
        <SeloAmbiente compacto environment={connection.environment} />
        <span className="sr-only">{t(HEALTH_LABEL[saude])}</span>
        {/*
          * O nome é o identificador; o selo é qualificador. Numa barra de
          * 260px o selo com a palavra inteira comia metade do nome
          * ("Produção Ass..."), e saber QUAL conexão está gravável é
          * exatamente o ponto do estado de perigo. Vira ícone, com o texto
          * no rótulo acessível.
          */}
        {/*
          * Aviso de segurança do último teste — hoje só o de papel privilegiado.
          * Fica ANTES do selo de escrita e empurra com `ml-auto` só se o selo
          * não existir, para os dois não brigarem pela borda direita.
          */}
        {warnings.length > 0 ? (
          <span
            className={cn("flex shrink-0 items-center", perigo ? "" : "ml-auto")}
            title={warnings.map((w) => w.message).join("\n\n")}
          >
            <TriangleAlert aria-hidden className="h-3.5 w-3.5 text-accent" />
            <span className="sr-only">{warnings.map((w) => w.message).join(" ")}</span>
          </span>
        ) : null}
        {perigo ? (
          <span
            className="ml-auto flex shrink-0 items-center rounded-[3px] bg-amber px-1 py-px"
            title={t("conexao.escritaHabilitada")}
          >
            <Pencil aria-hidden className="h-2.5 w-2.5 text-accent-ink" />
            <span className="sr-only">{t("conexao.escritaHabilitadaMin")}</span>
          </span>
        ) : null}
      </Row>

      <Filhos aberto={expanded}>
        <ul role="none">
          {databases.isPending ? (
            esqueleto ? (
              <li role="none" className="space-y-2 py-2 pl-8 pr-3">
                <span className="sr-only">{t("arvore.carregandoDatabases")}</span>
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </li>
            ) : null
          ) : databases.isError ? (
            <li role="none">
              <ErroDeCarga mensagem={databases.error.message} recuo="pl-8" onRetry={() => { void databases.refetch(); }} />
            </li>
          ) : (
            lista.map((db) => (
              <DatabaseBranch
                key={db.name}
                connection={connection}
                database={db.name}
                isDefault={db.isDefault}
                tree={tree}
                query={query}
                schema={arvores.find((_, i) => alvos[i]?.database === db.name)}
                onOpenRelation={onOpenRelation}
                onContextMenu={onContextMenu}
                activeTarget={activeTarget}
              />
            ))
          )}
        </ul>
      </Filhos>
    </li>
  );
}

function DatabaseBranch({
  connection,
  database,
  isDefault,
  tree,
  query,
  schema,
  onOpenRelation,
  onContextMenu,
  activeTarget,
}: {
  readonly connection: Connection;
  readonly database: string;
  readonly isDefault: boolean;
  readonly tree: TreeState;
  readonly query: string;
  /** Resultado do useQueries daquele database. `exactOptionalPropertyTypes`
   *  exige o `| undefined` explícito no `data`. */
  readonly schema:
    | {
        data?: DatabaseTree | undefined;
        isPending: boolean;
        isError: boolean;
        error: Error | null;
        refetch: () => unknown;
      }
    | undefined;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}) {
  const t = useT();
  const node = databaseNode(connection.id, database);
  /*
   * A engine tem o nível de schema?
   *
   * Sai da capacidade, e não de um `if (engine === "mysql")` aqui: quando a
   * próxima engine sem schema entrar, ela já vem certa. `null` (engine sem
   * capacidade declarada) desenha o nível, que é o comportamento de sempre.
   */
  const capacidades = capacidadesDe(connection.engine);
  // Todas as engines sem nível de schema (MySQL, MariaDB, libSQL, MongoDB) —
  // só o Postgres tem "schema" no meio. Checar a ausência de "schema" no lugar
  // de uma string exata faz a árvore acompanhar cada engine nova sozinha.
  const semNivelDeSchema = capacidades !== null && !capacidades.niveis.includes("schema");
  const expanded = tree.isExpanded(node);
  const perigo = connection.writeEnabled;

  const arvore = schema?.data;
  const filtrado = useMemo(
    () => (arvore === undefined ? [] : filterSchema(arvore, query)),
    [arvore, query],
  );

  /*
   * Teto de auto-expansão (ATRITO, auditoria de perf).
   *
   * Buscar expande os schemas casados de uma vez — mas num catálogo de 800
   * relações a primeira tecla injetava 6.420 nós no DOM num commit síncrono
   * (192 ms; 1,65 s com 10.000). Acima do teto, os schemas ficam recolhidos e a
   * pessoa abre o que interessa: o nome do schema já aparece filtrado, e abrir
   * um schema é barato. O filtro em si é rápido (0,155 ms), então o custo é só
   * de renderização, e é ele que o teto contém.
   */
  const totalCasadas = useMemo(() => countRelations(filtrado), [filtrado]);
  const autoExpandir = query !== "" && totalCasadas > 0 && totalCasadas <= MAX_AUTO_EXPAND;
  const totalRelacoes = useMemo(
    () => (arvore === undefined ? 0 : arvore.schemas.reduce((n, sc) => n + sc.relations.length, 0)),
    [arvore],
  );
  const esqueleto = useAtrasado(expanded && (schema === undefined || schema.isPending));

  return (
    <li role="none">
      <Row
        depth={1}
        expandable
        expanded={expanded}
        danger={perigo}
        rotulo={database}
        onClick={() => { tree.toggle(node); }}
        onContextMenu={(anchor) => { onContextMenu({ kind: "database", connection, database }, anchor); }}
      >
        <Database aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="truncate font-mono text-xs text-ink">{database}</span>
        {isDefault ? <span className="shrink-0 text-2xs text-subtle">{t("arvore.padrao")}</span> : null}
        {/*
          * Contagem "12 de 340" (§3.4) por database, não global: cada catálogo
          * chega numa requisição própria e o total só é honesto onde já chegou.
          */}
        {query.trim() !== "" && arvore !== undefined ? (
          <span className="ml-auto shrink-0 pl-2 text-2xs tabular-nums text-subtle">
            {t("arvore.contagem", { n: String(totalCasadas), total: String(totalRelacoes) })}
          </span>
        ) : null}
      </Row>

      <Filhos aberto={expanded}>
        {schema === undefined || schema.isPending ? (
          esqueleto ? (
            <div className="space-y-2 py-2 pl-12 pr-3">
              <span className="sr-only">{t("arvore.lendoCatalogo")}</span>
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          ) : null
        ) : schema.isError ? (
          <ErroDeCarga mensagem={schema.error?.message ?? ""} recuo="pl-12" onRetry={() => { schema.refetch(); }} />
        ) : filtrado.length === 0 ? (
          <p className="py-1.5 pl-12 text-xs text-subtle">
            {query === "" ? t("arvore.nenhumaRelacao") : t("arvore.nadaEncontrado", { q: query })}
          </p>
        ) : (
          <ul role="none">
            {filtrado.map((entry) => (
              <SchemaBranch
                key={entry.node.name}
                connection={connection}
                database={database}
                schemaName={entry.node.name}
                relations={entry.relations}
                semNivelDeSchema={semNivelDeSchema}
                // Busca ativa expande tudo: esconder o resultado atrás de um
                // clique anula o motivo de ter buscado.
                forceOpen={autoExpandir}
                query={query}
                tree={tree}
                onOpenRelation={onOpenRelation}
                onContextMenu={onContextMenu}
                activeTarget={activeTarget}
              />
            ))}
          </ul>
        )}
      </Filhos>
    </li>
  );
}

function SchemaBranch({
  connection,
  database,
  schemaName,
  relations,
  semNivelDeSchema,
  forceOpen,
  query,
  tree,
  onOpenRelation,
  onContextMenu,
  activeTarget,
}: {
  readonly connection: Connection;
  readonly database: string;
  readonly schemaName: string;
  readonly relations: readonly RelationTree[];
  /**
   * A engine não tem o nível de schema (`niveis: "conexao/database/tabela"`).
   *
   * No MySQL, `SCHEMA` e `DATABASE` são a mesma coisa: o driver devolve um nó
   * de schema com o nome do próprio database, para a resposta manter a forma do
   * fio, e é aqui que ele deixa de ser desenhado. Mostrar `loja > loja > tabela`
   * seria a tela inventando uma hierarquia que o servidor não tem.
   */
  readonly semNivelDeSchema: boolean;
  readonly forceOpen: boolean;
  readonly query: string;
  readonly tree: TreeState;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}) {
  const node = schemaNode(connection.id, database, schemaName);
  // Sem o nível, não há o que expandir: as relações são filhas do database.
  const expanded = semNivelDeSchema || forceOpen || tree.isExpanded(node);

  return (
    <li role="none">
      {semNivelDeSchema ? null : (
      <Row
        depth={2}
        expandable
        expanded={expanded}
        danger={connection.writeEnabled}
        rotulo={schemaName}
        onClick={() => { tree.toggle(node); }}
        onContextMenu={(anchor) => {
          onContextMenu({ kind: "schema", connection, database, schema: schemaName }, anchor);
        }}
      >
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-line-strong" />
        <span className="truncate text-xs text-muted"><Destacado texto={schemaName} termo={query} /></span>
        <span className="shrink-0 text-2xs text-subtle">{relations.length}</span>
      </Row>
      )}

      <Filhos aberto={expanded}>
        <ul role="none">
          {relations.map((relation) => {
            const Icon = RELATION_ICON[relation.kind];
            const ativo =
              activeTarget?.connectionId === connection.id &&
              activeTarget.database === database &&
              activeTarget.schema === schemaName &&
              activeTarget.relation === relation.name;

            return (
              <li key={relation.name} role="none">
                <Row
                  // Sem o nível de schema, a tabela é neta da conexão e não
                  // bisneta: o recuo tem que dizer a mesma coisa que a árvore.
                  depth={semNivelDeSchema ? 2 : 3}
                  expandable={false}
                  danger={connection.writeEnabled}
                  active={ativo}
                  rotulo={relation.name}
                  onContextMenu={(anchor) => {
                    onContextMenu(
                      { kind: "relation", connection, database, schema: schemaName, relation },
                      anchor,
                    );
                  }}
                  onClick={() => {
                    onOpenRelation({
                      connectionId: connection.id,
                      database,
                      schema: schemaName,
                      relation: relation.name,
                      kind: relation.kind,
                    });
                  }}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      relation.kind === "view" && "text-subtle",
                      relation.kind === "materialized_view" && "text-ok",
                      relation.kind !== "view" && relation.kind !== "materialized_view" && "text-muted",
                    )}
                  />
                  <span className="truncate text-xs text-ink"><Destacado texto={relation.name} termo={query} /></span>
                  <span className="sr-only">{RELATION_LABEL[relation.kind]}</span>
                </Row>
              </li>
            );
          })}
        </ul>
      </Filhos>
    </li>
  );
}
