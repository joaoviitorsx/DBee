import type { ResultColumn } from "@dbee/shared";
import { ArrowDown, ArrowUp, Braces, Check, CornerUpRight, Hand, KeyRound, Link2, Sigma } from "lucide-react";
import { toast } from "sonner";
import { ContextMenu, type MenuAnchor, type MenuSection } from "../../components/ContextMenu";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

import { useIdioma, useT } from "../../i18n";
import { ConteudoCelula } from "./ConteudoCelula";
import { type AlvoVisualizador, Visualizador } from "../visualizador/Visualizador";
import { temVisualizador } from "../visualizador/visual.puro";
import { gravarZebra, lerZebra } from "./zebra";
import { paraCsv, paraJson, paraMarkdown } from "./formatos.puro";
import { type AlvoRegistro, PainelRegistro } from "./PainelRegistro";
import { cn } from "../../lib/cn";
import { copiarTexto } from "../../lib/navegador";
import { dicaVista, marcarDicaVista } from "./dicaArrasto";
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
  /**
   * Editor **próprio** de uma célula: chamado no duplo clique ANTES do editor
   * inline. Se devolver `true`, a célula tem um editor dedicado (o modal
   * estruturado do Redis) e o inline não abre. É o que faz o duplo clique numa
   * coleção do Redis ir direto ao editor, sem passar por um input de texto que
   * não serve para JSON.
   */
  readonly abrirEditorCustom?: (linha: number, coluna: number) => boolean;
  /**
   * Nomes de coluna com FK — ganham a affordance de salto (navegação por FK).
   * O consumidor sabe quais têm FK (a tabela, pela introspecção); o grid só
   * pinta o gatilho.
   */
  readonly fkColunas?: ReadonlySet<string>;
  /** Clicar no salto de uma célula de coluna com FK chega aqui. */
  readonly onSaltoFk?: (linha: number, coluna: number) => void;
  /** Resumo da coluna (rota de estatística) — só onde há tabela por trás. */
  readonly onEstatistica?: (coluna: string, ancora: DOMRect) => void;
  /** INSERT gerado pelo servidor para as linhas dadas (o front não monta SQL). */
  readonly onCopiarInsert?: (linhas: readonly number[]) => Promise<string | null>;
  /** Filtro rápido a partir de uma célula (vira chip na aba Dados). */
  readonly onFiltrarValor?: (coluna: string, operador: "eq" | "ne" | "isNull", valor: string | null) => void;
  /** Colunas da chave primária — ganham o ícone de chave no cabeçalho. */
  readonly pkColunas?: ReadonlySet<string>;
  /** Célula recém-gravada: acende uma vez (`animate-salvo`) e apaga. */
  readonly celulaSalva?: { readonly linha: number; readonly coluna: number } | null;
  /** Célula com valor alterado e ainda não gravado: canto âmbar (é escrita, §3.5). */
  readonly celulaPendente?: { readonly linha: number; readonly coluna: number } | null;
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
  abrirEditorCustom,
  fkColunas,
  onSaltoFk,
  celulaSalva = null,
  celulaPendente = null,
  pkColunas,
  onEstatistica,
  onCopiarInsert,
  onFiltrarValor,
}: ResultGridProps) {
  const { locale } = useIdioma();
  const idioma = locale === "en" ? "en" : "pt";
  // Zebra: preferência por pessoa, desligada por padrão (ui-detalhes §4 #14).
  const [zebra, setZebra] = useState(lerZebra);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; linha: number; coluna: number } | null>(null);
  const [registro, setRegistro] = useState<AlvoRegistro | null>(null);
  // Visualizador de célula: UM overlay por grid, fora da lista virtual (§6).
  const [vendo, setVendo] = useState<AlvoVisualizador | null>(null);
  const abrirVisualizador = (linha: number, j: number, el: Element | null): void => {
    const valor = rows[linha]?.[j];
    const col = columns[j];
    if (valor === null || valor === undefined || valor === "" || col === undefined) return;
    const celulaEl = el ?? scroller.current?.querySelector(`[data-linha="${String(linha)}"][data-col="${String(j)}"]`) ?? null;
    setVendo({
      linha,
      coluna: col.name,
      tipo: col.dataTypeName,
      valor,
      ancora: celulaEl?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, 120, 0, 0),
    });
  };
  const scroller = useRef<HTMLDivElement>(null);
  // Célula em edição inline (duplo clique). `valor` é o rascunho do input.
  const [editando, setEditando] = useState<{ linha: number; coluna: number; valor: string } | null>(
    null,
  );
  // O conteúdo do cabeçalho, para acompanhar o scroll horizontal do corpo.
  const cabecalho = useRef<HTMLDivElement>(null);

  /*
   * A dica que ensina o gesto.
   *
   * **Só quando a grade transborda de verdade.** Uma dica de navegação
   * horizontal sobre uma tabela que cabe inteira na tela não é dica, é texto
   * mentindo — e treina a pessoa a ignorar o canto onde ela aparece. O
   * `ResizeObserver` mede o scroller e o conteúdo, porque a largura muda por
   * dois caminhos: a janela encolhendo e uma coluna sendo alargada no
   * cabeçalho.
   *
   * **E só enquanto ninguém a viu.** Depois de dispensada, `dica` é `false`
   * para sempre e o efeito sai na primeira linha: nenhum observer, nenhuma
   * medição, custo zero no componente mais caro do app.
   */
  const [dica, setDica] = useState(() => !dicaVista());
  const [transborda, setTransborda] = useState(false);

  const encerrarDica = (): void => {
    if (!dica) return;
    setDica(false);
    marcarDicaVista();
  };

  useEffect(() => {
    if (!dica) return;
    const el = scroller.current;
    if (el === null) return;
    const conteudo = el.firstElementChild;
    if (conteudo === null) return;

    // +1 absorve a fração de pixel que o zoom do navegador introduz: sem ela
    // uma tabela que cabe exatamente aparece como transbordando.
    const medir = (): void => { setTransborda(el.scrollWidth > el.clientWidth + 1); };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    ro.observe(conteudo);
    return () => { ro.disconnect(); };
  }, [dica, columns]);

  /*
   * Arrastar a grade para navegar (§5.4).
   *
   * ## Por que isto não conflita com a seleção
   *
   * A seleção de células é `onClick` e `Shift+onClick` — não é mousedown +
   * move. Então o botão esquerdo arrastando estava livre, e é o gesto que a
   * pessoa espera numa tabela larga: puxar o conteúdo em vez de mirar numa
   * barra de 8 px no rodapé.
   *
   * Um limiar de 4 px separa as duas intenções. Abaixo dele o gesto é clique e
   * a seleção acontece; acima, vira arrasto e o clique que o navegador dispara
   * ao soltar é **engolido** — senão soltar o arrasto mudaria a célula
   * selecionada, que é exatamente o tipo de efeito que ninguém pediu.
   *
   * ## Só mouse
   *
   * `pointerType !== "mouse"` sai fora: no toque o navegador já faz rolagem
   * com inércia, e sequestrar isso trocaria um gesto bom por um pior.
   *
   * ## Sem estado do React
   *
   * O deslocamento escreve `scrollLeft`/`scrollTop` direto no nó. Um `setState`
   * por `pointermove` re-renderizaria a grade inteira a cada quadro — no
   * caminho mais caro do app, medido em 6.400 botões de célula.
   */
  const arrasto = useRef<{
    x0: number;
    y0: number;
    esquerda: number;
    topo: number;
    passouLimiar: boolean;
  } | null>(null);
  /** Engole o `click` que o navegador dispara ao soltar um arrasto. */
  const engolirClique = useRef(false);

  const LIMIAR_ARRASTO = 4;

  const iniciarArrasto = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== "mouse") return;
    // Esquerdo ou do meio. O do meio é a convenção de pan e não seleciona nada.
    if (e.button !== 0 && e.button !== 1) return;
    const el = scroller.current;
    if (el === null) return;
    // O puxador de largura de coluna já parou a propagação; se algo mais vier a
    // querer o gesto, o `defaultPrevented` é o contrato.
    if (e.defaultPrevented) return;

    arrasto.current = {
      x0: e.clientX,
      y0: e.clientY,
      esquerda: el.scrollLeft,
      topo: el.scrollTop,
      passouLimiar: false,
    };
  };

  const moverArrasto = (e: React.PointerEvent<HTMLDivElement>): void => {
    const a = arrasto.current;
    const el = scroller.current;
    if (a === null || el === null) return;

    const dx = e.clientX - a.x0;
    const dy = e.clientY - a.y0;

    if (!a.passouLimiar) {
      if (Math.abs(dx) < LIMIAR_ARRASTO && Math.abs(dy) < LIMIAR_ARRASTO) return;
      a.passouLimiar = true;
      // Só aqui o cursor muda e a seleção de texto é suspensa: fazer isso no
      // `pointerdown` piscaria a cada clique simples.
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
      el.setPointerCapture(e.pointerId);
    }

    // O conteúdo segue o dedo: puxar para a esquerda revela o que está à
    // direita, então o scroll anda no sentido oposto ao ponteiro.
    el.scrollLeft = a.esquerda - dx;
    el.scrollTop = a.topo - dy;
  };

  const soltarArrasto = (e: React.PointerEvent<HTMLDivElement>): void => {
    const a = arrasto.current;
    const el = scroller.current;
    arrasto.current = null;
    if (a === null || el === null) return;
    if (!a.passouLimiar) return;

    el.style.cursor = "";
    el.style.userSelect = "";
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    engolirClique.current = true;
    // Arrastou uma vez: aprendeu. Inclusive o arrasto só vertical, que não
    // mexe no `scrollLeft` e por isso não passaria pelo `sincronizarScroll`.
    encerrarDica();
  };

  // Clique define a âncora, Shift+clique estende. É a convenção de planilha, e
  // o grid é lido como planilha.
  const [ancora, setAncora] = useState<Celula | null>(null);
  const [foco, setFoco] = useState<Celula | null>(null);
  const [copiado, setCopiado] = useState(false);
  const t = useT();
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
    if (c === null || s === null) return;
    // Sombra do cabeçalho só quando há linha escondida sob ele.
    c.parentElement?.toggleAttribute("data-rolado", s.scrollTop > 0);
    c.style.transform = `translateX(${String(-s.scrollLeft)}px)`;
    // Coluna fixa (§4 #8): o cabeçalho dela desfaz o deslocamento, e a sombra
    // à direita só aparece quando há coluna escondida sob ela.
    if (fixa) {
      const primeiro = c.firstElementChild as HTMLElement | null;
      if (primeiro !== null) primeiro.style.transform = `translateX(${String(s.scrollLeft)}px)`;
    }
    c.parentElement?.parentElement?.toggleAttribute("data-rolado-x", s.scrollLeft > 0);
    // Andou na horizontal por qualquer meio — barra, Shift+roda, teclado — e a
    // dica perdeu a função: quem chegou aqui já sabe navegar.
    if (s.scrollLeft > 0) encerrarDica();
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

  /**
   * Autoajuste por duplo-clique na alça (ui-detalhes §4 #7). Mede só o que
   * está no DOM — as células visíveis e o cabeçalho —, nunca o dataset: o grid
   * é virtualizado e medir 100k linhas travaria a aba. Teto de 480 px.
   */
  const autoajustar = (nome: string, j: number): void => {
    const corpo = scroller.current;
    const cab = cabecalho.current?.children[j] as HTMLElement | undefined;
    let maior = (cab?.firstElementChild as HTMLElement | null)?.scrollWidth ?? 0;
    corpo?.querySelectorAll<HTMLElement>(`[data-col="${String(j)}"]`).forEach((el) => {
      maior = Math.max(maior, el.scrollWidth);
    });
    const largura = Math.min(480, Math.max(64, maior + 2));
    setLarguras((atual) => new Map(atual).set(nome, largura));
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
  /*
   * PK fixa à esquerda (§4 #8) quando ela é a primeira coluna — o caso comum.
   * `position: sticky` dentro da linha virtual: a linha tem a largura total do
   * conteúdo, então a célula gruda no scroller sem sair da virtualização. PK
   * no meio da tabela não é movida: reordenar colunas mudaria o que se copia.
   */
  const fixa = columns[0] !== undefined && pkColunas?.has(columns[0].name) === true;
  const SOMBRA_FIXA = "group-data-[rolado-x]/grid:shadow-[1px_0_0_var(--color-line-strong),6px_0_8px_-4px_rgb(0_0_0/.55)]";
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
    /*
     * `copiarTexto`, e não `navigator.clipboard` direto.
     *
     * O DBee é alcançado pelo IP da tailnet, em `http://`, que **não é contexto
     * seguro** — e sem ele `navigator.clipboard` é `undefined`. O Ctrl+C não
     * copiava nada e ainda estourava no console; a grade parecia não ter a
     * função, quando a função existia e o ambiente é que a escondia. Ver
     * `lib/navegador.ts`.
     *
     * O "copiado" só acende quando copiou de verdade: dizer que copiou sem ter
     * copiado é pior que não dizer nada, porque a pessoa vai colar o conteúdo
     * antigo sem desconfiar.
     */
    const f = faixa;
    void copiarTexto(recorteTsv(rows, f)).then((ok) => {
      if (!ok) return;
      setCopiado(true);
      const { linhas, colunas } = contaCelulas(f);
      toast(t("grid.celulasCopiadas", { n: String(linhas * colunas) }));
      piscarFaixa(f);
    });
  };

  /**
   * A faixa copiada pisca uma vez (§3.5): opacidade 1→0,6→1 em `base`. Pela
   * Web Animations API nas células já no DOM — nada de estado React por
   * célula, e o que está fora da janela virtual não existe para piscar.
   */
  const piscarFaixa = (f: NonNullable<typeof faixa>): void => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    scroller.current?.querySelectorAll<HTMLElement>("[data-linha]").forEach((el) => {
      if (dentro(f, Number(el.dataset["linha"]), Number(el.dataset["col"]))) {
        el.animate([{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
      }
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

  /** Itens do menu de contexto do grid (§6.3). Cópias levam o valor bruto. */
  const secoesDoMenu = (linha: number, coluna: number): MenuSection[] => {
    const f = faixa ?? { linha0: linha, linha1: linha, coluna0: coluna, coluna1: coluna };
    const nomes = columns.slice(f.coluna0, f.coluna1 + 1).map((c) => c.name);
    const recorte = rows.slice(f.linha0, f.linha1 + 1).map((l) => l.slice(f.coluna0, f.coluna1 + 1));
    const n = recorte.length;
    const valor = rows[linha]?.[coluna] ?? null;
    const nome = columns[coluna]?.name ?? "";
    const copiar = (texto: string, formato: string): void => {
      void copiarTexto(texto).then((ok) => {
        toast(ok ? t("gridMenu.copiado", { n: String(n), f: formato }) : t("visualizador.copiaFalhou"));
      });
    };
    const secoes: MenuSection[] = [
      {
        items: [
          { id: "valor", label: t("gridMenu.copiarValor"), disabled: valor === null, onSelect: () => { copiar(valor ?? "", "texto"); } },
          { id: "tsv", label: t("gridMenu.copiarTsv"), onSelect: () => { copiar(recorteTsv(rows, f), "TSV"); } },
          { id: "csv", label: t("gridMenu.copiarCsv"), onSelect: () => { copiar(paraCsv(nomes, recorte), "CSV"); } },
          { id: "md", label: t("gridMenu.copiarMd"), onSelect: () => { copiar(paraMarkdown(nomes, recorte), "Markdown"); } },
          { id: "json", label: t("gridMenu.copiarJson"), onSelect: () => { copiar(paraJson(nomes, recorte), "JSON"); } },
          ...(onCopiarInsert !== undefined
            ? [{
                id: "insert",
                label: t("gridMenu.copiarInsert"),
                onSelect: () => {
                  const idx = Array.from({ length: n }, (_, k) => f.linha0 + k);
                  void onCopiarInsert(idx).then((sql) => {
                    if (sql === null) toast(t("gridMenu.insertFalhou"));
                    else copiar(sql, "INSERT");
                  });
                },
              }]
            : []),
        ],
      },
      {
        items: [
          {
            id: "ver",
            label: t("gridMenu.abrirVisualizador"),
            disabled: valor === null || valor === "",
            onSelect: () => { abrirVisualizador(linha, coluna, null); },
          },
          { id: "registro", label: t("gridMenu.registro"), onSelect: () => { setRegistro({ linhas: [linha] }); } },
          {
            id: "comparar",
            label: t("gridMenu.comparar"),
            // Duas linhas selecionadas (Shift+clique) — exatamente duas.
            disabled: f.linha1 - f.linha0 !== 1,
            onSelect: () => { setRegistro({ linhas: [f.linha0, f.linha1] }); },
          },
        ],
      },
    ];
    if (onFiltrarValor !== undefined) {
      secoes.push({
        items: [
          { id: "f-eq", label: t("gridMenu.filtrarIgual"), disabled: valor === null, onSelect: () => { onFiltrarValor(nome, "eq", valor); } },
          { id: "f-ne", label: t("gridMenu.filtrarDiferente"), disabled: valor === null, onSelect: () => { onFiltrarValor(nome, "ne", valor); } },
          { id: "f-null", label: t("gridMenu.filtrarNulo"), onSelect: () => { onFiltrarValor(nome, "isNull", null); } },
        ],
      });
    }
    secoes.push({
      items: [
        ...(onEstatistica !== undefined
          ? [{
              id: "stats",
              label: t("gridMenu.estatistica"),
              onSelect: () => {
                const cab = cabecalho.current?.children[coluna] as HTMLElement | undefined;
                onEstatistica(nome, cab?.getBoundingClientRect() ?? new DOMRect(menu?.anchor.x ?? 0, menu?.anchor.y ?? 0, 0, 0));
              },
            }]
          : []),
        {
          id: "zebra",
          label: t("gridMenu.zebra"),
          // Item de alternância: o check ocupa a coluna do ícone, ligado ou não.
          icon: <Check aria-hidden className={cn("h-3.5 w-3.5", zebra ? "text-ink" : "invisible")} />,
          onSelect: () => { gravarZebra(!zebra); setZebra(!zebra); },
        },
      ],
    });
    return secoes;
  };

  if (columns.length === 0) {
    return <p className="px-4 py-6 text-xs text-subtle">Sem colunas para mostrar.</p>;
  }

  return (
    <div className="group/grid relative flex h-full min-h-0 flex-col" onKeyDown={copiar}>
      {/* Cabeçalho fora do scroller vertical: fica fixo verticalmente, e
          acompanha o scroll horizontal do corpo por `transform`. */}
      <div className="relative z-[1] shrink-0 overflow-hidden border-b border-line bg-surface transition-shadow duration-(--motion-fast) data-[rolado]:shadow-[0_4px_8px_-6px_rgb(0_0_0/.45)]">
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
                    ativa ? "text-info" : "text-ink",
                  )}
                >
                  {/*
                    * A seta só aparece na coluna ordenada. Um ícone apagado em
                    * toda coluna transformaria o cabeçalho num campo de setas e
                    * a ordenada deixaria de saltar.
                    */}
                  {ativa ? (
                    // `key` pela direção: inverter remonta a seta e ela entra
                    // de novo em `fast`, o retorno de que o clique pegou.
                    sortDirection === "asc" ? (
                      <ArrowUp key="asc" aria-hidden className="motion-pop h-3 w-3 shrink-0" />
                    ) : (
                      <ArrowDown key="desc" aria-hidden className="motion-pop h-3 w-3 shrink-0" />
                    )
                  ) : null}
                  {pkColunas?.has(c.name) === true ? (
                    <KeyRound aria-label="chave primária" className="h-3 w-3 shrink-0 text-info" />
                  ) : null}
                  {fkColunas?.has(c.name) === true || (c.origin?.references ?? null) !== null ? (
                    <span
                      className="inline-flex shrink-0"
                      title={
                        c.origin?.references != null
                          ? `→ ${c.origin.references.schema}.${c.origin.references.table}.${c.origin.references.column}`
                          : "chave estrangeira"
                      }
                    >
                      <Link2 aria-label="chave estrangeira" className="h-3 w-3 text-info" />
                    </span>
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
              /*
               * O foco tinha o **mesmo fundo do hover** e o outline removido:
               * medido, o cabeçalho focado ficava a `1,09:1` do vizinho, contra
               * os 3:1 que o §9 pede para elemento de UI. Quem navega por
               * teclado não via onde estava. O anel âmbar volta — "foco visível
               * é inegociável" (§6).
               */
              ordenavel &&
                "cursor-pointer transition-colors duration-(--motion-fast) hover:bg-raised focus-visible:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
              ativa && "bg-raised",
            );

            return (
              <div
                key={`${c.name}-${String(i)}`}
                className={cn("group/cab relative shrink-0", fixa && i === 0 && cn("z-[2] bg-surface", SOMBRA_FIXA))}
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

                {onEstatistica !== undefined ? (
                  // Resumo da coluna no hover do cabeçalho (§6.3): um gesto,
                  // sem competir com o clique que ordena.
                  <button
                    type="button"
                    aria-label={`${t("stats.abrir")}: ${c.name}`}
                    title={t("stats.abrir")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEstatistica(c.name, (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect());
                    }}
                    className="press absolute right-2 top-1.5 z-10 hidden h-5 w-5 cursor-pointer items-center justify-center rounded-[4px] bg-overlay text-subtle hover:text-ink focus-visible:flex group-hover/cab:flex"
                  >
                    <Sigma aria-hidden className="h-3 w-3" />
                  </button>
                ) : null}
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
                  // Duplo-clique ajusta à largura do conteúdo visível.
                  onDoubleClick={(e) => { e.stopPropagation(); autoajustar(c.name, i); }}
                  className="absolute inset-y-0 right-0 z-10 w-1.5 translate-x-1/2 cursor-col-resize touch-none transition-colors duration-(--motion-fast) hover:bg-info/40"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/*
        A dica vive no canto **oposto** ao selo de seleção, e sai de cena
        quando há seleção: a 320 px os dois lado a lado não cabem, e quem já
        clicou numa célula está trabalhando, não procurando como navegar.

        O gesto é só de mouse (ver `iniciarArrasto`), então o toque não pode
        recebê-lo: lá a rolagem com inércia já existe, e ensinar um gesto que
        o aparelho não tem é pior que não dizer nada.

        A regra esconde em `pointer: coarse` em vez de exigir `pointer: fine`
        de propósito. Ambiente que não sabe classificar o ponteiro responde
        `none` — foi o que o Chrome headless devolveu ao verificar esta tela —
        e exigir `fine` esconderia a dica de quem tem mouse. Escondendo pelo
        toque, o desconhecido cai no lado que ainda funciona.
      */}
      {dica && transborda && faixa === null ? (
        <div className="pointer-events-none absolute bottom-2 left-3 z-10 flex items-center gap-1.5 rounded-[4px] border border-line bg-overlay px-2 py-1 text-2xs text-muted shadow-sm [@media(pointer:coarse)]:hidden">
          <Hand aria-hidden className="h-3 w-3 shrink-0 text-info" />
          {t("grid.dicaArrasto")}
        </div>
      ) : null}

      {faixa !== null ? (
        <div className="pointer-events-none absolute bottom-2 right-3 z-10 rounded-[4px] border border-line bg-overlay px-2 py-1 text-2xs text-muted shadow-sm">
          {copiado ? (
            <span className="text-ok">copiado como TSV</span>
          ) : (
            <>
              {t("grid.selecionado", {
                linhas: String(contaCelulas(faixa).linhas),
                colunas: String(contaCelulas(faixa).colunas),
              })}{" · "}
              {t("grid.copiaTsv")}
            </>
          )}
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={sincronizarScroll}
        onPointerDown={iniciarArrasto}
        onPointerMove={moverArrasto}
        onPointerUp={soltarArrasto}
        onPointerCancel={soltarArrasto}
        onContextMenu={(e) => {
          const el = (e.target as Element).closest<HTMLElement>("[data-linha]");
          if (el === null) return;
          e.preventDefault();
          const linha = Number(el.dataset["linha"]);
          const coluna = Number(el.dataset["col"]);
          // Botão direito fora da seleção move a seleção para a célula, como
          // em planilha; dentro dela, preserva a faixa.
          if (!dentro(faixa, linha, coluna)) {
            setAncora({ linha, coluna });
            setFoco({ linha, coluna });
          }
          setMenu({ anchor: { x: e.clientX, y: e.clientY }, linha, coluna });
        }}
        // Fase de captura: chega antes do `onClick` da célula, que é quem
        // mudaria a seleção ao soltar o arrasto.
        onClickCapture={(e) => {
          if (!engolirClique.current) return;
          engolirClique.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        <div style={{ height: virtual.getTotalSize(), position: "relative", minWidth: "max-content" }}>
          {itens.map((item) => {
            const linha = rows[item.index];
            if (linha === undefined) return null;

            return (
              <div
                key={item.key}
                className={cn(
                  "group/linha absolute left-0 flex border-b border-line/40 hover:bg-raised/70",
                  zebra && item.index % 2 === 1 && "bg-surface/60",
                )}
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
                        className="shrink-0 truncate border-r border-accent bg-sunken px-3 font-mono text-xs tabular-nums leading-[26px] text-ink outline-none ring-1 ring-accent"
                        style={{ width: larguraDe(columns[j]?.name ?? "") }}
                      />
                    );
                  }
                  // Coluna com FK e valor não nulo ganha o gatilho de salto.
                  // Valor nulo não referencia linha nenhuma, então não salta.
                  const temFk = (fkColunas?.has(columns[j]?.name ?? "") ?? false) && celula !== null;
                  return (
                  <div
                    key={j}
                    className={cn(
                      "group/cel relative shrink-0",
                      // Fixa precisa de fundo opaco, senão a coluna que passa
                      // por baixo aparece através dela.
                      fixa && j === 0 && cn("sticky left-0 z-[2] bg-surface group-hover/linha:bg-raised", SOMBRA_FIXA),
                    )}
                    style={{ width: larguraDe(columns[j]?.name ?? "") }}
                  >
                  <button
                    type="button"
                    onDoubleClick={(e) => {
                      // Editor próprio primeiro (modal do Redis); se ele
                      // assumir a célula, o inline não abre.
                      if (abrirEditorCustom?.(item.index, j) === true) return;
                      if (editavel) {
                        setEditando({ linha: item.index, coluna: j, valor: celula ?? "" });
                        return;
                      }
                      // Sem edição, o duplo-clique abre o visualizador (§6.1).
                      abrirVisualizador(item.index, j, e.currentTarget);
                    }}
                    onKeyDown={(e) => {
                      // Enter/Espaço com a célula em foco abrem o visualizador.
                      if ((e.key === "Enter" || e.key === " ") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        abrirVisualizador(item.index, j, e.currentTarget);
                      }
                    }}
                    onClick={(e) => {
                      // Shift estende a partir da âncora; clique simples a move.
                      if (e.shiftKey && ancora !== null) setFoco({ linha: item.index, coluna: j });
                      else {
                        setAncora({ linha: item.index, coluna: j });
                        setFoco({ linha: item.index, coluna: j });
                      }
                      onCellClick?.(item.index, j);
                    }}
                    title={
                      celulaPendente?.linha === item.index && celulaPendente.coluna === j
                        ? t("grid.valorOriginal", { v: celula ?? "NULL" })
                        : (celula ?? undefined)
                    }
                    data-col={j}
                    data-linha={item.index}
                    className={cn(
                      "block w-full cursor-default truncate border-r border-line/40 px-3 text-left font-mono text-xs tabular-nums leading-[26px]",
                      alinhamentos[j] === "right" && "text-right",
                      celula === null ? "text-subtle" : "text-ink",
                      // Faixa de seleção: tinta fraca, não o âmbar sólido do
                      // selo — seleção é interação, selo é informação.
                      dentro(faixa, item.index, j) && "bg-info/15 text-ink",
                      celulaSalva?.linha === item.index && celulaSalva.coluna === j && "animate-salvo",
                    )}
                  >
                    {/*
                      * Três coisas que precisam ser distinguíveis a olho
                      * (§11.14): SQL NULL, string vazia, e a string "NULL" —
                      * que aparece de verdade dentro da representação textual
                      * de um array, como em `{a,NULL,b}`.
                      */}
                    {/*
                      * Sem `opacity-70`.
                      *
                      * Ela empilhava sobre o `text-subtle` da célula e o
                      * resultado renderizado media **2,51:1 no escuro e 2,11:1
                      * no claro** — abaixo do piso que o próprio
                      * `design-system.md` §1.5 afirma para o token. A suíte de
                      * contraste não pegava porque mede o token sobre
                      * `surface`, e não vê nem a opacidade nem o fundo
                      * `sunken` do grid.
                      *
                      * Num grid fiscal, distinguir NULL de zero é exatamente a
                      * leitura que importa. O itálico já separa dos valores;
                      * a opacidade só apagava.
                      */}
                    {celula === null ? (
                      <span className="italic text-muted">{t("grid.nulo")}</span>
                    ) : celula === "" ? (
                      <span className="italic text-muted">{t("grid.vazio")}</span>
                    ) : (
                      <ConteudoCelula valor={celula} tipo={columns[j]?.dataTypeName ?? ""} idioma={idioma} />
                    )}
                  </button>
                  {celulaPendente?.linha === item.index && celulaPendente.coluna === j ? (
                    // Escrita pendente: triângulo âmbar de 4 px no canto (§3.5).
                    // Âmbar aqui é o sinal certo — é escrita ainda não gravada.
                    <span
                      aria-hidden
                      className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-amber"
                    />
                  ) : null}
                  {celula !== null && celula !== "" && temVisualizador(columns[j]?.dataTypeName ?? "", celula) ? (
                    // Gatilho de um gesto só (§6.1): aparece no hover, como o
                    // salto de FK. Clique simples na célula continua selecionando.
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={t("visualizador.abrir")}
                      title={t("visualizador.abrir")}
                      onClick={(e) => {
                        e.stopPropagation();
                        abrirVisualizador(item.index, j, e.currentTarget.parentElement);
                      }}
                      className={cn(
                        "absolute inset-y-0 z-10 hidden items-center rounded-l-[3px] border-l border-line bg-overlay px-1 text-info hover:bg-raised group-hover/cel:flex",
                        temFk ? "right-6" : "right-0",
                      )}
                    >
                      <Braces aria-hidden className="h-3 w-3" />
                    </button>
                  ) : null}
                  {temFk ? (
                    // Só no hover da célula: um ícone por célula-FK sempre visível
                    // viraria ruído. Fica sobre a borda direita, com fundo sólido
                    // para ser legível sobre qualquer tinta de seleção.
                    <button
                      type="button"
                      aria-label="Abrir tabela referenciada por esta linha"
                      title="Abrir a tabela referenciada, filtrada por esta linha"
                      onClick={(e) => { e.stopPropagation(); onSaltoFk?.(item.index, j); }}
                      className="absolute inset-y-0 right-0 z-10 hidden items-center rounded-l-[3px] border-l border-line bg-overlay pl-1 pr-1.5 text-info hover:bg-raised group-hover/cel:flex"
                    >
                      <CornerUpRight aria-hidden className="h-3 w-3" />
                    </button>
                  ) : null}
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {menu !== null ? (
        <ContextMenu
          anchor={menu.anchor}
          title={columns[menu.coluna]?.name ?? ""}
          sections={secoesDoMenu(menu.linha, menu.coluna)}
          onClose={() => { setMenu(null); }}
        />
      ) : null}
      <PainelRegistro alvo={registro} columns={columns} rows={rows} onFechar={() => { setRegistro(null); }} />
      <Visualizador
        alvo={vendo}
        onFechar={() => { setVendo(null); }}
        onMoverLinha={(d) => {
          if (vendo === null) return;
          const j = columns.findIndex((c) => c.name === vendo.coluna);
          const alvoLinha = vendo.linha + d;
          if (alvoLinha < 0 || alvoLinha >= rows.length) return;
          virtual.scrollToIndex(alvoLinha, { align: "auto" });
          abrirVisualizador(alvoLinha, j, null);
        }}
      />
    </div>
  );
}
