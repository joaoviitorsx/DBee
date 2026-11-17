import { toast } from "sonner";

import { useT } from "../../i18n";
import { copiarTexto } from "../../lib/navegador";
import { CorpoJson } from "./Visualizador";

/**
 * O núcleo do visualizador (árvore virtualizada, busca, copiar valor/caminho)
 * embutido nos editores de Mongo e Redis (ui-detalhes §6.1): um só jeito de
 * ler JSON no app. Só leitura — a escrita continua no formulário do modal.
 * JSON truncado pelo servidor (`…(+N)`) não parseia e cai no texto cru.
 */
export function ArvoreNavegavel({ texto, raiz }: { readonly texto: string; readonly raiz: string }) {
  const t = useT();
  const copiar = (valor: string, rotulo: string): void => {
    void copiarTexto(valor).then((ok) => { toast(ok ? rotulo : t("visualizador.copiaFalhou")); });
  };
  return (
    <div className="flex h-56 min-h-0 flex-col overflow-hidden rounded-[4px] border border-line bg-sunken">
      <CorpoJson texto={texto} coluna={raiz} onCopiar={copiar} />
    </div>
  );
}
