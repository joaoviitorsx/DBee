import type { ForeignKey, Relation } from "@dbee/shared";
import { CornerUpRight, KeyRound, Link2 } from "lucide-react";

import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

/**
 * Sub-aba Estrutura: colunas, tipos, nullable, default, PK e FK.
 *
 * Densa de propósito — comparar tipos entre colunas é leitura em coluna, e é
 * por isso que tipo e default vão em mono (design-system §2.1).
 */
export function StructureTab({
  relation,
  selectedColumn,
  onSelectColumn,
  onOpenReference,
}: {
  readonly relation: Relation;
  readonly selectedColumn: string | null;
  readonly onSelectColumn: (name: string) => void;
  /** Abrir a tabela referenciada por uma FK (navegação por FK). */
  readonly onOpenReference?: (fk: ForeignKey) => void;
}) {
  const t = useT();
  // Coluna → a FK inteira, para o salto ter schema/tabela referenciados.
  const fkPorColuna = new Map<string, ForeignKey>();
  for (const fk of relation.foreignKeys) {
    for (const coluna of fk.columns) {
      fkPorColuna.set(coluna, fk);
    }
  }

  return (
    // `max-w-5xl`: numa tela larga a tabela esticava até ~1300px, e a coluna
    // "Referência" ficava longe demais da coluna "Coluna". Ler uma linha não
    // pode exigir varredura horizontal.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] max-w-5xl border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-left text-2xs text-subtle">
            <th className="w-8 py-2 pl-4 font-medium" />
            <th className="py-2 pr-4 font-medium">{t("estrutura.coluna")}</th>
            <th className="py-2 pr-4 font-medium">{t("estrutura.tipo")}</th>
            <th className="w-20 py-2 pr-4 font-medium">{t("estrutura.nulo")}</th>
            <th className="py-2 pr-4 font-medium">{t("estrutura.default")}</th>
            <th className="py-2 pr-4 font-medium">{t("estrutura.referencia")}</th>
          </tr>
        </thead>
        <tbody>
          {relation.columns.map((column) => {
            const fk = fkPorColuna.get(column.name);
            const selecionada = column.name === selectedColumn;

            return (
              <tr
                key={column.name}
                onClick={() => { onSelectColumn(column.name); }}
                className={cn(
                  "cursor-pointer border-b border-line/60 transition-colors duration-150",
                  selecionada ? "bg-raised" : "hover:bg-surface",
                )}
              >
                <td className="py-1.5 pl-4">
                  {column.isPrimaryKey ? (
                    <KeyRound aria-label={t("estrutura.pkAria")} className="h-3 w-3 text-accent" />
                  ) : fk !== undefined ? (
                    <Link2 aria-label={t("estrutura.fkAria")} className="h-3 w-3 text-subtle" />
                  ) : null}
                </td>
                <td className="py-1.5 pr-4 font-medium text-ink">{column.name}</td>
                <td className="py-1.5 pr-4 font-mono text-muted">{column.dataType}</td>
                <td className="py-1.5 pr-4 text-muted">{column.nullable ? t("comum.sim") : t("comum.nao")}</td>
                <td className="max-w-[16rem] truncate py-1.5 pr-4 font-mono text-subtle">
                  {column.defaultValue ?? "—"}
                </td>
                <td className="py-1.5 pr-4 font-mono text-subtle">
                  {fk === undefined ? (
                    "—"
                  ) : onOpenReference !== undefined ? (
                    // Clicar abre a tabela referenciada. `stopPropagation` para
                    // não disparar o select de linha da `<tr>` junto.
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenReference(fk); }}
                      title={t("estrutura.abrirReferencia")}
                      className="inline-flex items-center gap-1 rounded-[3px] px-1 text-accent hover:bg-accent-soft"
                    >
                      {fk.referencedSchema}.{fk.referencedTable}
                      <CornerUpRight aria-hidden className="h-3 w-3" />
                    </button>
                  ) : (
                    `${fk.referencedSchema}.${fk.referencedTable}`
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {relation.columns.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-subtle">{t("estrutura.semColunas")}</p>
      ) : null}
    </div>
  );
}
