import * as Dialog from "@radix-ui/react-dialog";
import type { VpnEstado, VpnStatus } from "@dbee/shared";
import { FileUp, Shield, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Badge, Button, Field, Input } from "../../components/ui";
import { useIdioma, type Tradutor } from "../../i18n";
import { cn } from "../../lib/cn";
import { ErroApi } from "../auth/useSession";
import { useConectarVpn, useDesconectarVpn, useEnviarOvpn, useRemoverOvpn, useVpns } from "./useVpn";

/**
 * VPN por pessoa (ADR 014), na barra superior.
 *
 * Cada pessoa conecta a PRÓPRIA VPN: envia o próprio .ovpn uma vez (fica
 * cifrado no servidor) e, a cada conexão, digita o próprio usuário e PIN +
 * código do autenticador. As conexões marcadas com o perfil passam a sair pelo
 * túnel dela. O botão some quando o servidor não tem VPN configurada.
 *
 * A senha é limpa do estado logo depois do envio, e o .ovpn lido do disco vai
 * direto para a requisição — nenhum dos dois fica no React.
 */
const TOM: Record<VpnEstado, "ok" | "danger" | "neutral"> = {
  conectada: "ok",
  conectando: "neutral",
  desconectada: "neutral",
  inacessivel: "danger",
};

function resumo(vpns: readonly VpnStatus[]): VpnEstado {
  if (vpns.some((v) => v.estado === "conectada")) return "conectada";
  if (vpns.some((v) => v.estado === "conectando")) return "conectando";
  if (vpns.some((v) => v.estado === "inacessivel")) return "inacessivel";
  return "desconectada";
}

export function VpnBotao() {
  const { t } = useIdioma();
  const vpns = useVpns();
  const [aberto, setAberto] = useState(false);

  const lista = vpns.data ?? [];
  if (lista.length === 0) return null;

  const geral = resumo(lista);
  const Icone = geral === "conectada" ? ShieldCheck : geral === "inacessivel" ? ShieldOff : Shield;
  const rotulo = t("vpn.abrir", { estado: t(`vpn.estado.${geral}`) });

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={rotulo}
        title={rotulo}
        onClick={() => { setAberto(true); }}
      >
        <Icone
          aria-hidden
          className={cn(
            "h-3.5 w-3.5",
            geral === "conectada" ? "text-ok" : geral === "inacessivel" ? "text-danger" : "text-subtle",
          )}
        />
      </Button>
      {aberto ? <VpnDialog vpns={lista} onClose={() => { setAberto(false); }} /> : null}
    </>
  );
}

function mensagemDoErro(t: Tradutor, erro: unknown): string {
  if (!(erro instanceof ErroApi)) return t("vpn.erroGenerico");
  switch (erro.code) {
    case "vpn_auth_failed": return t("vpn.erroCredencial");
    case "vpn_timeout": return t("vpn.erroPrazo");
    case "vpn_unreachable": return t("vpn.erroInacessivel");
    case "vpn_no_file": return t("vpn.erroSemArquivo");
    // O servidor diz qual diretiva e linha — é o que a pessoa precisa para
    // saber se o arquivo é o certo.
    case "vpn_file_invalid": return erro.message;
    default: return t("vpn.erroGenerico");
  }
}

function VpnDialog({ vpns, onClose }: { readonly vpns: readonly VpnStatus[]; readonly onClose: () => void }) {
  const { t } = useIdioma();
  return (
    <Dialog.Root open onOpenChange={(a) => { if (!a) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); }}
          className={cn(
            "focus-visible:outline-none",
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[calc(100dvh-2rem)] flex-col",
            "rounded-lg border border-line bg-surface animate-settle shadow-[0_8px_24px_rgba(0,0,0,.35)]",
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-ink">{t("vpn.titulo")}</Dialog.Title>
              <Dialog.Description className="mt-1 text-2xs leading-relaxed text-subtle">
                {t("vpn.descricao")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("vpn.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>
          <ul className="flex min-h-0 flex-1 flex-col divide-y divide-line overflow-y-auto">
            {vpns.map((v) => (
              <li key={v.perfil} className="px-5 py-4">
                <Perfil t={t} vpn={v} />
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Perfil({ t, vpn }: { readonly t: Tradutor; readonly vpn: VpnStatus }) {
  const enviar = useEnviarOvpn();
  const remover = useRemoverOvpn();
  const conectar = useConectarVpn();
  const desconectar = useDesconectarVpn();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const idUsuario = useId();
  const idSenha = useId();
  const ocupado = enviar.isPending || remover.isPending || conectar.isPending || desconectar.isPending;
  const ligada = vpn.estado === "conectada" || vpn.estado === "conectando";

  const agir = (p: Promise<unknown>): void => {
    setErro(null);
    p.catch((e: unknown) => { setErro(mensagemDoErro(t, e)); });
  };

  const escolherArquivo = (f: File | undefined): void => {
    if (f === undefined) return;
    agir(f.text().then((ovpn) => enviar.mutateAsync({ perfil: vpn.perfil, ovpn })));
    if (arquivo.current !== null) arquivo.current.value = "";
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-ink">{vpn.perfil}</span>
        <Badge tone={TOM[vpn.estado]}>{t(`vpn.estado.${vpn.estado}`)}</Badge>
        {vpn.ipLocal !== null ? (
          <span className="ml-auto font-mono text-2xs text-subtle" title={t("vpn.ipAjuda")}>{vpn.ipLocal}</span>
        ) : null}
      </div>

      {erro !== null ? (
        <p role="alert" className="rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {erro}
        </p>
      ) : null}

      <input
        ref={arquivo}
        type="file"
        accept=".ovpn,.conf"
        className="hidden"
        onChange={(e) => { escolherArquivo(e.target.files?.[0]); }}
      />

      {!vpn.temArquivo ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">{t("vpn.semArquivo")}</p>
          <Button type="button" size="sm" variant="secondary" className="self-start" disabled={ocupado}
            onClick={() => arquivo.current?.click()}>
            <FileUp aria-hidden className="h-3.5 w-3.5" />
            {t("vpn.enviarArquivo")}
          </Button>
        </div>
      ) : ligada ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="secondary" disabled={ocupado}
            onClick={() => { agir(desconectar.mutateAsync(vpn.perfil)); }}>
            {t("vpn.desconectar")}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const credencial = { perfil: vpn.perfil, usuario, senha };
            // O código do autenticador é de uso único: sai do estado já.
            setSenha("");
            agir(conectar.mutateAsync(credencial));
          }}
        >
          <Field label={t("vpn.usuario")} htmlFor={idUsuario}>
            <Input id={idUsuario} autoComplete="username" value={usuario} required
              onChange={(e) => { setUsuario(e.target.value); }} />
          </Field>
          <Field label={t("vpn.senha")} htmlFor={idSenha} hint={t("vpn.senhaAjuda")}>
            <Input id={idSenha} type="password" inputMode="numeric" autoComplete="one-time-code" value={senha} required
              onChange={(e) => { setSenha(e.target.value); }} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={ocupado} onClick={() => arquivo.current?.click()}>
                {t("vpn.trocarArquivo")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={ocupado}
                onClick={() => { agir(remover.mutateAsync(vpn.perfil)); }}>
                {t("vpn.removerArquivo")}
              </Button>
            </div>
            <Button type="submit" size="sm" variant="secondary" disabled={ocupado || usuario === "" || senha === ""}>
              {conectar.isPending ? t("vpn.conectando") : t("vpn.conectar")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
