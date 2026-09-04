import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  /** Dica fica sob o rótulo, antes do erro — nunca dentro do placeholder. */
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint !== undefined && error === undefined ? (
        <p className="text-2xs text-subtle">{hint}</p>
      ) : null}
      {/* Erro junto do campo, não num bloco no topo do formulário. */}
      {error !== undefined ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-2xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
