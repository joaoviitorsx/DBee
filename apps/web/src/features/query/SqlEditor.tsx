import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { MySQL, PostgreSQL, SQLite, sql as sqlLang, type SQLDialect } from "@codemirror/lang-sql";
import { tags } from "@lezer/highlight";
import { Compartment, EditorSelection, EditorState, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, GutterMarker, gutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { acceptCompletion, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import type { DatabaseSchema } from "@dbee/shared";
import { splitStatements, type DialetoSql } from "@dbee/shared/puro";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import { construirCompletion } from "./completion";

/**
 * Editor SQL.
 *
 * O tema é escrito à mão em vez de importar um pronto: os tokens do design
 * system já definem a paleta, e um tema de terceiro traria uma segunda paleta
 * competindo com ela dentro do mesmo painel.
 */
const tema = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--color-sunken)",
      color: "var(--color-ink)",
      fontSize: "13px",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      caretColor: "var(--color-info)",
      padding: "12px 0",
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-sunken)",
      color: "var(--color-subtle)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--color-raised) 45%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-muted)" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--color-info)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      // Seleção em `info`: o âmbar é reservado ao modo escrita (ui-detalhes §3).
      backgroundColor: "color-mix(in oklab, var(--color-info) 30%, transparent)",
    },
    // Marca o statement que o Cmd+Enter vai rodar.
    ".cm-dbee-ativo": {
      backgroundColor: "color-mix(in oklab, var(--color-info) 7%, transparent)",
      borderLeft: "2px solid color-mix(in oklab, var(--color-info) 55%, transparent)",
    },
    /*
     * Erro com `position` (ui-detalhes §3.6): sublinhado ondulado `danger` no
     * token e um ponto no gutter da linha. Some ao editar o trecho (o campo
     * mapeia pelas mudanças e descarta quando o token é apagado).
     */
    ".cm-dbee-erro": {
      textDecoration: "underline wavy var(--color-danger)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
    },
    ".cm-dbee-gutter-erro": { width: "10px" },
    ".cm-dbee-gutter-erro .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center" },
    ".cm-dbee-ponto-erro": {
      width: "6px",
      height: "6px",
      borderRadius: "999px",
      backgroundColor: "var(--color-danger)",
    },

    /*
     * Autocomplete — dinâmico e polido (v0.2).
     *
     * O popup nasce com a mesma entrada encenada do resto do app (`dbee-settle`,
     * sobe e assenta), material de `overlay`, canto arredondado e sombra. A
     * opção selecionada ganha o leito âmbar (`accent-soft`) e a régua da marca;
     * o trecho que casa com o que foi digitado vem em âmbar — o olho pula direto
     * para o que importa. Ícone colorido por tipo (tabela/coluna/palavra-chave).
     */
    ".cm-tooltip.cm-tooltip-autocomplete": {
      border: "1px solid var(--color-line)",
      borderRadius: "8px",
      backgroundColor: "var(--color-overlay)",
      boxShadow: "0 12px 34px rgba(0,0,0,.34)",
      overflow: "hidden",
      animation: "dbee-settle 130ms var(--ease-enter)",
      transformOrigin: "top left",
    },
    ".cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
      maxHeight: "17rem",
    },
    ".cm-tooltip-autocomplete > ul > li": {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "3.5px 11px",
      lineHeight: "1.5",
      color: "var(--color-muted)",
      borderLeft: "2px solid transparent",
      transition: "background-color 90ms, color 90ms",
    },
    // Seleção da lista em neutro + régua `info`: âmbar é só do modo escrita.
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--color-raised)",
      color: "var(--color-ink)",
      borderLeftColor: "var(--color-info)",
    },
    ".cm-completionLabel": { color: "inherit" },
    ".cm-completionMatchedText": {
      color: "var(--color-info)",
      fontWeight: "700",
      textDecoration: "none",
    },
    ".cm-completionDetail": {
      marginLeft: "auto",
      paddingLeft: "14px",
      fontStyle: "normal",
      fontSize: "11px",
      color: "var(--color-subtle)",
    },
    ".cm-completionIcon": {
      boxSizing: "content-box",
      width: "1.1em",
      paddingRight: "0",
      textAlign: "center",
      opacity: "0.9",
      fontSize: "95%",
    },
    ".cm-completionIcon-table, .cm-completionIcon-keyword, .cm-completionIcon-class": {
      color: "var(--color-info)",
    },
    ".cm-completionIcon-property, .cm-completionIcon-variable": { color: "var(--color-ok)" },
    ".cm-completionIcon-type, .cm-completionIcon-enum": { color: "var(--color-muted)" },
  },
  { dark: true },
);

/**
 * Realce de sintaxe com os tokens do design system.
 *
 * Escrito à mão pela mesma razão do tema: um estilo pronto traria uma segunda
 * paleta competindo com a da marca dentro do editor. Aqui o âmbar marca a
 * palavra-chave — é o acento do produto, e ler SQL é achar o verbo.
 */
const realce = HighlightStyle.define([
  // Palavra-chave em `info`, não âmbar: âmbar significa escrita (design-system §1.4).
  { tag: tags.keyword, color: "var(--color-info)" },
  { tag: tags.operatorKeyword, color: "var(--color-info)" },
  { tag: tags.string, color: "var(--color-ok)" },
  { tag: tags.number, color: "var(--color-ok)" },
  { tag: tags.bool, color: "var(--color-ok)" },
  { tag: tags.null, color: "var(--color-ok)", fontStyle: "italic" },
  { tag: tags.comment, color: "var(--color-subtle)", fontStyle: "italic" },
  { tag: tags.typeName, color: "var(--color-muted)" },
  { tag: tags.function(tags.variableName), color: "var(--color-ink)" },
  // Identificador entre aspas é o caso em que o nome importa literalmente.
  { tag: tags.quote, color: "var(--color-ink)" },
  { tag: tags.punctuation, color: "var(--color-muted)" },
  { tag: tags.operator, color: "var(--color-muted)" },
]);

/**
 * O dialeto do CodeMirror para cada dialeto de engine.
 *
 * É a metade "sintaxe da engine" do autocomplete: cada dialeto traz o **próprio
 * conjunto de palavras-chave** e a **citação de identificador** certa. Com o
 * Postgres fixo, um usuário de MySQL via `AUTO_INCREMENT`/`LIMIT … OFFSET`
 * sumir da lista e a crase (`` `tabela` ``) não ser reconhecida como
 * identificador — o editor sugeria e destacava uma sintaxe que não é a do banco
 * conectado.
 *
 * `mysql` cobre MariaDB (o `dialetoDe` já os une), e `sqlite` cobre o libSQL —
 * a mesma gramática que o `splitStatements` usa para esses dois.
 */
const DIALETO_CODEMIRROR: Record<DialetoSql, SQLDialect> = {
  postgres: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
};

/** Um trecho do documento e onde ele começa (0-based) — para mapear `position`. */
export interface TrechoSql {
  readonly sql: string;
  readonly de: number;
}

/** O que a aba comanda no editor por ref (React 19: `ref` é prop). */
export interface SqlEditorApi {
  /** Põe o cursor no deslocamento (0-based), rola até ele e foca. */
  irPara: (pos: number) => void;
  /** Sublinha `[de, ate)`; `null` limpa. */
  marcarErro: (trecho: { de: number; ate: number } | null) => void;
  /** Formata o documento inteiro como uma transação desfazível. */
  formatar: () => void;
  /** O statement sob o cursor (ou a seleção, se houver). */
  alvo: () => TrechoSql | null;
}

export interface SqlEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** `Cmd+Enter` — a seleção, se houver; senão o statement sob o cursor. */
  readonly onRunStatement: (trecho: TrechoSql) => void;
  /** Seleção não vazia mudou — o botão vira "Executar seleção" (§4). */
  readonly onSelecao?: (trecho: TrechoSql | null) => void;
  /** `Shift+Alt+F` não conseguiu formatar (texto que o formatador não entende). */
  readonly onFormatarFalhou?: () => void;
  readonly ref?: Ref<SqlEditorApi>;
  /** `Cmd+Shift+Enter` — o script inteiro. */
  readonly onRunAll: () => void;
  /**
   * A árvore do database aberto, para o autocomplete.
   *
   * Ausente enquanto o schema não chegou: o editor funciona sem ele, e ganha
   * as tabelas e colunas assim que a introspecção volta — sem remontar, para
   * não perder foco nem cursor no meio da digitação.
   */
  readonly schema?: DatabaseSchema;
  /**
   * Como separar statements — a gramática da engine desta conexão.
   *
   * Padrão `postgres` porque é a engine que sempre existiu; o editor nunca
   * ficou sem separador, e um `undefined` aqui significa "conexão que ainda
   * não chegou", não "outro dialeto".
   */
  readonly dialeto?: DialetoSql;
}

/**
 * Qual statement está sob o cursor.
 *
 * Usa `splitStatements` de `packages/shared` — **a mesma função que o servidor
 * usa** para separar o SQL recebido. Duas implementações divergiriam no SQL
 * estranho (dollar quoting, `;` dentro de string) e o editor destacaria um
 * trecho enquanto o servidor executaria outro.
 *
 * O `dialeto` acompanha pelo mesmo motivo: o servidor separa o SQL do MySQL
 * com a gramática do MySQL, e um editor lendo com a do Postgres destacaria um
 * trecho diferente do que seria executado.
 */
export function statementSobCursor(
  sql: string,
  cursor: number,
  dialeto: DialetoSql = "postgres",
): { sql: string; de: number; ate: number } | null {
  const statements = splitStatements(sql, dialeto);
  if (statements.length === 0) return null;

  for (const s of statements) {
    const ate = s.offset + s.sql.length;
    // `<=` no fim: com o cursor colado no último caractere ainda é este.
    if (cursor >= s.offset && cursor <= ate) return { sql: s.sql, de: s.offset, ate };
  }

  // Cursor num espaço entre statements: pega o anterior, que é o que a pessoa
  // acabou de escrever.
  const anterior = [...statements].reverse().find((s) => s.offset <= cursor);
  if (anterior !== undefined) {
    return { sql: anterior.sql, de: anterior.offset, ate: anterior.offset + anterior.sql.length };
  }

  const primeiro = statements[0];
  return primeiro === undefined
    ? null
    : { sql: primeiro.sql, de: primeiro.offset, ate: primeiro.offset + primeiro.sql.length };
}

/** Liga/desliga o sublinhado de erro. */
const efeitoErro = StateEffect.define<{ de: number; ate: number } | null>();
const marcaErro = Decoration.mark({ class: "cm-dbee-erro" });

class PontoErro extends GutterMarker {
  override toDOM(): Node {
    const el = document.createElement("span");
    el.className = "cm-dbee-ponto-erro";
    return el;
  }
}
const pontoErro = new PontoErro();

/**
 * O sublinhado vive num `StateField` que **mapeia pelas mudanças**: editar
 * antes do erro desloca a marca junto; apagar o token a descarta. Sem isso a
 * marca ficaria pregada num deslocamento que já aponta outro texto.
 */
const campoErro = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(atual, tr) {
    let deco = atual.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(efeitoErro)) {
        const v = e.value;
        deco = v === null || v.ate <= v.de || v.ate > tr.state.doc.length
          ? Decoration.none
          : Decoration.set([marcaErro.range(v.de, v.ate)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const gutterErro = gutter({
  class: "cm-dbee-gutter-erro",
  markers: (v) => {
    const marcas: ReturnType<typeof pontoErro.range>[] = [];
    v.state.field(campoErro).between(0, v.state.doc.length, (de) => {
      const linha = v.state.doc.lineAt(de);
      if (marcas.at(-1)?.from !== linha.from) marcas.push(pontoErro.range(linha.from));
    });
    return RangeSet.of(marcas);
  },
});

/** O que o `Cmd+Enter` roda: a seleção, se houver; senão o statement do cursor. */
function alvoDoEditor(v: EditorView, dialeto: DialetoSql): TrechoSql | null {
  const sel = v.state.selection.main;
  if (!sel.empty) {
    const texto = v.state.sliceDoc(sel.from, sel.to);
    if (texto.trim() !== "") return { sql: texto, de: sel.from };
  }
  const alvo = statementSobCursor(v.state.doc.toString(), sel.head, dialeto);
  return alvo === null ? null : { sql: alvo.sql, de: alvo.de };
}

export function SqlEditor({
  value,
  onChange,
  onRunStatement,
  onRunAll,
  onSelecao,
  onFormatarFalhou,
  schema,
  dialeto = "postgres",
  ref,
}: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // A configuração da linguagem SQL vive num compartimento próprio para poder
  // ser trocada quando o schema chega, sem reconstruir o editor inteiro.
  const linguagem = useRef(new Compartment());

  /**
   * O `SQLNamespace` derivado do schema.
   *
   * `useMemo` porque a árvore de um banco grande vira um objeto grande, e
   * refazê-lo a cada render do componente — que acontece a cada tecla, via o
   * `onChange` que sobe — seria trabalho jogado fora.
   */
  const completion = useMemo(
    () => (schema === undefined ? null : construirCompletion(schema)),
    [schema],
  );

  const configSql = (): Extension =>
    sqlLang({
      // O dialeto da engine conectada, não o Postgres fixo: é o que traz as
      // palavras-chave certas e a citação de identificador certa para a lista.
      dialect: DIALETO_CODEMIRROR[dialetoRef.current],
      upperCaseKeywords: false,
      ...(completion === null
        ? {}
        : { schema: completion.schema, defaultSchema: completion.defaultSchema }),
    });

  /**
   * Ações guardadas em ref para o keymap não precisar ser recriado a cada
   * render — um `EditorState.reconfigure` por tecla digitada seria caro e
   * perderia o foco.
   *
   * A escrita vai num efeito, não no corpo do render: escrever em ref durante
   * a renderização quebra a garantia de render puro do React e o Compiler
   * recusa.
   */
  const acoes = useRef({ onChange, onRunStatement, onRunAll, onSelecao, onFormatarFalhou });
  useEffect(() => {
    acoes.current = { onChange, onRunStatement, onRunAll, onSelecao, onFormatarFalhou };
  });

  /*
   * O dialeto vai por ref pelo mesmo motivo das ações: o keymap é montado uma
   * vez, e uma dependência a mais no efeito remontaria o editor — perdendo
   * foco e cursor — só porque a lista de conexões chegou.
   */
  const dialetoRef = useRef(dialeto);
  useEffect(() => {
    dialetoRef.current = dialeto;
  }, [dialeto]);

  /**
   * Formatar como **uma** transação: `Ctrl+Z` volta ao texto anterior inteiro.
   *
   * O `sql-formatter` (todos os dialetos, ~300 KB) só é baixado no primeiro
   * uso — não entra no bundle de quem nunca formata. Se o texto mudou enquanto
   * o módulo chegava, não sobrescreve: formataria uma versão velha.
   */
  const formatar = (v: EditorView): void => {
    const atual = v.state.doc.toString();
    void import("./formatar.puro").then(({ formatarSql }) => {
      const novo = formatarSql(atual, dialetoRef.current);
      if (novo === null) {
        acoes.current.onFormatarFalhou?.();
        return;
      }
      if (v.state.doc.toString() !== atual || novo === atual) return;
      v.dispatch({ changes: { from: 0, to: atual.length, insert: novo }, userEvent: "input.format" });
    });
  };

  useImperativeHandle(ref, () => ({
    irPara: (pos) => {
      const v = view.current;
      if (v === null) return;
      const p = Math.min(Math.max(0, pos), v.state.doc.length);
      v.dispatch({ selection: EditorSelection.cursor(p), effects: EditorView.scrollIntoView(p, { y: "center" }) });
      v.focus();
    },
    marcarErro: (trecho) => {
      view.current?.dispatch({ effects: efeitoErro.of(trecho) });
    },
    formatar: () => { if (view.current !== null) formatar(view.current); },
    alvo: () => (view.current === null ? null : alvoDoEditor(view.current, dialetoRef.current)),
  }));


  useEffect(() => {
    const el = host.current;
    if (el === null) return;

    const extensoes: Extension[] = [
      gutterErro,
      lineNumbers(),
      campoErro,
      history(),
      linguagem.current.of(configSql()),
      // Abre sozinho ao digitar, como o VSCode. `Esc` fecha, `Ctrl+Espaço`
      // reabre. O `delay` dá um respiro para não piscar a cada tecla rápida.
      autocompletion({
        activateOnTyping: true,
        activateOnTypingDelay: 120,
        icons: true,
        maxRenderedOptions: 24,
        selectOnOpen: true,
      }),
      syntaxHighlighting(realce),
      tema,
      EditorView.lineWrapping,
      placeholder("SELECT 1"),
      keymap.of([
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: (v) => {
            const alvo = alvoDoEditor(v, dialetoRef.current);
            if (alvo !== null) acoes.current.onRunStatement(alvo);
            return true;
          },
        },
        // Formatar (roadmap-dbeaver item 4), o atalho do VSCode.
        { key: "Shift-Alt-f", preventDefault: true, run: (v) => { formatar(v); return true; } },
        {
          key: "Mod-Shift-Enter",
          preventDefault: true,
          run: () => {
            acoes.current.onRunAll();
            return true;
          },
        },
        // Tab **completa** a sugestão quando o popup está aberto (como no
        // VSCode). `acceptCompletion` devolve `false` quando não há popup, então
        // o Tab cai para o comportamento normal (sair do editor) — só rouba o
        // Tab quando há de fato o que completar.
        { key: "Tab", run: acceptCompletion },
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) acoes.current.onChange(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const sel = update.state.selection.main;
          const texto = sel.empty ? "" : update.state.sliceDoc(sel.from, sel.to);
          acoes.current.onSelecao?.(texto.trim() === "" ? null : { sql: texto, de: sel.from });
        }
      }),
    ];

    const v = new EditorView({ state: EditorState.create({ doc: value, extensions: extensoes }), parent: el });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Monta uma vez: o conteúdo é sincronizado pelo efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Schema chegou (ou mudou), ou a conexão da aba trocou de engine: troca só o
  // compartimento da linguagem. O documento, o histórico e o cursor ficam
  // intactos. O `dialeto` entra aqui porque ele decide o dialeto do CodeMirror
  // (palavras-chave e citação) — o `dialetoRef` já foi atualizado pelo efeito
  // acima, que roda antes deste por vir antes na ordem de declaração.
  useEffect(() => {
    const v = view.current;
    if (v === null) return;
    v.dispatch({ effects: linguagem.current.reconfigure(configSql()) });
    // `configSql` fecha sobre `completion` e `dialetoRef`, as dependências reais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion, dialeto]);

  // Só reescreve o documento quando o valor de fora diverge — sem isto, digitar
  // dispararia uma reescrita que move o cursor para o fim a cada tecla.
  useEffect(() => {
    const v = view.current;
    if (v === null) return;
    const atual = v.state.doc.toString();
    if (atual === value) return;
    v.dispatch({ changes: { from: 0, to: atual.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-full overflow-auto" />;
}
