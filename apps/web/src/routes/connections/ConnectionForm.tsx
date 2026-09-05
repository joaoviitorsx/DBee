import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import type { Connection, CreateConnection, SslMode } from "@dbee/shared";
import { Plug, X } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { Button, Field, Input } from "../../components/ui";
import { useT } from "../../i18n";
import type { ChaveI18n } from "../../i18n/pt";
import { cn } from "../../lib/cn";

/** Rótulos honestos: o que cada modo garante de fato (ADR 003). */
const SSL_OPTIONS: readonly { value: SslMode; label: ChaveI18n; hint: ChaveI18n }[] = [
  { value: "disable", label: "form.tlsDesativado", hint: "form.tlsDesativadoAjuda" },
  { value: "require", label: "form.tlsExigir", hint: "form.tlsExigirAjuda" },
  { value: "verify-full", label: "form.tlsVerificar", hint: "form.tlsVerificarAjuda" },
];

const TAGS: readonly { color: string; name: ChaveI18n }[] = [
  { color: "#E5484D", name: "cor.vermelho" },
  { color: "#F5A623", name: "cor.ambar" },
  { color: "#5FA777", name: "cor.verde" },
  { color: "#5B8FF9", name: "cor.azul" },
  { color: "#A78BFA", name: "cor.roxo" },
];

export interface ConnectionDraft extends CreateConnection {
  readonly sslMode: SslMode;
}

interface ConnectionFormProps {
  readonly open: boolean;
  readonly editing: Connection | null;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (draft: ConnectionDraft) => void;
}

function initialDraft(editing: Connection | null): ConnectionDraft {
  return {
    name: editing?.name ?? "",
    host: editing?.host ?? "",
    port: editing?.port ?? 5432,
    database: editing?.database ?? "",
    username: editing?.username ?? "",
    password: "",
    color: editing?.color ?? null,
    sslMode: editing?.sslMode ?? "disable",
    writeEnabled: editing?.writeEnabled ?? false,
    timezone: editing?.timezone ?? "UTC",
  };
}

/**
 * Painel lateral, não modal centrado: a lista continua visível enquanto se
 * cadastra, que é como se confere se a conexão já existe.
 */
export function ConnectionForm({
  open,
  editing,
  saving,
  error,
  onOpenChange,
  onSubmit,
}: ConnectionFormProps) {
  // O estado inicial vale por montagem: o pai passa `key` para remontar quando
  // troca o alvo, que é o reset idiomático — sem useEffect de sincronização.
  const [draft, setDraft] = useState<ConnectionDraft>(() => initialDraft(editing));
  const t = useT();

  const set = <K extends keyof ConnectionDraft>(field: K, value: ConnectionDraft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit: NonNullable<ComponentProps<"form">["onSubmit"]> = (event) => {
    event.preventDefault();
    onSubmit(draft);
  };

  const isEdit = editing !== null;
  const sslHintKey = SSL_OPTIONS.find((o) => o.value === draft.sslMode)?.hint;
  const sslHint = sslHintKey === undefined ? undefined : t(sslHintKey);

  /*
   * A régua da esquerda assume **a cor escolhida da conexão**.
   *
   * Não é enfeite: é a mesma tag de 3px que identifica a conexão na árvore, e
   * pô-la aqui faz o modal mostrar como aquela conexão vai aparecer depois. Sem
   * cor escolhida ela é âmbar — o acento do produto.
   */
  const regua = draft.color ?? "var(--color-accent)";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            // Centrado, não gaveta lateral: o formulário é o assunto enquanto
            // está aberto, e a gaveta sugeria um painel auxiliar sobre um
            // conteúdo que continua sendo usado — o que não é o caso.
            "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-lg border border-line bg-surface shadow-[0_24px_64px_rgba(0,0,0,.5)]",
            "animate-settle",
          )}
          style={{ borderLeft: `3px solid ${regua}` }}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-ink">
                <Plug aria-hidden className="h-4 w-4 shrink-0 text-accent" />
                {isEdit ? t("form.editarTitulo") : t("form.novoTitulo")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-relaxed text-muted">
                {isEdit ? t("form.editarDescricao") : t("form.novoDescricao")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <Field label={t("form.nome")} htmlFor="name" hint={t("form.nomeAjuda")}>
                <Input
                  id="name"
                  required
                  autoFocus
                  value={draft.name}
                  onChange={(e) => { set("name", e.target.value); }}
                  placeholder={t("form.nomePlaceholder")}
                />
              </Field>

              <div>
                <span className="text-xs font-medium text-muted">{t("form.tag")}</span>
                <div className="mt-1.5 flex items-center gap-2">
                  {TAGS.map((tag) => (
                    <button
                      key={tag.color}
                      type="button"
                      aria-label={t(tag.name)}
                      aria-pressed={draft.color === tag.color}
                      onClick={() => { set("color", draft.color === tag.color ? null : tag.color); }}
                      className={cn(
                        "h-7 w-7 cursor-pointer rounded-[4px] border-2 transition-transform duration-150",
                        draft.color === tag.color
                          ? "border-ink scale-110"
                          : "border-transparent hover:scale-105",
                      )}
                      style={{ backgroundColor: tag.color }}
                    />
                  ))}
                  <span className="ml-1 text-2xs text-subtle">
                    {draft.color === null ? t("form.semTag") : t("form.tagAjuda")}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <Field label={t("form.host")} htmlFor="host">
                  <Input
                    id="host"
                    required
                    mono
                    value={draft.host}
                    onChange={(e) => { set("host", e.target.value); }}
                    placeholder="10.0.0.4"
                  />
                </Field>
                <Field label={t("form.porta")} htmlFor="port" hint={t("form.portaAjuda")}>
                  <Input
                    id="port"
                    type="number"
                    required
                    mono
                    min={1}
                    max={65535}
                    value={draft.port}
                    onChange={(e) => { set("port", Number(e.target.value)); }}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("form.database")} htmlFor="database">
                  <Input
                    id="database"
                    required
                    mono
                    value={draft.database}
                    onChange={(e) => { set("database", e.target.value); }}
                  />
                </Field>
                <Field label={t("form.usuario")} htmlFor="username">
                  <Input
                    id="username"
                    required
                    mono
                    value={draft.username}
                    onChange={(e) => { set("username", e.target.value); }}
                  />
                </Field>
              </div>

              <Field
                label={t("form.senha")}
                htmlFor="password"
                hint={isEdit ? t("form.senhaAjuda") : undefined}
              >
                <Input
                  id="password"
                  type="password"
                  required={!isEdit}
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) => { set("password", e.target.value); }}
                />
              </Field>

              <Field label={t("form.criptografia")} htmlFor="ssl" hint={sslHint}>
                <select
                  id="ssl"
                  value={draft.sslMode}
                  onChange={(e) => { set("sslMode", e.target.value as SslMode); }}
                  className="h-10 cursor-pointer rounded-[4px] border border-line bg-sunken px-3 text-sm text-ink transition-colors duration-150 hover:border-line-strong"
                >
                  {SSL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("form.timezone")} htmlFor="timezone" hint={t("form.timezoneAjuda")}>
                <Input
                  id="timezone"
                  required
                  mono
                  value={draft.timezone}
                  onChange={(e) => { set("timezone", e.target.value); }}
                />
              </Field>

              {/* Escrita: o estado perigoso, e o formulário diz o que ele custa. */}
              <div className="flex items-start justify-between gap-4 rounded-[6px] border border-line bg-sunken p-3">
                <div>
                  <label htmlFor="write" className="text-sm font-medium text-ink">
                    {t("form.permitirEscrita")}
                  </label>
                  <p className="mt-0.5 text-2xs text-subtle">
                    {t("form.permitirEscritaAjuda")}
                  </p>
                </div>
                <Switch.Root
                  id="write"
                  checked={draft.writeEnabled === true}
                  onCheckedChange={(checked) => { set("writeEnabled", checked); }}
                  className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-line bg-raised transition-colors duration-150 data-[state=checked]:border-amber data-[state=checked]:bg-amber"
                >
                  <Switch.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-muted transition-transform duration-150 data-[state=checked]:translate-x-6 data-[state=checked]:bg-accent-ink" />
                </Switch.Root>
              </div>

              {error !== null ? (
                <p role="alert" className="rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              ) : null}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  {t("comum.cancelar")}
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" loading={saving} loadingLabel={t("form.salvando")}>
                {isEdit ? t("form.salvarAlteracoes") : t("form.cadastrar")}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
