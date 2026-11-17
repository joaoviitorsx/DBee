import type { ColumnStatsResponse, RowFilter } from "@dbee/shared";
import { useQuery } from "@tanstack/react-query";

import { PopoverAncorado } from "../../components/PopoverAncorado";
import { Skeleton } from "../../components/ui";
import { useT } from "../../i18n";
import { api } from "../../lib/api";
import { mensagemDeErro } from "../../lib/erroApi";
import { agruparMilhares } from "./celula.puro";

export interface AlvoEstatistica {
  readonly connectionId: string;
  readonly database: string;
  readonly schema: string;
  readonly table: string;
  readonly coluna: string;
  readonly filtros: readonly RowFilter[];
  readonly ancora: DOMRect;
}

/**
 * Resumo da coluna (ui-detalhes §6.3, aprovado): nulos, distintos, min/max e
 * os 5 valores mais frequentes, **calculados no servidor** sob BEGIN READ
 * ONLY e com os mesmos filtros da aba — nunca varrendo o array em memória,
 * que só tem as linhas já carregadas. Números chegam como string (regra 10).
 */
export function EstatisticaColuna({
  alvo,
  onFechar,
}: {
  readonly alvo: AlvoEstatistica | null;
  readonly onFechar: () => void;
}) {
  const t = useT();
  const consulta = useQuery({
    enabled: alvo !== null,
    queryKey: ["stats", alvo?.connectionId, alvo?.database, alvo?.schema, alvo?.table, alvo?.coluna, alvo?.filtros],
    queryFn: async (): Promise<ColumnStatsResponse> => {
      if (alvo === null) throw new Error("sem alvo");
      const { data, error } = await api.api
        .connections({ id: alvo.connectionId })
        .tables({ schema: alvo.schema })({ table: alvo.table })
        .stats.post({
          column: alvo.coluna,
          database: alvo.database,
          ...(alvo.filtros.length > 0 ? { filters: [...alvo.filtros] } : {}),
        });
      if (error !== null) throw new Error(mensagemDeErro(error, t("stats.falhou")));
      return data;
    },
    staleTime: 30_000,
  });
  if (alvo === null) return null;
  const d = consulta.data;
  return (
    <PopoverAncorado aberto ancora={alvo.ancora} onFora={onFechar} rotulo={t("stats.titulo", { c: alvo.coluna })} className="w-[min(20rem,calc(100vw-1rem))]">
      <div className="border-b border-line px-3 py-2">
        <p className="truncate text-xs font-medium text-ink">{alvo.coluna}</p>
        <p className="text-2xs text-subtle">
          {alvo.filtros.length > 0 ? t("stats.comFiltros") : t("stats.tabelaInteira")}
          {d !== undefined ? ` · ${String(d.durationMs)} ms` : ""}
        </p>
      </div>
      {consulta.isPending ? (
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : consulta.isError || d === undefined ? (
        <p role="alert" className="p-3 text-xs text-danger">{consulta.error.message}</p>
      ) : (
        <div className="motion-fade overflow-auto p-3 text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {([
              [t("stats.total"), d.total],
              [t("stats.nulos"), d.nulls],
              [t("stats.distintos"), d.distinct],
            ] as const).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-mono tabular-nums text-ink">{agruparMilhares(v)}</dd>
              </div>
            ))}
            {d.min !== null ? (
              <>
                <dt className="text-muted">{t("stats.min")}</dt>
                <dd className="truncate text-right font-mono text-ink" title={d.min}>{d.min}</dd>
                <dt className="text-muted">{t("stats.max")}</dt>
                <dd className="truncate text-right font-mono text-ink" title={d.max ?? ""}>{d.max}</dd>
              </>
            ) : null}
          </dl>
          {d.top.length > 0 ? (
            <>
              <p className="mb-1 mt-3 text-2xs text-subtle">{t("stats.frequentes")}</p>
              <ul className="flex flex-col gap-0.5">
                {d.top.map((x, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono" title={x.value ?? "NULL"}>
                      {x.value ?? <span className="italic text-muted">NULL</span>}
                    </span>
                    <span className="font-mono tabular-nums text-subtle">{agruparMilhares(x.count)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </PopoverAncorado>
  );
}
