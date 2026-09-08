import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import type { VersionStatus } from "@dbee/shared";
import { ArrowUpRight, Download, Loader2, RefreshCw, X } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Input } from "../../components/ui";
import { useIdioma, type Tradutor } from "../../i18n";
import { cn } from "../../lib/cn";
import {
  esperarServidorVoltar,
  FalhaDeUpdate,
  useDispararUpdate,
  useSalvarAjustes,
  useVerificarAgora,
  type CodigoDeFalha,
} from "./useUpdate";

/**
 * Quanto tempo esperar o container voltar antes de desistir e mandar a pessoa
 * olhar o Dokploy. Um pull de imagem em rede ruim passa fácil de um minuto.
 */
const LIMITE_ESPERA_MS = 180_000;

const MENSAGEM_POR_CODIGO: Record<CodigoDeFalha, "update.erroNaoConfigurado" | "update.erroCedoDemais" | "update.erroDisparo"> = {
  update_not_configured: "update.erroNaoConfigurado",
  update_too_soon: "update.erroCedoDemais",
  update_failed: "update.erroDisparo",
  desconhecido: "update.erroDisparo",
};

function mensagemDaFalha(t: Tradutor, erro: unknown): string {
  return t(MENSAGEM_POR_CODIGO[erro instanceof FalhaDeUpdate ? erro.codigo : "desconhecido"]);
}

/**
 * Diálogo de atualização (DBee.md §8).
 *
 * Três estados, e o do meio é o que costuma ser esquecido:
 *
 * 1. **sem URL de deploy** — o campo de configuração, uma vez na vida da
 *    instalação;
 * 2. **pronto** — o botão;
 * 3. **atualizando** — o servidor está morrendo por ordem nossa. A página
 *    espera ele voltar e recarrega. Sem este estado, a pessoa veria a aba
 *    quebrar e concluiria que a atualização falhou.
 */
export function UpdateDialog({
  estado,
  onClose,
}: {
  readonly estado: VersionStatus;
  readonly onClose: () => void;
}) {
  const { t, formatarData } = useIdioma();
  const [url, setUrl] = useState("");
  const [editandoUrl, setEditandoUrl] = useState(!estado.webhookConfigured);
  const [erro, setErro] = useState<string | null>(null);
  const [aguardando, setAguardando] = useState(false);
  const [naoVoltou, setNaoVoltou] = useState(false);
  // Remover pede confirmação porque a URL **não volta**: ela é gravada cifrada
  // e nunca é devolvida pela API (é credencial), então quem apagar por engano
  // precisa buscá-la no Dokploy de novo.
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);

  const salvar = useSalvarAjustes();
  const verificar = useVerificarAgora();
  const disparar = useDispararUpdate();

  const salvarUrl = (): void => {
    const limpa = url.trim();
    if (limpa === "") return;
    setErro(null);
    salvar.mutate(
      { webhookUrl: limpa },
      {
        onSuccess: () => { setEditandoUrl(false); setUrl(""); setConfirmandoRemocao(false); },
        onError: (e) => {
          setErro(
            e instanceof FalhaDeUpdate && e.codigo === "update_not_configured"
              ? t("update.erroUrlInvalida")
              : t("update.erroSalvar"),
          );
        },
      },
    );
  };

  /**
   * Apaga a URL guardada. `null` no `webhookUrl` é o que o schema define como
   * "desconfigura" — diferente de ausente, que é "não mexe" (ver
   * `UpdateSettingsRequest`). Depois de apagar, o formulário volta sozinho:
   * ficar numa tela sem URL e sem campo para colar outra seria o mesmo beco
   * que esta mudança está corrigindo.
   */
  const removerUrl = (): void => {
    setErro(null);
    salvar.mutate(
      { webhookUrl: null },
      {
        onSuccess: () => { setConfirmandoRemocao(false); setEditandoUrl(true); setUrl(""); },
        onError: () => { setErro(t("update.erroSalvar")); },
      },
    );
  };

  const atualizar = (): void => {
    setErro(null);
    disparar.mutate(undefined, {
      onSuccess: () => {
        setAguardando(true);
        void esperarServidorVoltar(LIMITE_ESPERA_MS).then((voltou) => {
          // Recarrega em vez de invalidar o cache: o bundle do front também
          // mudou, e uma aba com o JS antigo falando com a API nova é
          // justamente o par que ninguém testa.
          if (voltou) window.location.reload();
          else { setAguardando(false); setNaoVoltou(true); }
        });
      },
      onError: (e) => { setErro(mensagemDaFalha(t, e)); },
    });
  };

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !aguardando) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); }}
          className={cn(
            // O `:focus-visible` global pinta um anel âmbar de 2px. Num
            // controle isso é foco; num contêiner que só recebe foco de
            // rebote — quando o botão que estava focado é desabilitado — é o
            // acento mais forte da interface em volta da modal inteira,
            // dizendo nada.
            "focus-visible:outline-none",
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100dvh-2rem)] overflow-y-auto",
            "rounded-lg border border-line bg-surface animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-ink">
                {t("update.titulo")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-subtle">
                <span>{t("update.versaoAtual")}</span>
                <Badge tone="neutral" className="font-mono">{estado.current}</Badge>
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" disabled={aguardando} aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="space-y-4 px-5 py-4">
            {aguardando ? (
              <p
                role="status"
                className="flex items-start gap-2 rounded-[6px] border border-line bg-raised px-3 py-2.5 text-xs text-muted"
              >
                <Loader2 aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 animate-spin" />
                {t("update.reiniciando")}
              </p>
            ) : (
              <Cabecalho estado={estado} t={t} />
            )}

            {naoVoltou ? (
              <p role="alert" className="rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {t("update.naoVoltou", { segundos: LIMITE_ESPERA_MS / 1000 })}
              </p>
            ) : null}

            {estado.updateAvailable && !aguardando ? (
              <p className="text-xs leading-relaxed text-muted">{t("update.porQue")}</p>
            ) : null}

            {!aguardando ? (
              <div className="rounded-[6px] border border-line bg-raised px-3 py-2.5">
                <p className="text-xs leading-relaxed text-muted">{t("update.recomendacao")}</p>
                <a
                  href={estado.releaseNotesUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  {t("update.notas")}
                  <ArrowUpRight aria-hidden className="h-3 w-3" />
                </a>
              </div>
            ) : null}

            {editandoUrl && !aguardando ? (
              <ConfigDoDeploy
                t={t}
                url={url}
                onUrl={setUrl}
                onSalvar={salvarUrl}
                salvando={salvar.isPending}
                // Só dá para desistir se existe uma URL guardada para voltar.
                // Na primeira configuração, "cancelar" levaria a uma tela sem
                // saída nenhuma.
                onCancelar={
                  estado.webhookConfigured
                    ? () => { setEditandoUrl(false); setUrl(""); setErro(null); }
                    : undefined
                }
              />
            ) : null}

            {estado.webhookConfigured && !editandoUrl && !aguardando ? (
              <WebhookConfigurado
                t={t}
                confirmando={confirmandoRemocao}
                salvando={salvar.isPending}
                onTrocar={() => { setUrl(""); setErro(null); setEditandoUrl(true); }}
                onPedirRemocao={() => { setConfirmandoRemocao(true); }}
                onCancelarRemocao={() => { setConfirmandoRemocao(false); }}
                onRemover={removerUrl}
              />
            ) : null}

            {erro !== null ? (
              <p role="alert" className="rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {erro}
              </p>
            ) : null}

            {!aguardando ? (
              <div className="flex items-start justify-between gap-4 pt-1">
                <div className="min-w-0">
                  <label htmlFor="update-auto" className="text-xs font-medium text-ink">
                    {t("update.autoCheck")}
                  </label>
                  <p className="mt-0.5 text-2xs leading-relaxed text-subtle">
                    {t("update.autoCheckAjuda")}
                  </p>
                </div>
                {/*
                  Sem âmbar no estado ligado: âmbar sólido é exclusivo do modo
                  escrita (design-system §1.4), e um interruptor âmbar aqui
                  diria "gravável" para o olho no mesmo cabeçalho onde esse
                  vocabulário já significa outra coisa.
                */}
                <Switch.Root
                  id="update-auto"
                  checked={estado.autoCheck}
                  disabled={salvar.isPending}
                  onCheckedChange={(ligado) => { salvar.mutate({ autoCheck: ligado }); }}
                  className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-line bg-raised transition-colors duration-150 data-[state=checked]:border-line-strong data-[state=checked]:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Switch.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-muted transition-transform duration-150 data-[state=checked]:translate-x-6 data-[state=checked]:bg-surface" />
                </Switch.Root>
              </div>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <span className="text-2xs text-subtle">
              {estado.checkedAt === null
                ? t("update.nuncaVerificado")
                : t("update.verificadoEm", { quando: formatarData(estado.checkedAt) })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={aguardando}
                loading={verificar.isPending}
                onClick={() => { verificar.mutate(); }}
              >
                <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                {t("update.verificarAgora")}
              </Button>
              {estado.webhookConfigured && !editandoUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={!estado.updateAvailable || aguardando}
                  loading={disparar.isPending || aguardando}
                  loadingLabel={t("update.atualizando")}
                  onClick={atualizar}
                >
                  <Download aria-hidden className="h-3.5 w-3.5" />
                  {t("update.atualizar")}
                </Button>
              ) : null}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A linha que diz o que está acontecendo com a versão. */
function Cabecalho({ estado, t }: { readonly estado: VersionStatus; readonly t: Tradutor }) {
  if (estado.updateAvailable && estado.latest !== null) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-[6px] border border-ok/25 bg-ok/10 px-3 py-2.5 text-xs font-medium text-ok">
        <Download aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {t("update.novaVersao")}
        <span className="font-mono">{estado.latest}</span>
      </p>
    );
  }
  const [titulo, detalhe] =
    estado.latest === null
      ? ([t("update.semInfo"), t("update.semInfoDetalhe")] as const)
      : ([t("update.emDia"), t("update.emDiaDetalhe")] as const);
  return (
    <div className="rounded-[6px] border border-line bg-raised px-3 py-2.5">
      <p className="text-xs font-medium text-ink">{titulo}</p>
      <p className="mt-0.5 text-2xs text-subtle">{detalhe}</p>
    </div>
  );
}

/**
 * O passo único de configuração.
 *
 * Não é variável de ambiente de propósito: configurar por `environment` no
 * compose exigiria um deploy manual para habilitar o mecanismo que existe
 * para evitar deploy manual. Colada aqui, fica cifrada no SQLite e trocá-la
 * não custa deploy nenhum (DBee.md §8).
 */
function ConfigDoDeploy({
  t,
  url,
  onUrl,
  onSalvar,
  salvando,
  onCancelar,
}: {
  readonly t: Tradutor;
  readonly url: string;
  readonly onUrl: (v: string) => void;
  readonly onSalvar: () => void;
  readonly salvando: boolean;
  /** Ausente na primeira configuração: não há para onde voltar. */
  readonly onCancelar?: (() => void) | undefined;
}) {
  const trocando = onCancelar !== undefined;
  return (
    <div className="rounded-[6px] border border-line bg-raised px-3 py-3">
      <p className="text-xs font-medium text-ink">
        {trocando ? t("update.trocarUrl") : t("update.configTitulo")}
      </p>
      <p className="mt-1 text-2xs leading-relaxed text-subtle">{t("update.configAjuda")}</p>
      <p className="mt-1.5 font-mono text-2xs text-muted">{t("update.configOnde")}</p>
      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
        <Input
          // O passo é colar: o cursor começa aqui, não no botão de fechar.
          autoFocus
          mono
          value={url}
          onChange={(e) => { onUrl(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") onSalvar(); }}
          placeholder="https://dokploy.exemplo/api/deploy/…"
          aria-label={t("update.urlLabel")}
          autoComplete="off"
          spellCheck={false}
          className="h-9 flex-1 text-xs"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9"
            disabled={url.trim() === ""}
            loading={salvando}
            onClick={onSalvar}
          >
            {t("comum.salvar")}
          </Button>
          {onCancelar !== undefined ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9"
              disabled={salvando}
              onClick={onCancelar}
            >
              {t("comum.cancelar")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * O que a tela mostra quando já existe uma URL guardada.
 *
 * Antes não mostrava nada: `editandoUrl` nascia `false` com a URL configurada
 * e **nenhum caminho no código ligava ele de volta**. Quem colou a URL errada
 * ficava sem saída pela interface — o botão de atualizar aparecia e falhava
 * contra o endereço errado para sempre.
 *
 * A URL não é exibida de volta de propósito: é credencial, e a API só devolve
 * o booleano `webhookConfigured` (CLAUDE.md regra 5). Por isso "trocar" é
 * colar de novo, não editar um campo preenchido — e por isso "remover" pede
 * confirmação: o valor apagado não tem como ser recuperado daqui.
 */
function WebhookConfigurado({
  t,
  confirmando,
  salvando,
  onTrocar,
  onPedirRemocao,
  onCancelarRemocao,
  onRemover,
}: {
  readonly t: Tradutor;
  readonly confirmando: boolean;
  readonly salvando: boolean;
  readonly onTrocar: () => void;
  readonly onPedirRemocao: () => void;
  readonly onCancelarRemocao: () => void;
  readonly onRemover: () => void;
}) {
  return (
    <div className="rounded-[6px] border border-line bg-raised px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink">{t("update.webhookConfigurado")}</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-subtle">
            {t("update.webhookOculta")}
          </p>
        </div>
        {!confirmando ? (
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={salvando}
              onClick={onTrocar}
              // O rótulo é curto; o texto longo já está no título do bloco.
              aria-label={t("update.trocarUrl")}
            >
              {t("update.trocar")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={salvando}
              onClick={onPedirRemocao}
            >
              {t("comum.remover")}
            </Button>
          </div>
        ) : null}
      </div>

      {confirmando ? (
        <div className="mt-2.5 rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2">
          <p className="text-2xs leading-relaxed text-danger">{t("update.removerConfirma")}</p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
              loading={salvando}
              onClick={onRemover}
            >
              {t("comum.remover")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={salvando}
              onClick={onCancelarRemocao}
            >
              {t("comum.cancelar")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
