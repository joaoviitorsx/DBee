import { describe, expect, test } from "bun:test";
import { Engine } from "@dbee/shared";

import { ENGINES_EM_ORDEM, NOME_ENGINE } from "./IconeEngine";

/**
 * Os valores da união `Engine`, lidos do schema em vez de repetidos aqui.
 * Repetir a lista faria o teste concordar com a cópia errada.
 */
const DA_UNIAO = Engine.anyOf.map((v: { const: string }) => v.const);

describe("o conjunto de motores da tela acompanha o schema", () => {
  /*
   * Este é o furo que o TypeScript NÃO fecha.
   *
   * `GLIFOS` e `NOME_ENGINE` são `Record<Engine, …>`, então esquecer uma engine
   * ali quebra o typecheck. Mas `ENGINES_EM_ORDEM` é `readonly Engine[]`, e uma
   * lista incompleta é um array válido: dá para adicionar uma engine à união e
   * o seletor simplesmente não a desenha, sem erro em lugar nenhum.
   *
   * É exatamente o modo de falhar que este projeto já viu — a tela afirmando
   * menos do que o sistema tem, em silêncio.
   */
  test("toda engine da união aparece no seletor, sem sobra nem falta", () => {
    // Os dois lados como `string[]`: comparar `Engine[]` com `string[]` faz o
    // `toEqual` escolher outra sobrecarga e o erro sair no teste em vez de sair
    // no que ele deveria estar medindo.
    const daTela: string[] = [...ENGINES_EM_ORDEM];
    expect(daTela.sort()).toEqual([...DA_UNIAO].sort());
  });

  test("nenhuma engine aparece duas vezes", () => {
    expect(new Set(ENGINES_EM_ORDEM).size).toBe(ENGINES_EM_ORDEM.length);
  });

  test("toda engine tem nome de exibição não vazio", () => {
    for (const e of ENGINES_EM_ORDEM) {
      expect(NOME_ENGINE[e].length).toBeGreaterThan(0);
    }
  });

  /*
   * As relacionais primeiro. Não é preferência estética: são as que reusam a
   * grade e o editor de SQL que já existem, e as duas últimas exigem outra
   * vista inteira (`docs/multi-engine.md` §2). A ordem da tela é a ordem do
   * plano, e travá-la impede que uma engine de outro modelo suba para o topo
   * como se fosse equivalente.
   */
  test("MongoDB e Redis vêm por último — eles não usam a vista de grade", () => {
    const ultimos: string[] = ENGINES_EM_ORDEM.slice(-2);
    expect(ultimos.sort()).toEqual(["mongodb", "redis"]);
  });
});
