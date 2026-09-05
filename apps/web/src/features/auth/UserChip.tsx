import { LogOut } from "lucide-react";

import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { useLogout, useSession } from "./useSession";

/**
 * Quem está logado, na barra superior.
 *
 * Não é enfeite de perfil: **é o `actor` que vai para o `query_log`**. Toda
 * query executada nesta aba fica gravada com este nome, e a pessoa tem direito
 * de ver isso sem procurar.
 *
 * Sem menu suspenso para uma ação só — o menu seria um clique a mais para
 * chegar no mesmo lugar.
 */
export function UserChip() {
  const sessao = useSession();
  const sair = useLogout();
  const t = useT();

  const user = sessao.data;
  if (user == null) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span
        className="hidden font-mono text-2xs text-subtle sm:inline"
        title={t("userchip.registrado", { user: user.username })}
      >
        {user.username}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={t("userchip.sair", { user: user.username })}
        loading={sair.isPending}
        onClick={() => { sair.mutate(); }}
      >
        <LogOut aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
