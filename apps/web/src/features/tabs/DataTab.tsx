import type { Column, ForeignKey, RowFilter, RowsResponse } from "@dbee/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Filter, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge, Button, Input } from "../../components/ui";
import { api } from "../../lib/api";
import type { TableTarget } from "../../app/workspace";
import { ExportButton } from "../export/ExportButton";
import { Trabalhando, TrabalhandoInline } from "../motion/Trabalhando";
import { ResultGrid } from "../grid/ResultGrid";
import { RowEditModal, type Pendente, type PkValor } from "../grid/RowEditModal";
import { InsertModal } from "../grid/InsertModal";
import { useT } from "../../i18n";

const PAGINA = 200;

/**
 * Sub-aba Dados.
 *
 * Vai pela rota `/tables/.../rows`, **não pelo executor**: aqui a paginação é
 * keyset (que ainda degrada com a profundidade — `ATRITO.md`, auditoria de
 * 2026-09-05 — mas é a forma certa). Pelo executor ela
 * herdaria `maxRows`, a marca de truncamento e `OFFSET` — que degrada
 * exatamente nas tabelas grandes onde paginar importa.
 */
export function DataTab({
  target,
  onConsultar,
  estimatedRows = null,
  writeEnabled = false,
  colunasSchema,
  foreignKeys,
  initialFilters,
  onOpenTableFiltered,
  leading,
  trailing,
}: {
  readonly target: TableTarget;
  readonly onConsultar: () => void;
  /** `reltuples` do catálogo, para a escolha "exportar tudo" ter um número. */
  readonly estimatedRows?: number | null;
  /** A conexão permite escrita — habilita a edição de célula e o excluir linha. */
  readonly writeEnabled?: boolean;
  /** Colunas do schema (com nullable/default), para o formulário de "Nova linha". */
  readonly colunasSchema?: readonly Column[];
  /** FKs da tabela — habilitam o salto de navegação nas células. */
  readonly foreignKeys?: readonly ForeignKey[];
  /** Filtros iniciais quando a aba nasce de um salto por FK. */
  readonly initialFilters?: readonly RowFilter[];
  /** Salto por FK: abre a tabela referenciada, filtrada, em aba nova. */
  readonly onOpenTableFiltered?: (target: TableTarget, filters: readonly RowFilter[]) => void;
  /** Sub-abas, à esquerda da toolbar — uma linha só (ver `SubTabs`). */
  readonly leading?: React.ReactNode;
  /** Ações à direita, ex.: o botão do inspetor. */
  readonly trailing?: React.ReactNode;
}) {
  const t = useT();
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDirection, setOrderDirection] = useState<"asc" | "desc">("asc");
  // Semeado uma vez com os filtros do salto por FK (a tabela referenciada abre
  // já filtrada); depois o usuário manda. `initialFilters` só é lido na montagem.
  const [filtros, setFiltros] = useState<RowFilter[]>(() => [...(initialFilters ?? [])]);
  const [rascunho, setRascunho] = useState({ column: "", value: "" });
  // Edição de linha (v0.2): o modal do diff, e a linha selecionada para excluir.
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [linhaSel, setLinhaSel] = useState<number | null>(null);
  const [inserindo, setInserindo] = useState(false);

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

  // Editável só com escrita habilitada E chave primária: sem PK o WHERE não
  // identifica a linha com segurança (a rota também recusaria).
  const pk = primeira?.primaryKey ?? [];
  const editavel = writeEnabled && (primeira?.keyset ?? false) && pk.length > 0;

  // Colunas com FK ganham o gatilho de salto no grid.
  const fkColunas = useMemo(
    () => new Set((foreignKeys ?? []).flatMap((f) => f.columns)),
    [foreignKeys],
  );

  /**
   * Salto por FK: abre a tabela referenciada, filtrada pela linha de origem.
   *
   * FK composta usa **todas** as colunas, na ordem preservada
   * (`columns[i]` → `referencedColumns[i]`). Se qualquer valor da FK é nulo, a
   * linha não referencia nada e o salto não acontece.
   */
  const saltarFk = (li: number, col: number): void => {
    const coluna = colunas[col]?.name;
    const linha = linhas[li];
    if (coluna === undefined || linha === undefined || onOpenTableFiltered === undefined) return;
    const fk = (foreignKeys ?? []).find((f) => f.columns.includes(coluna));
    if (fk === undefined) return;

    const filters: RowFilter[] = [];
    for (let i = 0; i < fk.columns.length; i++) {
      const idx = colunas.findIndex((c) => c.name === fk.columns[i]);
      const valor = idx >= 0 ? linha[idx] : undefined;
      const refCol = fk.referencedColumns[i];
      if (valor === undefined || valor === null || refCol === undefined) return;
      filters.push({ column: refCol, operator: "eq", value: valor });
    }

    onOpenTableFiltered(
      {
        connectionId: target.connectionId,
        database: target.database,
        schema: fk.referencedSchema,
        relation: fk.referencedTable,
        kind: "table",
      },
      filters,
    );
  };

  /** Valores da PK de uma linha, ou `null` se algum for nulo (não identifica). */
  const pkDaLinha = (li: number): PkValor[] | null => {
    const linha = linhas[li];
    if (linha === undefined) return null;
    const out: PkValor[] = [];
    for (const nome of pk) {
      const idx = colunas.findIndex((c) => c.name === nome);
      const v = idx >= 0 ? linha[idx] : undefined;
      if (v === undefined || v === null) return null;
      out.push({ column: nome, value: v });
    }
    return out;
  };

  const abrirEdicao = (li: number, col: number, valor: string): void => {
    const p = pkDaLinha(li);
    const coluna = colunas[col]?.name;
    const linha = linhas[li];
    if (p === null || coluna === undefined || linha === undefined) return;
    setPendente({
      kind: "update",
      database: target.database,
      schema: target.schema,
      table: target.relation,
      pk: p,
      column: coluna,
      from: linha[col] ?? null,
      to: valor,
    });
  };

  const abrirExclusao = (): void => {
    if (linhaSel === null) return;
    const p = pkDaLinha(linhaSel);
    const linha = linhas[linhaSel];
    if (p === null || linha === undefined) return;
    // Guarda otimista: os valores originais das colunas NÃO-PK, como estão na
    // tela. A PK identifica; a guarda detecta que um terceiro mexeu na linha
    // entre a leitura e o clique — sem isso um DELETE apaga o que mudou.
    const nomesPk = new Set(pk);
    const guard = colunas
      .map((c, i) => ({ column: c.name, value: linha[i] ?? null }))
      .filter((g) => !nomesPk.has(g.column));
    setPendente({
      kind: "delete",
      database: target.database,
      schema: target.schema,
      table: target.relation,
      pk: p,
      guard,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        * Uma barra, dois níveis.
        *
        * À esquerda a **navegação** (as sub-abas, via `leading`); um divisor
        * vertical, e então as **ações da vista** — Consultar e filtro. O
        * divisor é o que impede que a sub-aba "Diagrama" e o botão "Consultar"
        * se leiam com o mesmo peso, coisas de camadas diferentes coladas. À
        * direita, separado por `ml-auto`, o estado (linhas carregadas) e o
        * export, que descrevem o resultado, não o comandam.
        */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-1.5 pl-3 pr-2">
        {leading}
        {leading !== undefined ? (
          <span aria-hidden className="h-5 w-px shrink-0 self-center bg-line" />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onConsultar}>
            {t("aba.consultar")}
          </Button>

          {editavel && (colunasSchema?.length ?? 0) > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => { setInserindo(true); }}>
              <Plus aria-hidden className="h-3.5 w-3.5" />
              {t("edit.novaLinha")}
            </Button>
          ) : null}

          <div className="flex items-center gap-1">
            <Filter aria-hidden className="h-3 w-3 text-subtle" />
            <select
              value={rascunho.column}
              onChange={(e) => { setRascunho((r) => ({ ...r, column: e.target.value })); }}
              aria-label={t("dados.colunaFiltro")}
              className="h-7 cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-xs text-ink"
            >
              <option value="">{t("dados.coluna")}</option>
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
              placeholder={t("dados.contem")}
              aria-label={t("dados.valorFiltro")}
              className="h-7 w-36 text-xs"
            />
          </div>

          {filtros.map((f, i) => (
            <Badge key={`${f.column}-${String(i)}`} tone="neutral">
              {f.column} ⊃ {f.value}
              <button
                type="button"
                aria-label={t("dados.removerFiltro", { col: f.column })}
                onClick={() => { setFiltros((atual) => atual.filter((_, j) => j !== i)); }}
                className="cursor-pointer"
              >
                <X aria-hidden className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {editavel && linhaSel !== null ? (
            <Button size="sm" variant="danger" onClick={abrirExclusao}>
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
              {t("edit.excluirLinha")}
            </Button>
          ) : null}

          {consulta.isFetchingNextPage ? (
            <TrabalhandoInline rotulo={t("dados.buscandoMais")} />
          ) : (
            <span className="text-2xs text-subtle">
              {t(linhas.length === 1 ? "dados.carregadaSing" : "dados.carregadaPlur", { n: linhas.length })}
              {consulta.hasNextPage ? t("dados.haMais") : ""}
            </span>
          )}

          {/* O export leva os MESMOS filtros e ordenação da tela: o arquivo tem
              de ser o que a pessoa está vendo, não a tabela crua. */}
          <ExportButton
          connectionId={target.connectionId}
          database={target.database}
          source={{
            kind: "table",
            schema: target.schema,
            table: target.relation,
            ...(orderBy === null ? {} : { orderBy, orderDirection }),
            ...(filtros.length > 0 ? { filters: filtros } : {}),
          }}
            carregadas={linhas.length}
            temMais={consulta.hasNextPage}
            // Com filtro a estimativa da tabela inteira mentiria: ela não sabe
            // quantas linhas sobram depois do WHERE.
            totalEstimado={filtros.length > 0 ? null : estimatedRows}
            disabled={consulta.isPending}
          />
          {trailing}
        </div>
      </div>

      {/* Sem PK não há keyset. Dizer isso é obrigatório: fingir que a navegação
          funciona é o que faz o usuário confiar numa lista incompleta. */}
      {primeira !== undefined && !primeira.keyset ? (
        <p className="flex shrink-0 items-center gap-1.5 border-b border-danger-line bg-danger-surface px-3 py-1.5 text-2xs text-danger-ink">
          <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
          {t("dados.semPk")}
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        {consulta.isPending ? (
          <Trabalhando rotulo={t("dados.lendoLinhas")} cronometro />
        ) : consulta.isError ? (
          <div className="px-4 py-6">
            <p className="text-xs text-danger">{consulta.error.message}</p>
            <Button size="sm" className="mt-2" onClick={() => void consulta.refetch()}>
              {t("comum.tentarDeNovo")}
            </Button>
          </div>
        ) : linhas.length === 0 ? (
          <p className="px-4 py-6 text-xs text-subtle">{t("dados.nenhumaLinha")}</p>
        ) : (
          <ResultGrid
            columns={colunas}
            rows={linhas}
            // A ordenação mora no cabeçalho do grid. Antes havia uma segunda
            // faixa de nomes de coluna só para isto — duas listas das mesmas
            // colunas, e a pessoa tinha de descobrir qual clicava.
            sortColumn={orderBy}
            sortDirection={orderDirection}
            onSort={ordenarPor}
            editavel={editavel}
            onEditCell={abrirEdicao}
            fkColunas={fkColunas}
            {...(onOpenTableFiltered !== undefined ? { onSaltoFk: saltarFk } : {})}
            onCellClick={(li) => { setLinhaSel(li); }}
            loadingMore={consulta.isFetchingNextPage}
            onReachEnd={() => {
              if (consulta.hasNextPage && !consulta.isFetchingNextPage) void consulta.fetchNextPage();
            }}
          />
        )}
      </div>

      {pendente !== null ? (
        <RowEditModal
          connectionId={target.connectionId}
          pendente={pendente}
          onClose={() => { setPendente(null); }}
        />
      ) : null}

      {inserindo && colunasSchema !== undefined ? (
        <InsertModal
          connectionId={target.connectionId}
          database={target.database}
          schema={target.schema}
          table={target.relation}
          columns={colunasSchema}
          onClose={() => { setInserindo(false); }}
        />
      ) : null}
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
