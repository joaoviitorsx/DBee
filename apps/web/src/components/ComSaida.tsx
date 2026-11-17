import { type HTMLAttributes, type ReactNode, useState } from "react";

/**
 * Mantém um painel montado enquanto a SAÍDA toca (ui-detalhes §3.2).
 *
 * Abrir e fechar precisam ser simétricos: sem isto o painel entra animado e
 * some seco, porque o pai desmonta na hora. Aqui `aberto=false` primeiro marca
 * `data-saindo` (o utilitário de movimento troca para a animação de saída, em
 * `--motion-fast` com `--ease-exit`) e só desmonta no `animationend` do
 * próprio nó. Sob reduced-motion a animação dura 0,01 ms e o evento chega
 * igual — a troca fica instantânea. O "estava aberto" é derivado durante o
 * render, não em efeito, para não pintar um quadro vazio.
 *
 * Mesmo contrato do `useSaidaAnimada` (diálogos Radix), para painéis que não
 * são diálogo: árvore recolhida, inspetor, visualizador, véus.
 */
export function ComSaida({
  aberto,
  children,
  ...props
}: { readonly aberto: boolean; readonly children?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const [montado, setMontado] = useState(aberto);
  if (aberto && !montado) setMontado(true);
  if (!montado) return null;
  return (
    <div
      {...props}
      data-saindo={aberto ? undefined : ""}
      onAnimationEnd={(e) => {
        props.onAnimationEnd?.(e);
        if (!aberto && e.target === e.currentTarget) setMontado(false);
      }}
    >
      {children}
    </div>
  );
}
