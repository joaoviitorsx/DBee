import { TableProperties } from "lucide-react";

/**
 * Sub-aba Dados — placeholder.
 *
 * Existe agora para o executor de query, na fatia seguinte, nascer dentro deste
 * shell em vez de virar uma tela a refazer.
 */
export function DataTab() {
  return (
    <div className="mx-auto mt-20 max-w-sm text-center">
      <TableProperties aria-hidden className="mx-auto h-7 w-7 text-line-strong" />
      <h3 className="mt-3 text-sm text-ink">Dados ainda não</h3>
      <p className="mt-1 text-xs text-muted">
        A leitura de linhas chega com o executor de query. Por enquanto, Estrutura e Índices já
        mostram tudo que o catálogo sabe sobre esta relação.
      </p>
    </div>
  );
}
