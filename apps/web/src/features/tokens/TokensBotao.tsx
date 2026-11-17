import { useState } from "react";

import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { useSession } from "../auth/useSession";
import { IconeMcp } from "./IconeMcp";
import { TokensDialog } from "./TokensDialog";

/**
 * Porta dos tokens de API do MCP, na barra superior. Para toda conta — cada
 * pessoa cria os próprios tokens, com as próprias permissões.
 */
export function TokensBotao() {
  const sessao = useSession();
  const [aberto, setAberto] = useState(false);
  const t = useT();
  if (sessao.data === undefined || sessao.data === null) return null;

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={t("tokens.abrir")}
        title={t("tokens.abrir")}
        onClick={() => { setAberto(true); }}
      >
        <IconeMcp />
      </Button>
      {aberto ? <TokensDialog onClose={() => { setAberto(false); }} /> : null}
    </>
  );
}
