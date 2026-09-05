import type { TableTarget } from "../../app/workspace";
import { useT } from "../../i18n";
import { Trabalhando } from "../motion/Trabalhando";
import { useSchema } from "../tree/useTree";
import { DiagramView } from "./DiagramView";

/**
 * A aba de diagrama: busca a árvore do database e desenha o ERD.
 *
 * Reusa `useSchema` — a mesma árvore que a navegação e o autocomplete usam,
 * quase sempre já em cache. Um database sem tabela nenhuma tem o que dizer, e
 * diz, em vez de mostrar um quadro em branco.
 */
export function DiagramTabContent({
  connectionId,
  database,
  onOpenTable,
}: {
  readonly connectionId: string;
  readonly database: string;
  readonly onOpenTable: (target: TableTarget) => void;
}) {
  const t = useT();
  const arvore = useSchema(connectionId, database, true);

  if (arvore.isPending) {
    return <Trabalhando rotulo={t("diagrama.lendo")} cronometro />;
  }
  if (arvore.isError) {
    return <p className="px-4 py-6 text-xs text-danger">{t("diagrama.erroLer")}</p>;
  }

  const totalRelacoes = arvore.data.schemas.reduce((n, s) => n + s.relations.length, 0);
  if (totalRelacoes === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-subtle">
        {t("diagrama.semTabelas")}
      </p>
    );
  }

  return (
    <DiagramView
      schema={arvore.data}
      connectionId={connectionId}
      database={database}
      onOpenTable={onOpenTable}
    />
  );
}
