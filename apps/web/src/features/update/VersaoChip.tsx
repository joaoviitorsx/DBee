import { useState } from "react";

import { useT } from "../../i18n";
import { UpdateDialog } from "./UpdateDialog";
import { useVersao } from "./useUpdate";

/**
 * A versão em execução, na barra superior — e a porta de entrada do diálogo.
 *
 * ## Uma fonte de versão, não duas
 *
 * Aqui havia um `v{__APP_VERSION__}`, lido do `apps/web/package.json` em tempo
 * de build do Vite. O binário do servidor passou a afirmar a **tag do git**
 * (§8), e as duas fontes divergem no instante em que alguém taggeia sem bumpar
 * o `package.json`: o cabeçalho diria `v0.1.3` e o diálogo, `v0.2.0`, na mesma
 * tela. Duas versões que se contradizem valem menos que nenhuma — quem lê não
 * tem como saber qual acreditar. Passa a ler do servidor, que é quem sabe o que
 * está rodando.
 *
 * ## Por que é clicável
 *
 * O selo de atualização só existe quando há versão nova. Sem este botão, com o
 * app em dia não haveria caminho nenhum até o diálogo — nem para configurar a
 * URL de deploy antes de precisar dela, nem para verificar na hora, nem para
 * desligar a verificação automática.
 */
export function VersaoChip() {
  const { data: estado } = useVersao();
  const [aberto, setAberto] = useState(false);
  const t = useT();

  if (estado === undefined) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { setAberto(true); }}
        title={t("update.titulo")}
        className="hidden shrink-0 cursor-pointer rounded-[4px] px-1 py-0.5 text-2xs text-subtle transition-colors duration-150 hover:text-muted sm:inline"
      >
        {estado.current}
      </button>
      {aberto ? (
        <UpdateDialog estado={estado} onClose={() => { setAberto(false); }} />
      ) : null}
    </>
  );
}
