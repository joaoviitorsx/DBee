import type { ApiTokenSummary, CreateApiTokenResponse } from "@dbee/shared";
import { Check, Copy, Plus } from "lucide-react";
import { type CSSProperties, useEffect, useId, useState } from "react";

import { Badge, Button, Input, ModalPainel } from "../../components/ui";
import { useIdioma, type Tradutor } from "../../i18n";
import { cn } from "../../lib/cn";
import { copiarTexto } from "../../lib/navegador";
import { Trabalhando } from "../motion/Trabalhando";
import { IconeMcp } from "./IconeMcp";
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
  const idAjuda = useId();

  const enviar = (): void => {
    setErro(null);
    criar
      .mutateAsync(nome.trim())
      .then((r) => { setNovo(r); setNome(""); })
      .catch(() => { setErro(t("tokens.erroGenerico")); });
  };

  const ativos = lista.data?.filter((tk) => tk.revokedAt === null).length ?? 0;

  return (
    <ModalPainel
      titulo={t("tokens.titulo")}
      descricao={t("tokens.descricao")}
      icone={<IconeMcp className="h-4 w-4" />}
      onClose={onClose}
    >
      {erro !== null ? (
        <p role="alert" className="mb-4 rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {erro}
        </p>
      ) : null}

      {novo !== null ? (
        <TokenNovo t={t} novo={novo} onFechar={() => { setNovo(null); }} />
      ) : (
        <form
          className="mb-5"
          onSubmit={(e) => { e.preventDefault(); enviar(); }}
        >
          <label htmlFor={idNome} className="mb-1.5 block text-xs font-medium text-muted">
            {t("tokens.nome")}
          </label>
          <p id={idAjuda} className="-mt-1 mb-2 text-2xs text-subtle">{t("tokens.nomeAjuda")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={idNome}
              value={nome}
              maxLength={100}
              aria-describedby={idAjuda}
              placeholder={t("tokens.nomeExemplo")}
              className="sm:flex-1"
              onChange={(e) => { setNome(e.target.value); }}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={nome.trim() === ""}
              loading={criar.isPending}
              loadingLabel={t("tokens.criando")}
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
              {t("tokens.criar")}
            </Button>
          </div>
        </form>
      )}

      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-ink">{t("tokens.lista")}</h3>
        {lista.data !== undefined && lista.data.length > 0 ? (
          <span className="text-2xs tabular-nums text-subtle">
            {t(ativos === 1 ? "tokens.ativos1" : "tokens.ativos", { n: String(ativos) })}
          </span>
        ) : null}
      </div>

      {lista.isPending ? (
        <Trabalhando rotulo={t("tokens.carregando")} />
      ) : lista.isError ? (
        <p className="py-6 text-center text-xs text-danger">{t("tokens.erroLer")}</p>
      ) : lista.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[6px] border border-dashed border-line px-4 py-8 text-center">
          <IconeMcp className="h-6 w-6 text-subtle" />
          <p className="text-xs text-muted">{t("tokens.vazio")}</p>
          <p className="max-w-[40ch] text-2xs leading-relaxed text-subtle">{t("tokens.vazioAjuda")}</p>
        </div>
      ) : (
        <ul className="motion-stagger -mx-2 flex flex-col">
          {lista.data.map((tk, i) => (
            <li key={tk.id} style={{ "--i": i } as CSSProperties}>
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
    </ModalPainel>
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
    <section className="motion-fade mb-5 border-b border-line pb-5">
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <Check aria-hidden className="h-4 w-4 text-ok" />
        {t("tokens.novoTitulo")}
      </p>
      <p className="mt-1 text-2xs leading-relaxed text-subtle">{t("tokens.novoAjuda")}</p>

      <BlocoDeCodigo t={t} rotulo={t("tokens.segredo")} texto={novo.secret} />
      <BlocoDeCodigo t={t} rotulo={t("tokens.snippet")} texto={comando} prompt />

      <div className="mt-4 flex justify-end">
        <Button type="button" size="sm" variant="secondary" onClick={onFechar}>
          {t("tokens.fechar")}
        </Button>
      </div>
    </section>
  );
}

/**
 * Código copiável: faixa com rótulo e botão, corpo em mono quebrando onde for
 * preciso (o segredo não tem espaço). O ícone de copiar gira para um check e
 * volta sozinho depois de um tempo — o "Copiado" não fica mentindo se a pessoa
 * copiar outra coisa no meio.
 */
function BlocoDeCodigo({
  t,
  rotulo,
  texto,
  prompt = false,
}: {
  readonly t: Tradutor;
  readonly rotulo: string;
  readonly texto: string;
  readonly prompt?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const id = setTimeout(() => { setCopiado(false); }, 2000);
    return () => { clearTimeout(id); };
  }, [copiado]);

  return (
    <div className="mt-3 overflow-hidden rounded-[6px] border border-line bg-sunken">
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pl-3 pr-1">
        <span className="text-2xs font-medium text-subtle">{rotulo}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 max-lg:h-9"
          onClick={() => { void copiarTexto(texto).then((ok) => { setCopiado(ok); }); }}
        >
          <span className="relative grid h-3.5 w-3.5 place-items-center">
            <Copy aria-hidden data-ativo={copiado ? undefined : ""} className="motion-troca absolute h-3.5 w-3.5" />
            <Check aria-hidden data-ativo={copiado ? "" : undefined} className="motion-troca absolute h-3.5 w-3.5 text-ok" />
          </span>
          <span aria-live="polite">{t(copiado ? "tokens.copiado" : "tokens.copiar")}</span>
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-2xs leading-relaxed text-ink">
        {prompt ? <span aria-hidden className="select-none text-subtle">$ </span> : null}
        {texto}
      </pre>
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
    <div
      className={cn(
        "rounded-[6px] px-2 py-2.5 transition-colors duration-(--motion-fast)",
        confirmando ? "bg-danger/10" : "hover:bg-raised",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("min-w-0 flex-1", revogado && "opacity-55")}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("min-w-0 truncate text-sm text-ink", revogado && "line-through decoration-subtle")}>
              {token.name}
            </span>
            {revogado ? <Badge tone="neutral">{t("tokens.revogado")}</Badge> : null}
          </div>
          <p className="mt-0.5 text-2xs leading-relaxed text-subtle">
            <span className="font-mono">dbee_{token.prefix}_…</span>
            {" · "}
            {t("tokens.criadoEm", { data: formatarData(token.createdAt) })}
            {" · "}
            {token.lastUsedAt === null
              ? t("tokens.nuncaUsado")
              : t("tokens.usadoEm", { data: formatarData(token.lastUsedAt) })}
          </p>
        </div>
        {!revogado && !confirmando ? (
          <Button type="button" size="sm" variant="ghost" className="shrink-0 hover:bg-danger/10 hover:text-danger" disabled={ocupado} onClick={onPedir}>
            {t("tokens.revogar")}
          </Button>
        ) : null}
      </div>
      {confirmando ? (
        <div className="motion-fade mt-2 flex flex-wrap items-center gap-2">
          <p className="min-w-[16ch] flex-1 text-2xs leading-relaxed text-danger">
            {t("tokens.revogarConfirma", { nome: token.name })}
          </p>
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
