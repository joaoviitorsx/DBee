import * as Dialog from "@radix-ui/react-dialog";
import type { RedisValueEditRequest, RedisValueOp } from "@dbee/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Info, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { mensagemDoCodigo, useIdioma } from "../../i18n";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";

/** Os quatro tipos de coleção que ganham editor estruturado. */
export type TipoColecao = "hash" | "list" | "set" | "zset";

/** O alvo da edição: a chave, seu tipo e o valor renderizado que a grade leu. */
export interface RedisAlvo {
  readonly database: string;
  readonly key: string;
  readonly type: TipoColecao;
  /** O JSON renderado na célula `value` (a fonte dos membros exibidos). */
  readonly valueJson: string | null;
}

/**
 * Um membro na tela: `a` é o identificador (campo/índice/membro), `b` o valor
 * associado (valor do campo, elemento, score) — `null` no `set`, que só tem
 * membro. `id` é estável para a lista do React.
 */
interface Membro {
  readonly id: string;
  readonly a: string;
  readonly b: string | null;
}

/**
 * Editor estruturado de uma coleção do Redis (hash/list/set/zset).
 *
 * Segue o padrão do `RowEditModal` (Radix Dialog, tokens do design system), mas
 * é **dinâmico**: lista os membros, cada um com edição e exclusão inline, e uma
 * linha para adicionar. Cada ação vai ao `POST /redis/value` com a guarda
 * otimista (o valor anterior), e a grade recarrega no sucesso.
 *
 * Os membros vêm do JSON já renderado na célula (até 100 itens). Se a célula foi
 * truncada, o editor avisa e segue servindo o que tem — adicionar e excluir por
 * nome continuam valendo; o que não aparece só não está listado.
 */
export function RedisValueModal({
  connectionId,
  alvo,
  onClose,
}: {
  readonly connectionId: string;
  readonly alvo: RedisAlvo;
  readonly onClose: () => void;
}) {
  const { t } = useIdioma();
  const qc = useQueryClient();

  const { membros: iniciais, truncado } = useMemo(() => parseMembros(alvo), [alvo]);
  const [membros, setMembros] = useState<Membro[]>(iniciais);
  const [erro, setErro] = useState<{ code?: string; message: string } | null>(null);
  // Adição: os dois campos (o segundo some no `set`).
  const [novoA, setNovoA] = useState("");
  const [novoB, setNovoB] = useState("");

  const temValor = alvo.type !== "set"; // set: só membro; os outros têm valor/score
  const editavelA = alvo.type === "set"; // no set o próprio membro é o dado
  const editavelB = alvo.type === "hash" || alvo.type === "zset" || alvo.type === "list";

  const aplicar = useMutation({
    mutationFn: async (op: RedisValueOp) => {
      setErro(null);
      const body: RedisValueEditRequest = {
        database: alvo.database,
        key: alvo.key,
        op,
        readOnly: false,
      };
      const { data, error } = await api.api
        .connections({ id: connectionId })
        .redis.value.post(body);
      if (error !== null) throw erroDaResposta(error);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rows"] });
    },
    onError: (e: unknown) => {
      const er = e as { code?: string; message?: string };
      setErro({ ...(er.code === undefined ? {} : { code: er.code }), message: er.message ?? "falhou" });
    },
  });

  /** Salva a edição de um membro (valor/score, ou o próprio membro no set). */
  const salvar = (m: Membro, novo: string): void => {
    const op = opDeEdicao(alvo.type, m, novo);
    if (op === null) return;
    aplicar.mutate(op, {
      onSuccess: () => {
        setMembros((lista) =>
          lista.map((x) =>
            x.id === m.id ? (alvo.type === "set" ? { ...x, a: novo } : { ...x, b: novo }) : x,
          ),
        );
      },
    });
  };

  const excluir = (m: Membro): void => {
    aplicar.mutate(opDeExclusao(alvo.type, m), {
      onSuccess: () => { setMembros((lista) => lista.filter((x) => x.id !== m.id)); },
    });
  };

  const adicionar = (): void => {
    const chave = novoA.trim();
    if (chave === "" && alvo.type !== "list") return; // list: só valor importa
    const valor = novoB;
    const op = opDeAdicao(alvo.type, chave, valor);
    if (op === null) return;
    aplicar.mutate(op, {
      onSuccess: () => {
        setMembros((lista) => [
          ...lista,
          {
            id: `novo-${String(Date.now())}-${String(lista.length)}`,
            a: alvo.type === "list" ? String(lista.length) : chave,
            b: temValor ? valor : null,
          },
        ]);
        setNovoA("");
        setNovoB("");
      },
    });
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
                {t("redisEdit.titulo", { key: alvo.key })}
              </Dialog.Title>
              <p className="mt-0.5 font-mono text-2xs uppercase tracking-wide text-subtle">
                {alvo.type} · {t("redisEdit.membros", { n: membros.length })}
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
                <TriangleAlert aria-hidden className="mt-px h-3 w-3 shrink-0" />
                <span>{t("redisEdit.truncado")}</span>
              </p>
            ) : null}

            {membros.length === 0 ? (
              <p className="py-2 text-xs text-subtle">{t("redisEdit.vazio")}</p>
            ) : (
              <ul className="space-y-1.5">
                {membros.map((m) => (
                  <LinhaMembro
                    key={m.id}
                    membro={m}
                    editavelA={editavelA}
                    editavelB={editavelB}
                    temValor={temValor}
                    ocupado={aplicar.isPending}
                    rotuloA={rotuloA(alvo.type, t)}
                    rotuloB={rotuloB(alvo.type, t)}
                    onSalvar={salvar}
                    onExcluir={excluir}
                  />
                ))}
              </ul>
            )}

            {/* Adicionar membro */}
            <div className="flex items-end gap-2 rounded-[4px] border border-dashed border-line px-3 py-2.5">
              {alvo.type !== "list" ? (
                <label className="min-w-0 flex-1 text-2xs text-subtle">
                  {rotuloA(alvo.type, t)}
                  <Input
                    value={novoA}
                    onChange={(e) => { setNovoA(e.target.value); }}
                    placeholder={rotuloA(alvo.type, t)}
                    className="mt-0.5"
                  />
                </label>
              ) : null}
              {temValor ? (
                <label className="min-w-0 flex-1 text-2xs text-subtle">
                  {rotuloB(alvo.type, t)}
                  <Input
                    value={novoB}
                    onChange={(e) => { setNovoB(e.target.value); }}
                    placeholder={rotuloB(alvo.type, t)}
                    className="mt-0.5"
                    onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }}
                  />
                </label>
              ) : null}
              <Button size="sm" variant="secondary" onClick={adicionar} loading={aplicar.isPending}>
                <Plus aria-hidden className="h-3.5 w-3.5" />
                {t("redisEdit.adicionar")}
              </Button>
            </div>

            <p className="flex gap-1.5 text-2xs leading-relaxed text-subtle">
              <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
              <span>{t("redisEdit.nota")}</span>
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

/** Uma linha de membro, com edição inline do que é editável e o excluir. */
function LinhaMembro({
  membro,
  editavelA,
  editavelB,
  temValor,
  ocupado,
  rotuloA: rA,
  rotuloB: rB,
  onSalvar,
  onExcluir,
}: {
  readonly membro: Membro;
  readonly editavelA: boolean;
  readonly editavelB: boolean;
  readonly temValor: boolean;
  readonly ocupado: boolean;
  readonly rotuloA: string;
  readonly rotuloB: string;
  readonly onSalvar: (m: Membro, novo: string) => void;
  readonly onExcluir: (m: Membro) => void;
}) {
  // O campo editável é `a` no set, `b` nos demais.
  const original = editavelA ? membro.a : (membro.b ?? "");
  const [rascunho, setRascunho] = useState(original);
  const sujo = rascunho !== original;

  return (
    <li className="flex items-center gap-2">
      {/* Identificador (campo/índice/membro) — só editável no set. */}
      {editavelA ? (
        <Input
          value={rascunho}
          onChange={(e) => { setRascunho(e.target.value); }}
          aria-label={rA}
          className="min-w-0 flex-1"
          onKeyDown={(e) => { if (e.key === "Enter" && sujo) onSalvar(membro, rascunho); }}
        />
      ) : (
        <span
          className="w-32 shrink-0 truncate font-mono text-2xs text-muted"
          title={membro.a}
        >
          {membro.a}
        </span>
      )}

      {/* Valor/score — editável no hash/zset/list. */}
      {temValor && !editavelA ? (
        editavelB ? (
          <Input
            value={rascunho}
            onChange={(e) => { setRascunho(e.target.value); }}
            aria-label={rB}
            className="min-w-0 flex-1"
            onKeyDown={(e) => { if (e.key === "Enter" && sujo) onSalvar(membro, rascunho); }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{membro.b}</span>
        )
      ) : null}

      {sujo ? (
        <Button
          size="icon"
          variant="secondary"
          aria-label="Salvar"
          disabled={ocupado}
          onClick={() => { onSalvar(membro, rascunho); }}
        >
          <Check aria-hidden className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        aria-label="Excluir"
        disabled={ocupado}
        onClick={() => { onExcluir(membro); }}
        className="text-subtle hover:text-danger"
      >
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
      </Button>
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

/** Rótulo do campo identificador por tipo. */
function rotuloA(tipo: TipoColecao, t: ReturnType<typeof useIdioma>["t"]): string {
  if (tipo === "hash") return t("redisEdit.campo");
  if (tipo === "list") return t("redisEdit.indice");
  return t("redisEdit.membro1");
}
/** Rótulo do campo valor por tipo. */
function rotuloB(tipo: TipoColecao, t: ReturnType<typeof useIdioma>["t"]): string {
  if (tipo === "zset") return t("redisEdit.score");
  return t("redisEdit.valor");
}

/** Op de edição de um membro existente (ou `null` se nada a fazer). */
function opDeEdicao(tipo: TipoColecao, m: Membro, novo: string): RedisValueOp | null {
  switch (tipo) {
    case "hash":
      return { kind: "hash-set", field: m.a, value: novo, from: m.b };
    case "zset":
      return { kind: "zset-add", member: m.a, score: novo };
    case "list":
      return { kind: "list-set", index: Number(m.a), value: novo, from: m.b ?? "" };
    case "set":
      // "Editar" um membro do set é remover o antigo e adicionar o novo. Aqui
      // fazemos o add; a remoção do antigo fica a cargo do usuário (excluir),
      // para não apagar em silêncio. Simples e previsível.
      return { kind: "set-add", member: novo };
  }
}

function opDeExclusao(tipo: TipoColecao, m: Membro): RedisValueOp {
  switch (tipo) {
    case "hash":
      return { kind: "hash-del", field: m.a };
    case "set":
      return { kind: "set-del", member: m.a };
    case "zset":
      return { kind: "zset-del", member: m.a };
    case "list":
      return { kind: "list-del", value: m.b ?? "" };
  }
}

function opDeAdicao(tipo: TipoColecao, chave: string, valor: string): RedisValueOp | null {
  switch (tipo) {
    case "hash":
      return { kind: "hash-set", field: chave, value: valor, from: null };
    case "set":
      return { kind: "set-add", member: chave };
    case "zset":
      return { kind: "zset-add", member: chave, score: valor };
    case "list":
      return { kind: "list-push", side: "right", value: valor };
  }
}

/** Lê os membros do JSON renderado na célula; marca truncamento. */
function parseMembros(alvo: RedisAlvo): { membros: Membro[]; truncado: boolean } {
  const bruto = alvo.valueJson ?? "";
  // `truncar` no servidor acrescenta `…(+N)` quando estoura o teto — o que
  // quebra o JSON. Detecta e degrada.
  const truncado = /…\(\+\d+\)$/.test(bruto);
  if (truncado) return { membros: [], truncado: true };

  let dado: unknown;
  try {
    dado = JSON.parse(bruto);
  } catch {
    return { membros: [], truncado: bruto.trim() !== "" };
  }

  const mk = (a: string, b: string | null, i: number): Membro => ({ id: `m-${String(i)}-${a}`, a, b });

  if (alvo.type === "hash" && typeof dado === "object" && dado !== null && !Array.isArray(dado)) {
    return {
      membros: Object.entries(dado as Record<string, unknown>).map(([k, v], i) => mk(k, String(v), i)),
      truncado: false,
    };
  }
  if (alvo.type === "list" && Array.isArray(dado)) {
    return { membros: dado.map((v, i) => mk(String(i), String(v), i)), truncado: false };
  }
  if (alvo.type === "set" && Array.isArray(dado)) {
    return { membros: dado.map((v, i) => mk(String(v), null, i)), truncado: false };
  }
  if (alvo.type === "zset" && Array.isArray(dado)) {
    // Pares `[membro, score]` ou plano `[membro, score, membro, score]`.
    const ehPares = dado.length > 0 && Array.isArray(dado[0]);
    if (ehPares) {
      return {
        membros: (dado as unknown[][]).map((par, i) => mk(String(par[0]), String(par[1]), i)),
        truncado: false,
      };
    }
    const membros: Membro[] = [];
    for (let i = 0; i + 1 < dado.length; i += 2) {
      membros.push(mk(String(dado[i]), String(dado[i + 1]), i));
    }
    return { membros, truncado: false };
  }
  return { membros: [], truncado: false };
}
