import { Users } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { useSession } from "../auth/useSession";
import { UsuariosDialog } from "./UsuariosDialog";

/**
 * A porta da administração de contas, na barra superior.
 *
 * **Só aparece para admin — e isso não é o controle.** Esconder o botão não
 * impede um `POST /api/users` montado à mão; quem recusa é o `exigirAdmin` no
 * servidor, com teste varrendo as cinco rotas. A checagem aqui existe para não
 * oferecer a um `member` um caminho que terminaria em 403.
 *
 * Fica ao lado do `UserChip` porque é o mesmo assunto: quem está logado, e quem
 * mais tem conta.
 */
export function UsuariosBotao() {
  const sessao = useSession();
  const [aberto, setAberto] = useState(false);
  const t = useT();

  const user = sessao.data;
  if (user?.role !== "admin") return null;

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={t("usuarios.abrir")}
        title={t("usuarios.abrir")}
        onClick={() => { setAberto(true); }}
      >
        <Users aria-hidden className="h-3.5 w-3.5" />
      </Button>
      {aberto ? (
        <UsuariosDialog euId={user.id} onClose={() => { setAberto(false); }} />
      ) : null}
    </>
  );
}
