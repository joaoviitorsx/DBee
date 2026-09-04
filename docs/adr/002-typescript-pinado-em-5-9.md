# 002. TypeScript pinado em 5.9.3

- **Status:** aceito
- **Data:** 2026-09-04

## Contexto

TypeScript 7 já está publicado (7.0.2 na data deste ADR). O `typescript-eslint`
8.69, porém, declara:

```json
"peerDependencies": { "typescript": ">=4.8.4 <6.1.0" }
```

Com TS 7 instalado, o lint type-aware não roda. E é o lint type-aware que
justifica ter escolhido ESLint em vez de Biome ou oxlint: `no-floating-promises`
e `no-misused-promises` são as regras que pegam transação que nunca fecha e
conexão vazada — a classe de bug que mais dói num cliente de banco, e a que
menos aparece em teste.

## Decisão

`"typescript": "5.9.3"` no `package.json` da raiz, **versão exata, sem `^`**,
para não subir sozinho num `bun install`.

Entre "compilador da última versão" e "lint que entende tipos", fica o lint.

## Consequências

- `bun install` avisa `typescript@5.9.3 (v7.0.2 available)` a cada execução. É
  ruído esperado, não pendência.
- O workspace fica sem as melhorias de performance do compilador nativo do TS 7
  até a condição de saída ser satisfeita. Num monorepo deste tamanho, o
  typecheck leva menos de um segundo — o custo é teórico.
- Recurso novo de linguagem do TS 7 não está disponível. Nenhum é necessário
  hoje.

## Condição de saída

**Soltar o pin quando `typescript-eslint` publicar versão cujo peer de
`typescript` aceite 7.x.** Verificar com:

```bash
bun pm view typescript-eslint peerDependencies
```

Quando aceitar, subir `typescript` e `typescript-eslint` juntos, rodar
`bun run typecheck && bun run lint && bun test`, e trocar a versão exata por
faixa (`^7.x`). Este ADR passa a `substituído por` no ADR que registrar a
subida — ou, se não houver decisão nova a registrar, basta o `CHANGELOG.md`.

Sem essa condição escrita, um pin exato vira dívida invisível: ninguém
reavalia porque ninguém lembra por que existe.

## Alternativas consideradas

**TS 7 + Biome ou oxlint.** Recusada: nenhum dos dois faz análise type-aware,
então perderíamos exatamente as regras que motivaram a escolha do linter. Trocar
a garantia pelo compilador mais novo é o inverso da prioridade.

**TS 7 + ESLint sem regras type-aware.** Recusada pelo mesmo motivo, com a
desvantagem extra de manter o peso do ESLint sem o que ele tem de melhor.

**Faixa `^5.9.3` em vez de versão exata.** Recusada: `^5.9.3` já cobriria um
eventual 5.10 sem problema, mas versão exata deixa explícito que o número está
travado por uma razão, e este ADR é onde a razão mora. Um `^` convida a alguém a
"só atualizar" sem ler.
