import type { ExplainResponse } from "@dbee/shared";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../components/ui";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { lerPlano, type NoPlano, type Plano } from "./plano.puro";

/**
 * EXPLAIN visual (ADR 017): árvore de nós com custo, linhas e tempo; o nó de
 * maior custo exclusivo ganha a régua `info` e o selo "mais caro". Âmbar não —
 * custo alto não é escrita.
 *
 * O plano tem dezenas de nós, não milhares de linhas: lista comum, sem
 * virtualização (a regra 11 é para linhas de resultado).
 */
export function PlanoView({ resposta }: { readonly resposta: ExplainResponse }) {
  const t = useT();
  const plano = resposta.plan === null ? null : lerPlano(resposta.plan);

  if (plano === null) {
    // Não deu para ler como plano: o texto cru continua acessível (regra 10).
    return (
      <pre className="whitespace-pre-wrap break-all px-4 py-3 font-mono text-2xs text-muted">
        {resposta.plan ?? ""}
      </pre>
    );
  }

  return (
    <div className="px-2 py-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-2 font-mono text-2xs text-subtle">
        {resposta.analyzed ? <Badge tone="write">ANALYZE</Badge> : <span>{t("explain.estimado")}</span>}
        {plano.tempoPlanejamento === null ? null : (
          <span>{t("explain.planejamento")} {plano.tempoPlanejamento.toFixed(2)} ms</span>
        )}
        {plano.tempoExecucao === null ? null : (
          <span>{t("explain.execucao")} {plano.tempoExecucao.toFixed(2)} ms</span>
        )}
        <span>{resposta.durationMs} ms</span>
      </p>
      <ul role="tree" aria-label={t("explain.titulo")}>
        <No no={plano.raiz} plano={plano} nivel={0} />
      </ul>
    </div>
  );
}

function No({ no, plano, nivel }: { readonly no: NoPlano; readonly plano: Plano; readonly nivel: number }) {
  const t = useT();
  const [aberto, setAberto] = useState(true);
  const caro = no.id === plano.maisCaro && plano.total > 0;
  const fracao = plano.total > 0 ? no.exclusivo / plano.total : 0;
  const temFilhos = no.filhos.length > 0;
  return (
    <li role="treeitem" aria-expanded={temFilhos ? aberto : undefined} aria-selected={false}>
      <div
        className={cn(
          "flex items-start gap-1.5 rounded-[4px] border-l-2 py-1.5 pr-2",
          caro ? "border-info bg-raised" : "border-transparent",
        )}
        style={{ paddingLeft: `${String(nivel * 16 + 4)}px` }}
      >
        <button
          type="button"
          disabled={!temFilhos}
          onClick={() => { setAberto((a) => !a); }}
          aria-label={aberto ? t("explain.recolher") : t("explain.expandir")}
          className="mt-0.5 cursor-pointer text-subtle disabled:invisible"
        >
          <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 transition-transform duration-(--motion-fast)", aberto && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium text-ink">{no.tipo}</span>
            {no.alvo === null ? null : <span className="font-mono text-2xs text-muted">{no.alvo}</span>}
            {caro ? <Badge tone="key">{t("explain.maisCaro")}</Badge> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-2xs text-subtle">
            {no.custoTotal === null ? null : (
              <span title={t("explain.custoTitle")}>
                {t("explain.custo")} {no.custoInicial?.toFixed(2) ?? "?"}..{no.custoTotal.toFixed(2)}
              </span>
            )}
            {no.linhasEstimadas === null ? null : (
              <span>
                {t("explain.linhas")} {no.linhasEstimadas}
                {no.linhasReais === null ? "" : ` → ${String(no.linhasReais)}`}
              </span>
            )}
            {no.tempoReal === null ? null : (
              <span>{no.tempoReal.toFixed(2)} ms{no.loops !== null && no.loops > 1 ? ` (${String(no.loops)}×)` : ""}</span>
            )}
            <span>{(fracao * 100).toFixed(0)}%</span>
          </div>
          {/* Fração do custo exclusivo: barra fina, escala por transform (sem reflow). */}
          <div aria-hidden className="mt-1 h-0.5 w-full max-w-60 overflow-hidden rounded-full bg-line">
            <div
              className={cn("h-full origin-left", caro ? "bg-info" : "bg-subtle")}
              style={{ transform: `scaleX(${String(Math.min(1, fracao))})` }}
            />
          </div>
          {no.detalhes.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {no.detalhes.map((d) => (
                <p key={d} className="break-all font-mono text-2xs text-muted">{d}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {temFilhos && aberto ? (
        <ul role="group">
          {no.filhos.map((f) => <No key={f.id} no={f} plano={plano} nivel={nivel + 1} />)}
        </ul>
      ) : null}
    </li>
  );
}
