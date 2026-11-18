import type { Column, FilterOperator, ForeignKey, RowFilter, RowsResponse } from "@dbee/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Filter, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Input } from "../../components/ui";
import { api } from "../../lib/api";
import type { TableTarget } from "../../app/workspace";
import { ExportButton } from "../export/ExportButton";
import { Trabalhando } from "../motion/Trabalhando";
import { EsqueletoGrid, useFaseCarregamento } from "../grid/EsqueletoGrid";
import { montarFiltro, OPERADORES, rotuloFiltro, semValor, SIMBOLO } from "../grid/carregamento.puro";
import { ResultGrid } from "../grid/ResultGrid";
import { type AlvoEstatistica, EstatisticaColuna } from "../grid/EstatisticaColuna";
import { RowEditModal, type Pendente, type PkValor } from "../grid/RowEditModal";
import { RedisValueModal, type RedisAlvo, type TipoColecao } from "../grid/RedisValueModal";
import { MongoDocModal, type MongoAlvo } from "../grid/MongoDocModal";
import { InsertModal } from "../grid/InsertModal";
import { mensagemDoCodigo, useT } from "../../i18n";

/**
 * Linhas por página.
 *
 * Era 200, e rolar 2.000 linhas custava **nove** requisições de ~37 ms cada,
 * espaçadas ~350 ms — 3,2 s para uma rolagem que o usuário faz o tempo todo. O
 * schema já aceitava até 1000; 500 corta as idas pela metade sem materializar
 * lote grande demais no servidor (o `FETCH n` do §6 traz n linhas para a
 * memória).
 */
const PAGINA = 500;

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
  permiteConsulta = true,
  estimatedRows = null,
  writeEnabled = false,
  exportavel = true,
  redisEstruturado = false,
  mongoDocumento = false,
  colunasSchema,
  foreignKeys,
  initialFilters,
  initialSort,
  onOpenTableFiltered,
  leading,
  trailing,
}: {
  readonly target: TableTarget;
  readonly onConsultar: () => void;
  /** A engine tem editor de SQL livre? Falso no Mongo — sem "Consultar". */
  readonly permiteConsulta?: boolean;
  /** `reltuples` do catálogo, para a escolha "exportar tudo" ter um número. */
  readonly estimatedRows?: number | null;
  /** A conexão permite escrita — habilita a edição de célula e o excluir linha. */
  readonly writeEnabled?: boolean;
  /** A engine exporta? Falso no Mongo e no Redis — esconde o botão de export. */
  readonly exportavel?: boolean;
  /** É Redis? Liga o editor estruturado da coluna `value` das coleções. */
  readonly redisEstruturado?: boolean;
  /** É Mongo? Liga o editor de documento aninhado (célula objeto/array). */
  readonly mongoDocumento?: boolean;
  /** Colunas do schema (com nullable/default), para o formulário de "Nova linha". */
  readonly colunasSchema?: readonly Column[];
  /** FKs da tabela — habilitam o salto de navegação nas células. */
  readonly foreignKeys?: readonly ForeignKey[];
  /** Filtros iniciais quando a aba nasce de um salto por FK. */
  readonly initialFilters?: readonly RowFilter[];
  /** Ordenação inicial vinda de link compartilhado (ADR 020); lida na montagem. */
  readonly initialSort?: { readonly column: string; readonly direction: "asc" | "desc" };
  /** Salto por FK: abre a tabela referenciada, filtrada, em aba nova. */
  readonly onOpenTableFiltered?: (target: TableTarget, filters: readonly RowFilter[]) => void;
  /** Sub-abas, à esquerda da toolbar — uma linha só (ver `SubTabs`). */
  readonly leading?: React.ReactNode;
  /** Ações à direita, ex.: o botão do inspetor. */
  readonly trailing?: React.ReactNode;
}) {
  const t = useT();
  const [orderBy, setOrderBy] = useState<string | null>(initialSort?.column ?? null);
  // Célula sendo editada e, depois de gravada, a que acende uma vez no grid.
  const [emEdicao, setEmEdicao] = useState<{ linha: number; coluna: number } | null>(null);
  const [salva, setSalva] = useState<{ linha: number; coluna: number } | null>(null);
  useEffect(() => {
    if (salva === null) return;
    const id = setTimeout(() => { setSalva(null); }, 1000);
    return () => { clearTimeout(id); };
  }, [salva]);
  const [orderDirection, setOrderDirection] = useState<"asc" | "desc">(initialSort?.direction ?? "asc");
  // Semeado uma vez com os filtros do salto por FK (a tabela referenciada abre
  // já filtrada); depois o usuário manda. `initialFilters` só é lido na montagem.
  const [filtros, setFiltros] = useState<RowFilter[]>(() => [...(initialFilters ?? [])]);
  const [estatistica, setEstatistica] = useState<AlvoEstatistica | null>(null);
  const [rascunho, setRascunho] = useState<{ column: string; operator: FilterOperator; value: string }>({ column: "", operator: "contains", value: "" });
  // Chip saindo: fica montado um `fast` com `motion-pop-out` e então sai do
  // estado (§3.5). O índice é do chip, não do filtro — a lista não reordena.
  const [saindo, setSaindo] = useState<number | null>(null);
  const removerFiltro = (i: number): void => {
    if (saindo !== null) return;
    setSaindo(i);
    setTimeout(() => {
      setFiltros((atual) => atual.filter((_, j) => j !== i));
      setSaindo(null);
    }, 120);
  };
  // Filtro repetido não muda o resultado; recusar mantém a chave do chip única
  // (a chave é o próprio filtro, para o chip não remontar quando outro sai).
  const adicionarFiltro = (f: RowFilter): void => {
    setFiltros((atual) => (atual.some((g) => JSON.stringify(g) === JSON.stringify(f)) ? atual : [...atual, f]));
  };
  const aplicarRascunho = (): void => {
    const f = montarFiltro(rascunho.column, rascunho.operator, rascunho.value);
    if (f === null) return;
    adicionarFiltro(f);
    setRascunho((r) => ({ ...r, column: "", value: "" }));
  };
  // Edição de linha (v0.2): o modal do diff, e a linha selecionada para excluir.
  const [pendente, setPendente] = useState<Pendente | null>(null);
  // Redis: a coluna `value` de uma coleção abre o editor estruturado.
  const [redisAlvo, setRedisAlvo] = useState<RedisAlvo | null>(null);
  const [mongoAlvo, setMongoAlvo] = useState<MongoAlvo | null>(null);
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
      if (error !== null) throw erroDaConsulta(error);
      return data;
    },
    getNextPageParam: (ultima) => (ultima.hasMore ? ultima.nextCursor : null),
  });

  // `?? []` cru criaria um array novo a cada render e o memo abaixo nunca
  // memoizaria — com dezenas de milhares de linhas, isso é uma cópia por quadro.
  const fase = useFaseCarregamento(consulta.isPending);
  const dados = consulta.data;
  const paginas = useMemo(() => dados?.pages ?? [], [dados]);
  const primeira = paginas[0];
  const linhas = useMemo(() => paginas.flatMap((p) => p.rows), [paginas]);
  const colunas = primeira?.columns ?? [];

  /*
   * Os tipos das colunas, para o PREVIEW da edição bater com o que executa.
   *
   * Vêm do schema (`introspect`, que usa `format_type(atttypid, atttypmod)`),
   * não de `columns[].dataTypeName` do resultado: aquele é resolvido com
   * `format_type(oid, NULL)`, **sem** o typmod, e devolve `character` no lugar
   * de `character(14)` — castar por ele truncaria o valor a um caractere.
   *
   * Isto é só desenho de tela. O SQL que executa é montado no servidor, com o
   * tipo lido do catálogo lá — tipo vindo do cliente entraria no SQL e seria
   * injeção.
   */
  const tiposDeColuna = useMemo(
    () => new Map((colunasSchema ?? []).map((c) => [c.name, c.dataType])),
    [colunasSchema],
  );

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
  /**
   * INSERT das linhas escolhidas, gerado pela rota do servidor (o front não
   * monta SQL por concatenação). Vai o valor bruto de todas as colunas.
   */
  const copiarInsert = async (indices: readonly number[]): Promise<string | null> => {
    const sel = indices.map((i) => linhas[i]).filter((l) => l !== undefined).map((l) => [...l]);
    if (sel.length === 0) return null;
    const { data, error } = await api.api
      .connections({ id: target.connectionId })
      .tables({ schema: target.schema })({ table: target.relation })["insert-sql"].post({
        database: target.database,
        columns: colunas.map((c) => c.name),
        rows: sel,
      });
    return error === null ? data.sql : null;
  };

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

  const COLECOES = new Set<string>(["hash", "list", "set", "zset"]);

  /**
   * Redis: o duplo clique na coluna `value` de uma coleção abre o editor
   * estruturado direto (sem passar pelo input inline, que não serve a JSON).
   * Devolve `true` quando assumiu a célula — o grid usa isso para não abrir o
   * editor inline por cima.
   */
  const abrirEditorRedis = (li: number, col: number): boolean => {
    if (!redisEstruturado || colunas[col]?.name !== "value") return false;
    const linha = linhas[li];
    if (linha === undefined) return false;
    const iTipo = colunas.findIndex((c) => c.name === "type");
    const iKey = colunas.findIndex((c) => c.name === "key");
    const tipo = iTipo >= 0 ? (linha[iTipo] ?? "") : "";
    const key = iKey >= 0 ? (linha[iKey] ?? "") : "";
    if (!COLECOES.has(tipo) || key === "") return false;
    setRedisAlvo({
      database: target.database,
      key,
      type: tipo as TipoColecao,
      valueJson: linha[col] ?? null,
    });
    return true;
  };

  /**
   * Mongo: o duplo clique numa célula cujo valor é objeto/array (JSON) abre o
   * editor de documento aninhado. Célula escalar não entra aqui — cai no editor
   * de célula normal (edição de campo de topo). O `_id` nunca é editável.
   */
  const abrirEditorMongo = (li: number, col: number): boolean => {
    if (!mongoDocumento) return false;
    const coluna = colunas[col]?.name;
    const linha = linhas[li];
    if (coluna === undefined || coluna === "_id" || linha === undefined) return false;
    const cel = linha[col] ?? null;
    // Só objeto/array (o render do Mongo faz JSON desses). Escalar → edição normal.
    if (cel === null || !(cel.startsWith("{") || cel.startsWith("["))) return false;
    const iId = colunas.findIndex((c) => c.name === "_id");
    const idValue = iId >= 0 ? (linha[iId] ?? "") : "";
    if (idValue === "") return false;
    setMongoAlvo({
      database: target.database,
      schema: target.schema,
      collection: target.relation,
      idColumn: "_id",
      idValue,
      campo: coluna,
      valueJson: cel,
    });
    return true;
  };

  /**
   * O editor próprio da célula: Redis primeiro, depois Mongo. Só quando a
   * edição está de fato liberada (`editavel`) — senão o modal abriria numa
   * conexão só-leitura e o servidor recusaria a gravação.
   */
  const abrirEditorCustom = (li: number, col: number): boolean =>
    editavel && (abrirEditorRedis(li, col) || abrirEditorMongo(li, col));

  const abrirEdicao = (li: number, col: number, valor: string): void => {
    const p = pkDaLinha(li);
    const coluna = colunas[col]?.name;
    const linha = linhas[li];
    if (p === null || coluna === undefined || linha === undefined) return;

    // Editor próprio (Redis/Mongo) tem prioridade; o grid já o abre no duplo
    // clique, mas se cair aqui via Enter do inline, roteia para ele também.
    if (abrirEditorCustom(li, col)) return;

    setEmEdicao({ linha: li, coluna: col });
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

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {permiteConsulta ? (
            <Button size="sm" variant="secondary" onClick={onConsultar}>
              {t("aba.consultar")}
            </Button>
          ) : null}

          {editavel && (colunasSchema?.length ?? 0) > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => { setInserindo(true); }}>
              <Plus aria-hidden className="h-3.5 w-3.5" />
              {t("edit.novaLinha")}
            </Button>
          ) : null}

          {/*
            `min-w-0` é o que faltava, não media query.

            Um `<select>` nativo dimensiona pela opção mais larga, e a opção
            mais larga aqui é o nome de coluna mais comprido da tabela — media
            299 px numa tabela real. Sem `min-w-0` o grupo não podia encolher
            abaixo do próprio min-content, o `flex-wrap` do pai não resolvia
            nada, e a PÁGINA rolava 157 px a 320.
          */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <Filter aria-hidden className="h-3 w-3 shrink-0 text-subtle" />
            <select
              value={rascunho.column}
              onChange={(e) => { setRascunho((r) => ({ ...r, column: e.target.value })); }}
              aria-label={t("dados.colunaFiltro")}
              className="h-7 min-w-0 max-w-[10rem] flex-1 cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-xs text-ink"
            >
              <option value="">{t("dados.coluna")}</option>
              {colunas.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <select
              value={rascunho.operator}
              onChange={(e) => { setRascunho((r) => ({ ...r, operator: e.target.value as FilterOperator })); }}
              aria-label={t("dados.operador")}
              className="h-7 w-[7.25rem] shrink-0 cursor-pointer rounded-[4px] border border-line bg-sunken px-1.5 font-mono text-xs text-ink"
            >
              {OPERADORES.map((op) => (
                <option key={op} value={op}>{SIMBOLO[op]}</option>
              ))}
            </select>
            {semValor(rascunho.operator) ? (
              <Button size="sm" variant="secondary" disabled={rascunho.column === ""} onClick={aplicarRascunho}>
                {t("dados.aplicarFiltro")}
              </Button>
            ) : (
              <Input
                value={rascunho.value}
                onChange={(e) => { setRascunho((r) => ({ ...r, value: e.target.value })); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") aplicarRascunho();
                  // Backspace no campo vazio tira o último chip (§3.5).
                  if (e.key === "Backspace" && rascunho.value === "" && filtros.length > 0) removerFiltro(filtros.length - 1);
                }}
                placeholder={rascunho.operator === "in" ? t("dados.valoresIn") : rascunho.operator === "contains" ? t("dados.contem") : t("dados.valor")}
                aria-label={t("dados.valorFiltro")}
                className="h-7 w-full min-w-0 max-w-[9rem] flex-1 text-xs"
              />
            )}
          </div>

          {filtros.map((f, i) => (
            <span key={JSON.stringify(f)} className={saindo === i ? "motion-pop-out" : "motion-pop"}>
              <Badge tone="neutral">
                <span className="max-w-[16rem] truncate font-mono" title={rotuloFiltro(f)}>{rotuloFiltro(f)}</span>
                <button
                  type="button"
                  aria-label={t("dados.removerFiltro", { col: f.column })}
                  onClick={() => { removerFiltro(i); }}
                  className="press cursor-pointer"
                >
                  <X aria-hidden className="h-2.5 w-2.5" />
                </button>
              </Badge>
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Sempre montado (desabilitado sem seleção): surgir no clique quebrava
              a toolbar, a grade descia e o 2º clique do duplo clique ordenava. */}
          {editavel ? (
            <Button size="sm" variant="danger" disabled={linhaSel === null} onClick={abrirExclusao}>
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
              {t("edit.excluirLinha")}
            </Button>
          ) : null}

          {/* O export leva os MESMOS filtros e ordenação da tela: o arquivo tem
              de ser o que a pessoa está vendo, não a tabela crua. Escondido nas
              engines que não exportam (Mongo, Redis). */}
          {exportavel ? (
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
          ) : null}
          {trailing}
        </div>
      </div>

      {/* Sem PK não há keyset. Dizer isso é obrigatório: fingir que a navegação
          funciona é o que faz o usuário confiar numa lista incompleta. */}
      {primeira !== undefined && !primeira.keyset ? (
        // Informação de navegação, não ato destrutivo: sai do vocabulário de
        // perigo. Em vermelho, colada sob a aba (que também era vermelha), as
        // duas se liam como um alerta só, dizendo coisas sem relação.
        <p className="flex shrink-0 items-center gap-1.5 border-b border-line bg-raised px-3 py-1.5 text-2xs text-muted">
          <TriangleAlert aria-hidden className="h-3 w-3 shrink-0 text-accent" />
          {t("dados.semPk")}
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        {consulta.isPending ? (
          // Regra única de carregamento (§3.7): nada, esqueleto, Trabalhando.
          fase === "nada" ? null : fase === "esqueleto" ? <EsqueletoGrid /> : <Trabalhando rotulo={t("dados.lendoLinhas")} cronometro />
        ) : consulta.isError ? (
          <div className="px-4 py-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="danger">
                {(consulta.error as { code?: string }).code ?? t("query.erroLabel")}
              </Badge>
              <span className="text-xs text-ink">
                {mensagemDoCodigo(
                  t,
                  (consulta.error as { code?: string }).code,
                  t("dados.erroLeitura"),
                )}
              </span>
            </div>
            <Button size="sm" className="mt-2" onClick={() => void consulta.refetch()}>
              {t("comum.tentarDeNovo")}
            </Button>
          </div>
        ) : linhas.length === 0 ? (
          // Tabela vazia e filtro sem resultado são informações diferentes (§3.7).
          filtros.length > 0 ? (
            <p className="px-4 py-6 text-xs text-subtle">
              {t("dados.nenhumaComFiltro")}{" · "}
              <button type="button" onClick={() => { setFiltros([]); }} className="cursor-pointer text-info hover:underline">
                {t("dados.limparFiltros")}
              </button>
            </p>
          ) : (
            <p className="px-4 py-6 text-xs text-subtle">{t("dados.nenhumaLinha")}</p>
          )
        ) : (
          <ResultGrid
            celulaSalva={salva}
            celulaPendente={pendente?.kind === "update" ? emEdicao : null}
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
            {...(redisEstruturado || mongoDocumento ? { abrirEditorCustom } : {})}
            fkColunas={fkColunas}
            pkColunas={new Set(pk)}
            onEstatistica={(coluna, ancora) => {
              setEstatistica({
                connectionId: target.connectionId,
                database: target.database,
                schema: target.schema,
                table: target.relation,
                coluna,
                filtros,
                ancora,
              });
            }}
            onCopiarInsert={copiarInsert}
            onFiltrarValor={(coluna, operador, valor) => {
              adicionarFiltro(operador === "isNull" ? { column: coluna, operator: "isNull" } : { column: coluna, operator: operador, value: valor ?? "" });
            }}
            {...(onOpenTableFiltered !== undefined ? { onSaltoFk: saltarFk } : {})}
            onCellClick={(li) => { setLinhaSel(li); }}
            loadingMore={consulta.isFetchingNextPage}
            onReachEnd={() => {
              if (consulta.hasNextPage && !consulta.isFetchingNextPage) void consulta.fetchNextPage();
            }}
          />
        )}
      </div>

      {/* Rodapé de lote (§4 #6): fora da lista virtual. A barra fina corre só
          durante o lote seguinte. Indeterminada: a rota não informa progresso
          dentro de um lote (pendência anotada em ui-detalhes §3.5). */}
      {linhas.length > 0 ? (
        <div className="relative flex h-6 shrink-0 items-center border-t border-line px-3 text-2xs tabular-nums text-subtle">
          {consulta.isFetchingNextPage ? (
            <span aria-hidden className="absolute inset-x-0 top-0 h-px overflow-hidden">
              <span className="animate-progresso block h-full w-full bg-info" />
            </span>
          ) : null}
          <span aria-live="polite">
            {consulta.hasNextPage
              ? t("dados.loteMais", { n: linhas.length.toLocaleString() })
              : linhas.length === 1
                ? t("dados.loteUma")
                : t("dados.loteTodas", { n: linhas.length.toLocaleString() })}
          </span>
        </div>
      ) : null}

      <EstatisticaColuna alvo={estatistica} onFechar={() => { setEstatistica(null); }} />

      {pendente !== null ? (
        <RowEditModal
          connectionId={target.connectionId}
          pendente={pendente}
          tipos={tiposDeColuna}
          onClose={() => { setPendente(null); }}
          onSalvo={() => { if (pendente.kind === "update") setSalva(emEdicao); }}
        />
      ) : null}

      {redisAlvo !== null ? (
        <RedisValueModal
          connectionId={target.connectionId}
          alvo={redisAlvo}
          onClose={() => { setRedisAlvo(null); }}
        />
      ) : null}

      {mongoAlvo !== null ? (
        <MongoDocModal
          connectionId={target.connectionId}
          alvo={mongoAlvo}
          onClose={() => { setMongoAlvo(null); }}
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

/**
 * Erro da leitura de linhas, tratado para a UI. Preserva o `code` do servidor
 * — o que `mensagemDoCodigo` traduz — e, sem corpo estruturado (transporte,
 * resposta sem JSON), marca `rede`. A `message` do banco segue de fallback,
 * inteira (CLAUDE.md), para quando não houver tradução do código.
 */
function erroDaConsulta(error: unknown): Error & { code?: string } {
  let message = "não foi possível carregar as linhas";
  let code: string | undefined;
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null) {
      if ("code" in value && typeof value.code === "string") code = value.code;
      if ("message" in value && typeof value.message === "string") message = value.message;
    }
  }
  code ??= "rede";
  const e: Error & { code?: string } = new Error(message);
  e.code = code;
  return e;
}
