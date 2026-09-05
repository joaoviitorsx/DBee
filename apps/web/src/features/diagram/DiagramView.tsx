import type { DatabaseSchema } from "@dbee/shared";
import { KeyRound, Link2, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import type { TableTarget } from "../../app/workspace";
import { calcularLayout, DIAGRAM_CONST, type NodeBox } from "./layout";

/**
 * Diagrama entidade-relacionamento de um database.
 *
 * As tabelas são caixas com as colunas (PK e FK marcadas), e as FKs são linhas
 * entre elas. Layout calculado uma vez (`useMemo` sobre o schema) — arrastar uma
 * caixa reposiciona só ela, sem recalcular o resto, porque a posição vira estado
 * local por nó.
 *
 * Pan com arrastar o fundo, zoom com a roda. Clicar no nome de uma tabela abre
 * a aba dela — o diagrama é um índice navegável, não só um desenho.
 */

const { ALTURA_CABECALHO, ALTURA_LINHA, MAX_COLUNAS } = DIAGRAM_CONST;

interface Vista {
  x: number;
  y: number;
  escala: number;
}

export function DiagramView({
  schema,
  connectionId,
  database,
  onOpenTable,
}: {
  readonly schema: DatabaseSchema;
  readonly connectionId: string;
  readonly database: string;
  readonly onOpenTable: (target: TableTarget) => void;
}) {
  const t = useT();
  const layout = useMemo(() => calcularLayout(schema), [schema]);

  // Posições vivas: começam no layout e mudam ao arrastar uma caixa.
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const posDe = (n: NodeBox): { x: number; y: number } => pos[n.id] ?? { x: n.x, y: n.y };

  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, escala: 0.75 });
  const svgRef = useRef<SVGSVGElement>(null);

  /*
   * Recalcular o layout (ex.: `?refresh=1` traz schema novo) descarta as
   * posições arrastadas — mantê-las reabriria caixas em lugares de um layout
   * que já não existe. Ajustado durante o render, guardando o layout anterior,
   * não num efeito: é o padrão do React sem o commit extra.
   */
  const [layoutAnterior, setLayoutAnterior] = useState(layout);
  if (layout !== layoutAnterior) {
    setLayoutAnterior(layout);
    setPos({});
  }

  // O que está sendo arrastado: o fundo (pan) ou um nó.
  const arrasto = useRef<
    | { tipo: "pan"; x0: number; y0: number; vx: number; vy: number }
    | { tipo: "no"; id: string; x0: number; y0: number; nx: number; ny: number }
    | null
  >(null);

  const nosPorId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    const fator = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setVista((v) => {
      const escala = Math.min(2.5, Math.max(0.15, v.escala * fator));
      // Zoom em direção ao ponteiro: o ponto sob o cursor não escorrega.
      const rect = svgRef.current?.getBoundingClientRect();
      const cx = rect === undefined ? 0 : e.clientX - rect.left;
      const cy = rect === undefined ? 0 : e.clientY - rect.top;
      const k = escala / v.escala;
      return { escala, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  const onPointerDownFundo = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    arrasto.current = { tipo: "pan", x0: e.clientX, y0: e.clientY, vx: vista.x, vy: vista.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const a = arrasto.current;
    if (a === null) return;
    if (a.tipo === "pan") {
      setVista((v) => ({ ...v, x: a.vx + (e.clientX - a.x0), y: a.vy + (e.clientY - a.y0) }));
    } else {
      const dx = (e.clientX - a.x0) / vista.escala;
      const dy = (e.clientY - a.y0) / vista.escala;
      setPos((p) => ({ ...p, [a.id]: { x: a.nx + dx, y: a.ny + dy } }));
    }
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    arrasto.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const iniciarArrastoNo = (e: React.PointerEvent, n: NodeBox): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = posDe(n);
    arrasto.current = { tipo: "no", id: n.id, x0: e.clientX, y0: e.clientY, nx: p.x, ny: p.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const enquadrar = (): void => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return;
    const escala = Math.min(rect.width / layout.width, rect.height / layout.height, 1) * 0.92;
    setVista({
      escala,
      x: (rect.width - layout.width * escala) / 2,
      y: (rect.height - layout.height * escala) / 2,
    });
  };

  useEffect(() => {
    // Enquadra quando o layout muda (montagem ou `?refresh=1`), não a cada
    // render — as deps são só `[layout]`, então o pan do usuário fica intacto
    // entre mudanças de layout. rAF: o SVG precisa ter sido medido antes.
    const id = requestAnimationFrame(() => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect !== undefined && rect.width > 0) enquadrar();
    });
    return () => { cancelAnimationFrame(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-sunken">
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDownFundo}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <g transform={`translate(${String(vista.x)} ${String(vista.y)}) scale(${String(vista.escala)})`}>
          {/* Arestas primeiro, atrás das caixas. */}
          {layout.edges.map((e) => {
            const a = nosPorId.get(e.from);
            const b = nosPorId.get(e.to);
            if (a === undefined || b === undefined) return null;
            const pa = posDe(a);
            const pb = posDe(b);
            const centro = (n: NodeBox, p: { x: number; y: number }) => ({
              x: p.x + n.width / 2,
              y: p.y + n.height / 2,
            });
            const ca = centro(a, pa);
            const cb = centro(b, pb);
            return (
              <line
                key={e.id}
                x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y}
                stroke="var(--color-line-strong)"
                strokeWidth={1.5}
                markerEnd="url(#seta)"
              />
            );
          })}

          <defs>
            <marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--color-line-strong)" />
            </marker>
          </defs>

          {layout.nodes.map((n) => {
            const p = posDe(n);
            const extras = n.columns.length - MAX_COLUNAS;
            const visiveis = n.columns.slice(0, MAX_COLUNAS);
            return (
              <g key={n.id} transform={`translate(${String(p.x)} ${String(p.y)})`}>
                <rect
                  width={n.width}
                  height={n.height}
                  rx={6}
                  className="fill-surface"
                  stroke="var(--color-line)"
                  strokeWidth={1}
                />
                {/* Cabeçalho: clicável para abrir a tabela, e alça de arrasto. */}
                <foreignObject width={n.width} height={ALTURA_CABECALHO}>
                  <button
                    type="button"
                    onPointerDown={(e) => { iniciarArrastoNo(e, n); }}
                    onClick={() => {
                      onOpenTable({
                        connectionId, database, schema: n.schema, relation: n.relation,
                        kind: n.kind as TableTarget["kind"],
                      });
                    }}
                    title={`${t("diagrama.abrir")} ${n.schema}.${n.relation}`}
                    className={cn(
                      "flex h-full w-full cursor-pointer items-center gap-1.5 rounded-t-[6px]",
                      "border-b border-line bg-raised px-2 text-left",
                      "hover:bg-overlay",
                    )}
                    style={{ height: ALTURA_CABECALHO }}
                  >
                    <span className="truncate text-xs font-semibold text-ink">{n.relation}</span>
                    {n.schema !== "public" ? (
                      <span className="shrink-0 text-2xs text-subtle">{n.schema}</span>
                    ) : null}
                  </button>
                </foreignObject>

                {/* Colunas. */}
                {visiveis.map((c, i) => (
                  <foreignObject
                    key={c.name}
                    y={ALTURA_CABECALHO + i * ALTURA_LINHA}
                    width={n.width}
                    height={ALTURA_LINHA}
                  >
                    <div className="flex h-full items-center gap-1 px-2" style={{ height: ALTURA_LINHA }}>
                      {c.pk ? (
                        <KeyRound aria-label={t("diagrama.pk")} className="h-2.5 w-2.5 shrink-0 text-accent" />
                      ) : c.fk ? (
                        <Link2 aria-label={t("diagrama.fk")} className="h-2.5 w-2.5 shrink-0 text-muted" />
                      ) : (
                        <span className="w-2.5 shrink-0" />
                      )}
                      <span className={cn("truncate text-2xs", c.pk ? "font-medium text-ink" : "text-muted")}>
                        {c.name}
                      </span>
                      <span className="ml-auto shrink-0 truncate font-mono text-2xs text-subtle">
                        {c.type}
                      </span>
                    </div>
                  </foreignObject>
                ))}

                {extras > 0 ? (
                  <foreignObject
                    y={ALTURA_CABECALHO + MAX_COLUNAS * ALTURA_LINHA}
                    width={n.width}
                    height={ALTURA_LINHA}
                  >
                    <div className="px-2 text-2xs text-subtle" style={{ height: ALTURA_LINHA }}>
                      {t(extras === 1 ? "diagrama.maisColunasSing" : "diagrama.maisColunasPlur", { n: extras })}
                    </div>
                  </foreignObject>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Controles, cantos. */}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-3">
        <span className="rounded-[4px] bg-overlay/80 px-2 py-1 text-2xs text-muted backdrop-blur">
          {t(layout.nodes.length === 1 ? "diagrama.tabelaSing" : "diagrama.tabelaPlur", { n: layout.nodes.length })} ·{" "}
          {t(layout.edges.length === 1 ? "diagrama.relacaoSing" : "diagrama.relacaoPlur", { n: layout.edges.length })} · {t("diagrama.ajuda")}
        </span>
        <button
          type="button"
          onClick={enquadrar}
          className="pointer-events-auto flex items-center gap-1.5 rounded-[4px] border border-line bg-raised px-2 py-1 text-2xs text-muted hover:text-ink"
        >
          <Maximize2 aria-hidden className="h-3 w-3" />
          {t("diagrama.enquadrar")}
        </button>
      </div>
    </div>
  );
}
