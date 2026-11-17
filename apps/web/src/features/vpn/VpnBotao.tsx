import type { VpnEstado, VpnStatus } from "@dbee/shared";
import { FileUp, KeyRound, MoreHorizontal, Shield, ShieldCheck, ShieldOff, Trash2, UserRound } from "lucide-react";
import { type CSSProperties, useId, useRef, useState } from "react";

import { ContextMenu, type MenuAnchor, type MenuItem } from "../../components/ContextMenu";

import { Badge, Button, Field, Input, ModalPainel } from "../../components/ui";
import { useIdioma, type Tradutor } from "../../i18n";
import { cn } from "../../lib/cn";
import { ErroApi } from "../auth/useSession";
import {
  useConectarVpn,
  useDesconectarVpn,
  useEnviarOvpn,
  useEsquecerCredencial,
  useRemoverOvpn,
  useVpns,
} from "./useVpn";

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
  /** Perfis cujo túnel CAIU (estava conectada e deixou de estar). */
  const [caidos, setCaidos] = useState<ReadonlySet<string>>(new Set());
  const [anterior, setAnterior] = useState(vpns.data);

  const lista = vpns.data ?? [];

  /*
   * Túnel caiu (renegociação, concentrador reiniciou, rede): abre o diálogo
   * já pedindo o código do autenticador. Com a senha lembrada, reconectar é
   * digitar 6 dígitos. Reage só à TRANSIÇÃO conectada → desconectada entre
   * duas leituras. Feito no render (padrão "ajustar estado quando a entrada
   * muda" do React), não num efeito: `vpns.data` é referência estável do
   * React Query, então isto roda uma vez por leitura nova.
   */
  if (vpns.data !== anterior) {
    const antes = new Map((anterior ?? []).map((v) => [v.perfil, v.estado]));
    const novos = lista
      .filter((v) => antes.get(v.perfil) === "conectada" && v.estado === "desconectada")
      .map((v) => v.perfil);
    setAnterior(vpns.data);
    if (novos.length > 0) {
      setCaidos((c) => new Set([...c, ...novos]));
      setAberto(true);
    }
  }

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
      {aberto ? (
        <VpnDialog
          vpns={lista}
          caidos={caidos}
          onReconectado={(perfil) => { setCaidos((c) => new Set([...c].filter((p) => p !== perfil))); }}
          onClose={() => { setAberto(false); }}
        />
      ) : null}
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
    case "vpn_no_credential": return t("vpn.erroSemCredencial");
    // O servidor diz qual diretiva e linha — é o que a pessoa precisa para
    // saber se o arquivo é o certo.
    case "vpn_file_invalid": return erro.message;
    default: return t("vpn.erroGenerico");
  }
}

function VpnDialog({
  vpns,
  caidos,
  onReconectado,
  onClose,
}: {
  readonly vpns: readonly VpnStatus[];
  readonly caidos: ReadonlySet<string>;
  readonly onReconectado: (perfil: string) => void;
  readonly onClose: () => void;
}) {
  const { t } = useIdioma();
  return (
    <ModalPainel
      titulo={t("vpn.titulo")}
      descricao={t("vpn.descricao")}
      icone={<Shield className="h-4 w-4" />}
      onClose={onClose}
    >
      <ul className="motion-stagger flex flex-col divide-y divide-line">
        {vpns.map((v, i) => (
          <li key={v.perfil} className="py-4 first:pt-0 last:pb-0" style={{ "--i": i } as CSSProperties}>
            <Perfil t={t} vpn={v} caiu={caidos.has(v.perfil)} onConectado={() => { onReconectado(v.perfil); }} />
          </li>
        ))}
      </ul>
    </ModalPainel>
  );
}

/**
 * Campo do código com cara de OTP: um único `<input>` (inputMode numérico,
 * `one-time-code` — o preenchimento automático e o auto-envio dependem dele)
 * transparente por cima de seis caixas desenhadas. As caixas são só pintura
 * (`aria-hidden`); leitor de tela e teclado veem o input normal.
 */
function CampoCodigo({
  id,
  valor,
  autoFocus,
  descricao,
  onChange,
}: {
  readonly id: string;
  readonly valor: string;
  readonly autoFocus: boolean;
  readonly descricao: string;
  readonly onChange: (v: string) => void;
}) {
  const caixas = Math.max(6, valor.length);
  return (
    <div className="group relative w-fit">
      <div aria-hidden className="flex gap-1.5">
        {Array.from({ length: caixas }, (_, i) => (
          <span
            key={i}
            className={cn(
              "grid h-11 w-9 place-items-center rounded-[6px] border bg-sunken font-mono text-lg text-ink",
              "transition-colors duration-(--motion-fast)",
              i === Math.min(valor.length, caixas - 1)
                ? "border-line group-focus-within:border-ink/60"
                : valor[i] === undefined ? "border-line" : "border-line-strong",
              i === 2 && caixas === 6 ? "mr-2" : "",
            )}
          >
            {valor[i] ?? ""}
          </span>
        ))}
      </div>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={8}
        value={valor}
        aria-describedby={descricao}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
        onChange={(e) => { onChange(e.target.value); }}
      />
    </div>
  );
}

function Perfil({
  t,
  vpn,
  caiu,
  onConectado,
}: {
  readonly t: Tradutor;
  readonly vpn: VpnStatus;
  readonly caiu: boolean;
  readonly onConectado: () => void;
}) {
  const enviar = useEnviarOvpn();
  const remover = useRemoverOvpn();
  const conectar = useConectarVpn();
  const desconectar = useDesconectarVpn();
  const esquecer = useEsquecerCredencial();
  const [outroLogin, setOutroLogin] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const idUsuario = useId();
  const idSenha = useId();
  const idCodigo = useId();
  const ocupado =
    enviar.isPending || remover.isPending || conectar.isPending || desconectar.isPending || esquecer.isPending;
  const ligada = vpn.estado === "conectada" || vpn.estado === "conectando";
  const soCodigo = vpn.usuarioLembrado !== null && !outroLogin;

  const agir = (p: Promise<unknown>): void => {
    setErro(null);
    p.catch((e: unknown) => { setErro(mensagemDoErro(t, e)); });
  };

  const escolherArquivo = (f: File | undefined): void => {
    if (f === undefined) return;
    agir(f.text().then((ovpn) => enviar.mutateAsync({ perfil: vpn.perfil, ovpn })));
    if (arquivo.current !== null) arquivo.current.value = "";
  };

  const enviarConexao = (cod: string): void => {
    if (ocupado || !/^[0-9]{6,8}$/.test(cod)) return;
    // Código é de uso único e a senha não fica no React depois de enviada.
    setCodigo("");
    setSenha("");
    agir(
      conectar
        .mutateAsync(
          soCodigo
            ? { perfil: vpn.perfil, codigo: cod }
            : { perfil: vpn.perfil, codigo: cod, usuario, senha, lembrar },
        )
        .then(() => { setOutroLogin(false); onConectado(); }),
    );
  };

  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const idCodigoAjuda = useId();
  const acoes: MenuItem[] = [
    ...(vpn.usuarioLembrado !== null
      ? [
          {
            id: "outro",
            label: outroLogin ? t("vpn.usarLembrado") : t("vpn.outroLogin"),
            icon: <UserRound aria-hidden className="h-3.5 w-3.5" />,
            onSelect: () => { setOutroLogin((v) => !v); setErro(null); },
          },
          {
            id: "esquecer",
            label: t("vpn.esquecer"),
            icon: <KeyRound aria-hidden className="h-3.5 w-3.5" />,
            onSelect: () => { agir(esquecer.mutateAsync(vpn.perfil)); },
          },
        ]
      : []),
    {
      id: "trocar",
      label: t("vpn.trocarArquivo"),
      icon: <FileUp aria-hidden className="h-3.5 w-3.5" />,
      onSelect: () => arquivo.current?.click(),
    },
    {
      id: "remover",
      label: t("vpn.removerArquivo"),
      icon: <Trash2 aria-hidden className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => { agir(remover.mutateAsync(vpn.perfil)); },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-sm text-ink">{vpn.perfil}</span>
        <Badge tone={TOM[vpn.estado]}>
          {vpn.estado === "conectada" ? <span aria-hidden className="motion-pulso mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ok" /> : null}
          {t(`vpn.estado.${vpn.estado}`)}
        </Badge>
        {vpn.ipLocal !== null ? (
          <span className="ml-auto font-mono text-2xs tabular-nums text-subtle" title={t("vpn.ipAjuda")}>{vpn.ipLocal}</span>
        ) : null}
      </div>

      {caiu && !ligada ? (
        <p role="status" className="motion-fade flex items-start gap-2 rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs leading-relaxed text-ink">
          <ShieldOff aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          {t("vpn.caiu")}
        </p>
      ) : null}

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
        <div className="flex flex-col items-center gap-3 rounded-[6px] border border-dashed border-line px-4 py-6 text-center">
          <FileUp aria-hidden className="h-5 w-5 text-subtle" />
          <p className="max-w-[46ch] text-xs leading-relaxed text-muted">{t("vpn.semArquivo")}</p>
          <Button type="button" size="sm" variant="secondary" disabled={ocupado}
            onClick={() => arquivo.current?.click()}>
            {t("vpn.enviarArquivo")}
          </Button>
        </div>
      ) : ligada ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="secondary" disabled={ocupado}
            // Desconectar pedido pela pessoa não é "caiu": limpa o aviso.
            onClick={() => { agir(desconectar.mutateAsync(vpn.perfil).then(onConectado)); }}>
            {t("vpn.desconectar")}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); enviarConexao(codigo); }}
        >
          {soCodigo ? (
            <p className="text-xs text-muted">
              {t("vpn.conectarComo")} <span className="font-mono text-ink">{vpn.usuarioLembrado}</span>
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("vpn.usuario")} htmlFor={idUsuario}>
                <Input id={idUsuario} autoComplete="username" value={usuario} required
                  onChange={(e) => { setUsuario(e.target.value); }} />
              </Field>
              <Field label={t("vpn.senha")} htmlFor={idSenha} hint={t("vpn.senhaAjuda")}>
                <Input id={idSenha} type="password" autoComplete="current-password" value={senha}
                  onChange={(e) => { setSenha(e.target.value); }} />
              </Field>
            </div>
          )}

          <div>
            <label htmlFor={idCodigo} className="mb-1.5 block text-xs font-medium text-muted">{t("vpn.codigo")}</label>
            <CampoCodigo
              id={idCodigo}
              valor={codigo}
              // Foco direto no código quando é só ele que falta.
              autoFocus={soCodigo || caiu}
              descricao={idCodigoAjuda}
              onChange={(v) => {
                const so = v.replace(/[^0-9]/g, "").slice(0, 8);
                setCodigo(so);
                // 6 dígitos com credencial lembrada: conecta sem clicar.
                if (soCodigo && so.length === 6) enviarConexao(so);
              }}
            />
            <p id={idCodigoAjuda} className="mt-1.5 text-2xs text-subtle">{t("vpn.codigoAjuda")}</p>
          </div>

          {!soCodigo ? (
            <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted">
              <input type="checkbox" checked={lembrar} onChange={(e) => { setLembrar(e.target.checked); }}
                className="mt-0.5 h-3.5 w-3.5 accent-current" />
              {t("vpn.lembrar")}
            </label>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button" size="icon" variant="ghost" disabled={ocupado}
              aria-label={t("vpn.maisAcoes")} title={t("vpn.maisAcoes")} aria-haspopup="menu"
              onClick={(e) => {
                // O conteúdo do diálogo tem `translate`: vira o bloco de
                // contenção do `fixed` do menu, então a âncora é relativa a ele.
                const r = e.currentTarget.getBoundingClientRect();
                const caixa = e.currentTarget.closest("[role=dialog]")?.getBoundingClientRect();
                setMenu({ x: r.left - (caixa?.left ?? 0), y: r.bottom + 4 - (caixa?.top ?? 0) });
              }}
            >
              <MoreHorizontal aria-hidden className="h-4 w-4" />
            </Button>
            <Button type="submit" size="sm" variant="secondary" loading={conectar.isPending}
              disabled={ocupado || codigo.length < 6 || (!soCodigo && usuario === "")}>
              {conectar.isPending ? t("vpn.conectando") : t("vpn.conectar")}
            </Button>
          </div>
          {menu !== null ? (
            <ContextMenu anchor={menu} title={vpn.perfil} sections={[{ items: acoes }]} onClose={() => { setMenu(null); }} />
          ) : null}
        </form>
      )}
    </div>
  );
}
