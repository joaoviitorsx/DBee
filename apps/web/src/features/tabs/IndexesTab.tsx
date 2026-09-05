import type { Relation } from "@dbee/shared";

import { Badge } from "../../components/ui";
import { useT } from "../../i18n";

/**
 * Sub-aba Índices.
 *
 * Índice sobre expressão vem com `columns` vazio de propósito (§11.22): a
 * definição literal é a única representação honesta dele, e mostrar uma lista
 * parcial de colunas faria o usuário acreditar num índice que não existe.
 */
export function IndexesTab({ relation }: { readonly relation: Relation }) {
  const t = useT();
  if (relation.indexes.length === 0) {
    return <p className="px-4 py-8 text-center text-xs text-subtle">{t("indices.nenhum")}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {relation.indexes.map((index) => (
        <li key={index.name} className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{index.name}</span>
            {index.isPrimary ? <Badge tone="key">{t("indices.pk")}</Badge> : null}
            {index.isUnique && !index.isPrimary ? <Badge tone="neutral">{t("indices.unico")}</Badge> : null}
          </div>

          {index.columns.length > 0 ? (
            <p className="mt-0.5 font-mono text-xs text-muted">({index.columns.join(", ")})</p>
          ) : (
            // Sem colunas = índice sobre expressão. A definição é a verdade.
            <p className="mt-0.5 break-all font-mono text-xs text-subtle">{index.definition}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
