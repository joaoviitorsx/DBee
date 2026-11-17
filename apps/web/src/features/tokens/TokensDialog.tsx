import * as Dialog from "@radix-ui/react-dialog";
import type { ApiTokenSummary, CreateApiTokenResponse } from "@dbee/shared";
import { Check, Copy, KeyRound, Plus, X } from "lucide-react";
import { useId, useState } from "react";

import { Badge, Button, Field, Input } from "../../components/ui";
import { useIdioma, type Tradutor } from "../../i18n";
import { cn } from "../../lib/cn";
import { copiarTexto } from "../../lib/navegador";
import { Trabalhando } from "../motion/Trabalhando";
import { useCriarToken, useRevogarToken, useTokens } from "./useTokens";

/**
 * Tokens pessoais do MCP (ADR 015).
 *
 * Mesmo formato do diálogo de contas: contas e tokens não pertencem a conexão
 * nenhuma, e as abas do app são por conexão.
 *
 * O token aparece **uma vez**, logo depois de criado, com o comando pronto do
 * Claude Code. O servidor só guarda o hash — fechar o painel é perdê-lo, e o
 * botão diz isso ("Já copiei") em vez de um "OK" neutro.
 */
export function TokensDialog({ onClose }: { readonly onClose: () => void }) {
  const { t, formatarData } = useIdioma();
  const lista = useTokens();
  const criar = useCriarToken();
  const revogar = useRevogarToken();

  const [nome, setNome] = useState("");
  const [novo, setNovo] = useState<CreateApiTokenResponse | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const idNome = useId();

  const enviar = (): void => {
    setErro(null);
    criar
      .mutateAsync(nome.trim())
      .then((r) => { setNovo(r); setNome(""); })
      .catch(() => { setErro(t("tokens.erroGenerico")); });
  };

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
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
              <Dialog.Title className="text-base font-semibold text-ink">{t("tokens.titulo")}</Dialog.Title>
              <Dialog.Description className="mt-1 text-2xs leading-relaxed text-subtle">
                {t("tokens.descricao")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {erro !== null ? (
              <p role="alert" className="mb-3 rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {erro}
              </p>
            ) : null}

            {novo !== null ? (
              <TokenNovo t={t} novo={novo} onFechar={() => { setNovo(null); }} />
            ) : (
              <form
                className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => { e.preventDefault(); enviar(); }}
              >
                <Field label={t("tokens.nome")} htmlFor={idNome} hint={t("tokens.nomeAjuda")} className="flex-1">
                  <Input
                    id={idNome}
                    value={nome}
                    maxLength={100}
                    onChange={(e) => { setNome(e.target.value); }}
                  />
                </Field>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  className="sm:mb-[22px]"
                  disabled={nome.trim() === ""}
                  loading={criar.isPending}
                  loadingLabel={t("tokens.criando")}
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" />
                  {t("tokens.criar")}
                </Button>
              </form>
            )}

            {lista.isPending ? (
              <Trabalhando rotulo={t("tokens.carregando")} />
            ) : lista.isError ? (
              <p className="py-6 text-center text-xs text-danger">{t("tokens.erroLer")}</p>
            ) : lista.data.length === 0 ? (
              <p className="py-6 text-center text-xs text-subtle">{t("tokens.vazio")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lista.data.map((tk) => (
                  <li key={tk.id}>
                    <LinhaDoToken
                      t={t}
                      token={tk}
                      formatarData={formatarData}
                      confirmando={confirmando === tk.id}
                      ocupado={revogar.isPending}
                      onPedir={() => { setConfirmando(tk.id); }}
                      onCancelar={() => { setConfirmando(null); }}
                      onRevogar={() => {
                        revogar
                          .mutateAsync(tk.id)
                          .then(() => { setConfirmando(null); })
                          .catch(() => { setErro(t("tokens.erroGenerico")); });
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** O token recém-criado, a única vez em que ele existe fora do servidor. */
function TokenNovo({
  t,
  novo,
  onFechar,
}: {
  readonly t: Tradutor;
  readonly novo: CreateApiTokenResponse;
  readonly onFechar: () => void;
}) {
  const url = `${window.location.origin}/api/mcp`;
  const comando = `claude mcp add --transport http dbee ${url} --header "Authorization: Bearer ${novo.secret}"`;

  return (
    <div className="mb-4 rounded-[6px] border border-line bg-raised px-3 py-3">
      <p className="mb-2 text-xs font-medium text-ink">{t("tokens.novoTitulo")}</p>
      <Copiavel t={t} texto={novo.secret} />
      <p className="mb-1 mt-3 text-2xs text-subtle">{t("tokens.snippet")}</p>
      <Copiavel t={t} texto={comando} />
      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" variant="secondary" onClick={onFechar}>
          {t("tokens.fechar")}
        </Button>
      </div>
    </div>
  );
}

function Copiavel({ t, texto }: { readonly t: Tradutor; readonly texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded-[4px] border border-line bg-raised px-2 py-1.5 font-mono text-2xs text-ink">
        {texto}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={t("tokens.copiar")}
        onClick={() => {
          void copiarTexto(texto).then((ok) => { setCopiado(ok); });
        }}
      >
        {copiado ? <Check aria-hidden className="h-3.5 w-3.5 text-ok" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
        <span className="max-sm:sr-only">{t(copiado ? "tokens.copiado" : "tokens.copiar")}</span>
      </Button>
    </div>
  );
}

function LinhaDoToken({
  t,
  token,
  formatarData,
  confirmando,
  ocupado,
  onPedir,
  onCancelar,
  onRevogar,
}: {
  readonly t: Tradutor;
  readonly token: ApiTokenSummary;
  readonly formatarData: (iso: string) => string;
  readonly confirmando: boolean;
  readonly ocupado: boolean;
  readonly onPedir: () => void;
  readonly onCancelar: () => void;
  readonly onRevogar: () => void;
}) {
  const revogado = token.revokedAt !== null;
  return (
    <div className={cn("rounded-[6px] border border-line bg-raised px-3 py-2.5", revogado && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KeyRound aria-hidden className="h-3.5 w-3.5 shrink-0 text-subtle" />
        <span className="min-w-0 truncate text-xs text-ink">{token.name}</span>
        <span className="font-mono text-2xs text-subtle">dbee_{token.prefix}_…</span>
        {revogado ? <Badge tone="neutral">{t("tokens.revogado")}</Badge> : null}
        {!revogado && !confirmando ? (
          <Button type="button" size="sm" variant="danger" className="ml-auto" disabled={ocupado} onClick={onPedir}>
            {t("tokens.revogar")}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-2xs text-subtle">
        {t("tokens.criadoEm", { data: formatarData(token.createdAt) })}
        {" · "}
        {token.lastUsedAt === null
          ? t("tokens.nuncaUsado")
          : t("tokens.usadoEm", { data: formatarData(token.lastUsedAt) })}
      </p>
      {confirmando ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="flex-1 text-2xs text-danger">{t("tokens.revogarConfirma", { nome: token.name })}</p>
          <Button type="button" size="sm" variant="ghost" onClick={onCancelar}>
            {t("tokens.cancelar")}
          </Button>
          <Button type="button" size="sm" variant="danger" loading={ocupado} onClick={onRevogar}>
            {t("tokens.revogar")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
