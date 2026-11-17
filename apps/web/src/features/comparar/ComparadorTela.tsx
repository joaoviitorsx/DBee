import type {
  Connection,
  DataCompareResponse,
  SchemaCompareResponse,
  SchemaDiffKind,
} from "@dbee/shared";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeftRight, Code2, GitCompareArrows, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { CompareTab } from "../../app/workspace";
import { Badge, Button, Input } from "../../components/ui";
import { useT } from "../../i18n";
import type { ChaveI18n } from "../../i18n/pt";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../lib/erroApi";
import { Trabalhando } from "../motion/Trabalhando";
import { ResultGrid } from "../grid/ResultGrid";
import { gradeDaAmostra, gradeDasDiferencas, sqlComAviso } from "./comparar.puro";

interface Lado {
  readonly connectionId: string;
  readonly database: string;
  readonly schema: string;
  readonly table: string;
}

const TIPOS_SCHEMA: Record<SchemaDiffKind, ChaveI18n> = {
  table_only_left: "comparar.difTabelaA",
  table_only_right: "comparar.difTabelaB",
  column_only_left: "comparar.difColunaA",
  column_only_right: "comparar.difColunaB",
  column_type: "comparar.difTipo",
  column_nullable: "comparar.difNulo",
  column_default: "comparar.difDefault",
  index_only_left: "comparar.difIndiceA",
  index_only_right: "comparar.difIndiceB",
  fk_only_left: "comparar.difFkA",
  fk_only_right: "comparar.difFkB",
};

/**
 * Comparar dados ou schema entre dois lados (ADR 018).
 *
 * **Só lê; nunca aplica.** O SQL gerado vai para uma aba de consulta nova, no
 * alvo do lado B (é ele que o SQL altera), com o aviso de revisar escrito no
 * próprio texto. Rodar é ação explícita da pessoa, na fronteira de sempre:
 * conexão em leitura recusa o UPDATE/DELETE na transação READ ONLY.
 *
 * A seleção é por texto (database/schema/tabela) com A sugerido pela aba de
 * origem: o servidor confere tudo no catálogo e devolve 404 sem revelar nada.
 */
export function ComparadorTela({
  tab,
  connections,
  onAbrirSql,
}: {
  readonly tab: CompareTab;
  readonly connections: readonly Connection[];
  readonly onAbrirSql: (connectionId: string, database: string, sql: string) => void;
}) {
  const t = useT();
  const inicial: Lado = { connectionId: tab.connectionId, database: tab.database, schema: tab.schema, table: tab.table ?? "" };
  const [a, setA] = useState<Lado>(inicial);
  const [b, setB] = useState<Lado>(inicial);
  const dados = tab.mode === "data";

  const lado = (l: Lado) => ({
    connectionId: l.connectionId,
    schema: l.schema.trim(),
    ...(l.database.trim() === "" ? {} : { database: l.database.trim() }),
  });

  const comparar = useMutation({
    mutationFn: async (): Promise<
      { modo: "data"; r: DataCompareResponse } | { modo: "schema"; r: SchemaCompareResponse }
    > => {
      if (dados) {
        const { data, error } = await api.api.compare.data.post({
          left: { ...lado(a), table: a.table.trim() },
          right: { ...lado(b), table: b.table.trim() },
          sampleSize: 200,
        });
        if (error !== null) throw new Error(mensagemDeErro(error, t("comparar.falhou")));
        return { modo: "data", r: data };
      }
      const { data, error } = await api.api.compare.schema.post({ left: lado(a), right: lado(b) });
      if (error !== null) throw new Error(mensagemDeErro(error, t("comparar.falhou")));
      return { modo: "schema", r: data };
    },
  });

  const completo = (l: Lado): boolean =>
    l.connectionId !== "" && l.schema.trim() !== "" && (!dados || l.table.trim() !== "");
  const pronto = completo(a) && completo(b);
  const resultado = comparar.data;

  const sql = resultado === undefined ? "" : resultado.modo === "data" ? resultado.r.sql : resultado.r.ddl;
  const abrirSql = (): void => {
    const conn = connections.find((c) => c.id === b.connectionId);
    onAbrirSql(b.connectionId, b.database.trim() === "" ? (conn?.database ?? "") : b.database.trim(), sqlComAviso(sql, t("comparar.avisoSql")));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <form
        className="shrink-0 border-b border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pronto && !comparar.isPending) comparar.mutate();
        }}
      >
        <div className="flex items-center gap-2 pb-2">
          <GitCompareArrows aria-hidden className="h-4 w-4 text-subtle" />
          <h2 className="text-sm font-medium text-ink">
            {t(dados ? "comparar.tituloDados" : "comparar.tituloSchema")}
          </h2>
          <p className="ml-1 truncate text-2xs text-subtle max-sm:hidden">{t("comparar.ajuda")}</p>
        </div>
        <div className="grid items-end gap-2 md:grid-cols-[1fr_auto_1fr]">
          <SeletorLado rotulo="A" lado={a} onChange={setA} connections={connections} comTabela={dados} />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("comparar.inverter")}
            title={t("comparar.inverter")}
            className="justify-self-center"
            onClick={() => { setA(b); setB(a); }}
          >
            <ArrowLeftRight aria-hidden className="h-4 w-4 max-md:rotate-90" />
          </Button>
          <SeletorLado rotulo="B" lado={b} onChange={setB} connections={connections} comTabela={dados} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={!pronto} loading={comparar.isPending}>
            {t("comparar.comparar")}
          </Button>
          <p className="text-2xs text-subtle">{t("comparar.direcao")}</p>
        </div>
      </form>

      {comparar.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Trabalhando rotulo={t("comparar.comparando")} />
        </div>
      ) : comparar.isError ? (
        <div role="alert" className="motion-fade m-3 rounded-[4px] border border-danger/35 p-3 text-xs text-danger">
          {comparar.error.message}
        </div>
      ) : resultado === undefined ? (
        <p className="motion-fade p-6 text-center text-sm text-muted">{t("comparar.vazio")}</p>
      ) : (
        <div key={comparar.submittedAt} className="motion-fade flex min-h-0 flex-1 flex-col">
          <Resumo resultado={resultado} />
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Button size="sm" variant="secondary" disabled={sql.trim() === ""} onClick={abrirSql}>
              <Code2 aria-hidden className="h-3.5 w-3.5" />
              {t("comparar.abrirSql")}
            </Button>
            <p className="flex items-center gap-1 text-2xs text-muted">
              <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
              {t("comparar.revise")}
            </p>
          </div>
          <Amostra resultado={resultado} />
        </div>
      )}
    </div>
  );
}

function SeletorLado({
  rotulo,
  lado,
  onChange,
  connections,
  comTabela,
}: {
  readonly rotulo: string;
  readonly lado: Lado;
  readonly onChange: (l: Lado) => void;
  readonly connections: readonly Connection[];
  readonly comTabela: boolean;
}) {
  const t = useT();
  return (
    <fieldset className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
      <legend className="sr-only">{t("comparar.lado", { l: rotulo })}</legend>
      <label className="col-span-2 flex min-w-0 items-center gap-1.5 sm:col-span-1">
        <span aria-hidden className="w-3 shrink-0 font-mono text-2xs text-subtle">{rotulo}</span>
        <select
          value={lado.connectionId}
          aria-label={t("comparar.conexao", { l: rotulo })}
          onChange={(e) => {
            const c = connections.find((x) => x.id === e.target.value);
            onChange({ ...lado, connectionId: e.target.value, database: c?.database ?? "" });
          }}
          className="h-8 min-w-0 flex-1 cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-xs text-ink"
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <Input
        value={lado.database}
        onChange={(e) => { onChange({ ...lado, database: e.target.value }); }}
        placeholder="database"
        aria-label={t("comparar.database", { l: rotulo })}
        className="h-8 min-w-0 text-xs"
        mono
      />
      <Input
        value={lado.schema}
        onChange={(e) => { onChange({ ...lado, schema: e.target.value }); }}
        placeholder="schema"
        aria-label={t("comparar.schema", { l: rotulo })}
        className={cn("h-8 min-w-0 text-xs", !comTabela && "sm:col-span-2")}
        mono
      />
      {comTabela ? (
        <Input
          value={lado.table}
          onChange={(e) => { onChange({ ...lado, table: e.target.value }); }}
          placeholder={t("comparar.tabela")}
          aria-label={t("comparar.tabelaDe", { l: rotulo })}
          className="col-span-2 h-8 min-w-0 text-xs sm:col-span-1"
          mono
        />
      ) : null}
    </fieldset>
  );
}

type Resultado = { modo: "data"; r: DataCompareResponse } | { modo: "schema"; r: SchemaCompareResponse };

function Resumo({ resultado }: { readonly resultado: Resultado }) {
  const t = useT();
  if (resultado.modo === "schema") {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <span className="text-ink">
          {resultado.r.differences.length === 0
            ? t("comparar.schemaIgual")
            : t("comparar.nDiferencas", { n: resultado.r.differences.length })}
        </span>
      </div>
    );
  }
  const r = resultado.r;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2 text-xs">
      <Badge tone="ok">{t("comparar.iguais", { n: r.equal })}</Badge>
      <Badge>{t("comparar.diferentes", { n: r.different })}</Badge>
      <Badge>{t("comparar.soA", { n: r.onlyLeft })}</Badge>
      <Badge>{t("comparar.soB", { n: r.onlyRight })}</Badge>
      <span className="text-2xs text-subtle">PK: <span className="font-mono">{r.primaryKey.join(", ")}</span></span>
      {r.truncated ? (
        <span className="flex items-center gap-1 text-2xs text-ink">
          <TriangleAlert aria-hidden className="h-3 w-3" />
          {t("comparar.truncado")}
        </span>
      ) : null}
      {r.ignoredColumns.length > 0 ? (
        <span className="text-2xs text-subtle">
          {t("comparar.ignoradas")} <span className="font-mono">{r.ignoredColumns.join(", ")}</span>
        </span>
      ) : null}
    </div>
  );
}

function Amostra({ resultado }: { readonly resultado: Resultado }) {
  const t = useT();
  const grade =
    resultado.modo === "data"
      ? gradeDaAmostra(resultado.r, {
          tipo: t("comparar.colTipo"),
          lado: t("comparar.colLado"),
          alteradas: t("comparar.colAlteradas"),
          kind: { only_left: t("comparar.soAcurto"), only_right: t("comparar.soBcurto"), different: t("comparar.diferente") },
        })
      : gradeDasDiferencas(
          resultado.r,
          { tipo: t("comparar.colTipo"), tabela: t("comparar.tabela"), nome: t("comparar.colNome") },
          (k) => t(TIPOS_SCHEMA[k]),
        );
  if (grade.rows.length === 0) {
    return <p className="p-6 text-center text-sm text-muted">{t("comparar.semDiferencas")}</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {resultado.modo === "data" ? (
        <p className="shrink-0 px-3 pt-2 text-2xs text-subtle">{t("comparar.amostra", { n: resultado.r.samples.length })}</p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <ResultGrid columns={grade.columns} rows={grade.rows} />
      </div>
    </div>
  );
}
