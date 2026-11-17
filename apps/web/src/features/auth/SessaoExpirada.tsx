import * as Dialog from "@radix-ui/react-dialog";
import { Lock, User } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui";
import { mensagemDoCodigo, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { CampoCredencial } from "./AuthPanel";
import { ErroApi, useLogin } from "./useSession";

/**
 * Sessão que venceu com o app aberto (ui-detalhes §3.7, §1.8).
 *
 * O login aparece **por cima** das abas, que continuam montadas — o SQL não
 * salvo, a posição no grid e o resultado na tela sobrevivem. Ao entrar,
 * `useLogin` invalida o cache e toda consulta que tomou 401 roda de novo: é a
 * "ação repete". Sem toast: é um bloqueio, não um aviso de passagem.
 *
 * Não fecha por Esc nem por clique fora — atrás dele nada funciona sem sessão,
 * e um modal que some deixaria a pessoa clicando numa tela que só devolve 401.
 */
export function SessaoExpirada({ usuario }: { readonly usuario: string }) {
  const t = useT();
  const login = useLogin();
  const [username, setUsername] = useState(usuario);
  const [password, setPassword] = useState("");

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="veu-dialogo" />
        <Dialog.Content
          onEscapeKeyDown={(e) => { e.preventDefault(); }}
          onPointerDownOutside={(e) => { e.preventDefault(); }}
          onInteractOutside={(e) => { e.preventDefault(); }}
          className={cn(
            "focus-visible:outline-none",
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-surface p-5 shadow-[0_24px_64px_rgba(0,0,0,.45)]",
          )}
        >
          <Dialog.Title className="text-base font-semibold text-ink">{t("sessao.expirouTitulo")}</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-xs leading-relaxed text-muted">
            {t("sessao.expirouAjuda")}
          </Dialog.Description>
          <form
            noValidate
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (login.isPending || username.trim() === "" || password === "") return;
              login.mutate({ username: username.trim().toLowerCase(), password });
            }}
          >
            <CampoCredencial
              id="expirou-usuario"
              rotulo={t("login.usuario")}
              tipo="text"
              valor={username}
              onChange={setUsername}
              autoComplete="username"
              icone={<User aria-hidden className="h-4 w-4" />}
              invalido={login.isError}
            />
            <CampoCredencial
              id="expirou-senha"
              rotulo={t("login.senha")}
              tipo="password"
              valor={password}
              onChange={setPassword}
              autoComplete="current-password"
              autoFocus
              icone={<Lock aria-hidden className="h-4 w-4" />}
              invalido={login.isError}
            />
            {login.isError ? (
              <p role="alert" className="text-xs text-danger">
                {login.error instanceof ErroApi
                  ? mensagemDoCodigo(t, login.error.code, login.error.message)
                  : login.error.message}
              </p>
            ) : null}
            <Button
              type="submit"
              className="h-10 w-full border-transparent bg-ink text-sm font-semibold text-surface hover:border-transparent hover:bg-ink/85"
              loading={login.isPending}
              loadingLabel={t("login.entrando")}
            >
              {t("login.entrar")}
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
