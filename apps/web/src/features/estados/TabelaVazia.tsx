import { FilterX } from "lucide-react";

import { Button } from "../../components/ui";
import { useT } from "../../i18n";

/**
 * Grid sem linhas (ui-detalhes §3.7). Distingue "a tabela está vazia" de "o
 * filtro não casou nada" — a segunda é a informação útil, e sem ela a pessoa
 * conclui que a tabela está vazia quando o filtro é que está errado.
 *
 * Ligar no `DataTab` no lugar do grid quando `rows.length === 0` e não houver
 * carregamento em curso, passando `filtrosAtivos` e o mesmo limpar do chip.
 */
export function TabelaVazia({
  filtrosAtivos,
  onLimparFiltros,
}: {
  readonly filtrosAtivos: number;
  readonly onLimparFiltros?: () => void;
}) {
  const t = useT();
  return (
    <div role="status" className="motion-fade flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {filtrosAtivos > 0 ? (
        <>
          <p className="text-sm text-ink">{t("estados.semLinhasFiltro")}</p>
          {onLimparFiltros !== undefined ? (
            <Button size="sm" variant="ghost" onClick={onLimparFiltros}>
              <FilterX aria-hidden className="h-3.5 w-3.5" />
              {t("estados.limparFiltros", { n: String(filtrosAtivos) })}
            </Button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">{t("estados.tabelaVazia")}</p>
      )}
    </div>
  );
}
