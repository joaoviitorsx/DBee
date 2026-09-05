import type { ExportFormat, ExportRequest, ExportSource } from "@dbee/shared";
import { Check, Download, Info, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui";
import { useIdioma } from "../../i18n";
import { tagIntl } from "../../lib/idioma";
import type { ChaveI18n } from "../../i18n/pt";
import { cn } from "../../lib/cn";
import { ExportCancelado, baixarExport, salvaEmStream } from "./download";

/**
 * Export com **as duas escolhas explícitas** (DBee.md §5).
 *
 * O que está na tela e o que está na tabela são coisas diferentes, e o número
 * de linhas de cada uma é a diferença. Um botão só, "Exportar", teria de
 * escolher em silêncio por quem clicou — e as duas leituras estão certas
 * dependendo do que a pessoa quer fazer com o arquivo.
 *
 * Quando não há diferença — a tela já tem a tabela inteira — as duas escolhas
 * seriam o mesmo arquivo, e aí ela vira **um botão**: perguntar sem ter o que
 * perguntar é atrito.
 */

const FORMATOS: { id: ExportFormat; rotulo: string; nota: ChaveI18n; somenteTabela?: boolean }[] = [
  { id: "csv", rotulo: "CSV", nota: "export.notaPlanilha" },
  { id: "json", rotulo: "JSON", nota: "export.notaArray" },
  { id: "ndjson", rotulo: "NDJSON", nota: "export.notaObjetoLinha" },
  // `.sql` só na aba Dados: precisa de uma tabela de destino para os INSERTs.
  // Numa consulta arbitrária não há para onde eles irem (o backend recusa).
  { id: "sql", rotulo: "SQL", nota: "export.notaSql", somenteTabela: true },
];

const SEPARADORES: { id: ";" | "," | "\t"; rotulo: string; nota: ChaveI18n }[] = [
  { id: ";", rotulo: ";", nota: "export.sepExcel" },
  { id: ",", rotulo: ",", nota: "export.sepPadrao" },
  { id: "\t", rotulo: "Tab", nota: "export.sepTsv" },
];

const tamanho = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export interface ExportButtonProps {
  readonly connectionId: string;
  readonly database: string;
  readonly source: ExportSource;
  /** Linhas que estão na tela agora. */
  readonly carregadas: number;
  /** Há mais linhas além das da tela? Falso colapsa para um botão só. */
  readonly temMais: boolean;
  /**
   * Estimativa do total, quando existe.
   *
   * Vem do `reltuples` do planejador, nunca de `count(*)`: contar de verdade
   * antes de exportar dobraria a leitura da tabela. Por ser estimativa, aparece
   * marcada como tal — número aproximado apresentado como exato é pior que
   * número nenhum.
   */
  readonly totalEstimado?: number | null;
  readonly disabled?: boolean;
}

export function ExportButton({
  connectionId,
  database,
  source,
  carregadas,
  temMais,
  totalEstimado = null,
  disabled = false,
}: ExportButtonProps) {
  const [aberto, setAberto] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [delimiter, setDelimiter] = useState<";" | "," | "\t">(";");
  const [bom, setBom] = useState(true);
  const [header, setHeader] = useState(true);
  const [emAndamento, setEmAndamento] = useState<null | { bytes: number }>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const { t, locale } = useIdioma();
  const tag = tagIntl(locale);
  const numero = new Intl.NumberFormat(tag);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent): void => {
      if (caixa.current !== null && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const executar = (maxRows: number | undefined): void => {
    setErro(null);
    setEmAndamento({ bytes: 0 });

    const pedido: ExportRequest = {
      source,
      format,
      database,
      ...(maxRows === undefined ? {} : { maxRows }),
      ...(format === "csv" ? { csv: { delimiter, bom, header } } : {}),
    };

    baixarExport(connectionId, pedido, (p) => { setEmAndamento({ bytes: p.bytes }); })
      .then(() => { setAberto(false); })
      .catch((err: unknown) => {
        if (err instanceof ExportCancelado) return;
        setErro(err instanceof Error ? err.message : "o export falhou");
      })
      .finally(() => { setEmAndamento(null); });
  };

  return (
    <div ref={caixa} className="relative">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || carregadas === 0}
        onClick={() => { setAberto((a) => !a); }}
        aria-expanded={aberto}
        aria-haspopup="dialog"
      >
        <Download aria-hidden className="h-3.5 w-3.5" />
        {t("export.exportar")}
      </Button>

      {aberto ? (
        <div
          role="dialog"
          aria-label={t("export.opcoes")}
          // Largura fixa em 20rem, mas nunca além da viewport: em 375px o popover
          // alinhado à direita passava da borda e cortava a última coluna.
          className="absolute right-0 z-40 mt-1 w-[min(20rem,calc(100vw-1.5rem))] rounded-[6px] border border-line bg-overlay p-3 shadow-lg"
        >
          <Grupo rotulo={t("export.formato")} layout="grid">
            {FORMATOS.filter((f) => !f.somenteTabela || source.kind === "table").map((f) => (
              <Opcao
                key={f.id}
                ativo={format === f.id}
                rotulo={f.rotulo}
                nota={t(f.nota)}
                onClick={() => { setFormat(f.id); }}
              />
            ))}
          </Grupo>

          {format === "csv" ? (
            <>
              <Grupo rotulo={t("export.separador")}>
                {SEPARADORES.map((s) => (
                  <Opcao
                    key={s.id}
                    ativo={delimiter === s.id}
                    rotulo={s.rotulo}
                    nota={t(s.nota)}
                    onClick={() => { setDelimiter(s.id); }}
                  />
                ))}
              </Grupo>

              <div className="mt-2 flex gap-4">
                <Marcar rotulo={t("export.bom")} nota={t("export.bomNota")} valor={bom} onChange={setBom} />
                <Marcar rotulo={t("export.cabecalho")} nota="" valor={header} onChange={setHeader} />
              </div>

              {/*
                * A ambiguidade é real e não tem conserto dentro do formato: o
                * CSV não distingue NULL de string vazia sem inventar convenção,
                * e qualquer convenção inventada o Excel lê errado. Dizer aqui é
                * a diferença entre uma limitação conhecida e um dado corrompido
                * em silêncio.
                */}
              <p className="mt-2 flex gap-1.5 text-2xs leading-relaxed text-subtle">
                <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
                <span>
                  {t("export.nullInfo1")} <strong className="text-muted">{t("export.nullInfo2")}</strong>{" "}
                  {t("export.nullInfo3")}
                </span>
              </p>
            </>
          ) : null}

          <div className="mt-3 space-y-1.5 border-t border-line pt-3">
            {temMais ? (
              <>
                <Escolha
                  principal
                  ocupado={emAndamento !== null}
                  titulo={t("export.daTela", { n: numero.format(carregadas) })}
                  nota={t("export.daTelaNota")}
                  onClick={() => { executar(carregadas); }}
                />
                <Escolha
                  ocupado={emAndamento !== null}
                  titulo={
                    totalEstimado === null
                      ? t("export.tudo")
                      : t("export.tudoEstimado", { n: numero.format(totalEstimado) })
                    }
                  nota={
                    totalEstimado === null
                      ? t("export.tudoNota")
                      : t("export.tudoNotaEstimado")
                  }
                  onClick={() => { executar(undefined); }}
                />
              </>
            ) : (
              // A tela já tem tudo: as duas escolhas dariam o mesmo arquivo.
              <Escolha
                principal
                ocupado={emAndamento !== null}
                titulo={t(carregadas === 1 ? "export.linhasSing" : "export.linhasPlur", { n: numero.format(carregadas) })}
                nota={t("export.telaInteira")}
                onClick={() => { executar(carregadas); }}
              />
            )}
          </div>

          {emAndamento !== null ? (
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted">
              <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
              {t("export.escritos", { size: tamanho(emAndamento.bytes) })}
            </p>
          ) : null}

          {erro !== null ? <p className="mt-2 text-2xs text-danger">{erro}</p> : null}

          {!salvaEmStream() ? (
            // Sem File System Access o navegador só salva um Blob pronto: o
            // arquivo passa inteiro pela memória da aba, mesmo com o servidor
            // em stream. É uma limitação do navegador e o usuário precisa saber
            // antes de pedir uma tabela de milhões de linhas.
            <p className="mt-2 text-2xs text-subtle">
              {t("export.navegadorNota")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Grupo({
  rotulo,
  children,
  layout = "flex",
}: {
  readonly rotulo: string;
  readonly children: React.ReactNode;
  /** `grid` alinha itens em duas colunas — necessário quando são 4 e um flex os aperta. */
  readonly layout?: "flex" | "grid";
}) {
  return (
    <div className="mb-2">
      <p className="mb-1 text-2xs text-subtle">{rotulo}</p>
      <div className={layout === "grid" ? "grid grid-cols-2 gap-1" : "flex gap-1"}>{children}</div>
    </div>
  );
}

function Opcao({
  ativo,
  rotulo,
  nota,
  onClick,
}: {
  readonly ativo: boolean;
  readonly rotulo: string;
  readonly nota: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-w-0 flex-1 cursor-pointer rounded-[4px] border px-2 py-1 text-left transition-colors duration-150",
        ativo
          ? "border-accent/45 bg-accent/10 text-ink"
          : "border-line bg-sunken text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      <span className="block text-xs font-medium">{rotulo}</span>
      {nota === "" ? null : <span className="block truncate text-2xs text-subtle">{nota}</span>}
    </button>
  );
}

function Marcar({
  rotulo,
  nota,
  valor,
  onChange,
}: {
  readonly rotulo: string;
  readonly nota: string;
  readonly valor: boolean;
  readonly onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted">
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => { onChange(e.target.checked); }}
        className="cursor-pointer accent-[var(--color-amber)]"
      />
      {rotulo}
      {nota === "" ? null : <span className="text-subtle">({nota})</span>}
    </label>
  );
}

function Escolha({
  titulo,
  nota,
  onClick,
  ocupado,
  principal = false,
}: {
  readonly titulo: string;
  readonly nota: string;
  readonly onClick: () => void;
  readonly ocupado: boolean;
  readonly principal?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
        principal
          ? "bg-amber text-accent-ink hover:bg-amber/90"
          : "border border-line bg-raised text-ink hover:bg-overlay hover:border-line-strong",
      )}
    >
      <Check aria-hidden className={cn("h-3.5 w-3.5 shrink-0", principal ? "" : "opacity-0")} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{titulo}</span>
        <span className={cn("block truncate text-2xs", principal ? "opacity-70" : "text-subtle")}>
          {nota}
        </span>
      </span>
    </button>
  );
}
