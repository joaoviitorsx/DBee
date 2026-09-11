import type { Engine } from "@dbee/shared/puro";
import { cn } from "../lib/cn";

/**
 * A marca de cada engine, como silhueta de uma cor só.
 *
 * ## Por que silhueta e não a logo colorida
 *
 * A tela já gasta cor em **estado**: âmbar é o acento e é o que significa "modo
 * escrita"; a tag colorida da conexão é escolha do usuário. Trazer sete
 * paletas de marca — azul do Postgres, teal do MySQL, ferrugem do MariaDB,
 * verde do Mongo, vermelho do Redis — colocaria sete cores novas competindo com
 * as que já querem dizer alguma coisa. Esse erro já foi enviado uma vez aqui,
 * com o selo de PK herdando o âmbar da escrita.
 *
 * Então a divisão é: **a forma diz qual engine é, a cor diz em que estado ela
 * está.** Todo glifo é `currentColor`, e quem o usa decide a cor — apagado
 * quando indisponível, tinta quando disponível, âmbar quando escolhido.
 *
 * ## Desenhados para 20px
 *
 * Preenchimento sólido e sem traço: contorno de 1px em animal de 20px vira
 * borrão. Cada glifo ocupa a caixa inteira de 24 e foi conferido em captura
 * antes de entrar — bicho pequeno demais é mancha, e mancha não identifica
 * nada.
 *
 * As silhuetas são as marcas dos projetos, simplificadas para este tamanho.
 * Servem para identificar o produto de cada um, que é o uso nominativo; nenhuma
 * é a logo oficial nem substitui a marca de ninguém.
 */

/**
 * Um glifo por engine, em caixa de 24×24.
 *
 * Cada um é **composto de formas simples** (elipses e polígonos) em vez de um
 * traçado heroico único. A primeira tentativa foi de traçado único e as três
 * silhuetas mais importantes — elefante, golfinho e leão-marinho — saíram
 * manchas na captura de 20px. Composição é o que dá para conferir e corrigir.
 *
 * O preenchimento é `nonzero`, **não** `evenodd`: as formas se sobrepõem de
 * propósito (a orelha entra na cabeça), e no `evenodd` toda sobreposição vira
 * buraco. Onde um buraco é desejado — o olho do elefante, a boca do cilindro —
 * a subforma é desenhada no sentido inverso, que é como o `nonzero` subtrai.
 *
 * O que cada um é: elefante (PostgreSQL), golfinho saltando (MySQL),
 * leão-marinho sentado (MariaDB), pena (SQLite), cilindro com arco de sinal
 * (libSQL, que é SQLite atendendo pela rede), folha (MongoDB) e três placas
 * empilhadas (Redis). O golfinho é horizontal e o leão-marinho é vertical de
 * propósito: MySQL e MariaDB são as duas que mais se confundem, e a diferença
 * entre elas é o assunto de `docs/papeis-mysql.md`.
 */
const GLIFOS: Readonly<Record<Engine, readonly string[]>> = {
  postgres: [
    "M2.7 9.2a3.3 4.4 0 1 0 6.6 0a3.3 4.4 0 1 0 -6.6 0Z",
    "M14.7 9.2a3.3 4.4 0 1 0 6.6 0a3.3 4.4 0 1 0 -6.6 0Z",
    "M7 9.6a5 5.6 0 1 0 10 0a5 5.6 0 1 0 -10 0Z",
    "M10.3 13.6 L13.7 13.6 L13.0 19.2 C12.92 20.15 13.6 20.95 14.55 21.1 L14.2 22.85 C12.25 22.55 10.9 20.8 11.1 18.85 Z",
    "M9.4 8.6a1 1.1 0 1 1 2 0a1 1.1 0 1 1 -2 0Z",
  ],
  mysql: [
    "M3.0 5.8 C10.1 5.8 15.8 10.2 18.2 16.5 L13.9 18.3 C12.0 13.0 8.0 10.2 3.0 10.2 Z",
    "M8.5 8.2 L11.7 4.6 L13.2 9.3 Z",
    "M16.2 14.9 L21.8 12.6 L19.6 18.0 L21.4 21.1 L16.2 19.5 Z",
    "M3.2 5.5 L0.5 8.3 L3.2 10.5 Z",
  ],
  mariadb: [
    "M6.6 21.6 C3.6 20.0 2.0 17.2 2.4 14.0 C3.0 9.6 6.6 6.6 11.2 6.6 L13.0 10.2 C9.6 10.2 7.0 12.1 6.6 15.0 C6.3 17.2 7.2 19.0 9.2 20.2 Z",
    "M10.799999999999999 7.2a3.4 3.1 0 1 0 6.8 0a3.4 3.1 0 1 0 -6.8 0Z",
    "M16.8 5.5 L21.8 6.3 L21.3 8.7 L16.6 9.3 Z",
    "M9.0 14.8 C11.5 14.8 13.3 16.3 13.9 18.6 L10.6 19.5 C10.3 18.3 9.7 17.7 8.8 17.6 Z",
    "M12.65 6.4a0.95 1 0 1 1 1.9 0a0.95 1 0 1 1 -1.9 0Z",
  ],
  sqlite: [
    "M20.8 2.2 C13.6 3.0 8.2 6.4 5.6 11.6 C4.2 14.4 3.8 17.4 4.5 20.5 L6.6 20.0 C6.1 18.1 6.2 16.2 6.7 14.4 L11.9 14.4 L13.6 11.9 L7.9 11.9 C8.7 10.6 9.6 9.4 10.7 8.4 L15.8 8.4 L17.5 5.9 L13.6 5.9 C15.7 4.5 18.1 3.3 20.8 2.2 Z",
    "M4.9 20.3 L6.7 20.9 L3.3 23.4 L2.3 22.0 Z",
  ],
  libsql: [
    "M9.6 3.2c-3.4 0-6.1 1-6.1 2.3v13c0 1.3 2.7 2.3 6.1 2.3s6.1-1 6.1-2.3v-13c0-1.3-2.7-2.3-6.1-2.3Z",
    "M4.8999999999999995 5.5a4.7 1 0 1 1 9.4 0a4.7 1 0 1 1 -9.4 0Z",
    "M17.5 5.8 16.3 7c1 1 1.6 2.4 1.6 3.9s-.6 2.9-1.6 3.9l1.2 1.2a7.2 7.2 0 0 0 0-10.2Z",
    "M20.2 3.1 19 4.3a9.4 9.4 0 0 1 0 13.3l1.2 1.2a11.1 11.1 0 0 0 0-15.7Z",
  ],
  mongodb: [
    "M12 1.6c-.4.6-3.5 4.4-4.8 7.5-1.9 4.5-.6 8.4 3.5 10.3l.4 2.4c0 .4.3.6.7.6h.4c.4 0 .7-.2.7-.6l.4-2.4c4.1-1.9 5.4-5.8 3.5-10.3C15 6 12.4 2.2 12 1.6Z",
  ],
  redis: [
    "M12 2.3 22 6.9l-10 4.6L2 6.9Z",
    "M2 10.2l3.5 1.6L12 14.8l6.5-3 3.5-1.6v2.4l-10 4.6-10-4.6Z",
    "M2 15.1l3.5 1.6L12 19.7l6.5-3 3.5-1.6v2.4l-10 4.6-10-4.6Z",
  ],
};

/** Como cada engine se chama na tela. Nome de produto não se traduz. */
export const NOME_ENGINE: Readonly<Record<Engine, string>> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
  libsql: "libSQL",
  mongodb: "MongoDB",
  redis: "Redis",
};

/**
 * A ordem em que as engines aparecem: as relacionais primeiro, por proximidade
 * com o que o DBee já faz, e as de outro modelo por último — porque elas exigem
 * outra vista, não só outro driver.
 */
export const ENGINES_EM_ORDEM: readonly Engine[] = [
  "postgres",
  "mysql",
  "mariadb",
  "sqlite",
  "libsql",
  "mongodb",
  "redis",
];

export function IconeEngine({
  engine,
  className,
}: {
  readonly engine: Engine;
  readonly className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {GLIFOS[engine].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
