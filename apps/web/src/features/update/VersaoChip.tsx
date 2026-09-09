import { useState } from "react";

import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { UpdateDialog } from "./UpdateDialog";
import { useVersao } from "./useUpdate";

/**
 * A versão em execução, na barra superior — e a porta de entrada do diálogo.
 *
 * ## Uma fonte de versão, não duas
 *
 * Aqui havia um `v{__APP_VERSION__}`, lido do `apps/web/package.json` em tempo
 * de build do Vite. O binário do servidor passou a afirmar a **tag do git**
 * (§8), e as duas fontes divergem no instante em que alguém taggeia sem bumpar
 * o `package.json`: o cabeçalho diria `v0.1.3` e o diálogo, `v0.2.0`, na mesma
 * tela. Duas versões que se contradizem valem menos que nenhuma — quem lê não
 * tem como saber qual acreditar. Passa a ler do servidor, que é quem sabe o que
 * está rodando.
 *
 * ## Por que é clicável
 *
 * O selo de atualização só existe quando há versão nova. Sem este botão, com o
 * app em dia não haveria caminho nenhum até o diálogo — nem para configurar a
 * URL de deploy antes de precisar dela, nem para verificar na hora, nem para
 * desligar a verificação automática.
 *
 * ## O anel, quando há atualização
 *
 * **Anel, não ponto.** O `UpdateBadge` ao lado registra a razão: verde é
 * conexão viva neste app, e um ponto colorido no cabeçalho ficaria a poucos
 * pixels dos pontos de saúde da árvore, dizendo outra coisa na mesma forma. O
 * §10 do design-system resolveu uma colisão idêntica mudando a **forma**, não o
 * matiz — um contorno que expande e some não se lê como indicador de estado.
 *
 * E o anel não é o único sinal: a versão também muda de `text-subtle` para
 * `text-accent`. Movimento sozinho falha para quem tem `prefers-reduced-motion`
 * ligado, que é justamente quem o bloco global do `index.css` zera.
 */
export function VersaoChip() {
  const { data: estado } = useVersao();
  const [aberto, setAberto] = useState(false);
  const t = useT();

  if (estado === undefined) return null;
  const temAtualizacao = estado.updateAvailable;

  return (
    <>
      <span className="relative hidden shrink-0 sm:inline-flex">
        {/*
          O anel vive num irmão `absolute`, não no botão: animar o próprio botão
          moveria a área de clique junto, e um alvo que escapa do dedo é pior
          que sinal nenhum. `pointer-events-none` garante que ele nunca
          intercepte o clique que o levaria ao diálogo.
        */}
        {temAtualizacao ? (
          <span
            aria-hidden
            className="animate-anel pointer-events-none absolute inset-0 rounded-[4px] border border-accent"
          />
        ) : null}

        <button
          type="button"
          onClick={() => { setAberto(true); }}
          title={
            temAtualizacao
              ? t("update.badgeTitulo", { version: estado.latest ?? "" })
              : t("update.titulo")
          }
          className={cn(
            "relative cursor-pointer rounded-[4px] px-1 py-0.5 text-2xs transition-colors duration-150",
            temAtualizacao ? "text-accent hover:text-accent" : "text-subtle hover:text-muted",
          )}
        >
          {estado.current}
        </button>
      </span>
      {aberto ? (
        <UpdateDialog estado={estado} onClose={() => { setAberto(false); }} />
      ) : null}
    </>
  );
}
