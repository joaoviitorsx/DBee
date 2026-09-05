import type { AuditStatus, Connection } from "@dbee/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText, Search, X } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Input } from "../../components/ui";
import { useIdioma } from "../../i18n";
import { tagIntl } from "../../lib/idioma";
import { api } from "../../lib/api";
import { Trabalhando } from "../motion/Trabalhando";

/**
 * Auditoria — o `query_log` pesquisável (v0.2).
 *
 * Cross-conexão: abre já filtrada pela conexão do menu, mas o filtro de conexão
 * pode voltar para "todas" — auditar é justamente ver o conjunto. Busca por
 * texto do SQL, estado e autor; paginação por keyset ("Carregar mais"), porque
 * o log cresce sem teto e `OFFSET` degradaria.
 */
const TONE: Record<AuditStatus, "ok" | "danger" | "neutral"> = {
  ok: "ok",
  error: "danger",
  cancelled: "neutral",
};

const STATUS_KEY = {
  ok: "audit.statusOk",
  error: "audit.statusError",
  cancelled: "audit.statusCancelled",
} as const;

function duracao(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function AuditTab({
  connectionId,
  connections,
}: {
  /** Conexão do menu — filtro inicial, não escopo fixo. */
  readonly connectionId: string;
  readonly connections: readonly Connection[];
}) {
  const { t, locale, formatarData } = useIdioma();
  const tag = tagIntl(locale);
  const nomeNumero = new Intl.NumberFormat(tag);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AuditStatus | "">("");
  const [conexao, setConexao] = useState<string>(connectionId);

  const nomeConexao = (id: string): string =>
    connections.find((c) => c.id === id)?.name ?? id;

  const consulta = useInfiniteQuery({
    queryKey: ["audit", q, status, conexao],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.api.audit.get({
        query: {
          ...(q !== "" ? { q } : {}),
          ...(status !== "" ? { status } : {}),
          ...(conexao !== "" ? { connectionId: conexao } : {}),
          ...(pageParam === null ? {} : { cursor: pageParam }),
        },
      });
      if (error !== null) throw new Error(t("audit.erroLer"));
      return data;
    },
    getNextPageParam: (ultima) => ultima.nextCursor,
  });

  const linhas = consulta.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra de filtros. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <ScrollText aria-hidden className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-ink">{t("audit.titulo")}</h2>

        <div className="relative ml-auto">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
          />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); }}
            placeholder={t("audit.buscar")}
            aria-label={t("audit.buscar")}
            className="h-7 w-56 pl-8 pr-7 text-xs"
          />
          {q !== "" ? (
            <button
              type="button"
              aria-label={t("arvore.limparBusca")}
              onClick={() => { setQ(""); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-subtle hover:text-ink"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as AuditStatus | ""); }}
          aria-label={t("audit.colEstado")}
          className="h-7 cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-xs text-ink"
        >
          <option value="">{t("audit.statusTodos")}</option>
          <option value="ok">{t("audit.statusOk")}</option>
          <option value="error">{t("audit.statusError")}</option>
          <option value="cancelled">{t("audit.statusCancelled")}</option>
        </select>

        <select
          value={conexao}
          onChange={(e) => { setConexao(e.target.value); }}
          aria-label={t("audit.colConexao")}
          className="h-7 max-w-40 cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-xs text-ink"
        >
          <option value="">{t("audit.conexaoTodas")}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {consulta.isPending ? (
          <Trabalhando rotulo={t("audit.lendo")} />
        ) : consulta.isError ? (
          <p className="px-4 py-8 text-xs text-danger">{t("audit.erroLer")}</p>
        ) : linhas.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-subtle">
            {q !== "" || status !== "" || conexao !== "" ? t("audit.vazioFiltro") : t("audit.vazio")}
          </p>
        ) : (
          <>
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-2xs text-subtle">
                  <th className="px-4 py-2 font-medium">{t("audit.colEstado")}</th>
                  <th className="px-4 py-2 font-medium">{t("audit.colSql")}</th>
                  <th className="px-4 py-2 font-medium">{t("audit.colConexao")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("audit.colLinhas")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("audit.colDuracao")}</th>
                  <th className="px-4 py-2 font-medium">{t("audit.colAutor")}</th>
                  <th className="px-4 py-2 font-medium">{t("audit.colQuando")}</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((e) => (
                  <tr key={e.id} className="border-b border-line/40 align-top hover:bg-raised">
                    <td className="px-4 py-2">
                      <Badge tone={TONE[e.status]}>{t(STATUS_KEY[e.status])}</Badge>
                    </td>
                    <td className="max-w-md px-4 py-2">
                      <span className="block truncate font-mono text-2xs text-ink" title={e.sql}>
                        {e.sql}
                      </span>
                      {e.error !== null ? (
                        <span className="mt-0.5 block truncate text-2xs text-danger" title={e.error}>
                          {e.error}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-muted">{nomeConexao(e.connectionId)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-muted">
                      {e.rowCount === null ? "—" : nomeNumero.format(e.rowCount)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-muted">
                      {duracao(e.durationMs)}
                    </td>
                    <td className="px-4 py-2 text-muted">{e.actor}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-subtle">{formatarData(e.executedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {consulta.hasNextPage ? (
              <div className="flex justify-center p-3">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={consulta.isFetchingNextPage}
                  loadingLabel={t("audit.carregando")}
                  onClick={() => void consulta.fetchNextPage()}
                >
                  {t("audit.carregarMais")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

