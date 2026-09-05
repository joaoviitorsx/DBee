import type { Activity } from "@dbee/shared";
import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, Pause, Play, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { useIdioma, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { Trabalhando } from "../motion/Trabalhando";

/**
 * Processos do servidor — `pg_stat_activity`, só-leitura.
 *
 * É um instantâneo. O auto-refresh de 3 s é **opt-in**: uma lista que se
 * reescreve sozinha o tempo todo é difícil de ler, e quem quer acompanhar um
 * lock aperta o play. `active` primeiro, porque é o que interessa quando algo
 * está preso.
 */
const REFRESH_MS = 3000;

function duracao(s: number | null): string {
  if (s === null) return "—";
  if (s < 1) return "< 1s";
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  return `${String(m)}m ${String(Math.floor(s % 60))}s`;
}

const CORES_ESTADO: Record<string, string> = {
  active: "text-ok",
  "idle in transaction": "text-danger",
  "idle in transaction (aborted)": "text-danger",
  idle: "text-subtle",
};

export function ActivityTab({ connectionId }: { readonly connectionId: string }) {
  const t = useT();
  const [auto, setAuto] = useState(false);

  const consulta = useQuery({
    queryKey: ["activity", connectionId],
    queryFn: async () => {
      const { data, error } = await api.api.connections({ id: connectionId }).activity.get();
      if (error !== null) throw new Error("não foi possível ler os processos");
      return data;
    },
    refetchInterval: auto ? REFRESH_MS : false,
  });

  if (consulta.isPending) return <Trabalhando rotulo={t("atividade.lendo")} cronometro />;
  if (consulta.isError) {
    return <p className="px-4 py-8 text-xs text-danger">{t("atividade.erroLer")}</p>;
  }

  // Ativas primeiro, depois por duração decrescente — o que está preso no topo.
  const sessoes = [...consulta.data.sessions].sort((a, b) => {
    if ((a.state === "active") !== (b.state === "active")) return a.state === "active" ? -1 : 1;
    return (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0);
  });
  const ativas = sessoes.filter((s) => s.state === "active").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <ActivityIcon aria-hidden className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-ink">{t("atividade.titulo")}</h2>
        <span className="text-2xs text-subtle">
          {t(sessoes.length === 1 ? "atividade.sessaoSing" : "atividade.sessaoPlur", { n: sessoes.length })} · {t(ativas === 1 ? "atividade.ativaSing" : "atividade.ativaPlur", { n: ativas })}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => { setAuto((a) => !a); }}
            title={auto ? t("atividade.pararAtualizar") : t("atividade.atualizar3s")}
          >
            {auto ? (
              <Pause aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <Play aria-hidden className="h-3.5 w-3.5" />
            )}
            {auto ? t("atividade.pausar") : t("atividade.aoVivo")}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={t("atividade.atualizarAgora")}
            loading={consulta.isFetching && !auto}
            onClick={() => void consulta.refetch()}
          >
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {sessoes.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-subtle">
            {t("atividade.semSessoes")}
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-2xs text-subtle">
                <th className="px-4 py-2 font-medium">{t("atividade.pid")}</th>
                <th className="px-4 py-2 font-medium">{t("atividade.database")}</th>
                <th className="px-4 py-2 font-medium">{t("atividade.usuario")}</th>
                <th className="px-4 py-2 font-medium">{t("atividade.estado")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("atividade.duracao")}</th>
                <th className="px-4 py-2 font-medium">{t("atividade.query")}</th>
              </tr>
            </thead>
            <tbody>
              {sessoes.map((s) => (
                <LinhaSessao key={s.pid} s={s} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LinhaSessao({ s }: { readonly s: Activity }) {
  const { t } = useIdioma();
  return (
    <tr className={cn("border-b border-line/40 hover:bg-raised", s.isSelf && "bg-accent/[0.04]")}>
      <td className="px-4 py-2 font-mono tabular-nums text-muted">
        {s.pid}
        {s.isSelf ? <span className="ml-1 text-2xs text-accent">{t("atividade.voce")}</span> : null}
      </td>
      <td className="px-4 py-2 text-muted">{s.database ?? "—"}</td>
      <td className="px-4 py-2 text-muted">{s.user ?? "—"}</td>
      <td className={cn("px-4 py-2 font-medium", CORES_ESTADO[s.state ?? ""] ?? "text-muted")}>
        {s.state ?? "—"}
        {s.waitEvent !== null ? (
          <span className="ml-1 text-2xs font-normal text-subtle">· {s.waitEvent}</span>
        ) : null}
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums text-muted">
        {s.state === "active" ? duracao(s.durationSeconds) : "—"}
      </td>
      <td className="max-w-md truncate px-4 py-2 font-mono text-2xs text-subtle" title={s.query}>
        {s.query === "" ? "—" : s.query}
      </td>
    </tr>
  );
}
