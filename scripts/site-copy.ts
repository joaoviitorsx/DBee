/**
 * Mede a copy da landing e reprova o que passa do orçamento.
 *
 * ## Por que isto existe
 *
 * "Não verboso demais, não complexo demais" é um critério que não sobrevive à
 * terceira edição do texto se ficar só na cabeça de quem escreveu — cada frase
 * cresce um pouco, ninguém percebe, e num ano a página é um documento. O
 * repositório já tem o hábito de travar número afirmado com teste
 * (`docs/design-system.md`); isto aplica o mesmo hábito à copy.
 *
 * Os tetos abaixo não são gosto, são o ponto em que cada papel quebra na tela:
 *
 * - **kicker**: passa de ~22 e não cabe numa linha em 375px, com o traço e o
 *   tracking de 0.14em que ele carrega.
 * - **título de seção**: passa de ~42 e vira três linhas em 375px, com a
 *   terceira quase vazia. Título de três linhas some da hierarquia.
 * - **lede**: passa de ~190 e vira quatro linhas no desktop; a partir daí
 *   ninguém lê, rola.
 * - **item de motor**: passa de ~95 e ocupa três linhas num cartão de 348px do
 *   trilho, que só cabe cinco itens de duas linhas.
 * - **botão**: passa de ~26 e o rótulo quebra em duas linhas dentro do botão.
 *
 * Não é um parser de HTML: é regex sobre um arquivo que este repositório
 * controla inteiro. Um parser de verdade seria dependência nova para resolver
 * um problema que não existe aqui.
 *
 *   bun scripts/site-copy.ts          # relatório + saída 1 se estourar
 *   bun scripts/site-copy.ts --tudo   # lista tudo, não só o que estourou
 */
const ARQUIVO = new URL("../site/index.html", import.meta.url).pathname;
const html = await Bun.file(ARQUIVO).text();
const tudo = process.argv.includes("--tudo");

/** Tira tags, resolve as entidades que a página usa e normaliza o espaço. */
function texto(bruto: string): string {
  return bruto
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

interface Regra {
  readonly papel: string;
  readonly teto: number;
  /** O grupo 1 do padrão é o conteúdo interno do elemento. */
  readonly padrao: RegExp;
}

const REGRAS: readonly Regra[] = [
  { papel: "kicker", teto: 22, padrao: /<p class="section__kicker"[^>]*>([\s\S]*?)<\/p>/g },
  { papel: "título de seção", teto: 42, padrao: /<h[12] class="(?:hero__title|section__title)[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/g },
  { papel: "lede", teto: 190, padrao: /<p class="(?:hero__sub|section__lede)"[^>]*>([\s\S]*?)<\/p>/g },
  { papel: "nome de motor", teto: 18, padrao: /<h3 class="engine__name">([\s\S]*?)<\/h3>/g },
  { papel: "estado de motor", teto: 24, padrao: /<p class="engine__state">([\s\S]*?)<\/p>/g },
  { papel: "item de motor", teto: 95, padrao: /<li(?: data-no)?>([\s\S]*?)<\/li>/g },
  { papel: "garantia de motor", teto: 130, padrao: /<p class="engine__guard">([\s\S]*?)<\/p>/g },
  { papel: "título de cartão", teto: 30, padrao: /<h3>([\s\S]*?)<\/h3>/g },
  { papel: "corpo de cartão", teto: 230, padrao: /<article class="bento__card"[^>]*>[\s\S]*?<\/svg>\s*<h3>[\s\S]*?<\/h3>\s*<p>([\s\S]*?)<\/p>/g },
  { papel: "botão", teto: 26, padrao: /<span class="btn__int">([\s\S]*?)<\/span>/g },
  { papel: "chip de motor", teto: 32, padrao: /<span class="chip[^"]*"[^>]*>([\s\S]*?)<\/span>/g },
  { papel: "legenda de captura", teto: 150, padrao: /<figcaption>([\s\S]*?)<\/figcaption>/g },
  { papel: "rótulo de número", teto: 62, padrao: /<div class="numero"[^>]*>[\s\S]*?<\/b>\s*<p>([\s\S]*?)<\/p>/g },
];

let estourou = 0;
let medidos = 0;

for (const { papel, teto, padrao } of REGRAS) {
  const linhas: { n: number; s: string }[] = [];
  for (const m of html.matchAll(padrao)) {
    const s = texto(m[1] ?? "");
    if (s === "") continue;
    linhas.push({ n: s.length, s });
    medidos++;
  }
  if (linhas.length === 0) continue;

  const max = Math.max(...linhas.map((l) => l.n));
  const media = Math.round(linhas.reduce((a, l) => a + l.n, 0) / linhas.length);
  const fora = linhas.filter((l) => l.n > teto);
  estourou += fora.length;

  const marca = fora.length > 0 ? "REPROVA" : "ok";
  console.log(
    `\n${marca}  ${papel} — teto ${String(teto)} · ${String(linhas.length)} rótulos · ` +
      `média ${String(media)} · maior ${String(max)}`,
  );
  for (const l of tudo ? linhas : fora) {
    const flag = l.n > teto ? "  !!" : "    ";
    console.log(`${flag} ${String(l.n).padStart(4)}  ${l.s.slice(0, 96)}`);
  }
}

console.log(`\n${String(medidos)} rótulos medidos, ${String(estourou)} fora do teto.`);
if (estourou > 0) {
  console.log("Encurte os marcados com !! ou justifique subindo o teto aqui.");
  process.exit(1);
}
