import { Eye, EyeOff, Lock, LogIn, User } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../../components/ui";
import { mensagemDoCodigo, useT } from "../../i18n";
import { AuthPanel, CampoCredencial } from "./AuthPanel";
import { ErroApi, useLogin } from "./useSession";

/**
 * Entrada no DBee (DBee.md §7).
 *
 * A tela não tem "esqueci minha senha" nem "criar conta" — recuperação e
 * convite são v0.2, e um link que leva a lugar nenhum é pior que a ausência
 * dele. Quem perdeu a senha do único usuário resolve pelo servidor, e o rodapé
 * diz isso em vez de deixar a pessoa procurando.
 */
export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const login = useLogin();
  const formulario = useRef<HTMLFormElement>(null);
  const t = useT();

  /**
   * Botão sempre clicável.
   *
   * Desabilitar até o formulário estar válido tem três defeitos ao mesmo
   * tempo: o botão nasce apagado e parece quebrado, ele deixa de ser focável
   * por teclado, e ele **não diz o que falta** — a pessoa fica olhando para um
   * botão morto sem saber qual campo está vazio. Clicar com campo vazio leva o
   * foco até ele, que é a resposta que a pessoa queria.
   */
  const enviar = (): void => {
    const focar = (id: string): void => {
      formulario.current?.querySelector<HTMLInputElement>(`#${id}`)?.focus();
    };
    if (username.trim() === "") {
      focar("usuario");
      return;
    }
    if (password === "") {
      focar("senha");
      return;
    }
    login.mutate({ username: username.trim().toLowerCase(), password });
  };

  return (
    <AuthPanel
      titulo={t("login.titulo")}
      descricao={t("login.descricao")}
      humor={login.isError ? "pensando" : "laptop"}
      ocupado={login.isPending}
      recusado={login.isError}
      rodape={t("login.rodape")}
    >
      <form
        ref={formulario}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!login.isPending) enviar();
        }}
        className="space-y-4"
      >
        <CampoCredencial
          id="usuario"
          rotulo={t("login.usuario")}
          tipo="text"
          valor={username}
          onChange={setUsername}
          autoComplete="username"
          autoFocus
          icone={<User aria-hidden className="h-4 w-4" />}
          invalido={login.isError}
        />

        <div
          // Caps Lock é a causa mais comum de senha certa recusada, e quase
          // nenhum campo de senha avisa. O evento vale para o campo, não para
          // a página: só interessa enquanto se digita a senha.
          onKeyUp={(e) => { setCapsLock(e.getModifierState("CapsLock")); }}
          onKeyDown={(e) => { setCapsLock(e.getModifierState("CapsLock")); }}
        >
          <CampoCredencial
            id="senha"
            rotulo={t("login.senha")}
            tipo={verSenha ? "text" : "password"}
            valor={password}
            onChange={setPassword}
            autoComplete="current-password"
            icone={<Lock aria-hidden className="h-4 w-4" />}
            invalido={login.isError}
            aviso={capsLock ? t("login.capsLock") : null}
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
        </div>

        {login.isError ? (
          // `role="alert"` porque a mensagem aparece depois da ação: sem ele,
          // quem usa leitor de tela clica em Entrar e não ouve nada.
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {login.error instanceof ErroApi
              ? mensagemDoCodigo(t, login.error.code, login.error.message)
              : login.error.message}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          // Botão com peso: sobe 2px e ganha um halo âmbar no hover, volta no
          // clique. Só transform/shadow — compositado. O halo âmbar lê nos dois
          // temas; sob prefers-reduced-motion a transição some pelo bloco global.
          className="h-11 w-full transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-8px_rgba(245,166,35,0.6)] active:translate-y-0 active:shadow-none"
          loading={login.isPending}
          loadingLabel={t("login.entrando")}
        >
          <LogIn aria-hidden className="h-4 w-4" />
          {t("login.entrar")}
        </Button>
      </form>
    </AuthPanel>
  );
}
