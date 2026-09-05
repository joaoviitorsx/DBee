import type { DatabaseOverview } from "@dbee/shared";
import { useQuery } from "@tanstack/react-query";
import { Database, Star } from "lucide-react";

import { api } from "../../lib/api";
import { useIdioma } from "../../i18n";
import { tagIntl } from "../../lib/idioma";
import { cn } from "../../lib/cn";
import { Trabalhando } from "../motion/Trabalhando";

/**
 * Visão geral dos databases do cluster — o "Selecionar Base de dados" do
 * Adminer, no vocabulário do DBee: tamanho, encoding, dono, conexões abertas.
 *
 * Só-leitura (lê `pg_database`). Clicar num database **abre a árvore nele** —
 * o mesmo destino da navegação, então a visão é um índice, não um beco.
 */
function tamanho(bytes: number | null, tag: string): string {
  if (bytes === null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(tag, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i] ?? "B"}`;
}

export function DatabasesOverviewTab({ connectionId }: { readonly connectionId: string }) {
  const { t, locale } = useIdioma();
  const tag = tagIntl(locale);
  const consulta = useQuery({
    queryKey: ["overview", connectionId],
    queryFn: async () => {
      const { data, error } = await api.api.connections({ id: connectionId }).databases.overview.get();
      if (error !== null) throw new Error("não foi possível ler os databases");
      return data;
    },
  });

  if (consulta.isPending) return <Trabalhando rotulo={t("databases.lendo")} cronometro />;
  if (consulta.isError) {
    return <p className="px-4 py-8 text-xs text-danger">{t("databases.erroLer")}</p>;
  }

  const { databases, serverVersion } = consulta.data;
  // "PostgreSQL 16.14 (Debian…" → "PostgreSQL 16.14"
  const versaoCurta = /PostgreSQL [\d.]+/.exec(serverVersion)?.[0] ?? serverVersion;
  const maior = Math.max(1, ...databases.map((d) => d.sizeBytes ?? 0));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <Database aria-hidden className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-ink">{t("databases.titulo")}</h2>
        <span className="text-2xs text-subtle">
          {databases.length} · {versaoCurta}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-2xs text-subtle">
              <th className="px-4 py-2 font-medium">{t("databases.database")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("databases.tamanho")}</th>
              <th className="px-4 py-2 font-medium">{t("databases.encoding")}</th>
              <th className="px-4 py-2 font-medium">{t("databases.collation")}</th>
              <th className="px-4 py-2 font-medium">{t("databases.dono")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("databases.conexoes")}</th>
            </tr>
          </thead>
          <tbody>
            {databases.map((d) => (
              <LinhaDatabase key={d.name} db={d} maior={maior} tag={tag} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinhaDatabase({ db, maior, tag }: { readonly db: DatabaseOverview; readonly maior: number; readonly tag: string }) {
  const { t } = useIdioma();
  const proporcao = db.sizeBytes === null ? 0 : (db.sizeBytes / maior) * 100;
  return (
    <tr className="border-b border-line/40 hover:bg-raised">
      <td className="px-4 py-2">
        <span className="flex items-center gap-1.5">
          {db.isDefault ? (
            <Star aria-label={t("databases.daConexao")} className="h-3 w-3 shrink-0 fill-accent text-accent" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className={cn("font-medium", db.isDefault ? "text-ink" : "text-muted")}>
            {db.name}
          </span>
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        {/* Barra de tamanho relativa: a maior enche, o resto proporcional —
            lê-se "qual pesa mais" antes de ler o número. */}
        <span className="flex items-center justify-end gap-2">
          <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-line sm:block">
            <span className="block h-full rounded-full bg-accent/50" style={{ width: `${String(proporcao)}%` }} />
          </span>
          <span className="font-mono tabular-nums text-muted">{tamanho(db.sizeBytes, tag)}</span>
        </span>
      </td>
      <td className="px-4 py-2 font-mono text-2xs text-subtle">{db.encoding}</td>
      <td className="px-4 py-2 font-mono text-2xs text-subtle">{db.collate}</td>
      <td className="px-4 py-2 text-muted">{db.owner}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums text-muted">
        {new Intl.NumberFormat(tag).format(db.connections)}
      </td>
    </tr>
  );
}
