import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { PostgreSQL, sql as sqlLang } from "@codemirror/lang-sql";
import { tags } from "@lezer/highlight";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import type { DatabaseSchema } from "@dbee/shared";
import { splitStatements } from "@dbee/shared";
import { useEffect, useMemo, useRef } from "react";

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
      caretColor: "var(--color-accent)",
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
    ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in oklab, var(--color-amber) 28%, transparent)",
    },
    // Marca o statement que o Cmd+Enter vai rodar.
    ".cm-dbee-ativo": {
      backgroundColor: "color-mix(in oklab, var(--color-amber) 7%, transparent)",
      borderLeft: "2px solid color-mix(in oklab, var(--color-accent) 55%, transparent)",
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
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--color-accent-soft)",
      color: "var(--color-ink)",
      borderLeftColor: "var(--color-accent)",
    },
    ".cm-completionLabel": { color: "inherit" },
    ".cm-completionMatchedText": {
      color: "var(--color-accent)",
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
      color: "var(--color-accent)",
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
  { tag: tags.keyword, color: "var(--color-accent)" },
  { tag: tags.operatorKeyword, color: "var(--color-accent)" },
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

export interface SqlEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** `Cmd+Enter` — recebe só o statement sob o cursor. */
  readonly onRunStatement: (sql: string) => void;
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
}

/**
 * Qual statement está sob o cursor.
 *
 * Usa `splitStatements` de `packages/shared` — **a mesma função que o servidor
 * usa** para separar o SQL recebido. Duas implementações divergiriam no SQL
 * estranho (dollar quoting, `;` dentro de string) e o editor destacaria um
 * trecho enquanto o servidor executaria outro.
 */
export function statementSobCursor(sql: string, cursor: number): { sql: string; de: number; ate: number } | null {
  const statements = splitStatements(sql);
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

export function SqlEditor({ value, onChange, onRunStatement, onRunAll, schema }: SqlEditorProps) {
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
      dialect: PostgreSQL,
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
  const acoes = useRef({ onChange, onRunStatement, onRunAll });
  useEffect(() => {
    acoes.current = { onChange, onRunStatement, onRunAll };
  });

  useEffect(() => {
    const el = host.current;
    if (el === null) return;

    const extensoes: Extension[] = [
      lineNumbers(),
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
            const doc = v.state.doc.toString();
            const alvo = statementSobCursor(doc, v.state.selection.main.head);
            if (alvo !== null) acoes.current.onRunStatement(alvo.sql);
            return true;
          },
        },
        {
          key: "Mod-Shift-Enter",
          preventDefault: true,
          run: () => {
            acoes.current.onRunAll();
            return true;
          },
        },
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) acoes.current.onChange(update.state.doc.toString());
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

  // Schema chegou (ou mudou): troca só o compartimento da linguagem. O
  // documento, o histórico e o cursor ficam intactos.
  useEffect(() => {
    const v = view.current;
    if (v === null) return;
    v.dispatch({ effects: linguagem.current.reconfigure(configSql()) });
    // `configSql` fecha sobre `completion`, que é a dependência real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion]);

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
