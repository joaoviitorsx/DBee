import type { HistoryScope } from "@dbee/shared";
import { CornerDownLeft, Search, X } from "lucide-react";
import { useRef, useState } from "react";

import { Badge, Button, Input } from "../../components/ui";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { useIndicador } from "../../lib/useIndicador";
import { useHistorico } from "./useHistorico";

/**
 * Painel de histórico da conexão (roadmap-dbeaver item 2).
 *
 * Abre em **Minhas** (o que eu rodei) com alternância **Time** — decisão do
 * autor: o time vê tudo, que é o mesmo que a Auditoria já mostra a quem
 * enxerga a conexão. Clicar numa entrada **cola** o SQL no editor; nunca
 * executa (a execução continua sendo ação explícita).
 *
 * Gaveta à direita (`motion-gaveta`), montada pelo `ComSaida` do chamador para
 * a saída tocar simétrica.
 */
export function PainelHistorico({
  connectionId,
  onUsar,
  onFechar,
}: {
  readonly connectionId: string;
  readonly onUsar: (sql: string) => void;
  readonly onFechar: () => void;
}) {
  const t = useT();
  const [scope, setScope] = useState<HistoryScope>("mine");
  const [busca, setBusca] = useState("");
  const hist = useHistorico(connectionId, scope, busca, true);
  const entradas = hist.data?.pages.flat() ?? [];

  const fila = useRef<HTMLDivElement>(null);
  const indicador = useRef<HTMLDivElement>(null);
  useIndicador(fila, indicador, scope);

  return (
    <div
      role="dialog"
      aria-label={t("historico.titulo")}
      onKeyDown={(e) => { if (e.key === "Escape") onFechar(); }}
      className="flex h-full flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold text-ink">{t("historico.titulo")}</h2>
        <Button size="icon" variant="ghost" aria-label={t("comum.fechar")} onClick={onFechar}>
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2">
        <div ref={fila} role="tablist" className="relative flex items-center gap-1">
          <div ref={indicador} aria-hidden className="indicador-aba bottom-0 bg-ink" />
          {(["mine", "team"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => { setScope(s); }}
              className={cn(
                "cursor-pointer px-2.5 py-1.5 text-xs transition-colors duration-(--motion-fast)",
                scope === s ? "font-medium text-ink" : "text-subtle hover:text-ink",
              )}
            >
              {s === "mine" ? t("historico.minhas") : t("historico.time")}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <Input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); }}
            placeholder={t("historico.buscar")}
            aria-label={t("historico.buscar")}
            className="h-8 w-full pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {hist.isPending ? (
          <p className="px-4 py-8 text-center text-xs text-subtle">{t("comum.carregando")}</p>
        ) : hist.isError ? (
          <p className="px-4 py-8 text-center text-xs text-danger">{t("historico.erro")}</p>
        ) : entradas.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-subtle">{t("historico.vazio")}</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {/* Entradas paginadas de 50 (keyset), não linhas de resultado: regra 11 não se aplica. */}
            {entradas.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => { onUsar(e.sql); }}
                  title={t("historico.usar")}
                  className="group block w-full cursor-pointer px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised"
                >
                  <div className="flex items-center gap-2 text-2xs text-subtle">
                    {e.status === "ok" ? null : (
                      <Badge tone="danger">{e.status === "error" ? t("historico.erroStatus") : t("historico.cancelada")}</Badge>
                    )}
                    {/* Ensaio (ADR 021) executou e reverteu: não é escrita, não leva âmbar. */}
                    {e.dryRun ? <Badge>{t("ensaio.revertido")}</Badge> : e.readOnly ? null : <Badge tone="write">{t("query.escrita")}</Badge>}
                    <span className="font-mono">{formatarQuando(e.executedAt)}</span>
                    {scope === "team" ? <span className="truncate">· {e.actor}</span> : null}
                    <span className="ml-auto font-mono">
                      {e.rowCount === null ? "" : `${String(e.rowCount)} · `}
                      {e.durationMs === null ? "" : `${String(e.durationMs)} ms`}
                    </span>
                    <CornerDownLeft aria-hidden className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <pre className="mt-1 max-h-14 overflow-hidden whitespace-pre-wrap break-all font-mono text-2xs leading-relaxed text-muted">
                    {e.sql.length > 240 ? `${e.sql.slice(0, 240)}…` : e.sql}
                  </pre>
                </button>
              </li>
            ))}
          </ul>
        )}
        {hist.hasNextPage ? (
          <div className="px-3 py-3">
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              loading={hist.isFetchingNextPage}
              onClick={() => { void hist.fetchNextPage(); }}
            >
              {t("historico.maisAntigas")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Data/hora curta, local. Só exibição: o `executedAt` cru fica no title da auditoria. */
function formatarQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
