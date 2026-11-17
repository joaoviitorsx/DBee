import type { StatementResult } from "@dbee/shared";
import { FlaskConical, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";

import { Badge, Button } from "../../components/ui";
import { mensagemDoCodigo, useT } from "../../i18n";
import { ResultGrid } from "../grid/ResultGrid";
import { Trabalhando } from "../motion/Trabalhando";
import { contagensEsperadas } from "./ensaio.puro";
import type { FaseEnsaio } from "./useEnsaio";

/**
 * O painel do ensaio de escrita (ADR 021): "afetaria N linhas" por statement,
 * a amostra do `RETURNING` e Aplicar/Descartar.
 *
 * Foco: quando o ensaio fica pronto, o foco vai para o **painel**, não para o
 * Aplicar — o mesmo Ctrl+Enter que pediu o ensaio não pode, de carona,
 * gravar. Esc descarta. Entrada com `motion-fade` e lista em `motion-stagger`
 * (tokens `--motion-*`, design-system §7).
 */
export function PainelEnsaio({
  fase,
  producao,
  onAplicar,
  onDescartar,
  onEnsaiarDeNovo,
  onSemEnsaio,
}: {
  readonly fase: FaseEnsaio;
  /** Conexão marcada production: Aplicar abre a confirmação pelo nome. */
  readonly producao: boolean;
  readonly onAplicar: () => void;
  readonly onDescartar: () => void;
  readonly onEnsaiarDeNovo: () => void;
  /** O ensaio é só DML; DDL e afins rodam pelo caminho direto (ADR 021). */
  readonly onSemEnsaio: () => void;
}) {
  const t = useT();
  const painel = useRef<HTMLDivElement>(null);
  const pronto = fase.tipo === "pronto";
  useEffect(() => {
    if (pronto) painel.current?.focus();
  }, [pronto]);

  if (fase.tipo === "ensaiando") {
    return <Trabalhando rotulo={t("ensaio.ensaiando")} cronometro />;
  }

  const ensaio = fase.ensaio;
  const aplicavel = ensaio !== null && contagensEsperadas(ensaio) !== null;

  return (
    <div
      ref={painel}
      tabIndex={-1}
      role="region"
      aria-label={t("ensaio.titulo")}
      onKeyDown={(e) => {
        if (e.key === "Escape" && fase.tipo !== "aplicando") {
          e.preventDefault();
          onDescartar();
        }
      }}
      className="motion-fade focus-visible:outline-none"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <FlaskConical aria-hidden className="h-3.5 w-3.5 text-info" />
        <span className="text-xs font-semibold text-ink">{t("ensaio.titulo")}</span>
        {/* O ensaio sempre reverte: a tela afirma isso, não deixa implícito. */}
        <span className="text-2xs text-subtle">{t("ensaio.nadaGravado")}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={fase.tipo === "aplicando"}
            title="Esc"
            onClick={onDescartar}
          >
            {t("ensaio.descartar")}
          </Button>
          {fase.tipo === "divergiu" ? (
            <Button variant="secondary" size="sm" onClick={onEnsaiarDeNovo}>
              <RotateCcw aria-hidden className="h-3.5 w-3.5" />
              {t("ensaio.ensaiarDeNovo")}
            </Button>
          ) : aplicavel ? (
            // Âmbar: este botão grava (design-system §1.4).
            <Button
              variant="primary"
              size="sm"
              loading={fase.tipo === "aplicando"}
              loadingLabel={t("ensaio.aplicando")}
              onClick={onAplicar}
            >
              {producao ? t("ensaio.aplicarProducao") : t("ensaio.aplicar")}
            </Button>
          ) : null}
        </div>
      </header>

      {fase.tipo === "divergiu" ? (
        <Aviso titulo={t("ensaio.divergiu")} texto={fase.mensagem} />
      ) : null}
      {fase.tipo === "falhou" ? (
        <Aviso
          titulo={fase.erro.code ?? t("query.erroLabel")}
          texto={mensagemDoCodigo(t, fase.erro.code, fase.erro.message)}
          detalhe={fase.erro.message}
        />
      ) : null}

      {ensaio !== null && ensaio.error !== null ? (
        <div className="border-b border-line px-4 py-3">
          <Aviso
            titulo={ensaio.error.code ?? t("query.erroLabel")}
            texto={ensaio.error.message}
            detalhe={[ensaio.error.detail, ensaio.error.hint].filter((x) => x !== null).join(" · ")}
            embutido
          />
          {/* DDL, CALL, SET… o ensaio recusa (só DML); o caminho direto existe. */}
          <p className="mt-2 text-2xs text-muted">{t("ensaio.soDml")}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={onSemEnsaio}>
            {t("ensaio.semEnsaio")}
          </Button>
        </div>
      ) : null}

      {ensaio !== null ? (
        <ol className="motion-stagger">
          {ensaio.results.map((r) => (
            <li key={r.index} style={{ "--i": r.index } as CSSProperties}>
              <LinhaEnsaio result={r} total={ensaio.results.length} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function LinhaEnsaio({ result, total }: { readonly result: StatementResult; readonly total: number }) {
  const t = useT();
  const temAmostra = result.columns.length > 0;
  return (
    <section className="border-b border-line">
      <header className="flex flex-wrap items-baseline gap-2 px-4 py-2">
        {total > 1 ? <span className="font-mono text-2xs text-subtle">#{result.index + 1}</span> : null}
        {result.command !== null ? <Badge>{result.command}</Badge> : null}
        <span className="text-xs text-ink">
          {t(result.rowCount === 1 ? "ensaio.afetariaSing" : "ensaio.afetariaPlur", { n: result.rowCount })}
        </span>
        <span className="font-mono text-2xs text-subtle">{result.durationMs} ms</span>
        {temAmostra && result.truncated ? (
          <span className="text-2xs text-subtle">{t("ensaio.amostra", { n: result.rows.length })}</span>
        ) : null}
      </header>
      <p className="truncate px-4 pb-2 font-mono text-2xs text-muted" title={result.sql}>{result.sql}</p>
      {temAmostra ? (
        <div className="h-48 border-t border-line">
          <ResultGrid columns={result.columns} rows={result.rows} />
        </div>
      ) : null}
    </section>
  );
}

function Aviso({
  titulo,
  texto,
  detalhe,
  embutido = false,
}: {
  readonly titulo: string;
  readonly texto: string;
  readonly detalhe?: string;
  readonly embutido?: boolean;
}) {
  return (
    <div
      role="alert"
      className={
        embutido
          ? "animate-refuse"
          : "animate-refuse border-b border-danger-line bg-danger-surface px-4 py-3"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert aria-hidden className="h-3.5 w-3.5 text-danger" />
        <Badge tone="danger">{titulo}</Badge>
        <span className="text-xs text-ink">{texto}</span>
      </div>
      {detalhe !== undefined && detalhe !== "" && detalhe !== texto ? (
        <p className="mt-1.5 text-2xs text-muted">{detalhe}</p>
      ) : null}
    </div>
  );
}
