import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import type { Connection, CreateConnection, SslMode } from "@dbee/shared";
import { X } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { Button, Field, Input } from "../../components/ui";
import { cn } from "../../lib/cn";

/** Rótulos honestos: o que cada modo garante de fato (ADR 003). */
const SSL_OPTIONS: readonly { value: SslMode; label: string; hint: string }[] = [
  { value: "disable", label: "Desativado", hint: "Texto claro. Use em rede privada." },
  {
    value: "require",
    label: "Exigir TLS",
    hint: "Criptografa, mas não autentica o servidor — não protege contra interceptação ativa.",
  },
  {
    value: "verify-full",
    label: "Exigir e verificar",
    hint: "Criptografa e valida o certificado e o hostname. O único que autentica o servidor.",
  },
];

const TAGS: readonly { color: string; name: string }[] = [
  { color: "#E5484D", name: "Vermelho" },
  { color: "#F5A623", name: "Âmbar" },
  { color: "#5FA777", name: "Verde" },
  { color: "#5B8FF9", name: "Azul" },
  { color: "#A78BFA", name: "Roxo" },
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

  const set = <K extends keyof ConnectionDraft>(field: K, value: ConnectionDraft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit: NonNullable<ComponentProps<"form">["onSubmit"]> = (event) => {
    event.preventDefault();
    onSubmit(draft);
  };

  const isEdit = editing !== null;
  const sslHint = SSL_OPTIONS.find((o) => o.value === draft.sslMode)?.hint;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col",
            "border-l border-line bg-surface shadow-[-16px_0_40px_rgba(0,0,0,.45)]",
          )}
        >
          <header className="flex items-center justify-between border-b border-line px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-ink">
                {isEdit ? "Editar conexão" : "Nova conexão"}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                {isEdit
                  ? "Deixe a senha em branco para manter a atual."
                  : "A senha é cifrada antes de ir para o disco."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Fechar">
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <Field label="Nome" htmlFor="name" hint="Como você reconhece este banco.">
                <Input
                  id="name"
                  required
                  autoFocus
                  value={draft.name}
                  onChange={(e) => { set("name", e.target.value); }}
                  placeholder="Produção Assertivus"
                />
              </Field>

              <div>
                <span className="text-xs font-medium text-muted">Tag</span>
                <div className="mt-1.5 flex items-center gap-2">
                  {TAGS.map((tag) => (
                    <button
                      key={tag.color}
                      type="button"
                      aria-label={tag.name}
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
                    {draft.color === null ? "Sem tag" : "Vermelho costuma marcar produção"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <Field label="Host" htmlFor="host">
                  <Input
                    id="host"
                    required
                    mono
                    value={draft.host}
                    onChange={(e) => { set("host", e.target.value); }}
                    placeholder="10.0.0.4"
                  />
                </Field>
                <Field label="Porta" htmlFor="port" hint="Nunca o PgBouncer.">
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
                <Field label="Database" htmlFor="database">
                  <Input
                    id="database"
                    required
                    mono
                    value={draft.database}
                    onChange={(e) => { set("database", e.target.value); }}
                  />
                </Field>
                <Field label="Usuário" htmlFor="username">
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
                label="Senha"
                htmlFor="password"
                hint={isEdit ? "Em branco mantém a senha atual." : undefined}
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

              <Field label="Criptografia" htmlFor="ssl" hint={sslHint}>
                <select
                  id="ssl"
                  value={draft.sslMode}
                  onChange={(e) => { set("sslMode", e.target.value as SslMode); }}
                  className="h-10 cursor-pointer rounded-[4px] border border-line bg-sunken px-3 text-sm text-ink transition-colors duration-150 hover:border-line-strong"
                >
                  {SSL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Timezone" htmlFor="timezone" hint="Como timestamptz aparece na grade.">
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
                    Permitir escrita
                  </label>
                  <p className="mt-0.5 text-2xs text-subtle">
                    Desligado, as queries rodam em transação read-only e o Postgres recusa
                    qualquer alteração. Ligue só quando for alterar dado de propósito.
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
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" loading={saving} loadingLabel="Salvando…">
                {isEdit ? "Salvar alterações" : "Cadastrar conexão"}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
