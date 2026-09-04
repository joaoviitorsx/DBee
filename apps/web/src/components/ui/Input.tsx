import type { InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
  readonly mono?: boolean;
}

export function Input({ className, invalid = false, mono = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid}
      className={cn(
        "h-10 rounded-[4px] border bg-sunken px-3 text-sm text-ink",
        "placeholder:text-subtle transition-colors duration-150",
        "hover:border-line-strong",
        invalid ? "border-danger" : "border-line",
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
}
