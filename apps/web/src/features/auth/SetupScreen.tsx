import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../../components/ui";
import { mensagemDoCodigo, useT } from "../../i18n";
import { AuthPanel, CampoCredencial } from "./AuthPanel";
import { ErroApi, useConcluirSetup } from "./useSession";

/**
 * Primeiro acesso (DBee.md §7).
 *
 * Aparece só enquanto não há nenhuma conta. A senha do primeiro usuário **não**
 * é gerada nem impressa em log — o operador lê um token do volume
 * (`docker exec … cat /data/setup-token`, ou o terminal do serviço no Dokploy) e
 * escolhe aqui usuário e senha. Senha em log seria senha visível no painel; o
 * token troca "quem leu o log" por "quem tem acesso ao volume".
 */
export function SetupScreen() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verSenha, setVerSenha] = useState(false);

  const setup = useConcluirSetup();
  const formulario = useRef<HTMLFormElement>(null);
  const t = useT();

  const enviar = (): void => {
    const focar = (id: string): void => {
      formulario.current?.querySelector<HTMLInputElement>(`#${id}`)?.focus();
    };
    if (token.trim() === "") {
      focar("setup-token");
      return;
    }
    if (username.trim() === "") {
      focar("setup-usuario");
      return;
    }
    if (password === "") {
      focar("setup-senha");
      return;
    }
    setup.mutate({ token: token.trim(), username: username.trim().toLowerCase(), password });
  };

  return (
    <AuthPanel
      titulo={t("setup.titulo")}
      descricao={t("setup.descricao")}
      humor={setup.isError ? "pensando" : "laptop"}
      ocupado={setup.isPending}
      recusado={setup.isError}
      rodape={t("setup.rodape")}
    >
      <form
        ref={formulario}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!setup.isPending) enviar();
        }}
        className="space-y-4"
      >
        <CampoCredencial
          id="setup-token"
          rotulo={t("setup.token")}
          tipo="text"
          valor={token}
          onChange={setToken}
          autoComplete="off"
          autoFocus
          invalido={setup.isError}
          dica={t("setup.tokenAjuda")}
        />

        <CampoCredencial
          id="setup-usuario"
          rotulo={t("setup.usuario")}
          tipo="text"
          valor={username}
          onChange={setUsername}
          autoComplete="username"
          invalido={setup.isError}
        />

        <CampoCredencial
          id="setup-senha"
          rotulo={t("setup.senha")}
          tipo={verSenha ? "text" : "password"}
          valor={password}
          onChange={setPassword}
          autoComplete="new-password"
          invalido={setup.isError}
          dica={t("setup.senhaAjuda")}
          acao={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              aria-label={verSenha ? t("login.ocultarSenha") : t("login.mostrarSenha")}
              aria-pressed={verSenha}
              onClick={() => { setVerSenha((v) => !v); }}
            >
              {verSenha ? (
                <EyeOff aria-hidden className="h-4 w-4" />
              ) : (
                <Eye aria-hidden className="h-4 w-4" />
              )}
            </Button>
          }
        />

        {setup.isError ? (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {setup.error instanceof ErroApi
              ? mensagemDoCodigo(t, setup.error.code, setup.error.message)
              : setup.error.message}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          className="h-11 w-full"
          loading={setup.isPending}
          loadingLabel={t("setup.criando")}
        >
          <KeyRound aria-hidden className="h-4 w-4" />
          {t("setup.criar")}
        </Button>
      </form>
    </AuthPanel>
  );
}
