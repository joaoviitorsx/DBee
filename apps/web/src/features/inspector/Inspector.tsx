import type { Column, Relation } from "@dbee/shared";
import { PanelRightClose } from "lucide-react";

import { Badge, Button } from "../../components/ui";
import { useT } from "../../i18n";

/**
 * Inspetor da seleção atual (zona direita).
 *
 * Nesta fatia mostra a coluna selecionada na aba Estrutura. O caso de célula de
 * resultado chega com o grid.
 */
export function Inspector({
  relation,
  column,
  onClose,
}: {
  readonly relation: Relation | null;
  readonly column: Column | null;
  readonly onClose: () => void;
}) {
  const t = useT();
  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-surface">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-xs font-medium text-muted">{t("inspetor.titulo")}</h2>
        <Button size="icon" variant="ghost" aria-label={t("inspetor.fechar")} onClick={onClose}>
          <PanelRightClose aria-hidden className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {column === null ? (
          <p className="mt-6 text-center text-xs text-subtle">
            {t("inspetor.vazio")}
          </p>
        ) : (
          <dl className="space-y-3">
            <div>
              <dt className="text-2xs text-subtle">{t("inspetor.coluna")}</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                {column.name}
                {column.isPrimaryKey ? <Badge tone="key">{t("indices.pk")}</Badge> : null}
                {column.nullable ? null : <Badge tone="neutral">{t("inspetor.notNull")}</Badge>}
              </dd>
            </div>

            <Campo rotulo={t("inspetor.tipo")} mono>
              {column.dataType}
            </Campo>
            <Campo rotulo={t("inspetor.oidTipo")} mono>
              {String(column.dataTypeId)}
            </Campo>
            <Campo rotulo={t("inspetor.posicao")}>{String(column.position)}</Campo>
            <Campo rotulo={t("inspetor.default")} mono>
              {column.defaultValue ?? "—"}
            </Campo>

            {column.comment !== null ? (
              <Campo rotulo={t("inspetor.comentario")}>{column.comment}</Campo>
            ) : null}

            {relation !== null ? <Referencias relation={relation} coluna={column.name} /> : null}
          </dl>
        )}
      </div>
    </aside>
  );
}

function Campo({
  rotulo,
  mono = false,
  children,
}: {
  readonly rotulo: string;
  readonly mono?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-2xs text-subtle">{rotulo}</dt>
      <dd className={`mt-0.5 break-all text-xs text-ink ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function Referencias({ relation, coluna }: { readonly relation: Relation; readonly coluna: string }) {
  const t = useT();
  const saindo = relation.foreignKeys.filter((fk) => fk.columns.includes(coluna));
  const indices = relation.indexes.filter((i) => i.columns.includes(coluna));

  if (saindo.length === 0 && indices.length === 0) return null;

  return (
    <>
      {saindo.length > 0 ? (
        <div>
          <dt className="text-2xs text-subtle">{t("inspetor.referencia")}</dt>
          <dd className="mt-0.5 space-y-0.5">
            {saindo.map((fk) => (
              <p key={fk.name} className="font-mono text-xs text-ink">
                {fk.referencedSchema}.{fk.referencedTable}
                <span className="text-subtle"> ({fk.referencedColumns.join(", ")})</span>
              </p>
            ))}
          </dd>
        </div>
      ) : null}

      {indices.length > 0 ? (
        <div>
          <dt className="text-2xs text-subtle">{t("inspetor.apareceEm")}</dt>
          <dd className="mt-0.5 space-y-0.5">
            {indices.map((i) => (
              <p key={i.name} className="font-mono text-xs text-muted">
                {i.name}
                {i.isUnique ? <span className="text-subtle"> · {t("inspetor.unico")}</span> : null}
              </p>
            ))}
          </dd>
        </div>
      ) : null}
    </>
  );
}
