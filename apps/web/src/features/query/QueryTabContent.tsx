import { splitStatements, type QueryResponse, type StatementResult } from "@dbee/shared";
import { useMutation } from "@tanstack/react-query";
import { Play, Square, Table2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";

import { Badge, Button } from "../../components/ui";
import { api } from "../../lib/api";
import { DataTab } from "../tabs/DataTab";
import { ExportButton } from "../export/ExportButton";
import { Mascote } from "../mascote";
import { Trabalhando } from "../motion/Trabalhando";
import { ResultGrid } from "../grid/ResultGrid";
import { cn } from "../../lib/cn";
import { useT } from "../../i18n";
import { useSchema } from "../tree/useTree";
import type { QueryTab } from "../../app/workspace";
import { SqlEditor } from "./SqlEditor";

/**
 * Aba de query — **andaime deliberado**.
 *
 * Textarea cru e tabela HTML sem virtualização. CodeMirror e TanStack Table são
 * a fatia seguinte; o que esta precisa provar é o caminho inteiro até o
 * Postgres e de volta, incluindo o erro com `position` correta.
 *
 * O alvo (conexão + database) vem da aba e é imutável: não há seletor aqui.
 */
export function QueryTabContent({
  tab,
  writeEnabled,
}: {
  readonly tab: QueryTab;
  readonly writeEnabled: boolean;
}) {
  const t = useT();
  const [sql, setSql] = useState(tab.initialSql);
  const [pedirEscrita, setPedirEscrita] = useState(false);
  // Id da execução em voo, para o botão Cancelar mandar o cancelamento certo.
  const queryIdRef = useRef("");

  // A árvore do database, para o autocomplete do editor. Já costuma estar em
  // cache (a navegação a buscou); aqui ela é reusada, não rebuscada.
  const arvore = useSchema(tab.connectionId, tab.database, true);

  /**
   * O painel de baixo: o resultado da consulta, ou os dados da tabela de origem.
   *
   * Quando a aba nasceu de "Consultar" sobre uma tabela, ela começa mostrando
   * **os dados da tabela** — é o ponto do pedido: ver a tabela enquanto se
   * escreve o SQL, sem decorar nome de coluna. Ao executar, salta para o
   * resultado; a aba "Tabela" continua ali para voltar a conferir.
   */
  const [painel, setPainel] = useState<"resultado" | "tabela">(
    tab.source !== undefined ? "tabela" : "resultado",
  );

  // reltuples da tabela de origem, para o "exportar tudo" da aba Dados.
  const relOrigem =
    tab.source === undefined
      ? null
      : (arvore.data?.schemas
          .find((e) => e.name === tab.source?.schema)
          ?.relations.find((r) => r.name === tab.source?.relation) ?? null);

  const executar = useMutation({
    mutationFn: async (aExecutar: string): Promise<QueryResponse> => {
      // Um id por execução, guardado no ref antes do request: é o que o Cancelar
      // usa para achar o backend certo enquanto a query roda.
      const queryId = crypto.randomUUID();
      queryIdRef.current = queryId;
      const { data, error } = await api.api.connections({ id: tab.connectionId }).query.post({
        sql: aExecutar,
        database: tab.database,
        queryId,
        // Só manda quando o usuário pediu: campo ausente significa leitura, e
        // o servidor trata assim de propósito.
        ...(writeEnabled && pedirEscrita ? { readOnly: false } : {}),
      });
      if (error !== null) throw new Error("o servidor não respondeu à consulta");
      return data;
    },
    // Executou: o olho quer o resultado, não os dados da tabela.
    onSuccess: () => { setPainel("resultado"); },
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

  const resposta = executar.data;
  /*
   * O SQL que o resultado descreve é o que **foi executado**, não o que está no
   * editor agora. Sem isto, editar o SQL depois de um erro recalculava o trecho
   * e o `^` sobre o texto novo — o caret pulava de lugar e a linha do erro
   * sumia ao apagar. `executar.variables` é o argumento que foi ao `mutate`.
   */
  const sqlExecutado = executar.variables ?? sql;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-52 shrink-0 border-b border-line">
        <SqlEditor
          value={sql}
          onChange={setSql}
          {...(arvore.data === undefined ? {} : { schema: arvore.data })}
          // Cmd+Enter roda só o statement sob o cursor; Cmd+Shift+Enter, tudo.
          onRunStatement={(trecho) => { if (trecho.trim() !== "") executar.mutate(trecho); }}
          onRunAll={() => { if (sql.trim() !== "") executar.mutate(sql); }}
        />
      </div>

      <div className="shrink-0 border-b border-line">
        <div className="flex items-center gap-3 px-3 py-2">
          <Button
            variant="primary"
            size="sm"
            disabled={sql.trim() === ""}
            loading={executar.isPending}
            loadingLabel={t("query.executando")}
            onClick={() => { executar.mutate(sql); }}
          >
            <Play aria-hidden className="h-3.5 w-3.5" />
            {t("query.executarTudo")}
          </Button>

          {executar.isPending ? (
            <Button
              variant="danger"
              size="sm"
              loading={cancelar.isPending}
              loadingLabel={t("query.cancelando")}
              onClick={() => { cancelar.mutate(); }}
            >
              <Square aria-hidden className="h-3 w-3" />
              {t("query.cancelar")}
            </Button>
          ) : null}

          <span className="text-2xs text-subtle">{t("query.cmdEnter")}</span>

          {writeEnabled ? (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-2xs text-muted">
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
          </p>
        ) : null}
      </div>

      {/*
        * Painel de baixo com duas faces. A barra de faces só existe quando há
        * tabela de origem — sem ela, "Dados da tabela" não teria o que mostrar,
        * e uma aba única seria um seletor de um item só.
        */}
      {tab.source !== undefined ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1">
          <FacePainel
            ativa={painel === "resultado"}
            onClick={() => { setPainel("resultado"); }}
          >
            {t("query.resultado")}
            {resposta !== undefined ? (
              <span className="ml-1 text-2xs text-subtle">
                {resposta.results.reduce((n, r) => n + r.rowCount, 0)}
              </span>
            ) : null}
          </FacePainel>
          <FacePainel ativa={painel === "tabela"} onClick={() => { setPainel("tabela"); }}>
            <Table2 aria-hidden className="h-3 w-3" />
            {tab.source.schema}.{tab.source.relation}
          </FacePainel>
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
            {...(relOrigem !== null ? { colunasSchema: relOrigem.columns } : {})}
            // "Consultar" aqui recarrega o SELECT da tabela no editor de cima,
            // em vez de abrir outra aba: já estamos na aba de consulta dela.
            onConsultar={() => {
              setSql(
                `SELECT *\nFROM ${tab.source?.schema ?? ""}.${tab.source?.relation ?? ""}\nLIMIT 100;`,
              );
            }}
          />
        ) : executar.isPending ? (
          // A espera mais longa do app: o `statement_timeout` padrão é 30 s.
          // Sem o cronômetro, "rodando" e "travado" têm a mesma aparência.
          <Trabalhando rotulo={t("query.executandoConsulta")} cronometro />
        ) : executar.isError ? (
          <p className="px-4 py-6 text-xs text-danger">{executar.error.message}</p>
        ) : resposta === undefined ? (
          <p className="px-4 py-6 text-xs text-subtle">
            {t("query.vazio")}
          </p>
        ) : (
          <Resultado resposta={resposta} sql={sqlExecutado} tab={tab} />
        )}
      </div>
    </div>
  );
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
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-xs transition-colors duration-150",
        ativa
          ? "bg-raised font-medium text-ink"
          : "cursor-pointer text-subtle hover:text-ink",
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
}: {
  readonly resposta: QueryResponse;
  readonly sql: string;
  readonly tab: QueryTab;
}) {
  const t = useT();
  /*
   * O SQL de cada statement, pelo MESMO separador que o servidor usou para
   * executá-los. Reconstruir a fatia de outro jeito exportaria um texto e
   * mostraria outro assim que o SQL tivesse `;` dentro de string.
   */
  const statements = splitStatements(sql);

  return (
    <>
      {resposta.error !== null ? <ErroPostgres erro={resposta.error} sql={sql} /> : null}

      {resposta.results.map((r) => (
        <ResultadoStatement
          key={r.index}
          result={r}
          total={resposta.results.length}
          tab={tab}
          sql={statements[r.index]?.sql ?? sql}
        />
      ))}

      <div className="flex items-center gap-2 px-4 py-3 text-2xs text-subtle">
        {/*
          * O mascote comemora só quando deu certo — erro tem sua própria caixa
          * com o `code` do Postgres, e uma abelha feliz ao lado de um erro seria
          * a tela contradizendo a si mesma. `pop` uma vez, sem flutuar depois:
          * é um aceno, não um enfeite permanente.
          */}
        {resposta.error === null ? (
          <Mascote humor="joia" pop className="h-6 w-6 shrink-0" />
        ) : null}
        <span>
          {resposta.totalDurationMs} ms · {resposta.readOnly ? t("query.somenteLeitura") : t("query.escrita")}
        </span>
      </div>
    </>
  );
}

/**
 * O erro do Postgres, inteiro (CLAUDE.md).
 *
 * Mostra a linha e a coluna calculadas a partir da `position` já corrigida pelo
 * servidor, e um recorte do SQL com um cursor apontando o ponto exato — é o que
 * o editor vai destacar quando o CodeMirror entrar.
 */
function ErroPostgres({
  erro,
  sql,
}: {
  readonly erro: NonNullable<QueryResponse["error"]>;
  readonly sql: string;
}) {
  const t = useT();
  const local = erro.position === null ? null : localizar(sql, erro.position);

  return (
    <div className="border-b border-danger/30 bg-danger/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{erro.code ?? t("query.erroLabel")}</Badge>
        <span className="text-xs text-ink">{erro.message}</span>
        {resposta_indice(erro.index)}
      </div>

      {local !== null ? (
        <div className="mt-2 block w-full rounded-[4px] bg-sunken p-2 text-left font-mono text-xs">
          <span className="text-subtle">
            {t("query.linhaColuna", { linha: local.linha, coluna: local.coluna })}
          </span>
          {/*
            * `whitespace-pre` é obrigatório aqui: o HTML colapsa sequências de
            * espaço, e sem isso o `^` ia parar na coluna 1 enquanto o texto
            * dizia "coluna 22" — a tela apontando um lugar e afirmando outro.
            */}
          <span className="mt-1 block whitespace-pre text-muted">{local.texto}</span>
          <span className="block whitespace-pre text-accent">
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

const resposta_indice = (index: number) =>
  index > 0 ? <span className="text-2xs text-subtle">statement #{index + 1}</span> : null;

/** Converte a posição 1-based em linha, coluna e o texto daquela linha. */
function localizar(sql: string, position: number): { linha: number; coluna: number; texto: string } {
  const antes = sql.slice(0, Math.max(0, position - 1));
  const linhas = antes.split("\n");
  const linha = linhas.length;
  const coluna = (linhas.at(-1)?.length ?? 0) + 1;
  return { linha, coluna, texto: sql.split("\n")[linha - 1] ?? "" };
}

function ResultadoStatement({
  result,
  total,
  tab,
  sql,
}: {
  readonly result: StatementResult;
  readonly total: number;
  readonly tab: QueryTab;
  readonly sql: string;
}) {
  const t = useT();
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
          <ResultGrid columns={result.columns} rows={result.rows} />
        </div>
      )}
    </section>
  );
}
