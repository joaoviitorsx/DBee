import type { QueryResponse, StatementResult } from "@dbee/shared";
import { useMutation } from "@tanstack/react-query";
import { Play, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge, Button } from "../../components/ui";
import { api } from "../../lib/api";
import { ResultGrid } from "../grid/ResultGrid";
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
  const [sql, setSql] = useState(tab.initialSql);
  const [pedirEscrita, setPedirEscrita] = useState(false);

  const executar = useMutation({
    mutationFn: async (aExecutar: string): Promise<QueryResponse> => {
      const { data, error } = await api.api.connections({ id: tab.connectionId }).query.post({
        sql: aExecutar,
        database: tab.database,
        // Só manda quando o usuário pediu: campo ausente significa leitura, e
        // o servidor trata assim de propósito.
        ...(writeEnabled && pedirEscrita ? { readOnly: false } : {}),
      });
      if (error !== null) throw new Error("o servidor não respondeu à consulta");
      return data;
    },
  });

  const resposta = executar.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-52 shrink-0 border-b border-line">
        <SqlEditor
          value={sql}
          onChange={setSql}
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
            loadingLabel="Executando…"
            onClick={() => { executar.mutate(sql); }}
          >
            <Play aria-hidden className="h-3.5 w-3.5" />
            Executar tudo
          </Button>

          <span className="text-2xs text-subtle">Cmd+Enter roda o statement sob o cursor</span>

          {writeEnabled ? (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-2xs text-muted">
              <input
                type="checkbox"
                checked={pedirEscrita}
                onChange={(e) => { setPedirEscrita(e.target.checked); }}
                className="cursor-pointer accent-[var(--color-danger)]"
              />
              {/* Escrita é opt-in por execução, não por conexão. */}
              Permitir escrita nesta execução
            </label>
          ) : (
            <span className="ml-auto text-2xs text-subtle">somente leitura</span>
          )}
        </div>

        {writeEnabled && pedirEscrita ? (
          <p className="flex items-center gap-1.5 border-t border-danger-line bg-danger-surface px-3 py-1.5 text-2xs text-danger-ink">
            <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
            A próxima execução roda em transação gravável e é commitada.
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {executar.isError ? (
          <p className="px-4 py-6 text-xs text-danger">{executar.error.message}</p>
        ) : resposta === undefined ? (
          <p className="px-4 py-6 text-xs text-subtle">
            Escreva uma consulta e execute. O resultado aparece aqui.
          </p>
        ) : (
          <Resultado resposta={resposta} sql={sql} />
        )}
      </div>
    </div>
  );
}

function Resultado({
  resposta,
  sql,
}: {
  readonly resposta: QueryResponse;
  readonly sql: string;
}) {
  return (
    <>
      {resposta.error !== null ? <ErroPostgres erro={resposta.error} sql={sql} /> : null}

      {resposta.results.map((r) => (
        <ResultadoStatement key={r.index} result={r} total={resposta.results.length} />
      ))}

      <p className="px-4 py-3 text-2xs text-subtle">
        {resposta.totalDurationMs} ms · {resposta.readOnly ? "somente leitura" : "escrita"}
      </p>
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
  const local = erro.position === null ? null : localizar(sql, erro.position);

  return (
    <div className="border-b border-danger/30 bg-danger/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{erro.code ?? "erro"}</Badge>
        <span className="text-xs text-ink">{erro.message}</span>
        {resposta_indice(erro.index)}
      </div>

      {local !== null ? (
        <div className="mt-2 block w-full rounded-[4px] bg-sunken p-2 text-left font-mono text-xs">
          <span className="text-subtle">
            linha {local.linha}, coluna {local.coluna}
          </span>
          {/*
            * `whitespace-pre` é obrigatório aqui: o HTML colapsa sequências de
            * espaço, e sem isso o `^` ia parar na coluna 1 enquanto o texto
            * dizia "coluna 22" — a tela apontando um lugar e afirmando outro.
            */}
          <span className="mt-1 block whitespace-pre text-muted">{local.texto}</span>
          <span className="block whitespace-pre text-amber">
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
}: {
  readonly result: StatementResult;
  readonly total: number;
}) {
  return (
    <section className="border-b border-line">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2">
        {total > 1 ? (
          <span className="font-mono text-2xs text-subtle">#{result.index + 1}</span>
        ) : null}
        <span className="text-2xs text-muted">
          {result.rowCount} {result.rowCount === 1 ? "linha" : "linhas"} · {result.durationMs} ms
          {result.command === null ? "" : ` · ${result.command}`}
        </span>
        {result.truncated ? (
          // Truncamento é informação, não detalhe: a query devolveu mais.
          <Badge tone="danger">truncado</Badge>
        ) : null}
      </header>

      {result.columns.length === 0 ? (
        <p className="px-4 pb-3 text-2xs text-subtle">Sem linhas para mostrar.</p>
      ) : (
        <div className="h-80 border-t border-line">
          <ResultGrid columns={result.columns} rows={result.rows} />
        </div>
      )}
    </section>
  );
}
