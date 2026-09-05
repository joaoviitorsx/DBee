import type { ResultColumn } from "@dbee/shared";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { type Celula, contaCelulas, dentro, faixaEntre, recorteTsv } from "./selecao";

/**
 * Grid virtualizado (CLAUDE.md regra 11).
 *
 * Nenhum `.map()` direto sobre as linhas do resultado: o virtualizador
 * renderiza só a janela visível. 100k linhas não podem travar a aba (§2.5), e
 * uma `<table>` crua com 100k `<tr>` trava.
 */

/** Tipos que se leem alinhados à direita, comparando dígito com dígito. */
const NUMERICOS = new Set([
  "smallint", "integer", "bigint", "numeric", "real", "double precision", "money",
  "smallserial", "serial", "bigserial",
]);

/**
 * Alinhamento pelo tipo real da coluna.
 *
 * Número alinhado à esquerda obriga a contar dígitos para comparar duas linhas.
 * O tipo vem de `format_type`, então `numeric(12,2)` precisa perder o
 * parâmetro antes da comparação.
 */
function alinhamento(dataTypeName: string): "left" | "right" {
  const base = dataTypeName.replace(/\(.*/, "").trim();
  return NUMERICOS.has(base) ? "right" : "left";
}

const ALTURA_LINHA = 26;
const LARGURA_PADRAO = 200;

export interface ResultGridProps {
  readonly columns: readonly ResultColumn[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly onCellClick?: (linha: number, coluna: number) => void;
  /** Chamado quando a rolagem chega perto do fim — paginação por keyset. */
  readonly onReachEnd?: () => void;
  readonly loadingMore?: boolean;
  /**
   * Ordenação **no cabeçalho**, onde o nome da coluna já está.
   *
   * Havia uma segunda faixa de nomes acima do grid só para ordenar: duas
   * listas das mesmas colunas, uma clicável e outra não, e a pessoa tinha de
   * descobrir qual era qual. O cabeçalho é o lugar onde se espera clicar para
   * ordenar — é a convenção de planilha, e o grid é lido como planilha.
   *
   * Ausente quando não há ordenação de servidor: o resultado de uma consulta
   * arbitrária tem a ordem que o SQL pediu, e fingir que dá para reordenar
   * seria a tela prometendo o que a rota não faz.
   */
  readonly sortColumn?: string | null;
  readonly sortDirection?: "asc" | "desc";
  readonly onSort?: (coluna: string) => void;
  /**
   * Liga a edição de célula por duplo clique (v0.2). Só quando a conexão
   * permite escrita e a tabela tem PK — quem decide é o consumidor.
   */
  readonly editavel?: boolean;
  /** Duplo clique numa célula, editado e confirmado com Enter, chega aqui. */
  readonly onEditCell?: (linha: number, coluna: number, valor: string) => void;
}

export function ResultGrid({
  columns,
  rows,
  onCellClick,
  onReachEnd,
  loadingMore = false,
  sortColumn = null,
  sortDirection = "asc",
  onSort,
  editavel = false,
  onEditCell,
}: ResultGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  // Célula em edição inline (duplo clique). `valor` é o rascunho do input.
  const [editando, setEditando] = useState<{ linha: number; coluna: number; valor: string } | null>(
    null,
  );
  // O conteúdo do cabeçalho, para acompanhar o scroll horizontal do corpo.
  const cabecalho = useRef<HTMLDivElement>(null);

  // Clique define a âncora, Shift+clique estende. É a convenção de planilha, e
  // o grid é lido como planilha.
  const [ancora, setAncora] = useState<Celula | null>(null);
  const [foco, setFoco] = useState<Celula | null>(null);
  const [copiado, setCopiado] = useState(false);
  const faixa = faixaEntre(ancora, foco);

  /**
   * Largura por coluna, ajustável arrastando a borda do cabeçalho.
   *
   * Guardada num `Map` por nome de coluna. `Map`, não objeto literal: uma coluna
   * chamada `__proto__` ou `constructor` num objeto devolveria o protótipo em
   * vez de `undefined`, e a largura sairia um objeto no `style`. `Map` trata
   * qualquer string como chave comum.
   *
   * O `Map` é **estado**, e é resetado quando as colunas mudam de identidade
   * (ver o efeito abaixo): sem isso a largura de `id` ajustada num resultado
   * vazava para a coluna `id` de outra tabela reusando o mesmo componente.
   */
  const [larguras, setLarguras] = useState<Map<string, number>>(() => new Map());
  const larguraDe = (nome: string): number => larguras.get(nome) ?? LARGURA_PADRAO;

  /**
   * Seleção e larguras não sobrevivem à troca de resultado.
   *
   * O `ResultGrid` de um statement é reconciliado na mesma posição quando a
   * query roda de novo — o React não o remonta. Sem este reset, a seleção
   * apontava índices do resultado antigo sobre as linhas do novo, e o `Ctrl+C`
   * copiava célula trocada **em silêncio**: a tela afirmando um dado que não é
   * o que está nela.
   *
   * O reset é feito **durante o render** guardando a referência anterior de
   * `columns`, não num efeito: é o padrão do React para "ajustar estado quando
   * a prop muda", sem o commit extra (e a cascata) de um `setState` em efeito.
   * `columns` é estável ao paginar — a seleção sobrevive à rolagem — e muda a
   * cada nova query.
   */
  const [colunasAnteriores, setColunasAnteriores] = useState(columns);
  if (columns !== colunasAnteriores) {
    setColunasAnteriores(columns);
    setAncora(null);
    setFoco(null);
    setCopiado(false);
    setLarguras(new Map());
  }

  /**
   * Cabeçalho acompanha o scroll horizontal do corpo.
   *
   * O cabeçalho vive **fora** do scroller vertical (senão rolaria para fora da
   * tela ao descer). O preço é que ele não anda sozinho no eixo horizontal —
   * sem isto, rolar para o lado desalinhava título e coluna, cada dado sob o
   * nome errado. Espelhar o `scrollLeft` por `transform` mantém os dois juntos
   * sem um segundo scroller.
   */
  const sincronizarScroll = (): void => {
    const c = cabecalho.current;
    const s = scroller.current;
    if (c !== null && s !== null) c.style.transform = `translateX(${String(-s.scrollLeft)}px)`;
  };

  const arrastoLargura = useRef<{ nome: string; x0: number; w0: number } | null>(null);
  const iniciarResize = (e: React.PointerEvent, nome: string): void => {
    e.preventDefault();
    e.stopPropagation();
    arrastoLargura.current = { nome, x0: e.clientX, w0: larguraDe(nome) };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const moverResize = (e: React.PointerEvent): void => {
    const a = arrastoLargura.current;
    if (a === null) return;
    // Mínimo de 64px: abaixo disso o nome da coluna some e o cabeçalho quebra.
    const largura = Math.max(64, a.w0 + (e.clientX - a.x0));
    setLarguras((atual) => new Map(atual).set(a.nome, largura));
  };
  const soltarResize = (e: React.PointerEvent): void => {
    if (arrastoLargura.current === null) return;
    arrastoLargura.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  // O React Compiler pula a memoização deste componente: o `useVirtualizer`
  // devolve funções que não podem ser memoizadas com segurança. É limitação
  // conhecida da biblioteca, não defeito daqui — o aviso do lint é esperado.
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ALTURA_LINHA,
    overscan: 12,
  });

  const itens = virtual.getVirtualItems();
  const alinhamentos = columns.map((c) => alinhamento(c.dataTypeName));

  /**
   * Dispara a próxima página quando faltam poucas linhas para o fim.
   *
   * Num efeito, não no corpo do render: chamar de volta durante a renderização
   * é efeito colateral em render — a mesma classe de problema que o
   * `react-hooks` recusa em ref, e que aqui provocaria uma busca por quadro
   * enquanto a resposta não chega.
   */
  /**
   * Ctrl+C copia a seleção como TSV.
   *
   * No contêiner e não em cada célula: o evento sobe do botão focado, e um
   * ouvinte por célula seria um por linha visível a cada rolagem.
   */
  const copiar = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
    if (faixa === null) return;
    e.preventDefault();
    void navigator.clipboard.writeText(recorteTsv(rows, faixa)).then(() => {
      setCopiado(true);
    });
  };

  // Some sozinho: aviso de confirmação que fica é ruído.
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => { setCopiado(false); }, 1600);
    return () => { clearTimeout(t); };
  }, [copiado]);

  const ultimoVisivel = itens.at(-1)?.index ?? -1;
  useEffect(() => {
    if (onReachEnd === undefined || loadingMore || rows.length === 0) return;
    if (ultimoVisivel >= rows.length - 10) onReachEnd();
  }, [ultimoVisivel, rows.length, loadingMore, onReachEnd]);

  if (columns.length === 0) {
    return <p className="px-4 py-6 text-xs text-subtle">Sem colunas para mostrar.</p>;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" onKeyDown={copiar}>
      {/* Cabeçalho fora do scroller vertical: fica fixo verticalmente, e
          acompanha o scroll horizontal do corpo por `transform`. */}
      <div className="shrink-0 overflow-hidden border-b border-line bg-surface">
        <div ref={cabecalho} className="flex will-change-transform" style={{ minWidth: "max-content" }}>
          {columns.map((c, i) => {
            const ordenavel = onSort !== undefined;
            const ativa = sortColumn === c.name;
            const direita = alinhamentos[i] === "right";
            const largura = larguraDe(c.name);

            const conteudo = (
              <>
                <span
                  className={cn(
                    "flex items-center gap-1 truncate text-xs font-medium",
                    direita && "justify-end",
                    ativa ? "text-accent" : "text-ink",
                  )}
                >
                  {/*
                    * A seta só aparece na coluna ordenada. Um ícone apagado em
                    * toda coluna transformaria o cabeçalho num campo de setas e
                    * a ordenada deixaria de saltar.
                    */}
                  {ativa ? (
                    sortDirection === "asc" ? (
                      <ArrowUp aria-hidden className="h-3 w-3 shrink-0" />
                    ) : (
                      <ArrowDown aria-hidden className="h-3 w-3 shrink-0" />
                    )
                  ) : null}
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="block truncate font-mono text-2xs text-subtle">
                  {c.dataTypeName}
                </span>
              </>
            );

            const classe = cn(
              "h-full w-full border-r border-line px-3 py-1.5 text-left",
              direita && "text-right",
              ordenavel &&
                "cursor-pointer transition-colors duration-150 hover:bg-raised focus-visible:bg-raised focus-visible:outline-none",
              ativa && "bg-amber/[0.06]",
            );

            return (
              <div
                key={`${c.name}-${String(i)}`}
                className="relative shrink-0"
                style={{ width: largura }}
              >
                {ordenavel ? (
                  <button
                    type="button"
                    onClick={() => { onSort(c.name); }}
                    // `aria-sort` é o que um leitor de tela anuncia; o ícone é
                    // para quem enxerga, e os dois precisam dizer a mesma coisa.
                    aria-sort={ativa ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                    title={
                      ativa
                        ? `Ordenado por ${c.name} — clique para inverter`
                        : `Ordenar por ${c.name}`
                    }
                    className={classe}
                  >
                    {conteudo}
                  </button>
                ) : (
                  <div className={classe}>{conteudo}</div>
                )}

                {/*
                  * Alça de redimensionamento na borda direita.
                  *
                  * Fica FORA do botão (um botão não pode conter outro controle),
                  * sobreposta na borda. Arrastar muda a largura desta coluna;
                  * clicar sem arrastar não ordena, porque o `stopPropagation`
                  * segura o evento antes de chegar ao botão.
                  */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Largura da coluna ${c.name}`}
                  onPointerDown={(e) => { iniciarResize(e, c.name); }}
                  onPointerMove={moverResize}
                  onPointerUp={soltarResize}
                  className="absolute inset-y-0 right-0 z-10 w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-accent/40"
                />
              </div>
            );
          })}
        </div>
      </div>

      {faixa !== null ? (
        <div className="pointer-events-none absolute bottom-2 right-3 z-10 rounded-[4px] border border-line bg-overlay px-2 py-1 text-2xs text-muted shadow-sm">
          {copiado ? (
            <span className="text-ok">copiado como TSV</span>
          ) : (
            <>
              {contaCelulas(faixa).linhas} × {contaCelulas(faixa).colunas} selecionado ·{" "}
              <kbd className="font-mono text-subtle">Ctrl+C</kbd> copia como TSV
            </>
          )}
        </div>
      ) : null}

      <div ref={scroller} onScroll={sincronizarScroll} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtual.getTotalSize(), position: "relative", minWidth: "max-content" }}>
          {itens.map((item) => {
            const linha = rows[item.index];
            if (linha === undefined) return null;

            return (
              <div
                key={item.key}
                className="absolute left-0 flex border-b border-line/40 hover:bg-surface"
                style={{ top: 0, transform: `translateY(${String(item.start)}px)`, height: ALTURA_LINHA }}
              >
                {linha.map((celula, j) => {
                  const emEdicao =
                    editando !== null && editando.linha === item.index && editando.coluna === j;
                  if (emEdicao) {
                    return (
                      <input
                        key={j}
                        autoFocus
                        value={editando.valor}
                        onChange={(e) => {
                          setEditando({ linha: item.index, coluna: j, valor: e.target.value });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            onEditCell?.(item.index, j, editando.valor);
                            setEditando(null);
                          }
                          if (e.key === "Escape") setEditando(null);
                        }}
                        // Sai da edição sem aplicar — a confirmação é o modal do
                        // diff, não o blur; blur cancela, para não abrir modal à
                        // toa ao clicar fora.
                        onBlur={() => { setEditando(null); }}
                        className="shrink-0 truncate border-r border-accent bg-sunken px-3 font-mono text-xs leading-[26px] text-ink outline-none ring-1 ring-accent"
                        style={{ width: larguraDe(columns[j]?.name ?? "") }}
                      />
                    );
                  }
                  return (
                  <button
                    key={j}
                    type="button"
                    onDoubleClick={
                      editavel
                        ? () => { setEditando({ linha: item.index, coluna: j, valor: celula ?? "" }); }
                        : undefined
                    }
                    onClick={(e) => {
                      // Shift estende a partir da âncora; clique simples a move.
                      if (e.shiftKey && ancora !== null) setFoco({ linha: item.index, coluna: j });
                      else {
                        setAncora({ linha: item.index, coluna: j });
                        setFoco({ linha: item.index, coluna: j });
                      }
                      onCellClick?.(item.index, j);
                    }}
                    title={celula ?? undefined}
                    className={cn(
                      "shrink-0 cursor-default truncate border-r border-line/40 px-3 text-left font-mono text-xs leading-[26px]",
                      alinhamentos[j] === "right" && "text-right",
                      celula === null ? "text-subtle" : "text-ink",
                      // Faixa de seleção: tinta fraca, não o âmbar sólido do
                      // selo — seleção é interação, selo é informação.
                      dentro(faixa, item.index, j) && "bg-amber/12 text-ink",
                    )}
                    style={{ width: larguraDe(columns[j]?.name ?? "") }}
                  >
                    {/*
                      * Três coisas que precisam ser distinguíveis a olho
                      * (§11.14): SQL NULL, string vazia, e a string "NULL" —
                      * que aparece de verdade dentro da representação textual
                      * de um array, como em `{a,NULL,b}`.
                      */}
                    {celula === null ? (
                      <span className="italic opacity-70">NULL</span>
                    ) : celula === "" ? (
                      <span className="italic text-subtle opacity-70">vazio</span>
                    ) : (
                      celula
                    )}
                  </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
