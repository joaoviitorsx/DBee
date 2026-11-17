import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import {
  aplicar,
  guardarPreferencia,
  lerPreferencia,
  ouvirSistema,
  proximaPreferencia,
  temaDe,
  type PreferenciaTema,
} from "../../lib/theme";
import { quadrosDePoca } from "../../lib/revelacao.puro";
import { AbelhaPlana } from "../mascote";

/**
 * Cicla escuro → claro → sistema (ideia I5).
 *
 * O ícone mostra **para onde o clique leva**, não onde se está: mostrar o
 * estado atual faz a pessoa clicar no ícone que já representa o que ela vê e
 * se surpreender com o resultado. O `title` diz as duas coisas.
 *
 * Em "sistema", a mudança do SO troca o tema **seco**, sem a poça: a animação
 * é resposta a um clique, e mel escorrendo sem ninguém ter pedido é ruído.
 *
 * A troca é a "poça de mel" (docs/arte-login.md, "Troca de tema";
 * design-system.md §7): uma gota nasce no botão e se espalha até cobrir a
 * janela, puxada pela abelha, recortada por `clip-path: path()` no
 * `::view-transition-new(root)`. A abelha é um elemento próprio com
 * `view-transition-name`, então voa ACIMA dos dois snapshots. Em
 * `--motion-tema`. Sem a API ou com reduced-motion, troca seco.
 *
 * Clique durante a animação: `skipTransition()` conclui a troca em curso na
 * hora e a próxima começa — nunca enfileira nem bloqueia.
 */
let emCurso: ViewTransition | null = null;
const QUADROS = 40;
export function ThemeToggle() {
  const [pref, setPref] = useState<PreferenciaTema>(() => lerPreferencia());
  const t = useT();

  useEffect(() => {
    if (pref !== "system") return;
    return ouvirSistema(() => { aplicar(temaDe("system")); });
  }, [pref]);

  const proximo = proximaPreferencia(pref);
  const nome = (p: PreferenciaTema): string =>
    p === "light" ? t("tema.claro") : p === "dark" ? t("tema.escuro") : t("tema.sistema");
  const legenda = t("tema.legenda", { atual: nome(pref), proximo: nome(proximo) });

  const trocar = (botao: HTMLButtonElement): void => {
    const aplicarJa = (): void => {
      flushSync(() => { setPref(proximo); });
      aplicar(temaDe(proximo));
      guardarPreferencia(proximo);
    };
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Sem mudança visível (sistema já resolve no tema atual): troca seco.
    const mesmoTema = temaDe(proximo) === temaDe(pref);
    if (typeof document.startViewTransition !== "function" || reduzido || mesmoTema) {
      aplicarJa();
      return;
    }
    emCurso?.skipTransition();
    const r = botao.getBoundingClientRect();
    const bx = r.left + r.width / 2;
    const by = r.top + r.height / 2;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const quadros = quadrosDePoca(QUADROS, bx, by, w, h);
    const css = getComputedStyle(document.documentElement);
    const duracao = Number.parseFloat(css.getPropertyValue("--motion-tema"));
    const curva = "linear"; // a aceleração já está na física dos quadros
    // A abelha olha para onde voa.
    const espelho = quadros[QUADROS] !== undefined && quadros[QUADROS].x < bx ? " scaleX(-1)" : "";

    const transicao = document.startViewTransition(() => {
      aplicarJa();
      document.documentElement.dataset["abelhaTema"] = "1";
    });
    emCurso = transicao;
    void transicao.ready.then(() => {
      const raiz = document.documentElement;
      raiz.animate(
        { clipPath: quadros.map((q) => q.recorte) },
        { duration: duracao, easing: curva, pseudoElement: "::view-transition-new(root)" },
      );
      raiz.animate(
        {
          transform: quadros.map((q) => `translate(${(q.x - 20).toFixed(1)}px, ${(q.y - 20).toFixed(1)}px)${espelho}`),
          opacity: quadros.map((_, i) => (i === 0 ? 0 : 1)),
        },
        { duration: duracao, easing: curva, pseudoElement: "::view-transition-group(abelha-tema)" },
      );
    }).catch(() => undefined);
    void transicao.finished.finally(() => {
      if (emCurso === transicao) emCurso = null;
      delete document.documentElement.dataset["abelhaTema"];
    });
  };

  return (
    <>
    {/* A abelha da troca: fora da tela, só existe como snapshot da transição. */}
    <span aria-hidden className="abelha-tema pointer-events-none">
      <AbelhaPlana pose="voando" animada tamanho={40} />
    </span>
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      title={legenda}
      aria-label={legenda}
      onClick={(e) => { trocar(e.currentTarget); }}
    >
      <span className="relative grid h-3.5 w-3.5 place-items-center">
        <Sun aria-hidden data-ativo={proximo === "light" ? "" : undefined} className="motion-troca absolute h-3.5 w-3.5" />
        <Moon aria-hidden data-ativo={proximo === "dark" ? "" : undefined} className="motion-troca absolute h-3.5 w-3.5" />
        <Monitor aria-hidden data-ativo={proximo === "system" ? "" : undefined} className="motion-troca absolute h-3.5 w-3.5" />
      </span>
    </Button>
    </>
  );
}
