import { Check, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";

import type { SessionUser } from "@dbee/shared";

import { Button } from "../../components/ui";
import { mensagemDoCodigo, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { AuthPanel, CampoCredencial } from "./AuthPanel";
import { ErroApi, useTrocarSenha } from "./useSession";

const MINIMO = 12;

/**
 * Troca obrigatória no primeiro acesso (DBee.md §7).
 *
 * A tela **explica o motivo** em vez de só exigir: a senha atual apareceu no
 * stdout do container quando o DBee subiu, então ela está no log do Docker e no
 * Dokploy. Exigir sem dizer por quê treina a pessoa a ignorar exigências.
 */
export function ChangePasswordScreen({ user }: { readonly user: SessionUser }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [ver, setVer] = useState(false);
  const trocar = useTrocarSenha();
  const t = useT();

  const curta = nova.length > 0 && nova.length < MINIMO;
  const igual = nova !== "" && nova === atual;
  const podeEnviar = atual !== "" && nova.length >= MINIMO && !igual && !trocar.isPending;

  return (
    <AuthPanel
      titulo={t("senha.titulo")}
      descricao={t("senha.descricao", { user: user.username })}
      humor={trocar.isError ? "pensando" : "joia"}
      ocupado={trocar.isPending}
      recusado={trocar.isError}
      rodape={t("senha.rodape")}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (podeEnviar) trocar.mutate({ currentPassword: atual, newPassword: nova });
        }}
        className="space-y-4"
      >
        <CampoCredencial
          id="atual"
          rotulo={t("senha.atual")}
          tipo="password"
          valor={atual}
          onChange={setAtual}
          autoComplete="current-password"
          autoFocus
          dica={t("senha.dicaAtual")}
          invalido={trocar.isError}
        />

        <CampoCredencial
          id="nova"
          rotulo={t("senha.nova")}
          tipo={ver ? "text" : "password"}
          valor={nova}
          onChange={setNova}
          autoComplete="new-password"
          dica={t("senha.dicaNova", { n: MINIMO })}
          invalido={igual}
          aviso={igual ? t("senha.igual") : null}
          acao={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              aria-label={ver ? t("login.ocultarSenha") : t("login.mostrarSenha")}
              aria-pressed={ver}
              onClick={() => { setVer((v) => !v); }}
            >
              {ver ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
            </Button>
          }
        />

        {/*
          * Contador, não medidor de força.
          *
          * Medidor de força pontua composição — e é ele que produz `Senha@123`.
          * A única regra aqui é comprimento, então o que a tela mostra é
          * comprimento: um traço que enche até o mínimo e para de chamar
          * atenção depois.
          */}
        <div className="flex items-center gap-2.5">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-200",
                nova.length >= MINIMO ? "bg-ok" : "bg-amber",
              )}
              style={{ width: `${String(Math.min(100, (nova.length / MINIMO) * 100))}%` }}
            />
          </div>
          <span
            className={cn(
              "font-mono text-2xs tabular-nums",
              nova.length >= MINIMO ? "text-ok" : curta ? "text-accent" : "text-subtle",
            )}
          >
            {nova.length >= MINIMO ? (
              <span className="flex items-center gap-1">
                <Check aria-hidden className="h-3 w-3" />
                {nova.length}
              </span>
            ) : (
              `${String(nova.length)}/${String(MINIMO)}`
            )}
          </span>
        </div>

        {trocar.isError ? (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {trocar.error instanceof ErroApi
              ? mensagemDoCodigo(t, trocar.error.code, trocar.error.message)
              : trocar.error.message}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          className="h-11 w-full"
          disabled={!podeEnviar}
          loading={trocar.isPending}
          loadingLabel={t("senha.trocando")}
        >
          <KeyRound aria-hidden className="h-4 w-4" />
          {t("senha.botao")}
        </Button>
      </form>
    </AuthPanel>
  );
}
