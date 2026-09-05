import type { Connection, DatabaseSchema, Relation, RelationKind } from "@dbee/shared";
import {
  ChevronRight,
  Database,
  Eye,
  Layers,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Search,
  Table2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { anchorFromEvent, anchorFromRect, type MenuAnchor } from "../../components/ContextMenu";
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

/** Estado do último teste, por conexão. */
export type ConnectionHealth = "untested" | "ok" | "error";

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
      readonly relation: Relation;
    };

interface ConnectionTreeProps {
  readonly connections: readonly Connection[];
  readonly health: Readonly<Record<string, ConnectionHealth>>;
  readonly tree: TreeState;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onNewConnection: () => void;
  /** Botão direito em qualquer nó, ou o botão "···" da conexão. */
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}

export function ConnectionTree({
  connections,
  health,
  tree,
  onOpenRelation,
  onNewConnection,
  onContextMenu,
  activeTarget,
}: ConnectionTreeProps) {
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
          placeholder="Buscar tabela ou schema"
          aria-label="Buscar na árvore"
          className="h-8 w-full pl-8 pr-7 text-xs"
        />
        {query !== "" ? (
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => { setQuery(""); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-subtle hover:text-ink"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Conexões" className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {connections.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-subtle">
            Nenhuma conexão ainda. Cadastre a primeira para começar.
          </p>
        ) : (
          <ul>
            {connections.map((connection) => (
              <ConnectionBranch
                key={connection.id}
                connection={connection}
                health={health[connection.id] ?? "untested"}
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

      <div className="shrink-0 border-t border-line p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onNewConnection}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Nova conexão
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
        danger ? "hover:bg-danger-raised" : "hover:bg-raised",
        active && (danger ? "bg-danger-raised" : "bg-raised"),
      )}
      style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}
    >
      {leading}
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expandable ? expanded : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left"
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

const HEALTH_DOT: Readonly<Record<ConnectionHealth, string>> = {
  ok: "bg-ok",
  error: "bg-danger",
  untested: "bg-line-strong",
};

const HEALTH_LABEL: Readonly<Record<ConnectionHealth, string>> = {
  ok: "conectada",
  error: "erro na última tentativa",
  untested: "não testada",
};

function ConnectionBranch({
  connection,
  health,
  tree,
  query,
  onOpenRelation,
  onContextMenu,
  activeTarget,
}: {
  readonly connection: Connection;
  readonly health: ConnectionHealth;
  readonly tree: TreeState;
  readonly query: string;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}) {
  const node = connectionNode(connection.id);
  const expanded = tree.isExpanded(node);
  const perigo = connection.writeEnabled;

  // Só busca quando expandida (ver plan.ts).
  const databases = useDatabases(connection.id, expanded);

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
        // O nó INTEIRO em tom de perigo, não uma barra de 2px: com escrita
        // habilitada o alerta precisa ser pego de relance (design-system §11).
        perigo && "my-0.5 border border-danger-line bg-danger-surface",
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
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", HEALTH_DOT[health])}
        />
        <Plug aria-hidden className={cn("h-3.5 w-3.5 shrink-0", perigo ? "text-danger-ink" : "text-muted")} />
        <span className="truncate text-sm font-medium text-ink">{connection.name}</span>
        <span className="sr-only">{HEALTH_LABEL[health]}</span>
        {/*
          * O nome é o identificador; o selo é qualificador. Numa barra de
          * 260px o selo com a palavra inteira comia metade do nome
          * ("Produção Ass..."), e saber QUAL conexão está gravável é
          * exatamente o ponto do estado de perigo. Vira ícone, com o texto
          * no rótulo acessível.
          */}
        {perigo ? (
          <span
            className="ml-auto flex shrink-0 items-center rounded-[3px] bg-amber px-1 py-px"
            title="Escrita habilitada"
          >
            <Pencil aria-hidden className="h-2.5 w-2.5 text-accent-ink" />
            <span className="sr-only">escrita habilitada</span>
          </span>
        ) : null}
      </Row>

      {expanded ? (
        <ul>
          {databases.isPending ? (
            <li className="py-1.5 pl-8 text-xs text-subtle">Carregando databases…</li>
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
        data?: DatabaseSchema | undefined;
        isPending: boolean;
        isError: boolean;
        error: Error | null;
      }
    | undefined;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onContextMenu: (target: TreeTarget, anchor: MenuAnchor) => void;
  readonly activeTarget: TableTarget | null;
}) {
  const node = databaseNode(connection.id, database);
  const expanded = tree.isExpanded(node);
  const perigo = connection.writeEnabled;

  const arvore = schema?.data;
  const filtrado = useMemo(
    () => (arvore === undefined ? [] : filterSchema(arvore, query)),
    [arvore, query],
  );

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
        {isDefault ? <span className="shrink-0 text-2xs text-subtle">padrão</span> : null}
      </Row>

      {expanded ? (
        schema === undefined || schema.isPending ? (
          <p className="py-1.5 pl-12 text-xs text-subtle">Lendo o catálogo…</p>
        ) : schema.isError ? (
          <p className="py-1.5 pl-12 pr-2 text-xs text-danger">{schema.error?.message}</p>
        ) : filtrado.length === 0 ? (
          <p className="py-1.5 pl-12 text-xs text-subtle">
            {query === "" ? "Nenhuma relação" : `Nada encontrado para "${query}"`}
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
                forceOpen={query !== "" && countRelations(filtrado) > 0}
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
  readonly relations: readonly Relation[];
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
