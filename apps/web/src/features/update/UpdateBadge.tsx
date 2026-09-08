import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { UpdateDialog } from "./UpdateDialog";
import { useVersao } from "./useUpdate";

/**
 * "Há versão nova", na barra superior (DBee.md §8).
 *
 * ## Só aparece quando há o que dizer
 *
 * Nada é renderizado enquanto o DBee está em dia. Marcar o estado seguro treina
 * o olho a ignorar o selo (design-system §5) — e um cabeçalho que carrega um
 * "tudo certo" permanente gasta a largura que, em 375px, o nome da conexão
 * precisa.
 *
 * ## Sem ponto colorido
 *
 * O Dokploy usa um ponto verde aqui. No DBee, verde é **conexão viva**, e um
 * ponto verde no cabeçalho ficaria a poucos pixels dos pontos de saúde da
 * árvore, dizendo outra coisa na mesma forma — o erro já cometido com a tag de
 * cor da conexão (design-system, lista do §1.4). O ícone de download carrega o
 * significado sozinho.
 *
 * ## Vira ícone quando aperta
 *
 * Abaixo de `md` o rótulo some e sobra o ícone: em 375px o cabeçalho já leva a
 * marca e três controles, e o selo é qualificador, não identificador.
 */
export function UpdateBadge() {
  const { data: estado } = useVersao();
  const [aberto, setAberto] = useState(false);
  const t = useT();

  if (estado?.updateAvailable !== true) return null;

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0 px-2 md:px-2.5"
        title={t("update.badgeTitulo", { version: estado.latest ?? "" })}
        aria-label={t("update.badgeTitulo", { version: estado.latest ?? "" })}
        onClick={() => { setAberto(true); }}
      >
        <Download aria-hidden className="h-3.5 w-3.5" />
        <span className="hidden text-2xs md:inline">{t("update.badge")}</span>
      </Button>
      {aberto ? (
        <UpdateDialog estado={estado} onClose={() => { setAberto(false); }} />
      ) : null}
    </>
  );
}
