import { Activity, Code2, Copy, Database, Pencil, Plug, RefreshCw, ScrollText, Share2, Table2, Trash2 } from "lucide-react";

import type { MenuSection } from "../../components/ContextMenu";
import type { TableTarget } from "../../app/workspace";
import type { TreeTarget } from "./ConnectionTree";
import type { Tradutor } from "../../i18n";

/** Copia para a área de transferência, em silêncio se o navegador recusar. */
function copiar(texto: string): void {
  void navigator.clipboard.writeText(texto).catch(() => undefined);
}

const icone = "h-3.5 w-3.5 text-muted";

export interface TreeMenuActions {
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onEditConnection: () => void;
  readonly onTestConnection: () => void;
  readonly onDeleteConnection: () => void;
  readonly onRefreshSchema: (connectionId: string, database: string) => void;
  readonly onNewQuery: (connectionId: string, database: string, sql?: string) => void;
  readonly onOpenDiagram: (connectionId: string, database: string) => void;
  readonly onOpenCluster: (connectionId: string, kind: "overview" | "activity" | "audit") => void;
  readonly testing: boolean;
}

/**
 * Ações por tipo de nó.
 *
 * Cada nível oferece o que faz sentido nele e nada além: menu com item inútil
 * treina o usuário a não ler o menu. Copiar o nome qualificado aparece nos
 * níveis abaixo da conexão porque é o que se cola numa query.
 */
export function treeMenuSections(target: TreeTarget, actions: TreeMenuActions, t: Tradutor): MenuSection[] {
  switch (target.kind) {
    case "connection":
      return [
        {
          items: [
            {
              id: "test",
              label: actions.testing ? t("menu.testando") : t("menu.testar"),
              icon: <Plug aria-hidden className={icone} />,
              disabled: actions.testing,
              onSelect: actions.onTestConnection,
            },
            {
              id: "edit",
              label: t("menu.editar"),
              icon: <Pencil aria-hidden className={icone} />,
              onSelect: actions.onEditConnection,
            },
          ],
        },
        {
          items: [
            {
              id: "overview",
              label: t("databases.selecionar"),
              icon: <Database aria-hidden className={icone} />,
              onSelect: () => { actions.onOpenCluster(target.connection.id, "overview"); },
            },
            {
              id: "activity",
              label: t("menu.verProcessos"),
              icon: <Activity aria-hidden className={icone} />,
              onSelect: () => { actions.onOpenCluster(target.connection.id, "activity"); },
            },
            {
              id: "audit",
              label: t("menu.verAuditoria"),
              icon: <ScrollText aria-hidden className={icone} />,
              onSelect: () => { actions.onOpenCluster(target.connection.id, "audit"); },
            },
          ],
        },
        {
          items: [
            {
              id: "delete",
              label: t("menu.excluirConexao"),
              icon: <Trash2 aria-hidden className="h-3.5 w-3.5" />,
              danger: true,
              onSelect: actions.onDeleteConnection,
            },
          ],
        },
      ];

    case "database":
      return [
        {
          items: [
            {
              id: "new-query",
              label: t("menu.novaConsultaAqui"),
              icon: <Code2 aria-hidden className={icone} />,
              onSelect: () => { actions.onNewQuery(target.connection.id, target.database); },
            },
            {
              id: "diagram",
              label: t("menu.verDiagrama"),
              icon: <Share2 aria-hidden className={icone} />,
              onSelect: () => { actions.onOpenDiagram(target.connection.id, target.database); },
            },
          ],
        },
        {
          items: [
            {
              id: "refresh",
              label: t("menu.recarregarCatalogo"),
              icon: <RefreshCw aria-hidden className={icone} />,
              onSelect: () => { actions.onRefreshSchema(target.connection.id, target.database); },
            },
            {
              id: "copy",
              label: t("menu.copiarNomeDatabase"),
              icon: <Copy aria-hidden className={icone} />,
              onSelect: () => { copiar(target.database); },
            },
          ],
        },
      ];

    case "schema":
      return [
        {
          items: [
            {
              id: "copy",
              label: t("menu.copiarNomeSchema"),
              icon: <Copy aria-hidden className={icone} />,
              onSelect: () => { copiar(target.schema); },
            },
          ],
        },
      ];

    case "relation":
      return [
        {
          items: [
            {
              id: "open",
              label: t("menu.abrir"),
              icon: <Table2 aria-hidden className={icone} />,
              onSelect: () => {
                actions.onOpenRelation({
                  connectionId: target.connection.id,
                  database: target.database,
                  schema: target.schema,
                  relation: target.relation.name,
                  kind: target.relation.kind,
                });
              },
            },
          ],
        },
        {
          items: [
            {
              id: "query-here",
              label: t("menu.consultarTabela"),
              icon: <Code2 aria-hidden className={icone} />,
              onSelect: () => {
                actions.onNewQuery(
                  target.connection.id,
                  target.database,
                  `SELECT *\nFROM ${target.schema}.${target.relation.name}\nLIMIT 100;`,
                );
              },
            },
          ],
        },
        {
          items: [
            {
              id: "copy-qualified",
              // O nome qualificado é o que se cola numa query — por isso vem
              // antes do nome simples.
              label: t("menu.copiarNomeQualificado"),
              icon: <Copy aria-hidden className={icone} />,
              onSelect: () => { copiar(`${target.schema}.${target.relation.name}`); },
            },
            {
              id: "copy-name",
              label: t("menu.copiarNome"),
              icon: <Copy aria-hidden className={icone} />,
              onSelect: () => { copiar(target.relation.name); },
            },
            {
              id: "copy-columns",
              label: t("menu.copiarColunas"),
              icon: <Copy aria-hidden className={icone} />,
              disabled: target.relation.columns.length === 0,
              onSelect: () => { copiar(target.relation.columns.map((c) => c.name).join(", ")); },
            },
          ],
        },
      ];
  }
}

/** Rótulo do cabeçalho do menu — diz sobre o que ele age. */
export function treeMenuTitle(target: TreeTarget): string {
  switch (target.kind) {
    case "connection":
      return target.connection.name;
    case "database":
      return target.database;
    case "schema":
      return target.schema;
    case "relation":
      return `${target.schema}.${target.relation.name}`;
  }
}
