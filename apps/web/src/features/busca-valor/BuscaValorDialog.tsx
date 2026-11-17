import {
  type Connection,
  type DatabaseTree,
  type RowFilter,
  type ValueSearchHit,
  type ValueSearchTableStatus,
} from "@dbee/shared";
import { BUSCA_VALOR_MAX_POR_TABELA, BUSCA_VALOR_MAX_TABELAS, BUSCA_VALOR_TIMEOUT_TABELA_MS } from "@dbee/shared/puro";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, SearchCode, Square } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { TableTarget } from "../../app/workspace";
import { Button, Field, Input, ModalPainel } from "../../components/ui";
import { useT } from "../../i18n";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../lib/erroApi";
import { uuidV4 } from "../../lib/navegador";
import { schemaTreeKey } from "../tree/useTree";
import { agruparHits, emLotes, ehBuscavel, filtrosDaPk, rotuloPk, TABELAS_POR_LOTE } from "./buscaValor.puro";

export interface AlvoBuscaValor {
  readonly connectionId: string;
  readonly database: string;
  readonly schema?: string;
}

interface Tabela { readonly schema: string; readonly name: string; readonly kind: TableTarget["kind"] }

interface Execucao {
  readonly feitas: number;
  readonly total: number;
  readonly atual: string | null;
  readonly hits: readonly ValueSearchHit[];
  readonly status: readonly ValueSearchTableStatus[];
  readonly fim: boolean;
  readonly cancelada: boolean;
  readonly erro: string | null;
  readonly puladas: number;
}

const selectCls = "h-10 w-full cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-sm text-ink";

/**
 * Buscar valor no banco (ideia I9, ADR 023).
 *
 * O escopo é obrigatório e a tela mostra os tetos **antes** de rodar. O
 * servidor varre em série; aqui as tabelas vão em lotes pequenos para o
 * progresso andar por tabela e o Cancelar parar no lote corrente (o pedido em
 * voo recebe `value-search/cancel`). Nada é escrito: `BEGIN READ ONLY` no
 * servidor.
 */
export function BuscaValorDialog({
  connections,
  alvo,
  onClose,
  onAbrirLinha,
}: {
  readonly connections: readonly Connection[];
  readonly alvo: AlvoBuscaValor;
  readonly onClose: () => void;
  readonly onAbrirLinha: (target: TableTarget, filters: readonly RowFilter[]) => void;
}) {
  const t = useT();
  const pgs = connections.filter((c) => c.engine === "postgres");
  const [connId, setConnId] = useState(alvo.connectionId);
  const conexao = pgs.find((c) => c.id === connId);
  const database = connId === alvo.connectionId ? alvo.database : (conexao?.database ?? "");
  const [modoEscopo, setModoEscopo] = useState<"schema" | "tables">("schema");
  const [schema, setSchema] = useState(alvo.schema ?? "");
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [valor, setValor] = useState("");
  const [exato, setExato] = useState(false);
  const [exec, setExec] = useState<Execucao | null>(null);
  const cancelarRef = useRef<{ queryId: string; parar: boolean } | null>(null);

  const arvore = useQuery({
    queryKey: schemaTreeKey(connId, database),
    enabled: conexao !== undefined && database !== "",
    queryFn: async (): Promise<DatabaseTree> => {
      const { data, error } = await api.api.connections({ id: connId }).schema.tree.get({ query: { database } });
      if (error !== null) throw new Error(mensagemDeErro(error, t("buscaValor.erro")));
      return data;
    },
  });
  const schemas = useMemo(() => arvore.data?.schemas ?? [], [arvore.data]);
  const schemaEfetivo = schemas.some((s) => s.name === schema) ? schema : (schemas.find((s) => s.name === "public") ?? schemas[0])?.name ?? "";
  const tabelasDoSchema: Tabela[] = useMemo(
    () => (schemas.find((s) => s.name === schemaEfetivo)?.relations ?? [])
      .filter((r) => ehBuscavel(r.kind))
      .map((r) => ({ schema: schemaEfetivo, name: r.name, kind: r.kind })),
    [schemas, schemaEfetivo],
  );
  const escopo = modoEscopo === "schema" ? tabelasDoSchema : tabelasDoSchema.filter((x) => marcadas.has(x.name));
  const lidas = escopo.slice(0, BUSCA_VALOR_MAX_TABELAS);
  const excedentes = escopo.length - lidas.length;
  const rodando = exec !== null && !exec.fim;

  const buscar = async (): Promise<void> => {
    const lotes = emLotes(lidas, TABELAS_POR_LOTE);
    const ctl = { queryId: "", parar: false };
    cancelarRef.current = ctl;
    let estado: Execucao = { feitas: 0, total: lidas.length, atual: null, hits: [], status: [], fim: false, cancelada: false, erro: null, puladas: excedentes };
    setExec(estado);
    for (const lote of lotes) {
      if (ctl.parar) break;
      ctl.queryId = uuidV4();
      estado = { ...estado, atual: lote.map((x) => x.name).join(", ") };
      setExec(estado);
      const { data, error } = await api.api.connections({ id: connId })["value-search"].post({
        database,
        value: valor.trim(),
        mode: exato ? "exact" : "contains",
        scope: { tables: lote.map((x) => ({ schema: x.schema, name: x.name })) },
        queryId: ctl.queryId,
      });
      if (error !== null) {
        estado = { ...estado, erro: mensagemDeErro(error, t("buscaValor.erro")) };
        break;
      }
      estado = {
        ...estado,
        feitas: estado.feitas + lote.length,
        hits: [...estado.hits, ...data.hits],
        status: [...estado.status, ...data.tables],
        puladas: estado.puladas + data.tablesSkipped,
      };
      setExec(estado);
      if (data.cancelled) ctl.parar = true;
    }
    setExec({ ...estado, atual: null, fim: true, cancelada: ctl.parar });
    cancelarRef.current = null;
  };

  const cancelar = (): void => {
    const ctl = cancelarRef.current;
    if (ctl === null) return;
    ctl.parar = true;
    if (ctl.queryId !== "") {
      void api.api.connections({ id: connId })["value-search"].cancel.post({ queryId: ctl.queryId });
    }
  };

  const abrirLinha = (h: ValueSearchHit): void => {
    const kind = tabelasDoSchema.find((x) => x.schema === h.schema && x.name === h.table)?.kind ?? "table";
    // Sem PK: o melhor recorte possível é a coluna igual ao valor achado.
    const filtros: RowFilter[] = h.pk !== null
      ? filtrosDaPk(h.pk)
      : h.value === null ? [{ column: h.column, operator: "isNull" }] : [{ column: h.column, operator: "eq", value: h.value }];
    onAbrirLinha({ connectionId: connId, database, schema: h.schema, relation: h.table, kind }, filtros);
  };

  const grupos = agruparHits(exec?.hits ?? []);
  const problemas = (exec?.status ?? []).filter((s) => s.status === "timeout" || s.status === "error");
  const podeBuscar = !rodando && valor.trim() !== "" && lidas.length > 0;

  return (
    <ModalPainel
      titulo={t("buscaValor.titulo")}
      descricao={t("buscaValor.descricao")}
      icone={<SearchCode aria-hidden className="h-4 w-4" />}
      onClose={() => { cancelar(); onClose(); }}
      rodape={
        <>
          {rodando ? (
            <Button variant="danger" size="sm" onClick={cancelar}>
              <Square aria-hidden className="h-3 w-3" />
              {t("buscaValor.cancelar")}
            </Button>
          ) : null}
          <Button variant="solido" size="sm" disabled={!podeBuscar} loading={rodando} loadingLabel={t("buscaValor.buscando")} onClick={() => { void buscar(); }}>
            {t("buscaValor.buscar")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => { e.preventDefault(); if (podeBuscar) void buscar(); }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("buscaValor.conexao")} htmlFor="bv-conexao">
            <select id="bv-conexao" className={selectCls} value={connId} disabled={rodando} onChange={(e) => { setConnId(e.target.value); setSchema(""); setMarcadas(new Set()); setExec(null); }}>
              {pgs.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.id === alvo.connectionId ? alvo.database : c.database}</option>)}
            </select>
          </Field>
          <Field label={t("buscaValor.schema")} htmlFor="bv-schema" error={arvore.isError ? arvore.error.message : undefined}>
            <select id="bv-schema" className={selectCls} value={schemaEfetivo} disabled={rodando || schemas.length === 0} onChange={(e) => { setSchema(e.target.value); setMarcadas(new Set()); }}>
              {schemas.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
        </div>

        <Field label={t("buscaValor.valor")} htmlFor="bv-valor" hint={t("buscaValor.valorDica")}>
          <div className="flex flex-wrap items-center gap-3">
            <Input id="bv-valor" mono autoFocus maxLength={200} value={valor} disabled={rodando} onChange={(e) => { setValor(e.target.value); }} className="min-w-0 flex-1" />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={exato} disabled={rodando} onChange={(e) => { setExato(e.target.checked); }} />
              {t("buscaValor.exato")}
            </label>
          </div>
        </Field>

        <fieldset className="flex flex-col gap-2" disabled={rodando}>
          <legend className="pb-1.5 text-xs font-medium text-muted">{t("buscaValor.escopo")}</legend>
          <div className="flex flex-wrap gap-4 text-xs text-ink">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="bv-escopo" checked={modoEscopo === "schema"} onChange={() => { setModoEscopo("schema"); }} />
              {t("buscaValor.escopoSchema", { schema: schemaEfetivo, n: String(tabelasDoSchema.length) })}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="bv-escopo" checked={modoEscopo === "tables"} onChange={() => { setModoEscopo("tables"); }} />
              {t("buscaValor.escopoTabelas", { n: String(marcadas.size) })}
            </label>
          </div>
          {modoEscopo === "tables" ? (
            <ul className="grid max-h-40 grid-cols-1 gap-x-3 overflow-y-auto rounded-[4px] border border-line bg-sunken p-2 sm:grid-cols-2">
              {tabelasDoSchema.map((x) => (
                <li key={x.name}>
                  <label className="flex cursor-pointer items-center gap-1.5 py-0.5 font-mono text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={marcadas.has(x.name)}
                      onChange={(e) => {
                        const n = new Set(marcadas);
                        if (e.target.checked) n.add(x.name); else n.delete(x.name);
                        setMarcadas(n);
                      }}
                    />
                    <span className="truncate">{x.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>

        {/* Os tetos antes de rodar (ADR 023, "A UI deve mostrar o escopo e o teto"). */}
        <p className="rounded-[4px] border border-line bg-sunken px-3 py-2 text-2xs leading-relaxed text-subtle">
          {t("buscaValor.tetos", {
            tabelas: String(BUSCA_VALOR_MAX_TABELAS),
            ocorrencias: String(BUSCA_VALOR_MAX_POR_TABELA),
            segundos: String(BUSCA_VALOR_TIMEOUT_TABELA_MS / 1000),
          })}
          {excedentes > 0 ? <span className="block font-medium text-ink">{t("buscaValor.excedentes", { n: String(excedentes) })}</span> : null}
        </p>
      </form>

      {exec === null ? null : (
        <section aria-live="polite" className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink">
                {exec.fim
                  ? exec.cancelada ? t("buscaValor.cancelada") : t("buscaValor.concluida")
                  : t("buscaValor.progresso", { feitas: String(exec.feitas), total: String(exec.total) })}
              </span>
              <span className="tabular-nums text-subtle">{t("buscaValor.ocorrencias", { n: String(exec.hits.length) })}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
              <div className="h-full bg-ink transition-[width] duration-(--motion-base)" style={{ width: `${String(exec.total === 0 ? 100 : (exec.feitas / exec.total) * 100)}%` }} />
            </div>
            {exec.atual !== null ? <p className="mt-1 truncate font-mono text-2xs text-subtle">{exec.atual}</p> : null}
            {exec.puladas > 0 ? <p className="mt-1 text-2xs text-ink">{t("buscaValor.excedentes", { n: String(exec.puladas) })}</p> : null}
            {exec.erro !== null ? <p role="alert" className="mt-1 text-xs text-danger">{exec.erro}</p> : null}
          </div>

          {problemas.length > 0 ? (
            <ul className="text-2xs text-subtle">
              {problemas.map((p) => (
                <li key={`${p.schema}.${p.table}`} className="font-mono">
                  {p.schema}.{p.table}: {p.status === "timeout" ? t("buscaValor.timeout") : (p.error ?? t("buscaValor.erro"))}
                </li>
              ))}
            </ul>
          ) : null}

          {exec.fim && grupos.length === 0 && exec.erro === null ? (
            <p className="py-2 text-center text-xs text-subtle">{t("buscaValor.nada")}</p>
          ) : null}

          {grupos.map((g) => {
            const truncada = exec.status.some((s) => s.schema === g.schema && s.table === g.table && s.status === "truncated");
            return (
              <details key={`${g.schema}.${g.table}`} open={exec.hits.length <= 60} className="group rounded-[4px] border border-line">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
                  <ChevronRight aria-hidden className="h-3 w-3 text-subtle transition-transform group-open:rotate-90" />
                  <span className="min-w-0 flex-1 truncate font-mono text-ink">{g.schema}.{g.table}</span>
                  <span className="shrink-0 tabular-nums text-subtle">
                    {truncada ? t("buscaValor.truncada", { n: String(g.total) }) : String(g.total)}
                  </span>
                </summary>
                {g.colunas.map((c) => (
                  <div key={c.column} className="border-t border-line px-3 py-1.5">
                    <p className="pb-1 font-mono text-2xs text-subtle">{c.column}</p>
                    <ul>
                      {c.hits.map((h, i) => (
                        <li key={i} className="flex items-center gap-2 py-0.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={h.value ?? "NULL"}>{h.value ?? "NULL"}</span>
                          <button
                            type="button"
                            onClick={() => { abrirLinha(h); }}
                            title={h.pk === null ? t("buscaValor.semPk") : rotuloPk(h.pk)}
                            className={cn("press inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-2xs text-muted hover:bg-raised hover:text-ink")}
                          >
                            <ExternalLink aria-hidden className="h-3 w-3" />
                            <span className="max-w-[10rem] truncate font-mono">{h.pk === null ? t("buscaValor.abrirLinha") : rotuloPk(h.pk)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
            );
          })}
        </section>
      )}
    </ModalPainel>
  );
}
