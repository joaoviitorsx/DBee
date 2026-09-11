import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Info, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { mensagemDoCodigo, useIdioma } from "../../i18n";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";

/** Alvo: o documento (por `_id`), a coleção, e o campo de topo cujo objeto abriu. */
export interface MongoAlvo {
  readonly database: string;
  readonly schema: string;
  readonly collection: string;
  readonly idColumn: string;
  readonly idValue: string;
  /** O campo de topo (objeto/array) sendo editado — prefixo de todo path. */
  readonly campo: string;
  /** O JSON renderado na célula desse campo (a fonte das folhas). */
  readonly valueJson: string | null;
}

/** Uma folha escalar do documento: caminho pontuado (relativo ao campo) e valor. */
interface Folha {
  readonly id: string;
  /** Path relativo ao campo de topo, ex.: `cidade`, `enderecos.0.cep`. */
  readonly path: string;
  readonly valor: string | null;
}

/**
 * Editor de **documento aninhado** do MongoDB.
 *
 * Um campo cujo valor é objeto/array não cabe numa célula editável de texto — a
 * grade mostra o JSON. Este editor abre esse sub-documento como uma lista de
 * **folhas escalares** por caminho pontuado (`endereco.cidade`), e cada edição
 * vira um `$set` de **um** campo por dot-notation no servidor (nunca reescreve o
 * documento — preserva os tipos BSON e o resto). Segue o padrão do
 * `RedisValueModal` (Radix, tokens do design system).
 *
 * v1 edita o **valor** de folhas existentes; acrescentar/remover campo aninhado
 * é fatia seguinte. Coleção grande que a grade truncou avisa que a visão pode
 * estar incompleta.
 */
export function MongoDocModal({
  connectionId,
  alvo,
  onClose,
}: {
  readonly connectionId: string;
  readonly alvo: MongoAlvo;
  readonly onClose: () => void;
}) {
  const { t } = useIdioma();
  const qc = useQueryClient();

  const { folhas: iniciais, truncado } = useMemo(() => achatar(alvo.valueJson), [alvo.valueJson]);
  const [folhas, setFolhas] = useState<Folha[]>(iniciais);
  const [erro, setErro] = useState<{ code?: string; message: string } | null>(null);

  const aplicar = useMutation({
    mutationFn: async (params: { path: string; from: string | null; to: string }) => {
      setErro(null);
      const { data, error } = await api.api.connections({ id: connectionId }).rows.update.post({
        database: alvo.database,
        schema: alvo.schema,
        table: alvo.collection,
        readOnly: false,
        pk: [{ column: alvo.idColumn, value: alvo.idValue }],
        // O campo de topo prefixa o caminho: `endereco` + `cidade` → `endereco.cidade`.
        changes: [{ column: `${alvo.campo}.${params.path}`, from: params.from, to: params.to }],
      });
      if (error !== null) throw erroDaResposta(error);
      return data;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["rows"] }); },
    onError: (e: unknown) => {
      const er = e as { code?: string; message?: string };
      setErro({ ...(er.code === undefined ? {} : { code: er.code }), message: er.message ?? "falhou" });
    },
  });

  const salvar = (f: Folha, novo: string): void => {
    aplicar.mutate(
      { path: f.path, from: f.valor, to: novo },
      { onSuccess: () => { setFolhas((l) => l.map((x) => (x.id === f.id ? { ...x, valor: novo } : x))); } },
    );
  };

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line border-l-[3px] border-l-accent bg-surface",
            "animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold text-ink">
                {t("mongoEdit.titulo", { campo: alvo.campo })}
              </Dialog.Title>
              <p className="mt-0.5 truncate font-mono text-2xs text-subtle">
                {alvo.collection} · _id {alvo.idValue}
              </p>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" className="shrink-0" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="space-y-2 overflow-y-auto px-5 py-4">
            {truncado ? (
              <p className="flex gap-1.5 rounded-[4px] border border-amber/30 bg-amber/10 px-3 py-2 text-2xs leading-relaxed text-amber">
                <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
                <span>{t("mongoEdit.truncado")}</span>
              </p>
            ) : null}

            {folhas.length === 0 ? (
              <p className="py-2 text-xs text-subtle">{t("mongoEdit.semFolhas")}</p>
            ) : (
              <ul className="space-y-1.5">
                {folhas.map((f) => (
                  <FolhaLinha key={f.id} folha={f} ocupado={aplicar.isPending} onSalvar={salvar} />
                ))}
              </ul>
            )}

            <p className="flex gap-1.5 text-2xs leading-relaxed text-subtle">
              <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
              <span>{t("mongoEdit.nota")}</span>
            </p>

            {erro !== null ? (
              <p role="alert" className="rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {mensagemDoCodigo(t, erro.code, erro.message)}
              </p>
            ) : null}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost">{t("comum.fechar")}</Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FolhaLinha({
  folha,
  ocupado,
  onSalvar,
}: {
  readonly folha: Folha;
  readonly ocupado: boolean;
  readonly onSalvar: (f: Folha, novo: string) => void;
}) {
  const original = folha.valor ?? "";
  const [rascunho, setRascunho] = useState(original);
  const sujo = rascunho !== original;

  return (
    <li className="flex items-center gap-2">
      <span className="w-40 shrink-0 truncate font-mono text-2xs text-muted" title={folha.path}>
        {folha.path}
      </span>
      <Input
        value={rascunho}
        onChange={(e) => { setRascunho(e.target.value); }}
        aria-label={folha.path}
        className="min-w-0 flex-1"
        onKeyDown={(e) => { if (e.key === "Enter" && sujo) onSalvar(folha, rascunho); }}
      />
      {sujo ? (
        <Button size="icon" variant="secondary" aria-label="Salvar" disabled={ocupado} onClick={() => { onSalvar(folha, rascunho); }}>
          <Check aria-hidden className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </li>
  );
}

/** Erro da API que preserva o `code`. */
function erroDaResposta(error: unknown): Error & { code?: string } {
  let message = "falhou";
  let code: string | undefined;
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null) {
      if ("code" in value && typeof value.code === "string") code = value.code;
      if ("message" in value && typeof value.message === "string") message = value.message;
    }
  }
  const e: Error & { code?: string } = new Error(message);
  if (code !== undefined) e.code = code;
  return e;
}

/** O texto de uma folha escalar (regra 10). Objeto/array recursam; resto vira texto. */
function textoDe(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return null; // não deveria chegar aqui (folha = escalar)
}

/**
 * Achata o JSON do campo em folhas escalares por caminho pontuado.
 *
 * `{cidade:"SP", geo:{lat:1}}` → [`cidade`="SP", `geo.lat`="1"]. Array vira
 * índice: `tags:["a"]` → `tags.0`="a". Truncamento (o `…(+N)` do servidor)
 * quebra o parse → devolve vazio com aviso.
 */
function achatar(valueJson: string | null): { folhas: Folha[]; truncado: boolean } {
  const bruto = valueJson ?? "";
  if (/…\(\+\d+\)$/.test(bruto)) return { folhas: [], truncado: true };

  let dado: unknown;
  try {
    dado = JSON.parse(bruto);
  } catch {
    return { folhas: [], truncado: bruto.trim() !== "" };
  }
  if (typeof dado !== "object" || dado === null) return { folhas: [], truncado: false };

  const folhas: Folha[] = [];
  let seq = 0;
  const anda = (v: unknown, prefixo: string): void => {
    if (typeof v === "object" && v !== null) {
      for (const [k, filho] of Object.entries(v as Record<string, unknown>)) {
        anda(filho, prefixo === "" ? k : `${prefixo}.${k}`);
      }
      return;
    }
    folhas.push({ id: `f-${String(seq++)}-${prefixo}`, path: prefixo, valor: textoDe(v) });
  };
  anda(dado, "");
  return { folhas, truncado: false };
}
