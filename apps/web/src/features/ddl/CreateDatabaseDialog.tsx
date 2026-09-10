import * as Dialog from "@radix-ui/react-dialog";
import { type CreateDatabaseRequest, type DatabaseEncoding } from "@dbee/shared";
import { DdlInvalido, montarCreateDatabase, type DialetoSql } from "@dbee/shared/puro";
import { Info, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { FalhaDdl, useCriarDatabase } from "./useDdl";

/**
 * Criar database (ADR 010).
 *
 * O aviso sobre transação **fica na tela**, e não só no código: este é o único
 * comando do DBee que roda fora do `BEGIN` do ADR 001, e quem opera merece
 * saber que ele não é revertível por rollback como todo o resto. Não é
 * disclaimer defensivo — muda o que fazer se der errado no meio.
 */

const CODIFICACOES: readonly DatabaseEncoding[] = ["UTF8", "LATIN1", "SQL_ASCII"];
const MODELOS = ["template0", "template1"] as const;

const rotulo = "block text-xs font-medium text-ink";
const campo = "mt-1 h-9 w-full text-sm";
const selectClasse =
  "mt-1 h-9 w-full rounded-[4px] border border-line bg-sunken px-2 font-mono text-xs text-ink";

export function CreateDatabaseDialog({
  connectionId,
  dialeto = "postgres",
  onClose,
}: {
  readonly connectionId: string;
  /** Dialeto da engine — no MySQL o comando é só `CREATE DATABASE`. */
  readonly dialeto?: DialetoSql;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [nome, setNome] = useState("");
  const [dono, setDono] = useState("");
  const [encoding, setEncoding] = useState<DatabaseEncoding | "">("");
  const [modelo, setModelo] = useState<"template0" | "template1" | "">("");
  const [collate, setCollate] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const criar = useCriarDatabase(connectionId);

  const pedido = useMemo<CreateDatabaseRequest>(
    () => ({
      name: nome,
      ...(dono.trim() === "" ? {} : { owner: dono }),
      ...(encoding === "" ? {} : { encoding }),
      ...(modelo === "" ? {} : { template: modelo }),
      ...(collate.trim() === "" ? {} : { lcCollate: collate }),
    }),
    [nome, dono, encoding, modelo, collate],
  );

  /** Mesmo montador do servidor: o que se lê é o que vai rodar. */
  const previa = useMemo<{ sql: string | null; problema: string | null }>(() => {
    if (nome.trim() === "") return { sql: null, problema: null };
    try {
      return { sql: montarCreateDatabase(pedido, dialeto), problema: null };
    } catch (e: unknown) {
      return { sql: null, problema: e instanceof DdlInvalido ? e.message : t("ddl.erroNome") };
    }
  }, [pedido, nome, dialeto, t]);

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
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
            // Coluna com corpo rolável e rodapé fixo: como estava, o painel
            // inteiro era o scroller e o rodapé rolava junto — a 375x667 os
            // botões de ação nasciam 24 px abaixo da dobra.
            "flex max-h-[calc(100dvh-2rem)] flex-col",
            "rounded-lg border border-line bg-surface animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-ink">
              {t("ddl.dbTitulo")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label htmlFor="db-nome" className={rotulo}>{t("ddl.nomeDatabase")}</label>
              <Input
                id="db-nome"
                autoFocus
                mono
                value={nome}
                onChange={(e) => { setNome(e.target.value); }}
                placeholder="faturamento_2027"
                autoComplete="off"
                spellCheck={false}
                className={campo}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="db-dono" className={rotulo}>{t("ddl.dono")}</label>
                <Input
                  id="db-dono"
                  mono
                  value={dono}
                  onChange={(e) => { setDono(e.target.value); }}
                  autoComplete="off"
                  spellCheck={false}
                  className={campo}
                />
              </div>
              <div>
                <label htmlFor="db-encoding" className={rotulo}>{t("ddl.codificacao")}</label>
                <select
                  id="db-encoding"
                  value={encoding}
                  onChange={(e) => { setEncoding(e.target.value as DatabaseEncoding | ""); }}
                  className={selectClasse}
                >
                  <option value="">—</option>
                  {CODIFICACOES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="db-modelo" className={rotulo}>{t("ddl.modelo")}</label>
                <select
                  id="db-modelo"
                  value={modelo}
                  onChange={(e) => { setModelo(e.target.value as "template0" | "template1" | ""); }}
                  className={selectClasse}
                >
                  <option value="">—</option>
                  {MODELOS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="db-collate" className={rotulo}>{t("ddl.ordenacao")}</label>
                <Input
                  id="db-collate"
                  mono
                  value={collate}
                  onChange={(e) => { setCollate(e.target.value); }}
                  placeholder="pt_BR.UTF-8"
                  autoComplete="off"
                  spellCheck={false}
                  className={campo}
                />
              </div>
            </div>

            <div>
              <p className="text-2xs font-semibold text-subtle">{t("ddl.oQueVaiRodar")}</p>
              <pre className="mt-1 overflow-x-auto rounded-[6px] border border-line bg-sunken px-3 py-2 font-mono text-xs leading-relaxed text-muted">
                {previa.sql ?? previa.problema ?? "—"}
              </pre>
            </div>

            <p className="flex items-start gap-2 rounded-[6px] border border-line bg-raised px-3 py-2 text-2xs leading-relaxed text-subtle">
              <Info aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
              {t("ddl.foraDeTransacao")}
            </p>

            {erro !== null ? (
              <p role="alert" className="rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {erro}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
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
              {t("ddl.criarDb")}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
