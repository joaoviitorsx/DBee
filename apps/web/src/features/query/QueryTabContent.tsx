import type { QueryResponse, StatementResult } from "@dbee/shared";
import { useMutation } from "@tanstack/react-query";
import { Play, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";

import { Badge, Button } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { QueryTab } from "../../app/workspace";

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
  const [sql, setSql] = useState("");
  const [pedirEscrita, setPedirEscrita] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const executar = useMutation({
    mutationFn: async (): Promise<QueryResponse> => {
      const { data, error } = await api.api.connections({ id: tab.connectionId }).query.post({
        sql,
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
      <div className="shrink-0 border-b border-line">
        <textarea
          ref={textarea}
          value={sql}
          onChange={(e) => { setSql(e.target.value); }}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter executa — é o gesto da §9 e o único atalho aqui.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (sql.trim() !== "") executar.mutate();
            }
          }}
          spellCheck={false}
          placeholder="SELECT 1"
          aria-label="SQL"
          className="h-40 w-full resize-y bg-sunken px-4 py-3 font-mono text-sm text-ink placeholder:text-subtle"
        />

        <div className="flex items-center gap-3 border-t border-line px-3 py-2">
          <Button
            variant="primary"
            size="sm"
            disabled={sql.trim() === ""}
            loading={executar.isPending}
            loadingLabel="Executando…"
            onClick={() => { executar.mutate(); }}
          >
            <Play aria-hidden className="h-3.5 w-3.5" />
            Executar
          </Button>

          <span className="text-2xs text-subtle">Cmd+Enter</span>

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
          <Resultado resposta={resposta} sql={sql} onFocarErro={(pos) => {
            const el = textarea.current;
            if (el === null) return;
            el.focus();
            el.setSelectionRange(pos - 1, pos - 1);
          }} />
        )}
      </div>
    </div>
  );
}

function Resultado({
  resposta,
  sql,
  onFocarErro,
}: {
  readonly resposta: QueryResponse;
  readonly sql: string;
  readonly onFocarErro: (position: number) => void;
}) {
  return (
    <>
      {resposta.error !== null ? (
        <ErroPostgres erro={resposta.error} sql={sql} onFocar={onFocarErro} />
      ) : null}

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
  onFocar,
}: {
  readonly erro: NonNullable<QueryResponse["error"]>;
  readonly sql: string;
  readonly onFocar: (position: number) => void;
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
        <button
          type="button"
          onClick={() => { onFocar(erro.position ?? 1); }}
          className="mt-2 block w-full cursor-pointer rounded-[4px] bg-sunken p-2 text-left font-mono text-xs"
        >
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
        </button>
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
        // Tabela HTML crua, sem virtualização: andaime até o TanStack Table.
        <div className="overflow-x-auto pb-2">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-y border-line text-left">
                {result.columns.map((c) => (
                  <th key={c.name} className="px-3 py-1.5 font-medium text-muted">
                    {c.name}
                    <span className="ml-1.5 font-mono text-2xs font-normal text-subtle">
                      {c.dataTypeName}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((linha, i) => (
                <tr key={i} className="border-b border-line/50">
                  {linha.map((celula, j) => (
                    <td
                      key={j}
                      className={cn(
                        "max-w-[24rem] truncate px-3 py-1 font-mono",
                        // NULL precisa se distinguir da string "NULL" (§11.14).
                        celula === null ? "italic text-subtle" : "text-ink",
                      )}
                      title={celula ?? "NULL"}
                    >
                      {celula ?? "NULL"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
