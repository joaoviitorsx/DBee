import { type ApplyResponse, type ExplainResponse, type QueryResponse, type SavedQuery, type StatementResult } from "@dbee/shared";
import { capacidadesDe, dialetoDe, splitStatements, valoresDosParametros, type DialetoSql } from "@dbee/shared/puro";
import { useMutation } from "@tanstack/react-query";
import { BookmarkPlus, FolderOpen, GitBranch, History, Play, Square, Table2, TriangleAlert, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge, Button } from "../../components/ui";
import { ComSaida } from "../../components/ComSaida";
import { api } from "../../lib/api";
import { useIndicador } from "../../lib/useIndicador";
import { SaveQueryDialog, SavedQueriesModal } from "./SavedQueriesModal";
import { DataTab } from "../tabs/DataTab";
import { ExportButton } from "../export/ExportButton";
import { Trabalhando } from "../motion/Trabalhando";
import { ResultGrid } from "../grid/ResultGrid";
import { PlanoView } from "../explain/PlanoView";
import { PainelHistorico } from "../historico/PainelHistorico";
import { PedirValores } from "../snippets/PedirValores";
import { prepararSnippet } from "../snippets/snippet.puro";
import { cn } from "../../lib/cn";
import { mensagemDoCodigo, useT } from "../../i18n";
import { useConnections, useSchema } from "../tree/useTree";
import type { QueryTab, TableTarget } from "../../app/workspace";
import type { RowFilter } from "@dbee/shared";
import { SqlEditor, type SqlEditorApi, type TrechoSql } from "./SqlEditor";
import { ArquivoSql } from "./ArquivoSql";
import { localizar, trechoDoErro } from "./posicaoErro.puro";
import { nomeDoSqlstate } from "./sqlstate.puro";
import { uuidV4 } from "../../lib/navegador";
import { zumbir } from "../../lib/zumbido";
import { PainelEnsaio } from "../ensaio/PainelEnsaio";
import { useEnsaio, type AlvoEnsaio } from "../ensaio/useEnsaio";
import { ConfirmarProducao } from "../ambiente/ConfirmarProducao";

/**
 * Uma execução: o SQL **enviado**, de onde ele saiu no editor e, para snippet
 * (ADR 019), os valores de bind. `original` é o texto do editor naquele
 * trecho — com `params`, `sql` traz `$n` e difere dele.
 */
interface Execucao {
  readonly sql: string;
  readonly de: number;
  readonly original: string;
  readonly params?: (string | null)[];
  /** Nome confirmado em produção; vai no body para o servidor conferir. */
  readonly confirmName?: string;
}

/** Um pedido de valores de snippet em espera; `acao` recebe o SQL com `$n`. */
interface Pendente {
  readonly nomes: readonly string[];
  readonly acao: (params: (string | null)[]) => void;
}

/**
 * Aba de query: editor CodeMirror, barra de ações e o painel de baixo
 * (resultado · plano · dados da tabela de origem).
 *
 * O alvo (conexão + database) vem da aba e é imutável: não há seletor aqui.
 */
export function QueryTabContent({
  tab,
  writeEnabled,
  onOpenTableFiltered,
  onAbrirSalva,
  onSqlChange,
  nomeConexao,
}: {
  readonly tab: QueryTab;
  readonly writeEnabled: boolean;
  /** Salto por FK — do painel "Tabela" e do resultado de query livre. */
  readonly onOpenTableFiltered: (target: TableTarget, filters: readonly RowFilter[]) => void;
  /** Abrir uma query salva numa aba nova, atrelada à conexão de origem. */
  readonly onAbrirSalva: (query: SavedQuery) => void;
  /** Persiste o texto do editor na aba (sobrevive a reload; workspace.ts). */
  readonly onSqlChange?: (sql: string) => void;
  /** Nome legível de uma conexão pelo id (ou null se foi apagada). */
  readonly nomeConexao: (connectionId: string | null) => string | null;
}) {
  const t = useT();
  const [sql, setSqlBruto] = useState(tab.initialSql);
  // Grava o texto na aba com 400 ms de folga: persistir a cada tecla
  // regravaria o localStorage dezenas de vezes por segundo.
  useEffect(() => {
    if (onSqlChange === undefined || sql === tab.initialSql) return;
    const id = setTimeout(() => { onSqlChange(sql); }, 400);
    return () => { clearTimeout(id); };
  }, [sql, onSqlChange, tab.initialSql]);
  const [pedirEscrita, setPedirEscrita] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mostrarSalvas, setMostrarSalvas] = useState(false);
  const [historico, setHistorico] = useState(false);
  /** Seleção não vazia do editor — o botão vira "Executar seleção" (§4). */
  const [selecao, setSelecao] = useState<TrechoSql | null>(null);
  /** `Ctrl+Enter` "aperta" o botão por `--motion-fast` (§3.6). */
  const [pressionado, setPressionado] = useState(false);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  /** Últimos valores por variável, para o próximo prompt já vir preenchido. */
  const [valoresSnippet, setValoresSnippet] = useState<Record<string, string | null>>({});
  const [recusa, setRecusa] = useState<"engine" | "varios" | null>(null);
  const editor = useRef<SqlEditorApi>(null);
  // Id da execução em voo, para o botão Cancelar mandar o cancelamento certo.
  const queryIdRef = useRef("");
  // O SQL do editor no momento da resposta — para conferir que o trecho
  // executado ainda está onde estava antes de sublinhar o erro.
  const sqlRef = useRef(sql);
  useEffect(() => { sqlRef.current = sql; }, [sql]);

  const setSql = (v: string): void => {
    setSqlBruto(v);
    setRecusa(null);
  };

  // A árvore do database, para o autocomplete do editor. Já costuma estar em
  // cache (a navegação a buscou); aqui ela é reusada, não rebuscada.
  const arvore = useSchema(tab.connectionId, tab.database, true);
  /*
   * O dialeto da conexão desta aba. É o que faz o editor separar statements do
   * mesmo jeito que o servidor vai separar: com a gramática do Postgres num SQL
   * de MySQL, `'O\'Brien; ...'` viraria dois trechos aqui e um lá.
   */
  const conexoes = useConnections();
  const conexaoDaAba = conexoes.data?.find((c) => c.id === tab.connectionId);
  const engineDaAba = conexaoDaAba?.engine ?? "postgres";
  /** Selo `production` (ADR 022): gravar pede o nome da conexão digitado. */
  const producao = conexaoDaAba?.environment === "production";
  const dialeto: DialetoSql = dialetoDe(engineDaAba);
  /**
   * A engine consegue cancelar uma consulta em voo?
   *
   * O Postgres (`pg_cancel_backend`), o MySQL (`KILL QUERY`) e o SQLite
   * (terminação do worker) conseguem; o libSQL **não** — o protocolo HTTP não
   * oferece cancelamento. Sem isto o botão "Cancelar" apareceria no libSQL sem
   * fazer nada, que é o tipo de ação morta que o design-system §5 proíbe.
   */
  const podeCancelar = capacidadesDe(engineDaAba)?.cancelarQuery === true;
  /** EXPLAIN visual é só Postgres (ADR 017 §5); o servidor recusa as outras. */
  const podeExplicar = engineDaAba === "postgres";

  /**
   * O painel de baixo: resultado, plano (EXPLAIN) ou os dados da tabela de
   * origem. Quando a aba nasceu de "Consultar" sobre uma tabela, começa nos
   * dados — ver a tabela enquanto se escreve o SQL. Ao executar, salta para o
   * resultado; ao explicar, para o plano.
   */
  const [painel, setPainel] = useState<"resultado" | "plano" | "tabela">(
    tab.source !== undefined ? "tabela" : "resultado",
  );

  // reltuples da tabela de origem, para o "exportar tudo" da aba Dados.
  const relOrigem =
    tab.source === undefined
      ? null
      : (arvore.data?.schemas
          .find((e) => e.name === tab.source?.schema)
          ?.relations.find((r) => r.name === tab.source?.relation) ?? null);

  const modoEscrita = writeEnabled && pedirEscrita;
  /**
   * O resultado de um Aplicar do ensaio (ADR 021). Fica ao lado de
   * `executar.data`, e o mais recente dos dois é o que o painel mostra: cada
   * caminho limpa o outro ao começar.
   */
  const [aplicado, setAplicado] = useState<{ resposta: QueryResponse; exec: Execucao } | null>(null);
  const ensaio = useEnsaio({
    connectionId: tab.connectionId,
    database: tab.database,
    queryIdRef,
    onAplicado: (r: ApplyResponse, alvo: AlvoEnsaio) => {
      setAplicado({ resposta: { results: r.results, error: r.error, totalDurationMs: r.totalDurationMs, readOnly: false }, exec: alvo });
      setPainel("resultado");
      if (r.committed) zumbir();
      editor.current?.marcarErro(trechoNoEditor(r.error?.position ?? null, alvo, sqlRef.current));
    },
  });
  /** Pedido de confirmação de produção em espera: o que fazer com o nome digitado. */
  const [confirmar, setConfirmar] = useState<((nome: string) => void) | null>(null);

  const executar = useMutation({
    mutationFn: async (exec: Execucao): Promise<QueryResponse> => {
      // Um id por execução, guardado no ref antes do request: é o que o Cancelar
      // usa para achar o backend certo enquanto a query roda.
      const queryId = uuidV4();
      queryIdRef.current = queryId;
      const { data, error } = await api.api.connections({ id: tab.connectionId }).query.post({
        sql: exec.sql,
        database: tab.database,
        queryId,
        // Bind dos `:nome` (ADR 019): os valores nunca tocam o texto.
        ...(exec.params === undefined ? {} : { params: exec.params }),
        // Só manda quando o usuário pediu: campo ausente significa leitura, e
        // o servidor trata assim de propósito.
        ...(writeEnabled && pedirEscrita ? { readOnly: false } : {}),
        ...(exec.confirmName === undefined ? {} : { confirmName: exec.confirmName }),
      });
      if (error !== null) throw erroDaConsulta(error);
      return data;
    },
    // Durante a execução o painel já mostra o resultado (o cronômetro), não
    // os dados da tabela — senão "Cancelar" aparece sem nada rodando à vista.
    onMutate: () => {
      editor.current?.marcarErro(null);
      setPainel("resultado");
      setAplicado(null);
      ensaio.descartar();
    },
    // Executou: o olho quer o resultado, não os dados da tabela. Se rodou em
    // modo escrita e o servidor confirmou o commit, a marca zumbe.
    onSuccess: (resposta, exec) => {
      setPainel("resultado");
      if (!resposta.readOnly && resposta.error === null) zumbir();
      editor.current?.marcarErro(trechoNoEditor(resposta.error?.position ?? null, exec, sqlRef.current));
    },
  });

  const explicar = useMutation({
    mutationFn: async (pedido: { exec: Execucao; analyze: boolean }): Promise<ExplainResponse> => {
      const { exec, analyze } = pedido;
      const { data, error } = await api.api.connections({ id: tab.connectionId }).explain.post({
        sql: exec.sql,
        database: tab.database,
        ...(exec.params === undefined ? {} : { params: exec.params }),
        // Ausente = sem ANALYZE; só se manda `true` (ADR 017).
        ...(analyze ? { analyze: true } : {}),
      });
      if (error !== null) throw erroDaConsulta(error);
      return data;
    },
    onMutate: () => {
      editor.current?.marcarErro(null);
      setPainel("plano");
    },
    onSuccess: (resposta, { exec }) => {
      editor.current?.marcarErro(trechoNoEditor(resposta.error?.position ?? null, exec, sqlRef.current));
    },
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (queryIdRef.current === "") return;
      // O cancelamento faz a query voltar com 57014; o resultado (erro
      // "cancelada") chega pela própria promessa do `executar`, não por aqui.
      await api.api.connections({ id: tab.connectionId }).query.cancel.post({
        queryId: queryIdRef.current,
      });
    },
  });

  /**
   * Antes de mandar: variáveis `:nome` pedem valores (ADR 019) ou são
   * recusadas com o motivo (outra engine, vários statements).
   */
  const comVariaveis = (trecho: TrechoSql, acao: (exec: Execucao) => void): void => {
    if (trecho.sql.trim() === "") return;
    setRecusa(null);
    const prep = prepararSnippet(trecho.sql, dialeto);
    if (prep.tipo === "sem") {
      acao({ sql: trecho.sql, de: trecho.de, original: trecho.sql });
    } else if (prep.tipo === "recusa") {
      setRecusa(prep.motivo);
    } else {
      setPendente({
        nomes: prep.nomes,
        acao: (params) => { acao({ sql: prep.sql, de: trecho.de, original: trecho.sql, params }); },
      });
    }
  };

  /** `/query` direto; em produção com escrita, só depois do nome digitado (ADR 022 §5). */
  const executarDireto = (exec: Execucao): void => {
    if (modoEscrita && producao) {
      setConfirmar(() => () => { executar.mutate({ ...exec, confirmName: conexaoDaAba.name }); });
      return;
    }
    executar.mutate(exec);
  };

  /*
   * Modo escrita no Postgres passa sempre pelo ensaio (ADR 021). Fora dele: as
   * outras engines (o servidor recusa o ensaio) e snippet com `:nome` (o
   * ensaio não leva bind) vão direto, como antes.
   */
  const rodar = (trecho: TrechoSql): void => {
    comVariaveis(trecho, (exec) => {
      if (modoEscrita && engineDaAba === "postgres" && exec.params === undefined) {
        executar.reset();
        setAplicado(null);
        editor.current?.marcarErro(null);
        setPainel("resultado");
        void ensaio.ensaiar(exec);
        return;
      }
      executarDireto(exec);
    });
  };
  const aplicarEnsaio = (): void => {
    if (producao) {
      setConfirmar(() => (nome: string) => { void ensaio.aplicar(nome); });
      return;
    }
    void ensaio.aplicar();
  };
  const rodarExplain = (analyze: boolean): void => {
    const alvo = editor.current?.alvo() ?? { sql, de: 0 };
    comVariaveis(alvo, (exec) => { explicar.mutate({ exec, analyze }); });
  };

  // O ref só é lido no clique, nunca durante o render.
  const irPara = (pos: number): void => { editor.current?.irPara(pos); };

  /** O teclado também "aperta" o botão: `data-pressed` por `--motion-fast`. */
  const apertar = (): void => {
    setPressionado(true);
    window.setTimeout(() => { setPressionado(false); }, 120);
  };

  const resposta = aplicado?.resposta ?? executar.data;
  /*
   * O SQL que o resultado descreve é o que **foi executado**, não o que está no
   * editor agora. Sem isto, editar o SQL depois de um erro recalculava o trecho
   * e o `^` sobre o texto novo — o caret pulava de lugar e a linha do erro
   * sumia ao apagar. `executar.variables` é o argumento que foi ao `mutate`.
   */
  const execucao = aplicado?.exec ?? executar.variables ?? { sql, de: 0, original: sql };
  const sqlExecutado = execucao.sql;

  // Faces do painel de baixo. A barra só existe com mais de uma: uma aba
  // única seria um seletor de um item só.
  const faces = [
    "resultado" as const,
    ...(explicar.data !== undefined || explicar.isPending || explicar.isError ? ["plano" as const] : []),
    ...(tab.source !== undefined ? ["tabela" as const] : []),
  ];
  const filaFaces = useRef<HTMLDivElement>(null);
  const indicadorFaces = useRef<HTMLDivElement>(null);
  useIndicador(filaFaces, indicadorFaces, `${painel}:${String(faces.length)}`);

  const fase = ensaio.fase;
  const executando =
    executar.isPending || fase?.tipo === "ensaiando" || fase?.tipo === "aplicando";
  const mostrarCancelar = executando && podeCancelar;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-52 shrink-0 border-b border-line">
        <SqlEditor
          ref={editor}
          value={sql}
          onChange={setSql}
          dialeto={dialeto}
          {...(arvore.data === undefined ? {} : { schema: arvore.data })}
          // Cmd+Enter roda a seleção ou o statement sob o cursor; Cmd+Shift+Enter, tudo.
          onRunStatement={(trecho) => { apertar(); rodar(trecho); }}
          onRunAll={() => { apertar(); rodar({ sql, de: 0 }); }}
          onSelecao={setSelecao}
          onFormatarFalhou={() => { toast.error(t("query.formatarFalhou")); }}
        />
      </div>

      <div className="shrink-0 border-b border-line">
        {/*
        `flex-wrap` aqui não é estética: sem ele o interruptor de escrita — o
        controle que faz a transação nascer `BEGIN READ WRITE` — ficava **fora
        da tela** a 375 (+32 px) e a 320 (+87 px), alcançável só rolando a
        página inteira para o lado. E o aviso vermelho que ele liga aparece
        abaixo, sem que se veja o controle que o ligou.
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2">
          {/*
            * Executar ↔ Cancelar no MESMO lugar (§3.6): os dois ocupam a mesma
            * célula do grid, a largura é a do maior, e a troca é opacidade +
            * escala. É o `motion-troca` sem o giro — girar um botão com texto
            * em 90° desmonta a leitura no meio da troca.
            */}
          <span className="grid">
            <Button
              // Âmbar só quando a execução pode gravar; leitura usa tinta neutra.
              variant={writeEnabled && pedirEscrita ? "primary" : "solido"}
              size="sm"
              data-ativo={mostrarCancelar ? undefined : ""}
              data-pressed={pressionado ? "" : undefined}
              inert={mostrarCancelar}
              aria-hidden={mostrarCancelar}
              disabled={sql.trim() === ""}
              loading={executando && !podeCancelar}
              loadingLabel={t("query.executando")}
              onClick={() => { rodar(selecao ?? { sql, de: 0 }); }}
              className={cn(
                "col-start-1 row-start-1 transition-[opacity,scale] duration-(--motion-base) ease-(--ease-enter)",
                "not-data-[ativo]:scale-90 not-data-[ativo]:opacity-0",
                "motion-safe:data-[pressed]:scale-[0.97]",
                writeEnabled && pedirEscrita ? "data-[pressed]:bg-amber/80" : "data-[pressed]:bg-ink/80",
              )}
            >
              <Play aria-hidden className="h-3.5 w-3.5" />
              {/* Em escrita no Postgres o botão ensaia (ADR 021): o nome diz o que acontece. */}
              {modoEscrita && engineDaAba === "postgres"
                ? (selecao !== null ? t("ensaio.ensaiarSelecao") : t("ensaio.ensaiar"))
                : selecao !== null ? t("query.executarSelecao") : t("query.executarTudo")}
            </Button>
            {podeCancelar ? (
              <Button
                variant="danger"
                size="sm"
                data-ativo={mostrarCancelar ? "" : undefined}
                inert={!mostrarCancelar}
                aria-hidden={!mostrarCancelar}
                loading={cancelar.isPending}
                loadingLabel={t("query.cancelando")}
                onClick={() => { cancelar.mutate(); }}
                className={cn(
                  "col-start-1 row-start-1 bg-surface transition-[opacity,scale] duration-(--motion-base) ease-(--ease-enter)",
                  "not-data-[ativo]:scale-90 not-data-[ativo]:opacity-0",
                )}
              >
                <Square aria-hidden className="h-3 w-3" />
                {t("query.cancelar")}
              </Button>
            ) : null}
          </span>

          {podeExplicar ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={sql.trim() === ""}
              loading={explicar.isPending && !explicar.variables.analyze}
              title={t("query.explicarTitle")}
              onClick={() => { rodarExplain(false); }}
            >
              <GitBranch aria-hidden className="h-3.5 w-3.5" />
              {t("query.explicar")}
            </Button>
          ) : null}
          {/* ANALYZE executa a query: só com escrita ligada nesta execução (ADR 017). */}
          {podeExplicar && writeEnabled && pedirEscrita ? (
            <Button
              variant="danger"
              size="sm"
              disabled={sql.trim() === ""}
              loading={explicar.isPending && explicar.variables.analyze}
              title={t("query.analyzeAviso")}
              onClick={() => { rodarExplain(true); }}
            >
              <GitBranch aria-hidden className="h-3.5 w-3.5" />
              {t("query.explicarAnalyze")}
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            disabled={sql.trim() === ""}
            title="Shift+Alt+F"
            onClick={() => { editor.current?.formatar(); }}
          >
            <WandSparkles aria-hidden className="h-3.5 w-3.5" />
            {t("query.formatar")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={sql.trim() === ""}
            onClick={() => { setSalvando(true); }}
          >
            <BookmarkPlus aria-hidden className="h-3.5 w-3.5" />
            {t("salvas.salvar")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setMostrarSalvas(true); }}>
            <FolderOpen aria-hidden className="h-3.5 w-3.5" />
            {t("salvas.abrirLista")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={historico}
            onClick={() => { setHistorico((h) => !h); }}
          >
            <History aria-hidden className="h-3.5 w-3.5" />
            {t("historico.titulo")}
          </Button>
          <ArquivoSql sql={sql} titulo={tab.title} onAbrir={setSql} />

          {/* A dica de atalho é a primeira a sair: teclado não é o caminho
              de quem está no telefone, e ela empurrava o interruptor. */}
          <span className="hidden text-2xs text-subtle xl:inline">{t("query.cmdEnter")}</span>

          {writeEnabled ? (
            <label className="flex w-full cursor-pointer items-center gap-1.5 text-2xs text-muted sm:ml-auto sm:w-auto">
              <input
                type="checkbox"
                checked={pedirEscrita}
                onChange={(e) => { setPedirEscrita(e.target.checked); }}
                className="cursor-pointer accent-[var(--color-danger)]"
              />
              {/* Escrita é opt-in por execução, não por conexão. */}
              {t("query.permitirEscrita")}
            </label>
          ) : (
            <span className="ml-auto text-2xs text-subtle">{t("query.somenteLeitura")}</span>
          )}
        </div>

        {writeEnabled && pedirEscrita ? (
          <p className="flex items-center gap-1.5 border-t border-danger-line bg-danger-surface px-3 py-1.5 text-2xs text-danger-ink">
            <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
            {t("query.avisoEscrita")}
            {podeExplicar ? ` ${t("query.analyzeAviso")}` : ""}
          </p>
        ) : null}
        {recusa !== null ? (
          <p role="alert" className="flex items-center gap-1.5 border-t border-danger-line bg-danger-surface px-3 py-1.5 text-2xs text-danger-ink">
            <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
            {recusa === "engine" ? t("snippets.soPostgres") : t("snippets.umStatement")}
          </p>
        ) : null}
      </div>

      {salvando ? (
        <SaveQueryDialog
          sql={sql}
          connectionId={tab.connectionId}
          onClose={() => { setSalvando(false); }}
        />
      ) : null}
      {mostrarSalvas ? (
        <SavedQueriesModal
          onClose={() => { setMostrarSalvas(false); }}
          onOpen={onAbrirSalva}
          nomeConexao={nomeConexao}
        />
      ) : null}
      {confirmar !== null ? (
        <ConfirmarProducao
          nomeConexao={conexaoDaAba?.name ?? ""}
          onClose={() => { setConfirmar(null); }}
          onConfirmar={(nome) => {
            setConfirmar(null);
            confirmar(nome);
          }}
        />
      ) : null}
      {pendente !== null ? (
        <PedirValores
          nomes={pendente.nomes}
          iniciais={valoresSnippet}
          onClose={() => { setPendente(null); }}
          onConfirmar={(valores) => {
            setValoresSnippet((v) => ({ ...v, ...valores }));
            const r = valoresDosParametros(pendente.nomes, valores);
            if (r.ok) pendente.acao(r.params);
          }}
        />
      ) : null}
      {/* Histórico: gaveta à direita, saída simétrica pelo ComSaida (§3.2). */}
      <ComSaida
        aberto={historico}
        className="motion-gaveta fixed bottom-0 right-0 top-[var(--h-topbar,49px)] z-40 w-[min(28rem,100vw)] border-l border-line bg-surface shadow-[0_8px_24px_-12px_rgb(0_0_0/.5)]"
      >
        <PainelHistorico
          connectionId={tab.connectionId}
          onFechar={() => { setHistorico(false); }}
          onUsar={(texto) => {
            // Cola, não executa: rodar continua sendo ação explícita.
            setSql(texto);
            setHistorico(false);
          }}
        />
      </ComSaida>

      {faces.length > 1 ? (
        <div
          ref={filaFaces}
          role="tablist"
          className="relative flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3"
        >
          <div ref={indicadorFaces} aria-hidden className="indicador-aba bottom-0 bg-ink" />
          <FacePainel ativa={painel === "resultado"} onClick={() => { setPainel("resultado"); }}>
            {t("query.resultado")}
            {resposta !== undefined ? (
              <span className="ml-1 font-mono text-2xs text-subtle">
                {resposta.results.reduce((n, r) => n + r.rowCount, 0)}
              </span>
            ) : null}
          </FacePainel>
          {faces.includes("plano") ? (
            <FacePainel ativa={painel === "plano"} onClick={() => { setPainel("plano"); }}>
              <GitBranch aria-hidden className="h-3 w-3" />
              {t("explain.titulo")}
            </FacePainel>
          ) : null}
          {tab.source !== undefined ? (
            <FacePainel ativa={painel === "tabela"} onClick={() => { setPainel("tabela"); }}>
              <Table2 aria-hidden className="h-3 w-3" />
              {tab.source.schema}.{tab.source.relation}
            </FacePainel>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab.source !== undefined && painel === "tabela" ? (
          // Os dados da própria tabela, embaixo do editor. Reusa a aba Dados
          // inteira — mesma paginação por keyset, mesmo grid, mesmo export.
          <DataTab
            key={`${tab.source.schema}.${tab.source.relation}`}
            target={tab.source}
            estimatedRows={relOrigem?.estimatedRows ?? null}
            writeEnabled={writeEnabled}
            onOpenTableFiltered={onOpenTableFiltered}
            {...(relOrigem !== null ? { colunasSchema: relOrigem.columns, foreignKeys: relOrigem.foreignKeys } : {})}
            // "Consultar" aqui recarrega o SELECT da tabela no editor de cima,
            // em vez de abrir outra aba: já estamos na aba de consulta dela.
            onConsultar={() => {
              setSql(
                `SELECT *\nFROM ${tab.source?.schema ?? ""}.${tab.source?.relation ?? ""}\nLIMIT 100;`,
              );
            }}
          />
        ) : painel === "plano" ? (
          explicar.isPending ? (
            <Trabalhando rotulo={t("explain.planejando")} cronometro />
          ) : explicar.isError ? (
            <ErroExecucao erro={explicar.error} onRetry={() => { explicar.mutate(explicar.variables); }} />
          ) : explicar.data === undefined ? null : explicar.data.error !== null ? (
            <ErroPostgres
              erro={{ ...explicar.data.error, index: 0 }}
              sql={explicar.variables.exec.sql}
              posEditor={posNoEditor(explicar.data.error.position, explicar.variables.exec)}
              onIrPara={irPara}
            />
          ) : (
            <div className="motion-fade">
              <PlanoView resposta={explicar.data} />
            </div>
          )
        ) : fase !== null ? (
          <PainelEnsaio
            fase={fase}
            producao={producao}
            onAplicar={aplicarEnsaio}
            onDescartar={() => {
              ensaio.descartar();
            }}
            onEnsaiarDeNovo={() => { void ensaio.ensaiar(fase.alvo); }}
            onSemEnsaio={() => { executarDireto(fase.alvo); }}
          />
        ) : executando ? (
          // A espera mais longa do app: o `statement_timeout` padrão é 30 s.
          // Sem o cronômetro, "rodando" e "travado" têm a mesma aparência.
          <Trabalhando rotulo={t("query.executandoConsulta")} cronometro />
        ) : executar.isError ? (
          <ErroExecucao
            erro={executar.error}
            // Tentar de novo passa pela MESMA porta: em produção com escrita,
            // pede o nome outra vez (revisão de segurança v0.7).
            onRetry={() => {
              const { sql: s1, de, original, params } = execucao;
              executarDireto({ sql: s1, de, original, ...(params === undefined ? {} : { params }) });
            }}
          />
        ) : resposta === undefined ? (
          <p className="px-4 py-6 text-xs text-subtle">
            {t("query.vazio")}
          </p>
        ) : (
          <Resultado
            resposta={resposta}
            sql={sqlExecutado}
            tab={tab}
            dialeto={dialeto}
            onOpenTableFiltered={onOpenTableFiltered}
            posEditor={posNoEditor(resposta.error?.position ?? null, execucao)}
            onIrPara={irPara}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Onde, no documento ATUAL do editor, fica o token que o erro aponta — ou
 * `null` se não dá para saber com certeza.
 *
 * Com `params` (snippet) o SQL enviado tem `$n` e as posições não batem com o
 * texto do editor; e se o trecho já não está onde estava (editou-se durante a
 * execução), sublinhar seria apontar outro texto. Nos dois casos, melhor não
 * marcar do que marcar errado.
 */
function trechoNoEditor(
  position: number | null,
  exec: Execucao,
  docAtual: string,
): { de: number; ate: number } | null {
  if (position === null || exec.params !== undefined) return null;
  if (docAtual.slice(exec.de, exec.de + exec.original.length) !== exec.original) return null;
  return trechoDoErro(docAtual, exec.de + position - 1);
}

/** Deslocamento do erro no editor (0-based), quando ele existe lá. */
function posNoEditor(position: number | null, exec: Execucao): number | null {
  return position === null || exec.params !== undefined ? null : exec.de + position - 1;
}


/** Uma face do painel de baixo — resultado ou dados da tabela. */
function FacePainel({
  ativa,
  onClick,
  children,
}: {
  readonly ativa: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      aria-selected={ativa}
      className={cn(
        // Indicador deslizante da fila (§3.3) em vez de fundo por aba.
        "flex shrink-0 items-center gap-1.5 px-2.5 py-2 text-xs transition-colors duration-(--motion-fast)",
        ativa ? "font-medium text-ink" : "cursor-pointer text-subtle hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Resultado({
  resposta,
  sql,
  tab,
  dialeto,
  onOpenTableFiltered,
  posEditor,
  onIrPara,
}: {
  readonly resposta: QueryResponse;
  readonly sql: string;
  readonly tab: QueryTab;
  readonly dialeto: DialetoSql;
  readonly onOpenTableFiltered: (target: TableTarget, filters: readonly RowFilter[]) => void;
  readonly posEditor: number | null;
  readonly onIrPara: (pos: number) => void;
}) {
  const t = useT();
  /*
   * O SQL de cada statement, pelo MESMO separador que o servidor usou para
   * executá-los. Reconstruir a fatia de outro jeito exportaria um texto e
   * mostraria outro assim que o SQL tivesse `;` dentro de string.
   */
  const statements = splitStatements(sql, dialeto);
  const totalLinhas = resposta.results.reduce((n, r) => n + r.rowCount, 0);

  return (
    <>
      {resposta.error !== null ? (
        <ErroPostgres erro={resposta.error} sql={sql} posEditor={posEditor} onIrPara={onIrPara} />
      ) : null}

      {resposta.results.map((r) => (
        <ResultadoStatement
          key={r.index}
          result={r}
          total={resposta.results.length}
          tab={tab}
          sql={statements[r.index]?.sql ?? sql}
          onOpenTableFiltered={onOpenTableFiltered}
        />
      ))}

      {/* Um statement só: o cabeçalho dele já diz linhas e tempo, e a barra
          diz "somente leitura" — o total repetiria as duas coisas. */}
      {resposta.results.length === 1 ? null : (
      <div className="flex items-center gap-2 px-4 py-3 font-mono text-2xs text-subtle">
        {/*
          * Só métrica, em mono (§3.6, auditoria #6). Havia um mascote
          * comemorando cada consulta; quem roda 200 por dia via 200
          * comemorações — ruído em ação rotineira. O número troca seco.
          */}
        <span>
          {t(totalLinhas === 1 ? "query.linhaSing" : "query.linhaPlur", { n: totalLinhas })} · {resposta.totalDurationMs} ms · {resposta.readOnly ? t("query.somenteLeitura") : t("query.escrita")}
        </span>
      </div>
      )}
    </>
  );
}

/**
 * O erro do Postgres, inteiro (CLAUDE.md).
 *
 * Mostra a linha e a coluna calculadas a partir da `position` já corrigida pelo
 * servidor e um recorte do SQL com `^` no ponto; o editor sublinha o mesmo
 * token (§3.6). "linha X, coluna Y" é botão: põe o cursor lá e rola.
 *
 * Entra com `animate-refuse` uma vez (no mount — a caixa é nova a cada
 * resposta com erro, não re-anima ao re-renderizar).
 */
function ErroPostgres({
  erro,
  sql,
  posEditor,
  onIrPara,
}: {
  readonly erro: NonNullable<QueryResponse["error"]>;
  readonly sql: string;
  /** Onde o erro está no editor (0-based); `null` quando não dá para saber. */
  readonly posEditor: number | null;
  readonly onIrPara: (pos: number) => void;
}) {
  const t = useT();
  const local = erro.position === null ? null : localizar(sql, erro.position);
  const rotulo = local === null ? "" : t("query.linhaColuna", { linha: local.linha, coluna: local.coluna });

  return (
    <div className="animate-refuse border-b border-danger/30 bg-danger/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {erro.code === null ? (
          <Badge tone="danger">{t("query.erroLabel")}</Badge>
        ) : (
          <kbd
            title={nomeDoSqlstate(erro.code) ?? erro.code}
            className="cursor-help rounded-[4px] border border-danger/35 bg-danger/10 px-1.5 py-0.5 font-mono text-2xs font-semibold text-danger"
          >
            {erro.code}
          </kbd>
        )}
        <span className="text-xs text-ink">{erro.message}</span>
        {resposta_indice(erro.index)}
      </div>

      {local !== null ? (
        <div className="mt-2 block w-full rounded-[4px] bg-sunken p-2 text-left font-mono text-xs">
          {posEditor === null ? (
            <span className="text-subtle">{rotulo}</span>
          ) : (
            <button
              type="button"
              onClick={() => { onIrPara(posEditor); }}
              title={t("query.irAoErro")}
              className="cursor-pointer text-info underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              {rotulo}
            </button>
          )}
          {/*
            * `whitespace-pre` é obrigatório aqui: o HTML colapsa sequências de
            * espaço, e sem isso o `^` ia parar na coluna 1 enquanto o texto
            * dizia "coluna 22" — a tela apontando um lugar e afirmando outro.
            */}
          <span className="mt-1 block whitespace-pre text-muted">{local.texto}</span>
          <span className="block whitespace-pre text-danger">
            {`${" ".repeat(Math.max(0, local.coluna - 1))}^`}
          </span>
        </div>
      ) : null}

      {erro.detail !== null ? (
        <p className="mt-1.5 text-2xs text-muted">{erro.detail}</p>
      ) : null}
      {erro.hint !== null ? <p className="mt-1 text-2xs text-muted">{erro.hint}</p> : null}
    </div>
  );
}

/**
 * Erro da **execução** da consulta, tratado para a UI — o irmão do
 * `ErroPostgres`. Aquele é o SQL que rodou e o banco recusou (`resposta.error`,
 * com `position`); este é a execução que nem chegou a devolver um resultado:
 * servidor fora do ar, credencial não decifrável, escrita não permitida,
 * rate-limit. Preserva o `code` do servidor — o que `mensagemDoCodigo` traduz —
 * e, quando não há corpo estruturado (falha de transporte, resposta sem JSON),
 * marca `rede`: a falha é do caminho, não do SQL.
 */
function erroDaConsulta(error: unknown): Error & { code?: string } {
  let message = "falhou";
  let code: string | undefined;
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null) {
      if ("code" in value && typeof value.code === "string") code = value.code;
      if ("message" in value && typeof value.message === "string") message = value.message;
    }
  }
  // Sem código do servidor = não veio corpo estruturado: transporte, não SQL.
  code ??= "rede";
  const e: Error & { code?: string } = new Error(message);
  e.code = code;
  return e;
}

/**
 * A caixa de erro da execução. Mostra a mensagem **traduzida pelo código**
 * (uma frase que o usuário entende, não o texto cru do driver) e oferece rodar
 * de novo.
 *
 * Um erro sem `code` só chega aqui se algo do lado do cliente estourou antes do
 * request — o caso do `crypto.randomUUID` fora de contexto seguro. Aí a frase
 * amigável entra na frente e o texto técnico vai para uma linha discreta, para
 * quem for depurar, em vez de a tela cuspir "is not a function" no rosto de
 * quem só queria rodar um SELECT.
 */
function ErroExecucao({
  erro,
  onRetry,
}: {
  readonly erro: Error & { code?: string };
  readonly onRetry: () => void;
}) {
  const t = useT();
  const code = erro.code;
  const tecnico = code === undefined && erro.message !== "" && erro.message !== "falhou";
  return (
    <div className="px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{code ?? t("query.erroLabel")}</Badge>
        <span className="text-xs text-ink">{mensagemDoCodigo(t, code, t("query.erroExecucao"))}</span>
      </div>
      {tecnico ? <p className="mt-1.5 font-mono text-2xs text-muted">{erro.message}</p> : null}
      <Button size="sm" className="mt-2" onClick={onRetry}>
        {t("comum.tentarDeNovo")}
      </Button>
    </div>
  );
}

const resposta_indice = (index: number) =>
  index > 0 ? <span className="text-2xs text-subtle">statement #{index + 1}</span> : null;


function ResultadoStatement({
  result,
  total,
  tab,
  sql,
  onOpenTableFiltered,
}: {
  readonly result: StatementResult;
  readonly total: number;
  readonly tab: QueryTab;
  readonly sql: string;
  readonly onOpenTableFiltered: (target: TableTarget, filters: readonly RowFilter[]) => void;
}) {
  const t = useT();
  /*
   * Salto por FK no resultado de query livre (roadmap item 10): o servidor
   * resolve `tableID`/`columnID` da RowDescription e devolve a FK de UMA
   * coluna em `origin.references`. O grid marca por nome de coluna; com dois
   * resultados de mesmo nome (JOIN sem alias), vale a referência da coluna
   * clicada — `onSaltoFk` recebe o índice, não o nome.
   */
  const fkColunas = useMemo(
    () => new Set(result.columns.filter((c) => (c.origin?.references ?? null) !== null).map((c) => c.name)),
    [result.columns],
  );
  const saltarFk = (li: number, col: number): void => {
    const ref = result.columns[col]?.origin?.references ?? null;
    const valor = result.rows[li]?.[col] ?? null;
    // Valor nulo não referencia linha nenhuma.
    if (ref === null || valor === null) return;
    onOpenTableFiltered(
      { connectionId: tab.connectionId, database: tab.database, schema: ref.schema, relation: ref.table, kind: "table" },
      [{ column: ref.column, operator: "eq", value: valor }],
    );
  };
  return (
    <section className="border-b border-line">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2">
        {total > 1 ? (
          <span className="font-mono text-2xs text-subtle">#{result.index + 1}</span>
        ) : null}
        <span className="text-2xs text-muted">
{t(result.rowCount === 1 ? "query.linhaSing" : "query.linhaPlur", { n: result.rowCount })} · {result.durationMs} ms
          {result.command === null ? "" : ` · ${result.command}`}
        </span>
        {result.truncated ? (
          // Truncamento é informação, não detalhe: a query devolveu mais.
          <Badge tone="danger">{t("dados.truncado")}</Badge>
        ) : null}

        {result.columns.length > 0 ? (
          <div className="ml-auto">
            {/*
              * Truncado é exatamente onde a escolha existe: as linhas da tela
              * já foram lidas, e o resultado inteiro exige rodar a consulta de
              * novo — sem `maxRows`, e num cursor que não trunca.
              */}
            <ExportButton
              connectionId={tab.connectionId}
              database={tab.database}
              source={{ kind: "query", sql }}
              carregadas={result.rowCount}
              temMais={result.truncated}
            />
          </div>
        ) : null}
      </header>

      {result.columns.length === 0 ? (
        <p className="px-4 pb-3 text-2xs text-subtle">{t("dados.semLinhas")}</p>
      ) : (
        <div className="h-80 border-t border-line">
          <ResultGrid
            columns={result.columns}
            rows={result.rows}
            {...(fkColunas.size > 0 ? { fkColunas, onSaltoFk: saltarFk } : {})}
          />
        </div>
      )}
    </section>
  );
}
