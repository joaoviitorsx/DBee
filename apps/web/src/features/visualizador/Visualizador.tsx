import { ChevronDown, ChevronUp, Copy, Maximize2, Minimize2, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ComSaida } from "../../components/ComSaida";
import { PopoverAncorado } from "../../components/PopoverAncorado";
import { cn } from "../../lib/cn";
import { copiarTexto } from "../../lib/navegador";
import { useT } from "../../i18n";
import { hexDump, itensDoArray } from "../grid/formatos.puro";
import { JsonArvore } from "./JsonArvore";
import { abertosAte, buscar, formatarCaminho, type NoJson, valorDoNo } from "./jsonArvore.puro";
import { type TipoVisual, formatarXml, tipoVisual } from "./visual.puro";

/** Acima disto o JSON não é parseado: só o bruto, para não travar a aba. */
const TETO_PARSE = 5 * 1024 * 1024;
/** Popover só para conteúdo pequeno; o resto abre direto no painel. */
const TETO_POPOVER = 2 * 1024;

export interface AlvoVisualizador {
  readonly linha: number;
  readonly coluna: string;
  readonly tipo: string;
  /** Valor BRUTO da célula, exatamente como o driver entregou (regra 10). */
  readonly valor: string;
  readonly ancora: DOMRect;
}

/**
 * Visualizador de célula (ui-detalhes §6): UM overlay por grid, fora da lista
 * virtual (regra 11). Popover ancorado para conteúdo curto; "Expandir" (ou
 * Shift+Enter) vira painel lateral, que acompanha a linha com Alt+↑/↓.
 * Abre e fecha com animação simétrica (`ComSaida`).
 */
export function Visualizador({
  alvo,
  onFechar,
  onMoverLinha,
}: {
  readonly alvo: AlvoVisualizador | null;
  readonly onFechar: () => void;
  readonly onMoverLinha: (delta: 1 | -1) => void;
}) {
  // O último alvo fica guardado para a saída animar com o conteúdo, não vazia.
  const [ultimo, setUltimo] = useState(alvo);
  if (alvo !== null && alvo !== ultimo) setUltimo(alvo);
  const [painel, setPainel] = useState(false);
  const atual = alvo ?? ultimo;
  const grande = atual !== null && (atual.valor.length > TETO_POPOVER || atual.valor.split("\n").length > 24);
  const modoPainel = painel || grande;

  useEffect(() => {
    if (alvo === null) return;
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); onFechar(); }
      if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); setPainel((p) => !p); }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        onMoverLinha(e.key === "ArrowDown" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); };
  }, [alvo, onFechar, onMoverLinha]);

  if (atual === null) return null;

  const corpo = (
    <Conteudo
      key={`${String(atual.linha)}:${atual.coluna}`}
      alvo={atual}
      painel={modoPainel}
      onAlternarPainel={grande ? null : () => { setPainel((p) => !p); }}
      onFechar={onFechar}
    />
  );

  return modoPainel ? (
    <ComSaida
      aberto={alvo !== null}
      role="dialog"
      aria-label={atual.coluna}
      className="motion-gaveta fixed bottom-0 right-0 top-[var(--h-topbar,49px)] z-40 flex w-[min(30rem,100vw)] flex-col border-l border-line bg-surface shadow-[0_8px_24px_-12px_rgb(0_0_0/.5)] max-lg:top-auto max-lg:h-[70vh] max-lg:w-full max-lg:border-l-0 max-lg:border-t"
    >
      {corpo}
    </ComSaida>
  ) : (
    <PopoverAncorado aberto={alvo !== null} ancora={atual.ancora} onFora={onFechar} rotulo={atual.coluna}>
      {corpo}
    </PopoverAncorado>
  );
}

function Conteudo({
  alvo,
  painel,
  onAlternarPainel,
  onFechar,
}: {
  readonly alvo: AlvoVisualizador;
  readonly painel: boolean;
  readonly onAlternarPainel: (() => void) | null;
  readonly onFechar: () => void;
}) {
  const t = useT();
  const tipo: TipoVisual = tipoVisual(alvo.tipo, alvo.valor);
  const [bruto, setBruto] = useState(false);

  const copiar = (texto: string, rotulo: string): void => {
    void copiarTexto(texto).then((ok) => {
      if (ok) toast(rotulo);
      else toast(t("visualizador.copiaFalhou"));
    });
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">{alvo.coluna}</p>
          <p className="truncate font-mono text-2xs text-subtle">
            {alvo.tipo} · {t("visualizador.linha", { n: String(alvo.linha + 1) })} · {t("visualizador.caracteres", { n: alvo.valor.length.toLocaleString() })}
          </p>
        </div>
        {tipo === "json" ? (
          <div role="radiogroup" aria-label={t("visualizador.modo")} className="flex rounded-[4px] border border-line p-0.5 text-2xs">
            {([false, true] as const).map((b) => (
              <button
                key={String(b)}
                type="button"
                role="radio"
                aria-checked={bruto === b}
                onClick={() => { setBruto(b); }}
                className={cn(
                  "cursor-pointer rounded-[3px] px-1.5 py-0.5 transition-colors duration-(--motion-fast)",
                  bruto === b ? "bg-raised text-ink" : "text-muted hover:text-ink",
                )}
              >
                {b ? t("visualizador.bruto") : t("visualizador.arvore")}
              </button>
            ))}
          </div>
        ) : null}
        <BotaoIcone rotulo={t("visualizador.copiarBruto")} onClick={() => { copiar(alvo.valor, t("visualizador.copiado")); }}>
          <Copy aria-hidden className="h-3.5 w-3.5" />
        </BotaoIcone>
        {onAlternarPainel !== null ? (
          <BotaoIcone rotulo={painel ? t("visualizador.encolher") : t("visualizador.expandir")} onClick={onAlternarPainel}>
            {painel ? <Minimize2 aria-hidden className="h-3.5 w-3.5" /> : <Maximize2 aria-hidden className="h-3.5 w-3.5" />}
          </BotaoIcone>
        ) : null}
        <BotaoIcone rotulo={t("comum.fechar")} onClick={onFechar}>
          <X aria-hidden className="h-3.5 w-3.5" />
        </BotaoIcone>
      </div>
      {tipo === "json" && !bruto && alvo.valor.length <= TETO_PARSE ? (
        <CorpoJson texto={alvo.valor} coluna={alvo.coluna} onCopiar={copiar} />
      ) : tipo === "array" ? (
        <CorpoLista itens={itensDoArray(alvo.valor) ?? []} />
      ) : tipo === "bytea" ? (
        <Pre linhas={hexDump(alvo.valor)} />
      ) : tipo === "xml" ? (
        <Pre linhas={formatarXml(alvo.valor).split("\n")} numerado />
      ) : (
        <Pre linhas={alvo.valor.split("\n")} numerado quebra />
      )}
    </>
  );
}

export function CorpoJson({
  texto,
  coluna,
  onCopiar,
}: {
  readonly texto: string;
  readonly coluna: string;
  readonly onCopiar: (texto: string, rotulo: string) => void;
}) {
  const t = useT();
  const raiz = useMemo<{ ok: true; v: unknown } | { ok: false }>(() => {
    try {
      return { ok: true, v: JSON.parse(texto) as unknown };
    } catch {
      return { ok: false };
    }
  }, [texto]);
  const [abertos, setAbertos] = useState<Set<string>>(() => (raiz.ok ? abertosAte(raiz.v, 2) : new Set()));
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const busca = useMemo(() => (raiz.ok ? buscar(raiz.v, q) : { achados: [], abrir: new Set<string>() }), [raiz, q]);
  const achados = useMemo(() => new Set(busca.achados), [busca]);
  const atual = busca.achados.length === 0 ? null : (busca.achados[i % busca.achados.length] ?? null);

  // Busca abre os ancestrais dos achados (sem fechar o que a pessoa abriu).
  const [ultimaBusca, setUltimaBusca] = useState(busca);
  if (busca !== ultimaBusca) {
    setUltimaBusca(busca);
    if (busca.abrir.size > 0) setAbertos((a) => new Set([...a, ...busca.abrir]));
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        campo.current?.focus();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); };
  }, []);

  if (!raiz.ok) return <Pre linhas={texto.split("\n")} numerado quebra />;

  const copiarValor = (no: NoJson): void => {
    const v = valorDoNo(raiz.v, no.partes);
    onCopiar(v.texto, v.reformatado ? t("visualizador.copiadoReformatado") : t("visualizador.copiado"));
  };
  const copiarCaminho = (no: NoJson): void => {
    onCopiar(formatarCaminho(no.partes, coluna), t("visualizador.caminhoCopiado", { c: formatarCaminho(no.partes, coluna) }));
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-1">
        <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-subtle" />
        <input
          ref={campo}
          value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); setI((x) => x + (e.shiftKey ? -1 + busca.achados.length : 1)); }
          }}
          placeholder={t("visualizador.buscar")}
          aria-label={t("visualizador.buscar")}
          className="min-w-0 flex-1 bg-transparent py-1 text-xs text-ink outline-none placeholder:text-subtle"
        />
        {q.trim() !== "" ? (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-subtle">
            {busca.achados.length === 0 ? "0" : `${String((i % busca.achados.length) + 1)}/${String(busca.achados.length)}`}
          </span>
        ) : null}
        <BotaoIcone rotulo={t("visualizador.anterior")} onClick={() => { setI((x) => x - 1 + busca.achados.length); }}>
          <ChevronUp aria-hidden className="h-3.5 w-3.5" />
        </BotaoIcone>
        <BotaoIcone rotulo={t("visualizador.proximo")} onClick={() => { setI((x) => x + 1); }}>
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </BotaoIcone>
      </div>
      <JsonArvore
        raiz={raiz.v}
        abertos={abertos}
        onAbertos={setAbertos}
        achados={achados}
        achadoAtual={atual}
        onCopiarValor={copiarValor}
        onCopiarCaminho={copiarCaminho}
      />
      <p className="shrink-0 border-t border-line px-3 py-1 text-2xs text-subtle">{t("visualizador.dicaTeclas")}</p>
    </>
  );
}

function CorpoLista({ itens }: { readonly itens: readonly (string | null)[] }) {
  return (
    <ol className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs">
      {itens.map((v, i) => (
        // Array do Postgres é pequeno por natureza (vai inteiro numa célula);
        // a lista não é dado de grid, então mapear direto não fere a regra 11.
        <li key={i} className="flex gap-3 px-3 py-0.5 hover:bg-raised/60">
          <span className="w-6 shrink-0 text-right tabular-nums text-subtle">{i}</span>
          {v === null ? <span className="italic text-muted">NULL</span> : <span className="whitespace-pre-wrap break-all text-ink">{v}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Prévia em texto: até 2 000 linhas (o bruto inteiro vai pelo "Copiar"). */
const TETO_LINHAS = 2000;

function Pre({ linhas, numerado = false, quebra = false }: { readonly linhas: readonly string[]; readonly numerado?: boolean; readonly quebra?: boolean }) {
  const t = useT();
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs leading-5">
      {linhas.length > TETO_LINHAS ? (
        <p className="px-3 pb-1 text-2xs text-subtle">
          {t("visualizador.truncado", { n: String(TETO_LINHAS), total: String(linhas.length) })}
        </p>
      ) : null}
      {linhas.slice(0, TETO_LINHAS).map((l, i) => (
        <div key={i} className="flex gap-3 px-3">
          {numerado ? <span aria-hidden className="w-8 shrink-0 select-none text-right tabular-nums text-subtle">{i + 1}</span> : null}
          <span className={cn("text-ink", quebra ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{l === "" ? " " : l}</span>
        </div>
      ))}
    </div>
  );
}

function BotaoIcone({ rotulo, onClick, children }: { readonly rotulo: string; readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className="press flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-subtle transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink"
    >
      {children}
    </button>
  );
}
