import { Copy, Pencil, Plug, RefreshCw, Table2, Trash2 } from "lucide-react";

import type { MenuSection } from "../../components/ContextMenu";
import type { TableTarget } from "../../app/workspace";
import type { TreeTarget } from "./ConnectionTree";

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
  readonly testing: boolean;
}

/**
 * Ações por tipo de nó.
 *
 * Cada nível oferece o que faz sentido nele e nada além: menu com item inútil
 * treina o usuário a não ler o menu. Copiar o nome qualificado aparece nos
 * níveis abaixo da conexão porque é o que se cola numa query.
 */
export function treeMenuSections(target: TreeTarget, actions: TreeMenuActions): MenuSection[] {
  switch (target.kind) {
    case "connection":
      return [
        {
          items: [
            {
              id: "test",
              label: actions.testing ? "Testando…" : "Testar conexão",
              icon: <Plug aria-hidden className={icone} />,
              disabled: actions.testing,
              onSelect: actions.onTestConnection,
            },
            {
              id: "edit",
              label: "Editar",
              icon: <Pencil aria-hidden className={icone} />,
              onSelect: actions.onEditConnection,
            },
          ],
        },
        {
          items: [
            {
              id: "delete",
              label: "Excluir conexão",
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
              id: "refresh",
              label: "Recarregar catálogo",
              icon: <RefreshCw aria-hidden className={icone} />,
              onSelect: () => { actions.onRefreshSchema(target.connection.id, target.database); },
            },
            {
              id: "copy",
              label: "Copiar nome do database",
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
              label: "Copiar nome do schema",
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
              label: "Abrir",
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
              id: "copy-qualified",
              // O nome qualificado é o que se cola numa query — por isso vem
              // antes do nome simples.
              label: "Copiar nome qualificado",
              icon: <Copy aria-hidden className={icone} />,
              onSelect: () => { copiar(`${target.schema}.${target.relation.name}`); },
            },
            {
              id: "copy-name",
              label: "Copiar nome",
              icon: <Copy aria-hidden className={icone} />,
              onSelect: () => { copiar(target.relation.name); },
            },
            {
              id: "copy-columns",
              label: "Copiar lista de colunas",
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
