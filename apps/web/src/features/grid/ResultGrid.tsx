import type { ResultColumn } from "@dbee/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/cn";

/**
 * Grid virtualizado (CLAUDE.md regra 11).
 *
 * Nenhum `.map()` direto sobre as linhas do resultado: o virtualizador
 * renderiza só a janela visível. 100k linhas não podem travar a aba (§2.5), e
 * uma `<table>` crua com 100k `<tr>` trava.
 */

/** Tipos que se leem alinhados à direita, comparando dígito com dígito. */
const NUMERICOS = new Set([
  "smallint", "integer", "bigint", "numeric", "real", "double precision", "money",
  "smallserial", "serial", "bigserial",
]);

/**
 * Alinhamento pelo tipo real da coluna.
 *
 * Número alinhado à esquerda obriga a contar dígitos para comparar duas linhas.
 * O tipo vem de `format_type`, então `numeric(12,2)` precisa perder o
 * parâmetro antes da comparação.
 */
function alinhamento(dataTypeName: string): "left" | "right" {
  const base = dataTypeName.replace(/\(.*/, "").trim();
  return NUMERICOS.has(base) ? "right" : "left";
}

const ALTURA_LINHA = 26;

export interface ResultGridProps {
  readonly columns: readonly ResultColumn[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly onCellClick?: (linha: number, coluna: number) => void;
  /** Chamado quando a rolagem chega perto do fim — paginação por keyset. */
  readonly onReachEnd?: () => void;
  readonly loadingMore?: boolean;
}

export function ResultGrid({
  columns,
  rows,
  onCellClick,
  onReachEnd,
  loadingMore = false,
}: ResultGridProps) {
  const scroller = useRef<HTMLDivElement>(null);

  // O React Compiler pula a memoização deste componente: o `useVirtualizer`
  // devolve funções que não podem ser memoizadas com segurança. É limitação
  // conhecida da biblioteca, não defeito daqui — o aviso do lint é esperado.
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ALTURA_LINHA,
    overscan: 12,
  });

  const itens = virtual.getVirtualItems();
  const alinhamentos = columns.map((c) => alinhamento(c.dataTypeName));

  /**
   * Dispara a próxima página quando faltam poucas linhas para o fim.
   *
   * Num efeito, não no corpo do render: chamar de volta durante a renderização
   * é efeito colateral em render — a mesma classe de problema que o
   * `react-hooks` recusa em ref, e que aqui provocaria uma busca por quadro
   * enquanto a resposta não chega.
   */
  const ultimoVisivel = itens.at(-1)?.index ?? -1;
  useEffect(() => {
    if (onReachEnd === undefined || loadingMore || rows.length === 0) return;
    if (ultimoVisivel >= rows.length - 10) onReachEnd();
  }, [ultimoVisivel, rows.length, loadingMore, onReachEnd]);

  if (columns.length === 0) {
    return <p className="px-4 py-6 text-xs text-subtle">Sem colunas para mostrar.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho fora do scroller vertical: fica fixo, e a largura acompanha. */}
      <div className="shrink-0 overflow-hidden border-b border-line bg-surface">
        <div className="flex" style={{ minWidth: "max-content" }}>
          {columns.map((c, i) => (
            <div
              key={`${c.name}-${String(i)}`}
              className={cn(
                "shrink-0 border-r border-line px-3 py-1.5",
                alinhamentos[i] === "right" && "text-right",
              )}
              style={{ width: 200 }}
            >
              <span className="block truncate text-xs font-medium text-ink">{c.name}</span>
              <span className="block truncate font-mono text-2xs text-subtle">
                {c.dataTypeName}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtual.getTotalSize(), position: "relative", minWidth: "max-content" }}>
          {itens.map((item) => {
            const linha = rows[item.index];
            if (linha === undefined) return null;

            return (
              <div
                key={item.key}
                className="absolute left-0 flex border-b border-line/40 hover:bg-surface"
                style={{ top: 0, transform: `translateY(${String(item.start)}px)`, height: ALTURA_LINHA }}
              >
                {linha.map((celula, j) => (
                  <button
                    key={j}
                    type="button"
                    onClick={() => onCellClick?.(item.index, j)}
                    title={celula ?? undefined}
                    className={cn(
                      "shrink-0 cursor-default truncate border-r border-line/40 px-3 text-left font-mono text-xs leading-[26px]",
                      alinhamentos[j] === "right" && "text-right",
                      celula === null ? "text-subtle" : "text-ink",
                    )}
                    style={{ width: 200 }}
                  >
                    {/*
                      * Três coisas que precisam ser distinguíveis a olho
                      * (§11.14): SQL NULL, string vazia, e a string "NULL" —
                      * que aparece de verdade dentro da representação textual
                      * de um array, como em `{a,NULL,b}`.
                      */}
                    {celula === null ? (
                      <span className="italic opacity-70">NULL</span>
                    ) : celula === "" ? (
                      <span className="italic text-subtle opacity-70">vazio</span>
                    ) : (
                      celula
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
