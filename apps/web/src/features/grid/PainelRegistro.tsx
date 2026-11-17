import type { ResultColumn } from "@dbee/shared";
import { X } from "lucide-react";
import { useState } from "react";

import { ComSaida } from "../../components/ComSaida";
import { useIdioma, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { ConteudoCelula } from "./ConteudoCelula";

export interface AlvoRegistro {
  /** Uma linha: "ver como registro". Duas: comparar. */
  readonly linhas: readonly number[];
}

/**
 * Linha na vertical (ui-detalhes §6.3): `coluna: valor` com os mesmos
 * renderizadores do grid — resolve tabela de 40 colunas. Com duas linhas,
 * vira comparação lado a lado com as diferenças marcadas e o filtro "só
 * diferenças". Painel lateral com entrada e saída simétricas. As colunas são
 * a lista de colunas da tabela (dezenas), não as linhas do resultado: o
 * `.map` aqui não fere a regra 11.
 */
export function PainelRegistro({
  alvo,
  columns,
  rows,
  onFechar,
}: {
  readonly alvo: AlvoRegistro | null;
  readonly columns: readonly ResultColumn[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly onFechar: () => void;
}) {
  const t = useT();
  const { locale } = useIdioma();
  const idioma = locale === "en" ? "en" : "pt";
  const [ultimo, setUltimo] = useState(alvo);
  if (alvo !== null && alvo !== ultimo) setUltimo(alvo);
  const [soDiff, setSoDiff] = useState(false);
  const atual = alvo ?? ultimo;
  if (atual === null) return null;
  const comparando = atual.linhas.length === 2;
  const [a, b] = atual.linhas.map((i) => rows[i] ?? []);
  const diferentes = columns.filter((_, j) => comparando && a?.[j] !== b?.[j]).length;

  const valor = (v: string | null | undefined, tipo: string) =>
    v === null || v === undefined ? (
      <span className="italic text-muted">NULL</span>
    ) : v === "" ? (
      <span className="italic text-muted">{t("grid.vazio")}</span>
    ) : (
      <ConteudoCelula valor={v} tipo={tipo} idioma={idioma} />
    );

  return (
    <ComSaida
      aberto={alvo !== null}
      role="dialog"
      aria-label={comparando ? t("registro.comparar") : t("registro.titulo")}
      onKeyDown={(e) => { if (e.key === "Escape") onFechar(); }}
      className="motion-gaveta fixed bottom-0 right-0 top-[var(--h-topbar,49px)] z-40 flex w-[min(36rem,100vw)] flex-col border-l border-line bg-surface shadow-[0_8px_24px_-12px_rgb(0_0_0/.5)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">
            {comparando ? t("registro.comparar") : t("registro.titulo")}
          </p>
          <p className="text-2xs text-subtle">
            {atual.linhas.map((i) => t("visualizador.linha", { n: String(i + 1) })).join(" × ")}
            {comparando ? ` · ${t("registro.diferencas", { n: String(diferentes) })}` : ""}
          </p>
        </div>
        {comparando ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted">
            <input type="checkbox" checked={soDiff} onChange={(e) => { setSoDiff(e.target.checked); }} className="accent-(--color-info)" />
            {t("registro.soDiferencas")}
          </label>
        ) : null}
        <button
          type="button"
          aria-label={t("comum.fechar")}
          onClick={onFechar}
          className="press flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] text-subtle hover:bg-raised hover:text-ink"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed font-mono text-xs">
          <tbody>
            {columns.map((c, j) => {
              const difere = comparando && a?.[j] !== b?.[j];
              if (soDiff && !difere) return null;
              return (
                <tr key={c.name} className={cn("border-b border-line/50 align-top", difere && "bg-info/10")}>
                  <th scope="row" className="w-40 truncate px-3 py-1 text-left font-sans font-medium text-muted" title={`${c.name} · ${c.dataTypeName}`}>
                    {c.name}
                  </th>
                  <td className="break-all px-3 py-1 text-ink" title={a?.[j] ?? "NULL"}>{valor(a?.[j], c.dataTypeName)}</td>
                  {comparando ? (
                    <td className="break-all border-l border-line/50 px-3 py-1 text-ink" title={b?.[j] ?? "NULL"}>{valor(b?.[j], c.dataTypeName)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ComSaida>
  );
}
