import type { Connection, DatabaseTree, RelationKind, RelationTree , ConnectionWarning } from "@dbee/shared";
import {
  AlertCircle,
  ChevronRight,
  Database,
  Eye,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Search,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { anchorFromEvent, anchorFromRect, type MenuAnchor } from "../../components/ContextMenu";
import { HoneycombCluster } from "../../components/HoneycombCluster";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import type { TableTarget } from "../../app/workspace";
import { countRelations, filterSchema } from "./filter";
import { connectionNode, databaseNode, schemaNode } from "./keys";
import { plannedSchemaTargets } from "./plan";
import { useDatabases, useExpandedSchemas, type TreeState } from "./useTree";

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

  return (
    <div className="flex h-full flex-col">
      {/* Busca sempre visível: a árvore passa de cem nós com poucos clientes. */}
      <div className="relative shrink-0 p-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-4.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
        />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
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
          <ul>
            {connections.map((connection) => (
              <ConnectionBranch
                key={connection.id}
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

      {/*
        * Favo de mel no pé da barra, atrás do "Nova conexão" — um **cacho**
        * hexagonal no canto inferior direito (o mesmo motivo do rodapé do
        * login), não a tesselação difusa de antes: hexágonos flat-top de
        * verdade, parte cheios, parte contorno. `mask` desvanece para cima e
        * para a esquerda, para o favo assinar a lateral sem competir com a
        * árvore; `text-accent` tinge em dark e light.
        */}
      <div className="relative shrink-0 overflow-hidden border-t border-line p-2">
        <HoneycombCluster
          aria-hidden
          className="absolute bottom-0 right-0 h-28 w-28 translate-x-4 translate-y-4 text-accent opacity-[0.13]"
          size={13}
        />
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
  readonly onClick: () => void;
  readonly onContextMenu?: (anchor: MenuAnchor) => void;
  readonly children: React.ReactNode;
  readonly trailing?: React.ReactNode;
  readonly leading?: React.ReactNode;
}) {
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
        "group/row flex items-center gap-1 rounded-[4px] pr-1 transition-colors duration-150",
        danger ? "hover:bg-accent-soft" : "hover:bg-raised",
        active && (danger ? "bg-accent-soft" : "bg-raised"),
      )}
      style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}
    >
      {/*
        * A relação aberta ganha a **mesma régua** que identifica a conexão na
        * linha de cima — 3px na borda esquerda, agora em âmbar. Só o fundo
        * `raised` era fraco demais numa árvore de cem nós: a linha ativa
        * sumia junto com a linha sob o cursor, que usa o mesmo tom.
        *
        * Não vale para os nós expansíveis: ali "ativo" seria "aberto", e todo
        * ramo aberto com uma régua transformaria a árvore num campo de barras.
        */}
      {active && !expandable ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-[3px] left-0 w-[3px] rounded-full bg-accent",
          )}
        />
      ) : null}
      {leading}
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expandable ? expanded : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left max-lg:py-3"
      >
        {expandable ? (
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3 w-3 shrink-0 text-subtle transition-transform duration-150",
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
const HEALTH_DOT: Readonly<Record<"ok" | "untested", string>> = {
  ok: "bg-ok",
  // Anel vazado, não cinza sólido: "nada se sabe ainda" não é um estado, é a
  // ausência de um — e a forma vazada diz isso sem depender do matiz.
  untested: "border border-line-strong",
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
  connection,
  health,
  warnings,
  tree,
  query,
  onOpenRelation,
  onContextMenu,
  activeTarget,
}: {
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

  return (
    <li
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
            className="shrink-0 cursor-pointer rounded p-1 text-subtle opacity-0 transition-opacity duration-150 hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
          </button>
        }
      >
        {/*
          O `title` fica no invólucro: os ícones do lucide não aceitam `title`,
          e um wrapper só mantém o texto no mesmo lugar para os três estados.
        */}
        <span aria-hidden className="flex h-3 w-3 shrink-0 items-center justify-center" title={t(HEALTH_LABEL[saude])}>
          {saude === "error" ? (
            // Único estado com glifo de alerta: é o único que pede ação, e a
            // forma o separa do "ok" para quem não distingue verde de vermelho.
            <AlertCircle className="h-3 w-3 text-danger" />
          ) : saude === "conectando" ? (
            // Glifo, e não o ponto girando: um anel de 6 px fica idêntico a
            // cada quadro da rotação, então o giro não comunicaria nada. Com o
            // movimento zerado por `prefers-reduced-motion`, o `Loader2` parado
            // ainda é uma forma diferente do ponto — não depende da animação.
            <Loader2 className="h-3 w-3 animate-spin text-accent" />
          ) : (
            <span className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[saude === "ok" ? "ok" : "untested"])} />
          )}
        </span>
        <Plug aria-hidden className={cn("h-3.5 w-3.5 shrink-0", perigo ? "text-danger-ink" : "text-muted")} />
        <span className="truncate text-sm font-medium text-ink">{connection.name}</span>
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

      {expanded ? (
        <ul>
          {databases.isPending ? (
            <li className="py-1.5 pl-8 text-xs text-subtle">{t("arvore.carregandoDatabases")}</li>
          ) : databases.isError ? (
            <li className="py-1.5 pl-8 pr-2 text-xs text-danger">{databases.error.message}</li>
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
      ) : null}
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
      }
    | undefined;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}) {
  const t = useT();
  const node = databaseNode(connection.id, database);
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

  return (
    <li>
      <Row
        depth={1}
        expandable
        expanded={expanded}
        danger={perigo}
        onClick={() => { tree.toggle(node); }}
        onContextMenu={(anchor) => { onContextMenu({ kind: "database", connection, database }, anchor); }}
      >
        <Database aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="truncate font-mono text-xs text-ink">{database}</span>
        {isDefault ? <span className="shrink-0 text-2xs text-subtle">{t("arvore.padrao")}</span> : null}
      </Row>

      {expanded ? (
        schema === undefined || schema.isPending ? (
          <p className="py-1.5 pl-12 text-xs text-subtle">{t("arvore.lendoCatalogo")}</p>
        ) : schema.isError ? (
          <p className="py-1.5 pl-12 pr-2 text-xs text-danger">{schema.error?.message}</p>
        ) : filtrado.length === 0 ? (
          <p className="py-1.5 pl-12 text-xs text-subtle">
            {query === "" ? t("arvore.nenhumaRelacao") : t("arvore.nadaEncontrado", { q: query })}
          </p>
        ) : (
          <ul>
            {filtrado.map((entry) => (
              <SchemaBranch
                key={entry.node.name}
                connection={connection}
                database={database}
                schemaName={entry.node.name}
                relations={entry.relations}
                // Busca ativa expande tudo: esconder o resultado atrás de um
                // clique anula o motivo de ter buscado.
                forceOpen={autoExpandir}
                tree={tree}
                onOpenRelation={onOpenRelation}
                onContextMenu={onContextMenu}
                activeTarget={activeTarget}
              />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

function SchemaBranch({
  connection,
  database,
  schemaName,
  relations,
  forceOpen,
  tree,
  onOpenRelation,
  onContextMenu,
  activeTarget,
}: {
  readonly connection: Connection;
  readonly database: string;
  readonly schemaName: string;
  readonly relations: readonly RelationTree[];
  readonly forceOpen: boolean;
  readonly tree: TreeState;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}) {
  const node = schemaNode(connection.id, database, schemaName);
  const expanded = forceOpen || tree.isExpanded(node);

  return (
    <li>
      <Row
        depth={2}
        expandable
        expanded={expanded}
        danger={connection.writeEnabled}
        onClick={() => { tree.toggle(node); }}
        onContextMenu={(anchor) => {
          onContextMenu({ kind: "schema", connection, database, schema: schemaName }, anchor);
        }}
      >
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-line-strong" />
        <span className="truncate text-xs text-muted">{schemaName}</span>
        <span className="shrink-0 text-2xs text-subtle">{relations.length}</span>
      </Row>

      {expanded ? (
        <ul>
          {relations.map((relation) => {
            const Icon = RELATION_ICON[relation.kind];
            const ativo =
              activeTarget?.connectionId === connection.id &&
              activeTarget.database === database &&
              activeTarget.schema === schemaName &&
              activeTarget.relation === relation.name;

            return (
              <li key={relation.name}>
                <Row
                  depth={3}
                  expandable={false}
                  danger={connection.writeEnabled}
                  active={ativo}
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
                  <span className="truncate text-xs text-ink">{relation.name}</span>
                  <span className="sr-only">{RELATION_LABEL[relation.kind]}</span>
                </Row>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
