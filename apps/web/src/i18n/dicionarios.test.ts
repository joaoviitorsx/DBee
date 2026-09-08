import { describe, expect, it } from "bun:test";

import { en } from "./en";
import { pt } from "./pt";

/**
 * Paridade entre os dois dicionários.
 *
 * Não é zelo: chave nova entra **à mão nos dois arquivos**, e esquecer um deles
 * não quebra build, typecheck nem lint — o `t()` devolve a própria chave, então
 * a tela mostra `usuarios.papelAdmin` no lugar do texto, e só para quem usa
 * aquele idioma. O projeto nasceu em português; um buraco no `en` passa
 * despercebido indefinidamente.
 *
 * Foi exatamente o risco de 41 chaves acrescentadas de uma vez na
 * administração de contas.
 */

const chavesPt = Object.keys(pt).sort();
const chavesEn = Object.keys(en).sort();

describe("dicionários pt/en", () => {
  it("têm exatamente as mesmas chaves", () => {
    expect({
      soEmPt: chavesPt.filter((k) => !(k in en)),
      soEmEn: chavesEn.filter((k) => !(k in pt)),
    }).toEqual({ soEmPt: [], soEmEn: [] });
  });

  /**
   * Valor vazio é pior que chave faltando: sem chave o `t()` pelo menos mostra
   * o identificador, e dá para achar. Vazio some da tela sem deixar rastro.
   */
  it("nenhum valor é vazio", () => {
    const vazias = [...Object.entries(pt), ...Object.entries(en)]
      .filter(([, v]) => v.trim() === "")
      .map(([k]) => k);
    expect(vazias).toEqual([]);
  });

  /**
   * Os dois lados precisam interpolar os **mesmos** parâmetros. `{user}` só no
   * português faz a frase em inglês perder o nome no meio — sem erro nenhum,
   * porque a substituição simplesmente não acha o que trocar.
   */
  it("as mesmas chaves usam os mesmos parâmetros", () => {
    const params = (texto: string): string[] =>
      [...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

    const divergentes = chavesPt
      .filter((k) => k in en)
      .map((k) => ({
        chave: k,
        pt: params(pt[k as keyof typeof pt]),
        en: params(en[k as keyof typeof en]),
      }))
      .filter((r) => r.pt.join(",") !== r.en.join(","));

    expect(divergentes).toEqual([]);
  });
});
