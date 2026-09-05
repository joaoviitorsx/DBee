import type { RowFilter, RowsResponse } from "@dbee/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Filter, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge, Button, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { TableTarget } from "../../app/workspace";
import { ResultGrid } from "../grid/ResultGrid";

const PAGINA = 200;

/**
 * Sub-aba Dados.
 *
 * Vai pela rota `/tables/.../rows`, **não pelo executor**: aqui a paginação é
 * keyset, então a página 400 custa o mesmo que a página 2. Pelo executor ela
 * herdaria `maxRows`, a marca de truncamento e `OFFSET` — que degrada
 * exatamente nas tabelas grandes onde paginar importa.
 */
export function DataTab({
  target,
  onConsultar,
}: {
  readonly target: TableTarget;
  readonly onConsultar: () => void;
}) {
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDirection, setOrderDirection] = useState<"asc" | "desc">("asc");
  const [filtros, setFiltros] = useState<RowFilter[]>([]);
  const [rascunho, setRascunho] = useState({ column: "", value: "" });

  const chave = ["rows", target.connectionId, target.database, target.schema, target.relation, orderBy, orderDirection, filtros];

  const consulta = useInfiniteQuery({
    queryKey: chave,
    initialPageParam: null as RowsResponse["nextCursor"],
    queryFn: async ({ pageParam }): Promise<RowsResponse> => {
      const { data, error } = await api.api
        .connections({ id: target.connectionId })
        .tables({ schema: target.schema })({ table: target.relation })
        .rows.post({
          database: target.database,
          limit: PAGINA,
          ...(orderBy === null ? {} : { orderBy, orderDirection }),
          ...(filtros.length > 0 ? { filters: filtros } : {}),
          ...(pageParam === null ? {} : { after: pageParam }),
        });
      if (error !== null) throw new Error(mensagem(error));
      return data;
    },
    getNextPageParam: (ultima) => (ultima.hasMore ? ultima.nextCursor : null),
  });

  // `?? []` cru criaria um array novo a cada render e o memo abaixo nunca
  // memoizaria — com dezenas de milhares de linhas, isso é uma cópia por quadro.
  const dados = consulta.data;
  const paginas = useMemo(() => dados?.pages ?? [], [dados]);
  const primeira = paginas[0];
  const linhas = useMemo(() => paginas.flatMap((p) => p.rows), [paginas]);
  const colunas = primeira?.columns ?? [];

  const ordenarPor = (nome: string): void => {
    if (orderBy === nome) {
      setOrderDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setOrderBy(nome);
    setOrderDirection("asc");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="secondary" onClick={onConsultar}>
          Consultar
        </Button>

        <div className="flex items-center gap-1">
          <Filter aria-hidden className="h-3 w-3 text-subtle" />
          <select
            value={rascunho.column}
            onChange={(e) => { setRascunho((r) => ({ ...r, column: e.target.value })); }}
            aria-label="Coluna do filtro"
            className="h-7 cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-xs text-ink"
          >
            <option value="">coluna…</option>
            {colunas.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <Input
            value={rascunho.value}
            onChange={(e) => { setRascunho((r) => ({ ...r, value: e.target.value })); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rascunho.column !== "") {
                setFiltros((f) => [...f, { column: rascunho.column, operator: "contains", value: rascunho.value }]);
                setRascunho({ column: "", value: "" });
              }
            }}
            placeholder="contém…"
            aria-label="Valor do filtro"
            className="h-7 w-40 text-xs"
          />
        </div>

        {filtros.map((f, i) => (
          <Badge key={`${f.column}-${String(i)}`} tone="neutral">
            {f.column} ⊃ {f.value}
            <button
              type="button"
              aria-label={`Remover filtro de ${f.column}`}
              onClick={() => { setFiltros((atual) => atual.filter((_, j) => j !== i)); }}
              className="cursor-pointer"
            >
              <X aria-hidden className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}

        <span className="ml-auto text-2xs text-subtle">
          {linhas.length} carregada{linhas.length === 1 ? "" : "s"}
          {consulta.hasNextPage ? " · há mais" : ""}
        </span>
      </div>

      {/* Sem PK não há keyset. Dizer isso é obrigatório: fingir que a navegação
          funciona é o que faz o usuário confiar numa lista incompleta. */}
      {primeira !== undefined && !primeira.keyset ? (
        <p className="flex shrink-0 items-center gap-1.5 border-b border-danger-line bg-danger-surface px-3 py-1.5 text-2xs text-danger-ink">
          <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
          Sem chave primária: navegação limitada. A ordem entre páginas pode repetir ou pular linha.
        </p>
      ) : null}

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-1">
        {colunas.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => { ordenarPor(c.name); }}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-2 py-0.5 text-2xs transition-colors duration-150",
              orderBy === c.name ? "bg-raised text-ink" : "text-subtle hover:text-ink",
            )}
          >
            {c.name}
            {orderBy === c.name ? (
              orderDirection === "asc" ? (
                <ArrowUp aria-hidden className="h-2.5 w-2.5" />
              ) : (
                <ArrowDown aria-hidden className="h-2.5 w-2.5" />
              )
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {consulta.isPending ? (
          <p className="px-4 py-6 text-xs text-muted">Lendo linhas…</p>
        ) : consulta.isError ? (
          <div className="px-4 py-6">
            <p className="text-xs text-danger">{consulta.error.message}</p>
            <Button size="sm" className="mt-2" onClick={() => void consulta.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : linhas.length === 0 ? (
          <p className="px-4 py-6 text-xs text-subtle">Nenhuma linha.</p>
        ) : (
          <ResultGrid
            columns={colunas}
            rows={linhas}
            loadingMore={consulta.isFetchingNextPage}
            onReachEnd={() => {
              if (consulta.hasNextPage && !consulta.isFetchingNextPage) void consulta.fetchNextPage();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** O erro do Postgres vai inteiro para a UI (CLAUDE.md). */
function mensagem(error: unknown): string {
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null && "message" in value) {
      if (typeof value.message === "string") return value.message;
    }
  }
  return "não foi possível carregar as linhas";
}
