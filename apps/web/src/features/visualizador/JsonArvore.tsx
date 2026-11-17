import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "../../lib/cn";
import { abertosAte, achatar, idDe, type NoJson, todosAbertos } from "./jsonArvore.puro";

const ALTURA = 22;

/**
 * Árvore de JSON navegável (ui-detalhes §6.1) — o núcleo que o visualizador
 * usa e que os modais de Mongo/Redis podem adotar.
 *
 * Sempre virtualizada (TanStack Virtual): um jsonb de 5 000 nós não vira 5 000
 * nós de DOM. Teclado no padrão `tree`: ↑↓ move, → abre/desce, ← fecha/sobe,
 * Home/End, Enter alterna, `*` expande tudo, `-` recolhe tudo, `c` copia o
 * valor, `Shift+C` copia o caminho.
 */
export function JsonArvore({
  raiz,
  abertos,
  onAbertos,
  achados,
  achadoAtual,
  onCopiarValor,
  onCopiarCaminho,
}: {
  readonly raiz: unknown;
  readonly abertos: ReadonlySet<string>;
  readonly onAbertos: (a: Set<string>) => void;
  readonly achados: ReadonlySet<string>;
  readonly achadoAtual: string | null;
  readonly onCopiarValor: (no: NoJson) => void;
  readonly onCopiarCaminho: (no: NoJson) => void;
}) {
  const nos = useMemo(() => achatar(raiz, abertos), [raiz, abertos]);
  const [foco, setFoco] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: nos.length,
    getScrollElement: () => caixa.current,
    estimateSize: () => ALTURA,
    overscan: 16,
  });

  // Achado atual entra na vista (busca com Enter).
  const iAchado = achadoAtual === null ? -1 : nos.findIndex((n) => n.id === achadoAtual);
  const [ultimoAchado, setUltimoAchado] = useState(-1);
  if (iAchado !== ultimoAchado) {
    setUltimoAchado(iAchado);
    if (iAchado >= 0) {
      setFoco(iAchado);
      queueMicrotask(() => { virtual.scrollToIndex(iAchado, { align: "auto" }); });
    }
  }

  const alternar = (no: NoJson, abrir?: boolean): void => {
    if (no.filhos === 0) return;
    const a = new Set(abertos);
    const vai = abrir ?? !a.has(no.id);
    if (vai) a.add(no.id);
    else a.delete(no.id);
    onAbertos(a);
  };

  const mover = (i: number): void => {
    const n = Math.max(0, Math.min(nos.length - 1, i));
    setFoco(n);
    virtual.scrollToIndex(n, { align: "auto" });
  };

  const tecla = (e: KeyboardEvent<HTMLDivElement>): void => {
    const no = nos[foco];
    if (no === undefined) return;
    const pai = (): number => nos.findIndex((x) => x.id === idDe(no.partes.slice(0, -1)));
    switch (e.key) {
      case "ArrowDown": mover(foco + 1); break;
      case "ArrowUp": mover(foco - 1); break;
      case "Home": mover(0); break;
      case "End": mover(nos.length - 1); break;
      case "ArrowRight":
        if (no.filhos > 0 && !no.aberto) alternar(no, true);
        else if (no.aberto) mover(foco + 1);
        break;
      case "ArrowLeft":
        if (no.aberto) alternar(no, false);
        else { const p = pai(); if (p >= 0) mover(p); }
        break;
      case "Enter": alternar(no); break;
      case "*": onAbertos(todosAbertos(raiz)); break;
      case "-": onAbertos(abertosAte(raiz, 1)); break;
      case "c": onCopiarValor(no); break;
      case "C": onCopiarCaminho(no); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={caixa}
      role="tree"
      tabIndex={0}
      aria-activedescendant={nos[foco] === undefined ? undefined : `jn-${String(foco)}`}
      onKeyDown={tecla}
      className="min-h-0 flex-1 overflow-auto font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-strong"
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative", minWidth: "max-content" }}>
        {virtual.getVirtualItems().map((item) => {
          const no = nos[item.index];
          if (no === undefined) return null;
          const focado = item.index === foco;
          return (
            <div
              key={no.id}
              id={`jn-${String(item.index)}`}
              role="treeitem"
              aria-level={no.nivel + 1}
              aria-expanded={no.filhos > 0 ? no.aberto : undefined}
              aria-selected={focado}
              onClick={() => { setFoco(item.index); alternar(no); }}
              className={cn(
                "absolute left-0 right-0 flex cursor-default items-center gap-1 whitespace-pre pr-3",
                focado ? "bg-raised" : "hover:bg-raised/60",
                achados.has(no.id) && "bg-info/12",
                achadoAtual === no.id && "ring-1 ring-inset ring-info/60",
              )}
              style={{ top: 0, transform: `translateY(${String(item.start)}px)`, height: ALTURA, paddingLeft: 8 + no.nivel * 14 }}
            >
              {/* Guias de nível: um traço por ancestral, como num editor. */}
              {Array.from({ length: no.nivel }, (_, k) => (
                <span key={k} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: 13 + k * 14 }} />
              ))}
              {no.filhos > 0 ? (
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "h-3 w-3 shrink-0 text-subtle transition-transform duration-(--motion-fast) ease-(--ease-enter)",
                    no.aberto && "rotate-90",
                  )}
                />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {no.chave !== null ? (
                <span className={typeof no.chave === "number" ? "text-subtle" : "text-ink"}>
                  {typeof no.chave === "number" ? no.chave : JSON.stringify(no.chave)}
                  <span className="text-subtle">: </span>
                </span>
              ) : null}
              <Valor no={no} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Valor({ no }: { readonly no: NoJson }) {
  if (no.tipo === "objeto" || no.tipo === "array") {
    const [a, f] = no.tipo === "objeto" ? ["{", "}"] : ["[", "]"];
    return (
      <span className="text-subtle">
        {a}
        {no.aberto ? "" : ` ${String(no.filhos)} `}
        {no.aberto ? "" : f}
      </span>
    );
  }
  return (
    <span
      className={cn(
        no.tipo === "string" && "text-(--syn-string)",
        no.tipo === "numero" && "tabular-nums text-(--syn-number)",
        no.tipo === "bool" && "text-(--syn-bool)",
        no.tipo === "null" && "italic text-muted",
      )}
    >
      {no.texto}
    </span>
  );
}
