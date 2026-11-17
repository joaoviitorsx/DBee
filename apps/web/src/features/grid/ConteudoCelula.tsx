import { Check, CornerDownLeft, Minus } from "lucide-react";

import { type Idioma, lerCelula } from "./celula.puro";

/**
 * O que a célula mostra (docs/ui-detalhes.md §4, §6.2). Só exibição: o botão
 * da célula mantém o valor bruto no `title`, na cópia e na edição (regra 10).
 *
 * Custo O(1) por célula visível — nada de estado, efeito ou medição aqui. A
 * única coisa memoizada é o resumo de JSON (cache em `celula.puro.ts`).
 */
export function ConteudoCelula({
  valor,
  tipo,
  idioma,
}: {
  readonly valor: string;
  readonly tipo: string;
  readonly idioma: Idioma;
}) {
  const l = lerCelula(valor, tipo, idioma);
  switch (l.tipo) {
    case "bool":
      // Glifo + texto oculto para leitor de tela; t/f em mono era o pior caso
      // de leitura do grid.
      return l.valor ? (
        <span className="inline-flex items-center text-ok">
          <Check aria-hidden className="h-3.5 w-3.5" />
          <span className="sr-only">true</span>
        </span>
      ) : (
        <span className="inline-flex items-center text-subtle">
          <Minus aria-hidden className="h-3.5 w-3.5" />
          <span className="sr-only">false</span>
        </span>
      );
    case "data":
      return (
        <>
          {l.principal}
          {l.resto !== "" ? <span className="text-subtle">{l.resto}</span> : null}
        </>
      );
    case "json":
      return (
        <>
          {l.resumo !== null ? <span className="mr-1.5 text-info">{l.resumo}</span> : null}
          {l.texto}
        </>
      );
    case "array":
      return (
        <>
          {l.itens !== null ? <span className="mr-1.5 text-info">[{l.itens}]</span> : null}
          {l.texto}
        </>
      );
    case "uuid":
      return <>{l.curto}</>;
    case "bytea":
      return (
        <>
          <span className="mr-1.5 text-info">{l.tamanho}</span>
          <span className="text-subtle">{l.inicio}…</span>
        </>
      );
    case "numero":
      return <>{l.texto}</>;
    case "texto":
      return (
        <>
          {/*
            Espaço nas bordas vira `·` apagado: a diferença entre "abc" e
            "abc " é exatamente o bug que a pessoa está caçando. O marcador é
            só pintura — a cópia leva o valor bruto.
          */}
          {l.espacosInicio > 0 ? <Espacos n={l.espacosInicio} /> : null}
          {l.texto.slice(l.espacosInicio, l.texto.length - (l.linhasExtras === 0 ? l.espacosFim : 0))}
          {l.linhasExtras === 0 && l.espacosFim > 0 ? <Espacos n={l.espacosFim} /> : null}
          {l.linhasExtras > 0 ? (
            <span
              className="ml-1.5 inline-flex items-center gap-0.5 text-subtle"
              title={`+${String(l.linhasExtras)}`}
            >
              <CornerDownLeft aria-hidden className="h-3 w-3" />
              {l.linhasExtras}
            </span>
          ) : null}
        </>
      );
  }
}

function Espacos({ n }: { readonly n: number }) {
  return (
    <span aria-hidden className="text-subtle/70">
      {"·".repeat(Math.min(n, 8))}
    </span>
  );
}
