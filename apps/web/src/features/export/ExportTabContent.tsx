import type { BundleTable } from "@dbee/shared";
import { Download, Info, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { useIdioma } from "../../i18n";
import { cn } from "../../lib/cn";
import { Trabalhando } from "../motion/Trabalhando";
import { useSchema } from "../tree/useTree";
import { baixarBundle, ExportCancelado } from "./download";

/**
 * Export de várias tabelas — aba própria (§5).
 *
 * ## Por que não é um diálogo
 *
 * Um banco de cliente tem cem tabelas. Escolher entre elas é trabalho de
 * leitura e comparação, não de confirmação — e um diálogo modal tira a árvore
 * da tela justamente quando a pessoa quer conferir onde a tabela está.
 *
 * ## Duas colunas de marcação, não uma
 *
 * Estrutura e dados são independentes porque os três casos existem de verdade:
 * subir um ambiente vazio (só schema), recarregar dados num schema que já
 * existe (só dados), e o dump completo. O Adminer resolve isso com dois
 * cabeçalhos marcáveis; aqui é a mesma ideia.
 *
 * ## `-1` não é uma contagem
 *
 * `reltuples` vale `-1` quando a relação nunca passou por `ANALYZE`. O Adminer
 * mostra `-1` na tela; aqui isso vira "não analisada", porque um número
 * negativo de linhas não significa nada para quem lê.
 */

interface Escolha {
  readonly structure: boolean;
  readonly data: boolean;
}

const CHAVE = (schema: string, tabela: string): string => `${schema}.${tabela}`;

export function ExportTabContent({
  connectionId,
  database,
}: {
  readonly connectionId: string;
  readonly database: string;
}) {
  const { t, formatarNumero } = useIdioma();
  const arvore = useSchema(connectionId, database, true);

  const [filtro, setFiltro] = useState("");
  const [dropFirst, setDropFirst] = useState(false);
  const [gzip, setGzip] = useState(false);
  const [escolhas, setEscolhas] = useState<Readonly<Record<string, Escolha>>>({});
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState<string | null>(null);

  /** Só tabelas: view não recebe INSERT, e materialized view não é recriada por CREATE TABLE. */
  const tabelas = useMemo(
    () =>
      (arvore.data?.schemas ?? []).flatMap((s) =>
        s.relations
          .filter((r) => r.kind === "table")
          .map((r) => ({ schema: s.name, table: r.name, rows: r.estimatedRows })),
      ),
    [arvore.data],
  );

  const visiveis = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    if (termo === "") return tabelas;
    return tabelas.filter((tb) => CHAVE(tb.schema, tb.table).toLowerCase().includes(termo));
  }, [tabelas, filtro]);

  const escolhaDe = (schema: string, table: string): Escolha =>
    escolhas[CHAVE(schema, table)] ?? { structure: false, data: false };

  const marcar = (schema: string, table: string, mudanca: Partial<Escolha>): void => {
    setEscolhas((atuais) => ({
      ...atuais,
      [CHAVE(schema, table)]: { ...escolhaDe(schema, table), ...mudanca },
    }));
  };

  /** Marca ou desmarca tudo que está **visível** — não o que o filtro escondeu. */
  const marcarVisiveis = (valor: boolean): void => {
    setEscolhas((atuais) => {
      const novo = { ...atuais };
      for (const tb of visiveis) {
        novo[CHAVE(tb.schema, tb.table)] = { structure: valor, data: valor };
      }
      return novo;
    });
  };

  const selecionadas = useMemo<BundleTable[]>(
    () =>
      tabelas
        .map((tb) => ({ ...escolhaDe(tb.schema, tb.table), schema: tb.schema, table: tb.table }))
        .filter((e) => e.structure || e.data),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- escolhaDe deriva de `escolhas`
    [tabelas, escolhas],
  );

  const exportar = (): void => {
    setErro(null);
    setPronto(null);
    setBaixando(true);
    void baixarBundle(connectionId, {
      database,
      tables: selecionadas,
      ...(dropFirst ? { dropFirst: true } : {}),
      ...(gzip ? { gzip: true } : {}),
    })
      .then(({ filename }) => { setPronto(filename); })
      .catch((e: unknown) => {
        // Fechar o seletor de arquivo é decisão, não falha.
        if (e instanceof ExportCancelado) return;
        setErro(e instanceof Error ? e.message : t("erro.bad_request"));
      })
      .finally(() => { setBaixando(false); });
  };

  if (arvore.isPending) {
    return <Trabalhando rotulo={t("arvore.lendoCatalogo")} cronometro />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Opções do dump: uma linha, densa, no topo — como no Adminer. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-sunken px-4 py-2.5">
        <span className="text-xs font-semibold text-ink">
          {t("exp.titulo", { db: database })}
        </span>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={gzip}
            onChange={(e) => { setGzip(e.target.checked); }}
            className="h-4 w-4 accent-[var(--color-muted)]"
          />
          {t("exp.gzip")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted" title={t("exp.dropCreateAjuda")}>
          <input
            type="checkbox"
            checked={dropFirst}
            onChange={(e) => { setDropFirst(e.target.checked); }}
            className="h-4 w-4 accent-[var(--color-muted)]"
          />
          {t("exp.dropCreate")}
        </label>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-2xs text-subtle sm:inline">
            {t("exp.selecionadas", { n: selecionadas.length, total: tabelas.length })}
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={selecionadas.length === 0}
            loading={baixando}
            loadingLabel={t("exp.exportando")}
            onClick={exportar}
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            {t("exp.exportar")}
          </Button>
        </div>
      </div>

      {/* Filtro e marcação em massa. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div className="relative min-w-[12rem] flex-1 max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <Input
            value={filtro}
            onChange={(e) => { setFiltro(e.target.value); }}
            placeholder={t("exp.buscar")}
            aria-label={t("exp.buscar")}
            className="h-8 w-full pl-7 text-xs"
          />
        </div>
        <Button size="sm" variant="ghost" onClick={() => { marcarVisiveis(true); }}>
          {t("exp.todas")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { marcarVisiveis(false); }}>
          {t("exp.nenhuma")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tabelas.length === 0 ? (
          <p className="px-4 py-6 text-xs text-subtle">{t("exp.semTabelas")}</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-2xs font-semibold text-subtle">
                <th className="px-4 py-2 text-left">{t("exp.tabelas")}</th>
                <th className="px-3 py-2 text-right" title={t("exp.estimativa")}>
                  {t("exp.linhas")}
                </th>
                <th className="w-24 px-3 py-2 text-center">{t("exp.estrutura")}</th>
                <th className="w-20 px-3 py-2 text-center">{t("exp.dados")}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((tb) => {
                const escolha = escolhaDe(tb.schema, tb.table);
                const marcada = escolha.structure || escolha.data;
                return (
                  <tr
                    key={CHAVE(tb.schema, tb.table)}
                    className={cn(
                      "border-b border-line/50",
                      marcada ? "bg-raised" : "hover:bg-raised/50",
                    )}
                  >
                    <td className="px-4 py-1.5 font-mono text-ink">
                      <span className="text-subtle">{tb.schema}.</span>
                      {tb.table}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-mono text-subtle"
                      title={tb.rows === null ? t("exp.naoAnalisada") : t("exp.estimativa")}
                    >
                      {tb.rows === null ? "—" : formatarNumero(tb.rows)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={escolha.structure}
                        onChange={(e) => { marcar(tb.schema, tb.table, { structure: e.target.checked }); }}
                        aria-label={`${t("exp.estrutura")} ${CHAVE(tb.schema, tb.table)}`}
                        className="h-4 w-4 accent-[var(--color-muted)]"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={escolha.data}
                        onChange={(e) => { marcar(tb.schema, tb.table, { data: e.target.checked }); }}
                        aria-label={`${t("exp.dados")} ${CHAVE(tb.schema, tb.table)}`}
                        className="h-4 w-4 accent-[var(--color-muted)]"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="space-y-1.5 border-t border-line px-4 py-2.5">
        {erro !== null ? (
          <p role="alert" className="rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger">
            {erro}
          </p>
        ) : null}
        {pronto !== null ? (
          <p role="status" className="text-xs text-ok">{pronto}</p>
        ) : null}
        <p className="flex items-start gap-2 text-2xs leading-relaxed text-subtle">
          <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
          <span>
            {t("exp.naoEhPgDump")} {t("exp.umSnapshot")}
          </span>
        </p>
      </footer>
    </div>
  );
}
