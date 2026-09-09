import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { useT } from "../i18n";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { copiarTexto } from "../lib/navegador";

/**
 * Fronteira de erro — o que impede que um defeito local vire sessão perdida.
 *
 * ## Por que ela existe
 *
 * Um usuário abriu a aba Diagrama e o app **inteiro** morreu: `Not possible to
 * find intersection inside of the rectangle`, lançado pelo `dagre` dentro de um
 * `useMemo`. O defeito era do layout de um diagrama; o dano foi as abas
 * abertas, o SQL não salvo e a posição na tabela de quem estava trabalhando.
 *
 * Em React, exceção em render sem fronteira **desmonta a árvore toda** — não é
 * degradação, é tela branca. Numa ferramenta de uso diário isso é a diferença
 * entre "essa aba deu erro" e "perdi a manhã".
 *
 * ## Classe, e não hook
 *
 * Não existe equivalente em hook: `getDerivedStateFromError` e
 * `componentDidCatch` só existem em componente de classe. Por isso a fronteira
 * é classe e a **tela** de recuperação é função — assim a tela usa `useT` e
 * fala o idioma da pessoa, sem que a classe precise de contexto.
 *
 * ## O que ela NÃO faz
 *
 * Não engole. `componentDidCatch` sempre escreve no console, com a pilha e o
 * componente que quebrou: quem for depurar precisa disso, e o overlay do Vite
 * em desenvolvimento continua aparecendo por cima.
 *
 * Também não captura o que React nenhum captura: erro em manipulador de evento,
 * `setTimeout`, ou promessa rejeitada. Esses não desmontam a árvore, então não
 * são o problema que esta peça resolve.
 *
 * ## `resetKey`
 *
 * Trocar de aba tem de rearmar a fronteira. Sem isso, uma aba quebrada
 * contaminaria a próxima: a fronteira ficaria presa no estado de erro e a aba
 * seguinte — sadia — nasceria mostrando o painel de falha.
 */

interface FronteiraProps {
  readonly children: ReactNode;
  /**
   * Muda → a fronteira se rearma. Passe o id da aba ativa: é o que separa
   * "esta aba quebrou" de "a próxima aba herdou a quebra da anterior".
   */
  readonly resetKey?: string | null;
  /**
   * `painel` ocupa a área de conteúdo e diz que o resto segue vivo.
   * `tela` é a última rede, quando o que quebrou foi o próprio shell.
   */
  readonly variante: "painel" | "tela";
}

interface FronteiraState {
  readonly erro: Error | null;
  readonly pilha: string | null;
  readonly chave: string | null;
}

export class FronteiraDeErro extends Component<FronteiraProps, FronteiraState> {
  override state: FronteiraState = { erro: null, pilha: null, chave: null };

  static getDerivedStateFromError(erro: Error): Partial<FronteiraState> {
    return { erro };
  }

  /**
   * Rearma quando `resetKey` muda.
   *
   * Feito em `getDerivedStateFromProps` e não em efeito: o efeito rodaria
   * **depois** do commit, e a pessoa veria o painel de erro piscar na aba nova
   * antes de ele sumir.
   */
  static getDerivedStateFromProps(
    props: FronteiraProps,
    state: FronteiraState,
  ): Partial<FronteiraState> | null {
    const chave = props.resetKey ?? null;
    if (chave === state.chave) return null;
    return { chave, erro: null, pilha: null };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    // Nunca engolir: a pilha do componente é o que permite achar o culpado, e
    // ela não sobrevive ao `getDerivedStateFromError` (que só recebe o erro).
    console.error("[dbee] erro capturado pela fronteira", erro, info.componentStack);
    this.setState({ pilha: info.componentStack ?? null });
  }

  override render(): ReactNode {
    const { erro, pilha } = this.state;
    if (erro === null) return this.props.children;
    return (
      <TelaDeRecuperacao
        erro={erro}
        pilha={pilha}
        variante={this.props.variante}
        onTentar={() => { this.setState({ erro: null, pilha: null }); }}
      />
    );
  }
}

interface TelaProps {
  readonly erro: Error;
  readonly pilha: string | null;
  readonly variante: "painel" | "tela";
  readonly onTentar: () => void;
}

/**
 * A tela de recuperação.
 *
 * **A mensagem do erro fica visível.** O DBee é usado por um time de
 * desenvolvimento; esconder `Not possible to find intersection inside of the
 * rectangle` atrás de "algo deu errado" transformaria um relato de dez segundos
 * numa sessão de adivinhação. É a mesma decisão que o CLAUDE.md já toma sobre
 * erro do Postgres: não engolir, porque é informação útil para quem lê.
 */
function TelaDeRecuperacao({ erro, pilha, variante, onTentar }: TelaProps) {
  const t = useT();
  const [copiado, setCopiado] = useState(false);

  const detalhes = `${erro.name}: ${erro.message}\n\n${erro.stack ?? ""}\n${pilha ?? ""}`.trim();

  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-0 flex-col items-center justify-center gap-4 overflow-auto p-6 text-center",
        /*
          `flex-1` só ocupa a altura quando o pai é flex COM altura — o que
          vale dentro do `<main>`, mas não na raiz: ali o pai é o `#root`, e a
          tela de falha nascia com 237 px encostada no topo de uma janela de
          900. `min-h-screen` é o que dá altura própria a quem não herda
          nenhuma. Medido, não suposto.
        */
        variante === "tela" ? "min-h-screen bg-sunken text-ink" : "flex-1",
      )}
    >
      <TriangleAlert aria-hidden className="h-8 w-8 shrink-0 text-danger" />

      <div className="flex max-w-lg flex-col gap-1.5">
        <h2 className="text-sm font-medium text-ink">
          {t(variante === "tela" ? "fronteira.tituloApp" : "fronteira.tituloAba")}
        </h2>
        <p className="text-xs text-muted">
          {t(variante === "tela" ? "fronteira.explicacaoApp" : "fronteira.explicacaoAba")}
        </p>
      </div>

      {/*
        `break-words` não é acabamento: mensagem de erro traz identificador
        longo sem espaço, e sem isso ela estoura a caixa e volta a rolar a
        página na horizontal — o defeito que o `check-responsivo.ts` tranca.
      */}
      <pre className="max-h-40 w-full max-w-lg overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-line bg-sunken px-3 py-2 text-left text-2xs text-muted">
        {erro.message}
      </pre>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {variante === "tela" ? (
          <Button size="sm" variant="primary" onClick={() => { location.reload(); }}>
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            {t("fronteira.recarregar")}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onTentar}>
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            {t("fronteira.tentar")}
          </Button>
        )}

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void copiarTexto(detalhes).then((ok) => { if (ok) setCopiado(true); });
          }}
        >
          {copiado ? t("fronteira.copiado") : t("fronteira.copiar")}
        </Button>
      </div>
    </div>
  );
}
