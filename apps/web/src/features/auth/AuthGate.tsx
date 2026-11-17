import type { SessionUser } from "@dbee/shared";
import { Fragment, useState } from "react";


import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { Mascote } from "../mascote";
import { Trabalhando } from "../motion/Trabalhando";
import { ChangePasswordScreen } from "./ChangePasswordScreen";
import { LoginScreen } from "./LoginScreen";
import { SetupScreen } from "./SetupScreen";
import { SessaoExpirada } from "./SessaoExpirada";
import { saiuDeProposito, useSession, useSetupStatus } from "./useSession";

/**
 * Decide o que existe antes de qualquer coisa.
 *
 * Três estados, e a ordem importa: **enquanto não se sabe**, nem login nem app
 * — mostrar o login por um quadro e depois trocá-lo pelo app faz a pessoa ver
 * uma tela de senha que não precisava e piscar o conteúdo por cima.
 */
export function AuthGate({ children }: { readonly children: React.ReactNode }) {
  const t = useT();
  const sessao = useSession();
  // Só decide setup×login quando já se sabe que NÃO há sessão. Enquanto o `/me`
  // está pendente, este fica ocioso (`enabled`) para não pedir o status à toa.
  const setup = useSetupStatus(sessao.data === null);

  /*
   * Último usuário autenticado — o que separa "nunca entrou" de "a sessão
   * venceu" (§3.7). Estado derivado durante o render (padrão do React para
   * "guardar o valor anterior"), não efeito: o efeito deixaria um quadro com
   * o login de tela cheia desmontando as abas antes de corrigir.
   */
  const [ultimo, setUltimo] = useState<SessionUser | null>(null);
  const atual = sessao.data ?? null;
  if (atual !== null && atual.id !== ultimo?.id) setUltimo(atual);
  if (atual === null && ultimo !== null && saiuDeProposito()) setUltimo(null);

  if (sessao.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-sunken">
        <Trabalhando rotulo={t("sessao.verificando")} />
      </div>
    );
  }

  // Venceu com o app aberto: as abas ficam montadas, o login vem por cima.
  // A chave é o id do usuário — se OUTRA pessoa entrar pelo modal, o
  // workspace remonta e não herda as abas (nem os dados) da anterior.
  if (sessao.data === null && ultimo !== null && !saiuDeProposito()) {
    return (
      <>
        <Fragment key={ultimo.id}>{children}</Fragment>
        <SessaoExpirada usuario={ultimo.username} />
      </>
    );
  }

  if (sessao.isError) return <ServidorMudo mensagem={sessao.error.message} onTentar={() => { void sessao.refetch(); }} />;

  if (sessao.data === null) {
    // Sem conta ainda → tela de setup. Enquanto não se sabe, espera; erro ao
    // checar cai para o login, que é o estado seguro (o POST de setup ainda
    // recusaria com `setup_done` se já houvesse conta).
    if (setup.isPending) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-sunken">
          <Trabalhando rotulo={t("sessao.verificando")} />
        </div>
      );
    }
    return setup.data === true ? <SetupScreen /> : <LoginScreen />;
  }
  if (sessao.data.mustChangePassword) return <ChangePasswordScreen user={sessao.data} />;

  return <Fragment key={sessao.data.id}>{children}</Fragment>;
}

/**
 * O servidor não respondeu.
 *
 * A única tela do app em que não há nada a fazer do lado de cá. O texto diz o
 * que aconteceu e **o que verificar** — "ocorreu um erro" sozinho manda a
 * pessoa adivinhar. O botão continua ali porque queda de rede é o caso mais
 * comum e costuma passar sozinha.
 */
function ServidorMudo({
  mensagem,
  onTentar,
}: {
  readonly mensagem: string;
  readonly onTentar: () => void;
}) {
  const t = useT();
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-1 overflow-hidden bg-sunken px-5 py-10">
      {/* A abelha dormindo: o servidor está fora, não há o que fazer aqui. */}
      <Mascote pose="dormindo" float className="relative h-40 w-40" />

      <div className="relative mt-2 max-w-sm text-center">
        <h1 className="text-base font-semibold tracking-[-0.02em] text-ink">
          {t("gate.servidorMudoTitulo")}
        </h1>
        {/*
          * Prosa fixa aqui, mensagem crua do servidor embaixo.
          *
          * Interpolar a mensagem no meio da frase produzia "não foi possível
          * verificar a sessão. O container pode…" — minúscula abrindo período,
          * e a explicação repetindo o título. O texto humano diz o que fazer; o
          * técnico fica separado, em mono, para quem for depurar.
          */}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t("gate.servidorMudoAjuda")}
        </p>
        <p className="mt-3 font-mono text-2xs text-subtle">{mensagem}</p>
        <Button size="sm" className="mt-5" onClick={onTentar}>
          {t("comum.tentarDeNovo")}
        </Button>
      </div>
    </main>
  );
}
