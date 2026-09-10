import * as Dialog from "@radix-ui/react-dialog";
import { type ColumnType, type CreateTableRequest, type NewColumn } from "@dbee/shared";
import { DdlInvalido, montarCreateTable, TIPOS_COM_PRECISAO, TIPOS_COM_TAMANHO, TIPOS_SERIAIS, type DialetoSql } from "@dbee/shared/puro";
import { Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { FalhaDdl, useCriarTabela } from "./useDdl";

/**
 * Criar tabela — formulário, e o comando à vista (ADR 010).
 *
 * ## O SQL fica na tela enquanto se preenche
 *
 * Não é enfeite nem "modo avançado": é o que substitui a confirmação. O ADR 006
 * recusou "DDL por botão com confirmação" porque confirmação vira reflexo em
 * duas semanas. Ler o comando que vai rodar é uma barreira de outra natureza —
 * e aqui ele é montado pelo **mesmo código** do servidor (`montarCreateTable`
 * vem de `@dbee/shared`), então o que se lê é literalmente o que vai executar,
 * não uma aproximação que pode divergir.
 *
 * ## Só aparece com escrita ligada
 *
 * Quem monta o menu decide isso; aqui não há checagem de UI, porque UI não é
 * controle — o servidor recusa de qualquer jeito (`write_forbidden`).
 */

const TIPOS: readonly ColumnType[] = [
  "bigserial", "serial", "bigint", "integer", "smallint",
  "numeric", "real", "double precision", "boolean",
  "text", "varchar", "char", "uuid",
  "date", "time", "timestamp", "timestamptz",
  "json", "jsonb", "bytea", "inet",
];

let proximoId = 0;
interface Linha extends NewColumn {
  readonly key: number;
}

const novaLinha = (extra: Partial<NewColumn> = {}): Linha => ({
  key: proximoId++,
  name: "",
  type: "text",
  ...extra,
});

/**
 * Tira a chave de UI antes de mandar ao servidor — ela identifica a linha no
 * React, não a coluna no SQL.
 *
 * Campo a campo, e não `{ key, ...resto }`, por causa do
 * `exactOptionalPropertyTypes`: `{ length: undefined }` não é o mesmo que
 * ausência, e o schema do TypeBox recusaria a chave presente com `undefined`.
 */
const semChave = (l: Linha): NewColumn => ({
  name: l.name,
  type: l.type,
  ...(l.length === undefined ? {} : { length: l.length }),
  ...(l.scale === undefined ? {} : { scale: l.scale }),
  ...(l.notNull === undefined ? {} : { notNull: l.notNull }),
  ...(l.primaryKey === undefined ? {} : { primaryKey: l.primaryKey }),
  ...(l.unique === undefined ? {} : { unique: l.unique }),
  ...(l.defaultValue === undefined || l.defaultValue === ""
    ? {}
    : { defaultValue: l.defaultValue }),
  ...(l.defaultExpression === undefined ? {} : { defaultExpression: l.defaultExpression }),
});

export function CreateTableDialog({
  connectionId,
  database,
  schema,
  dialeto = "postgres",
  onClose,
}: {
  readonly connectionId: string;
  readonly database: string;
  readonly schema: string;
  /** Dialeto da engine — decide a sintaxe do preview (e do que roda). */
  readonly dialeto?: DialetoSql;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [nome, setNome] = useState("");
  const [comentario, setComentario] = useState("");
  const [seNaoExiste, setSeNaoExiste] = useState(false);
  const [linhas, setLinhas] = useState<readonly Linha[]>(() => [
    novaLinha({ name: "id", type: "bigserial", primaryKey: true }),
    novaLinha(),
  ]);
  const [erro, setErro] = useState<string | null>(null);

  const criar = useCriarTabela(connectionId, database);

  const pedido = useMemo<CreateTableRequest>(
    () => ({
      database,
      schema,
      name: nome,
      columns: linhas.filter((l) => l.name.trim() !== "").map(semChave),
      ...(seNaoExiste ? { ifNotExists: true } : {}),
      ...(comentario.trim() === "" ? {} : { comment: comentario }),
    }),
    [database, schema, nome, linhas, seNaoExiste, comentario],
  );

  /**
   * A prévia é o mesmo montador do servidor. Enquanto o formulário está
   * incompleto ele estoura — e aí a prévia mostra o motivo em vez de SQL, que é
   * a mensagem certa na hora certa.
   */
  const previa = useMemo<{ sql: string | null; problema: string | null }>(() => {
    if (pedido.name.trim() === "") return { sql: null, problema: null };
    if (pedido.columns.length === 0) return { sql: null, problema: t("ddl.semColunas") };
    try {
      return { sql: montarCreateTable(pedido, dialeto), problema: null };
    } catch (e: unknown) {
      return { sql: null, problema: e instanceof DdlInvalido ? e.message : t("ddl.erroNome") };
    }
  }, [pedido, dialeto, t]);

  const alterar = (key: number, aplicar: (linha: Linha) => Linha): void => {
    setLinhas((atuais) => atuais.map((l) => (l.key === key ? aplicar(l) : l)));
  };

  /**
   * Campo numérico vazio **remove** a propriedade em vez de gravar `undefined`:
   * sob `exactOptionalPropertyTypes` os dois não são a mesma coisa, e a chave
   * presente com `undefined` chegaria ao TypeBox como valor inválido.
   */
  const alterarNumero = (key: number, campo: "length" | "scale", bruto: string): void => {
    alterar(key, (linha) => {
      const n = Number(bruto);
      const vazio = bruto === "" || !Number.isFinite(n);
      // Reconstruído sem a chave, em vez de `delete` — o lint proíbe delete de
      // chave computada, e reconstruir deixa a intenção explícita.
      const { length, scale, ...resto } = linha;
      const outro = campo === "length" ? scale : length;
      return {
        ...resto,
        ...(campo === "length"
          ? { ...(vazio ? {} : { length: n }), ...(outro === undefined ? {} : { scale: outro }) }
          : { ...(vazio ? {} : { scale: n }), ...(outro === undefined ? {} : { length: outro }) }),
      };
    });
  };

  const enviar = (): void => {
    if (previa.sql === null) return;
    setErro(null);
    criar.mutate(pedido, {
      onSuccess: onClose,
      onError: (e) => { setErro(e instanceof FalhaDdl ? e.message : t("ddl.erroNome")); },
    });
  };

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); }}
          className={cn(
            "focus-visible:outline-none",
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[calc(100dvh-2rem)] flex-col",
            "rounded-lg border border-line bg-surface animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-ink">
                {t("ddl.tabelaTitulo")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 font-mono text-2xs text-subtle">
                {t("ddl.tabelaEm", { schema })}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label htmlFor="ddl-nome" className="block text-xs font-medium text-ink">
                {t("ddl.nomeTabela")}
              </label>
              <Input
                id="ddl-nome"
                autoFocus
                mono
                value={nome}
                onChange={(e) => { setNome(e.target.value); }}
                placeholder="pedidos"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 h-9 w-full max-w-sm text-sm"
              />
            </div>

            {/*
              Grade, não tabela `<table>`: a linha precisa reflowar em 375px, e
              uma tabela com sete colunas ali rola horizontalmente — que é
              justamente o que a §5 do design-system proíbe no corpo da página.
            */}
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[1fr_9rem_4rem_4rem_2.5rem_2.5rem_1fr_2rem] items-center gap-2 border-b border-line pb-1.5 text-2xs font-semibold text-subtle">
                  <span>{t("ddl.coluna")}</span>
                  <span>{t("ddl.tipo")}</span>
                  <span>{t("ddl.tamanho")}</span>
                  <span>{t("ddl.escala")}</span>
                  <span className="text-center">{t("ddl.pk")}</span>
                  <span className="text-center">{t("ddl.nulo")}</span>
                  <span>{t("ddl.padrao")}</span>
                  <span />
                </div>

                {linhas.map((linha) => {
                  const serial = TIPOS_SERIAIS.has(linha.type);
                  return (
                    <div
                      key={linha.key}
                      className="grid grid-cols-[1fr_9rem_4rem_4rem_2.5rem_2.5rem_1fr_2rem] items-center gap-2 border-b border-line/60 py-1.5"
                    >
                      <Input
                        mono
                        value={linha.name}
                        onChange={(e) => { alterar(linha.key, (l) => ({ ...l, name: e.target.value })); }}
                        aria-label={t("ddl.coluna")}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-8 w-full text-xs"
                      />
                      <select
                        value={linha.type}
                        onChange={(e) => { alterar(linha.key, (l) => ({ ...l, type: e.target.value as ColumnType })); }}
                        aria-label={t("ddl.tipo")}
                        className="h-8 rounded-[4px] border border-line bg-sunken px-2 font-mono text-xs text-ink"
                      >
                        {TIPOS.map((tipo) => (
                          <option key={tipo} value={tipo}>{tipo}</option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        min={1}
                        value={linha.length ?? ""}
                        disabled={!TIPOS_COM_TAMANHO.has(linha.type) && !TIPOS_COM_PRECISAO.has(linha.type)}
                        onChange={(e) => { alterarNumero(linha.key, "length", e.target.value); }}
                        aria-label={t("ddl.tamanho")}
                        className="h-8 w-full text-xs disabled:opacity-40"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={linha.scale ?? ""}
                        disabled={!TIPOS_COM_PRECISAO.has(linha.type)}
                        onChange={(e) => { alterarNumero(linha.key, "scale", e.target.value); }}
                        aria-label={t("ddl.escala")}
                        className="h-8 w-full text-xs disabled:opacity-40"
                      />
                      <input
                        type="checkbox"
                        checked={linha.primaryKey === true}
                        onChange={(e) => { alterar(linha.key, (l) => ({ ...l, primaryKey: e.target.checked })); }}
                        aria-label={`${t("ddl.pk")} ${linha.name}`}
                        className="mx-auto h-4 w-4 accent-[var(--color-muted)]"
                      />
                      {/*
                        Marcado = aceita NULL; `notNull` é o inverso, e o
                        cabeçalho diz "Nulo" porque é o que a pessoa pensa.
                        PK e serial **não** aceitam NULL — deixar a caixa
                        marcada (mesmo desabilitada) fazia a tela afirmar que
                        uma chave primária aceita nulo.
                      */}
                      <input
                        type="checkbox"
                        checked={linha.primaryKey !== true && !serial && linha.notNull !== true}
                        disabled={linha.primaryKey === true || serial}
                        onChange={(e) => { alterar(linha.key, (l) => ({ ...l, notNull: !e.target.checked })); }}
                        aria-label={`${t("ddl.nulo")} ${linha.name}`}
                        className="mx-auto h-4 w-4 accent-[var(--color-muted)] disabled:opacity-40"
                      />
                      <Input
                        mono
                        value={linha.defaultValue ?? ""}
                        disabled={serial}
                        onChange={(e) => { alterar(linha.key, (l) => ({ ...l, defaultValue: e.target.value })); }}
                        aria-label={t("ddl.padrao")}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-8 w-full text-xs disabled:opacity-40"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={linhas.length === 1}
                        aria-label={t("ddl.removerColuna", { nome: linha.name })}
                        onClick={() => { setLinhas((a) => a.filter((l) => l.key !== linha.key)); }}
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setLinhas((a) => [...a, novaLinha()]); }}
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
              {t("ddl.addColuna")}
            </Button>

            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[16rem] flex-1">
                <label htmlFor="ddl-comentario" className="block text-xs font-medium text-ink">
                  {t("ddl.comentario")}
                </label>
                <Input
                  id="ddl-comentario"
                  value={comentario}
                  onChange={(e) => { setComentario(e.target.value); }}
                  className="mt-1 h-8 w-full text-xs"
                />
              </div>
              <label className="flex items-center gap-2 pb-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={seNaoExiste}
                  onChange={(e) => { setSeNaoExiste(e.target.checked); }}
                  className="h-4 w-4 accent-[var(--color-muted)]"
                />
                {t("ddl.seNaoExiste")}
              </label>
            </div>

            <div>
              <p className="text-2xs font-semibold text-subtle">{t("ddl.oQueVaiRodar")}</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-[6px] border border-line bg-sunken px-3 py-2 font-mono text-xs leading-relaxed text-muted">
                {previa.sql ?? previa.problema ?? "—"}
              </pre>
            </div>

            {erro !== null ? (
              <p role="alert" className="rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {erro}
              </p>
            ) : null}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost">{t("comum.cancelar")}</Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="primary"
              disabled={previa.sql === null}
              loading={criar.isPending}
              loadingLabel={t("ddl.criando")}
              onClick={enviar}
            >
              {t("ddl.criar")}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
