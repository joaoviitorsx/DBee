import type { Engine } from "@dbee/shared/puro";
import { engineImplementada } from "@dbee/shared/puro";

import { ENGINES_EM_ORDEM, IconeEngine, NOME_ENGINE } from "../../components/IconeEngine";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

/**
 * Escolher o motor do banco — a primeira decisão do formulário, porque é ela
 * que decide **quais campos existem abaixo** (ver `capacidadesDe`).
 *
 * ## Por que uma grade e não um `<select>`
 *
 * Num `<select>` a marca não aparece: a lista fecha e sobra texto. A grade é o
 * que torna a escolha visual, que é o ponto — sete nomes parecidos em lista
 * ("MySQL", "MariaDB") se leem devagar; sete silhuetas se leem de relance.
 *
 * ## Por que os motores indisponíveis aparecem, e por que em chip
 *
 * Sete opções iguais prometeriam sete conexões que funcionam, e hoje só uma
 * funciona. Então os outros aparecem **apagados e não clicáveis**: mostrar o
 * caminho sem oferecer o que ainda não existe. O `disabled` no rádio nativo
 * também os tira da navegação por setas, então o teclado não passa por opção
 * que não seleciona.
 *
 * A primeira versão eram cartões altos com "em breve" em cada um. A captura em
 * 375px reprovou: a grade comia a tela inteira e era preciso rolar por sete
 * cartões para chegar ao campo Nome — e seis deles nem se pode tocar. Além
 * disso "em breve" seis vezes é a mesma frase repetida como ruído. Virou chip
 * de uma linha, e o aviso virou **uma** frase abaixo da grade.
 *
 * Quando uma engine entra, ela acende sozinha — a fonte é
 * `ENGINES_IMPLEMENTADAS`, não uma lista repetida aqui.
 */
export function SeletorDeEngine({
  valor,
  onChange,
  desabilitado = false,
}: {
  readonly valor: Engine;
  readonly onChange: (engine: Engine) => void;
  /** Em edição o motor não muda: o ADR 005 amarra a cifra da senha ao id. */
  readonly desabilitado?: boolean;
}) {
  const t = useT();

  if (desabilitado) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("form.engine")}</span>
        <div className="flex w-fit items-center gap-2 rounded border border-line bg-raised px-3 py-2">
          <IconeEngine engine={valor} className="h-5 w-5 text-accent" />
          <span className="text-sm font-medium text-ink">{NOME_ENGINE[valor]}</span>
        </div>
        <p className="text-2xs text-subtle">{t("form.engineFixa")}</p>
      </div>
    );
  }

  return (
    <fieldset className="flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 text-xs font-medium text-muted">{t("form.engine")}</legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {ENGINES_EM_ORDEM.map((engine) => {
          const disponivel = engineImplementada(engine);
          const escolhida = engine === valor;
          return (
            <label
              key={engine}
              title={disponivel ? undefined : t("form.engineEmBreve")}
              className={cn(
                "flex items-center gap-2 rounded border px-2.5 py-2 transition-colors duration-150",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2",
                "has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                escolhida
                  ? "border-accent-line bg-accent-soft text-accent"
                  : "border-line bg-raised text-muted",
                disponivel
                  ? "cursor-pointer"
                  : // Indisponível continua legível: ele está aqui para ser
                    // lido, não escolhido.
                    "cursor-not-allowed opacity-40",
                disponivel && !escolhida && "hover:border-line-strong hover:text-ink",
              )}
            >
              <input
                type="radio"
                name="engine"
                value={engine}
                checked={escolhida}
                disabled={!disponivel}
                onChange={() => { onChange(engine); }}
                className="sr-only"
              />
              <IconeEngine engine={engine} className="h-4 w-4" />
              <span className="truncate text-xs font-medium">{NOME_ENGINE[engine]}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-2xs text-subtle">{t("form.engineAjuda")}</p>
    </fieldset>
  );
}
