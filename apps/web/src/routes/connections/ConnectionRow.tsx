import type { Connection, TestConnectionResult } from "@dbee/shared";
import { Pencil, Plug, Trash2 } from "lucide-react";

import { Badge, Button } from "../../components/ui";
import { cn } from "../../lib/cn";

interface ConnectionRowProps {
  readonly connection: Connection;
  readonly result: TestConnectionResult | undefined;
  readonly testing: boolean;
  readonly onTest: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}

/**
 * A linha veste o próprio risco (docs/design-system.md §5).
 *
 * Hierarquia deliberada: a tag de cor é a primeira coisa que o olho pega, o
 * selo de escrita só existe quando há risco, e as coordenadas ficam em mono
 * porque endereço de banco se lê comparando coluna.
 */
export function ConnectionRow({
  connection,
  result,
  testing,
  onTest,
  onEdit,
  onDelete,
}: ConnectionRowProps) {
  const coordinates = `${connection.username}@${connection.host}:${connection.port}/${connection.database}`;

  return (
    <li className="group relative flex items-center gap-4 py-3 pl-5 pr-3 transition-colors duration-150 hover:bg-surface">
      {/*
        Tag de cor: a única cor saturada da linha, e é dado do usuário
        (vermelho = produção, por convenção dele). Decorativa para leitores de
        tela — o significado já está no nome, cor nunca é o único portador.
      */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 left-0 w-[3px] rounded-full",
          connection.color === null && "bg-line-strong",
          // Enquanto testa, a tag respira: o elemento que já significa "esta
          // conexão" é o que se move, em vez de um spinner à parte.
          testing && "animate-probe",
        )}
        style={connection.color === null ? undefined : { backgroundColor: connection.color }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-semibold text-ink">{connection.name}</h3>
          {connection.writeEnabled ? <Badge tone="write">Escrita</Badge> : null}
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-muted">
          {coordinates}
          <span className="text-subtle"> · {connection.timezone}</span>
        </p>
      </div>

      {/* Resultado do último teste: o erro do Postgres vai literal (CLAUDE.md). */}
      {result !== undefined && !testing ? (
        result.ok ? (
          <Badge tone="ok" className="animate-settle">
            Conectou · {result.durationMs} ms
          </Badge>
        ) : (
          <Badge tone="danger" className="animate-settle max-w-[22rem] truncate" title={result.message}>
            {result.code ?? "falhou"} · {result.message}
          </Badge>
        )
      ) : null}

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={onTest}
          loading={testing}
          loadingLabel="Testando…"
        >
          <Plug aria-hidden className="h-3.5 w-3.5" />
          Testar
        </Button>
        <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Editar ${connection.name}`}>
          <Pencil aria-hidden className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onDelete}
          aria-label={`Apagar ${connection.name}`}
          className="hover:text-danger"
        >
          <Trash2 aria-hidden className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}
