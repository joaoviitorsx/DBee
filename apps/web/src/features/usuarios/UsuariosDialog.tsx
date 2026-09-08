import * as Dialog from "@radix-ui/react-dialog";
import type { Role, UserSummary } from "@dbee/shared";
import { KeyRound, Plus, ShieldCheck, Trash2, User as UserIcon, X } from "lucide-react";
import { useId, useState } from "react";

import { Badge, Button, Field, Input } from "../../components/ui";
import { useIdioma, type Tradutor } from "../../i18n";
import { cn } from "../../lib/cn";
import { ErroApi } from "../auth/useSession";
import { Trabalhando } from "../motion/Trabalhando";
import {
  useCriarUsuario,
  useDefinirPapel,
  useRemoverUsuario,
  useResetarSenha,
  useUsuarios,
} from "./useUsuarios";

/**
 * Administração de contas (DBee.md §9, v0.2).
 *
 * ## Por que um diálogo, e não uma aba
 *
 * As abas deste app são **por conexão** — uma tabela, uma consulta, uma
 * auditoria daquela conexão. Contas não pertencem a conexão nenhuma, e o
 * projeto não tem roteador. Um diálogo é o mesmo lugar onde já mora a outra
 * tela de instalação (a de atualização), então não inventa conceito novo.
 *
 * ## Isto não é o controle de acesso
 *
 * O botão que abre esta tela só aparece para quem é admin, mas **isso é
 * conveniência, não segurança**: esconder um botão não impede um `POST
 * /api/users` montado à mão. Quem recusa é o `exigirAdmin` no servidor, e há
 * teste varrendo as cinco rotas para provar isso. Aqui a checagem existe só
 * para não oferecer a alguém um caminho que terminaria em 403.
 *
 * ## A senha provisória é digitada, não gerada
 *
 * O admin escolhe e entrega por fora. Gerar exigiria mostrá-la numa tela para
 * ser copiada, e §7 é explícito sobre não produzir senha que precise ser
 * exibida ou transportada — foi assim que a senha impressa no log saiu do
 * projeto. A conta nasce obrigada a trocá-la no primeiro acesso.
 */

/** Traduz o `code` do servidor; a mensagem crua é a reserva. */
function mensagemDoErro(t: Tradutor, erro: unknown): string {
  const code = erro instanceof ErroApi ? erro.code : undefined;
  if (code === "last_admin") return t("usuarios.erroUltimoAdmin");
  if (code === "username_taken") return t("usuarios.erroNomeUsado");
  if (code === "self_target") return t("usuarios.erroPropriaConta");
  return t("usuarios.erroGenerico");
}

type Confirmacao =
  | { readonly tipo: "remover"; readonly alvo: UserSummary }
  | { readonly tipo: "resetar"; readonly alvo: UserSummary };

export function UsuariosDialog({
  euId,
  onClose,
}: {
  /** Quem está logado: a lista marca "você" e esconde ações sobre si. */
  readonly euId: string;
  readonly onClose: () => void;
}) {
  const { t } = useIdioma();
  const lista = useUsuarios(true);

  const [criando, setCriando] = useState(false);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const papel = useDefinirPapel();
  const remover = useRemoverUsuario();

  const agir = (p: Promise<unknown>, sucesso: string): void => {
    setErro(null);
    p.then(() => { setAviso(sucesso); setConfirmacao(null); })
      .catch((e: unknown) => { setErro(mensagemDoErro(t, e)); });
  };

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          // Mesmo motivo do diálogo de atualização: o anel âmbar de foco em
          // volta da modal inteira não diz nada.
          onOpenAutoFocus={(e) => { e.preventDefault(); }}
          className={cn(
            "focus-visible:outline-none",
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[calc(100dvh-2rem)] flex-col",
            "rounded-lg border border-line bg-surface animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-ink">
                {t("usuarios.titulo")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-2xs leading-relaxed text-subtle">
                {t("usuarios.descricao")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {aviso !== null ? (
              <p className="mb-3 rounded-[6px] border border-ok/25 bg-ok/10 px-3 py-2 text-xs text-ok">
                {aviso}
              </p>
            ) : null}
            {erro !== null ? (
              <p role="alert" className="mb-3 rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {erro}
              </p>
            ) : null}

            {criando ? (
              <FormularioNovaConta
                t={t}
                onCancelar={() => { setCriando(false); }}
                onCriada={(nome) => {
                  setCriando(false);
                  setErro(null);
                  setAviso(t("usuarios.criada", { user: nome }));
                }}
                onErro={(e) => { setErro(mensagemDoErro(t, e)); }}
              />
            ) : null}

            {lista.isPending ? (
              <Trabalhando rotulo={t("usuarios.carregando")} />
            ) : lista.isError ? (
              <p className="py-6 text-center text-xs text-danger">{t("usuarios.erroLer")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lista.data.map((u) => (
                  <li key={u.id}>
                    <LinhaDaConta
                      t={t}
                      conta={u}
                      sozinha={lista.data.length === 1}
                      eu={u.id === euId}
                      ocupado={papel.isPending || remover.isPending}
                      confirmacao={confirmacao?.alvo.id === u.id ? confirmacao : null}
                      onPapel={(role) => {
                        agir(
                          papel.mutateAsync({ id: u.id, role }),
                          t(role === "admin" ? "usuarios.papelAdmin" : "usuarios.papelMembro"),
                        );
                      }}
                      onPedir={(tipo) => { setErro(null); setAviso(null); setConfirmacao({ tipo, alvo: u }); }}
                      onCancelar={() => { setConfirmacao(null); }}
                      onRemover={() => {
                        agir(remover.mutateAsync(u.id), t("usuarios.removida", { user: u.username }));
                      }}
                      onResetada={() => { setAviso(t("usuarios.resetada", { user: u.username })); setConfirmacao(null); }}
                      onErro={(e) => { setErro(mensagemDoErro(t, e)); }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end border-t border-line px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={criando}
              onClick={() => { setCriando(true); setAviso(null); setErro(null); }}
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
              {t("usuarios.nova")}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Uma conta na lista, com as ações que cabem nela. */
function LinhaDaConta({
  t,
  conta,
  sozinha,
  eu,
  ocupado,
  confirmacao,
  onPapel,
  onPedir,
  onCancelar,
  onRemover,
  onResetada,
  onErro,
}: {
  readonly t: Tradutor;
  readonly conta: UserSummary;
  /** Única conta da instalação: não há o que administrar nela. */
  readonly sozinha: boolean;
  readonly eu: boolean;
  readonly ocupado: boolean;
  readonly confirmacao: Confirmacao | null;
  readonly onPapel: (role: Role) => void;
  readonly onPedir: (tipo: "remover" | "resetar") => void;
  readonly onCancelar: () => void;
  readonly onRemover: () => void;
  readonly onResetada: () => void;
  readonly onErro: (erro: unknown) => void;
}) {
  const admin = conta.role === "admin";

  return (
    <div className="rounded-[6px] border border-line bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {admin ? (
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />
        ) : (
          <UserIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-subtle" />
        )}
        <span className="truncate font-mono text-xs text-ink">{conta.username}</span>

        <Badge tone={admin ? "key" : "neutral"}>
          {t(admin ? "usuarios.papelAdmin" : "usuarios.papelMembro")}
        </Badge>
        {eu ? <Badge tone="neutral">{t("usuarios.voce")}</Badge> : null}
        {/*
          `neutral`, não `danger`: a conta não está em erro, só ainda não foi
          usada. Vermelho é do ato destrutivo (design-system §1.4), e três
          selos vermelhos numa lista de contas novas fazem a tela parecer
          alarme quando não há nada errado.
        */}
        {conta.mustChangePassword ? (
          <Badge tone="neutral" title={t("usuarios.trocaPendenteAjuda")}>
            {t("usuarios.trocaPendente")}
          </Badge>
        ) : null}

        <span className="ml-auto shrink-0 text-2xs text-subtle">
          {conta.activeSessions === 0
            ? t("usuarios.semSessao")
            : t(conta.activeSessions === 1 ? "usuarios.sessoes" : "usuarios.sessoesPlural", {
                n: String(conta.activeSessions),
              })}
        </span>
      </div>

      {confirmacao === null ? (
        // A única conta da instalação não recebe ação nenhuma: todas as três
        // seriam recusadas pelo servidor (último admin, própria conta), e
        // oferecer um botão que só produz erro é pior que não oferecer.
        sozinha ? null : (
          <div className="mt-2 flex flex-wrap gap-1">
            <Button
              type="button" size="sm" variant="ghost" disabled={ocupado}
              onClick={() => { onPapel(admin ? "member" : "admin"); }}
            >
              {t(admin ? "usuarios.tornarMembro" : "usuarios.tornarAdmin")}
            </Button>
            <Button
              type="button" size="sm" variant="ghost" disabled={ocupado}
              onClick={() => { onPedir("resetar"); }}
            >
              <KeyRound aria-hidden className="h-3.5 w-3.5" />
              {t("usuarios.resetar")}
            </Button>
            {/* Remover a própria conta é recusado pelo servidor; não é botão. */}
            {eu ? null : (
              <Button
                type="button" size="sm" variant="ghost" disabled={ocupado}
                onClick={() => { onPedir("remover"); }}
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                {t("usuarios.remover")}
              </Button>
            )}
          </div>
        )
      ) : confirmacao.tipo === "remover" ? (
        <div className="mt-2 rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2">
          <p className="text-2xs font-medium text-danger">
            {t("usuarios.removerTitulo", { user: conta.username })}
          </p>
          <p className="mt-0.5 text-2xs leading-relaxed text-danger/85">
            {t("usuarios.removerAjuda")}
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="danger" loading={ocupado} onClick={onRemover}>
              {t("comum.remover")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={ocupado} onClick={onCancelar}>
              {t("comum.cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <FormularioReset
          t={t}
          conta={conta}
          onCancelar={onCancelar}
          onPronto={onResetada}
          onErro={onErro}
        />
      )}
    </div>
  );
}

function FormularioNovaConta({
  t,
  onCancelar,
  onCriada,
  onErro,
}: {
  readonly t: Tradutor;
  readonly onCancelar: () => void;
  readonly onCriada: (username: string) => void;
  readonly onErro: (erro: unknown) => void;
}) {
  const idUsuario = useId();
  const idSenha = useId();
  const criar = useCriarUsuario();

  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<Role>("member");

  const valido = username.trim().length >= 3 && senha.length >= 12;

  const enviar = (): void => {
    if (!valido) return;
    criar
      .mutateAsync({ username: username.trim(), temporaryPassword: senha, role })
      .then(() => { onCriada(username.trim()); })
      .catch(onErro);
  };

  return (
    <form
      className="mb-4 rounded-[6px] border border-line bg-raised px-3 py-3"
      onSubmit={(e) => { e.preventDefault(); enviar(); }}
    >
      <p className="text-xs font-medium text-ink">{t("usuarios.novaTitulo")}</p>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Field
          label={t("usuarios.usuario")}
          htmlFor={idUsuario}
          hint={t("usuarios.usuarioAjuda")}
          className="flex-1"
        >
          <Input
            id={idUsuario}
            mono
            autoFocus
            value={username}
            // Minúsculas na entrada: o schema do servidor recusa maiúscula, e
            // deixar a pessoa digitar para levar 422 depois é desperdício.
            onChange={(e) => { setUsername(e.target.value.toLowerCase()); }}
            autoComplete="off"
            spellCheck={false}
            className="h-9 text-xs"
          />
        </Field>

        <Field
          label={t("usuarios.senhaProvisoria")}
          htmlFor={idSenha}
          hint={t("usuarios.senhaProvisoriaAjuda")}
          className="flex-1"
        >
          <Input
            id={idSenha}
            type="password"
            value={senha}
            onChange={(e) => { setSenha(e.target.value); }}
            autoComplete="new-password"
            className="h-9 text-xs"
          />
        </Field>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-muted">{t("usuarios.papel")}</legend>
        <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:gap-2">
          {(["member", "admin"] as const).map((valor) => (
            <label
              key={valor}
              className={cn(
                "flex flex-1 cursor-pointer items-start gap-2 rounded-[4px] border px-2.5 py-2 transition-colors duration-150",
                role === valor
                  ? "border-accent-line bg-accent-soft"
                  : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <input
                type="radio"
                name="papel"
                className="mt-0.5 accent-[var(--color-accent)]"
                checked={role === valor}
                onChange={() => { setRole(valor); }}
              />
              <span className="min-w-0">
                <span className="block text-xs text-ink">
                  {t(valor === "admin" ? "usuarios.papelAdmin" : "usuarios.papelMembro")}
                </span>
                <span className="block text-2xs leading-relaxed text-subtle">
                  {t(valor === "admin" ? "usuarios.papelAdminAjuda" : "usuarios.papelMembroAjuda")}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!valido}
          loading={criar.isPending}
          loadingLabel={t("usuarios.criando")}
        >
          {t("usuarios.criar")}
        </Button>
        <Button
          type="button" size="sm" variant="ghost"
          disabled={criar.isPending}
          onClick={onCancelar}
        >
          {t("comum.cancelar")}
        </Button>
      </div>
    </form>
  );
}

function FormularioReset({
  t,
  conta,
  onCancelar,
  onPronto,
  onErro,
}: {
  readonly t: Tradutor;
  readonly conta: UserSummary;
  readonly onCancelar: () => void;
  readonly onPronto: () => void;
  readonly onErro: (erro: unknown) => void;
}) {
  const idSenha = useId();
  const resetar = useResetarSenha();
  const [senha, setSenha] = useState("");

  return (
    <form
      className="mt-2 rounded-[4px] border border-line-strong bg-surface px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (senha.length < 12) return;
        resetar
          .mutateAsync({ id: conta.id, temporaryPassword: senha })
          .then(onPronto)
          .catch(onErro);
      }}
    >
      <p className="text-2xs font-medium text-ink">
        {t("usuarios.resetarTitulo", { user: conta.username })}
      </p>
      <p className="mt-0.5 text-2xs leading-relaxed text-subtle">{t("usuarios.resetarAjuda")}</p>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id={idSenha}
          type="password"
          autoFocus
          value={senha}
          onChange={(e) => { setSenha(e.target.value); }}
          aria-label={t("usuarios.senhaProvisoria")}
          autoComplete="new-password"
          className="h-9 flex-1 text-xs"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            type="submit" size="sm" variant="secondary" className="h-9"
            disabled={senha.length < 12}
            loading={resetar.isPending}
          >
            {t("usuarios.resetarConfirma")}
          </Button>
          <Button
            type="button" size="sm" variant="ghost" className="h-9"
            disabled={resetar.isPending}
            onClick={onCancelar}
          >
            {t("comum.cancelar")}
          </Button>
        </div>
      </div>
    </form>
  );
}
