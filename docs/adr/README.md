# ADR — Architecture Decision Records

Uma decisão de arquitetura que alguém (inclusive você, em seis meses) vai
questionar mora aqui. Não em comentário de código, não no commit, não só no
`DBee.md`.

## Quando escrever

Quando a resposta para "por que isso é assim?" não for óbvia lendo o código, e
quando a alternativa descartada for razoável. Escolha de driver, formato de
serialização, modelo de transação, o que quer que tenha custado uma tarde.

Não escreva ADR para decisão sem alternativa real ("usar TypeScript") nem para
detalhe que o código já explica.

## Como

Um arquivo por decisão: `NNN-titulo-em-kebab-case.md`, `NNN` sequencial a partir
de `001`, nunca reaproveitado.

```markdown
# NNN. Título da decisão

- **Status:** proposto | aceito | substituído por [NNN](NNN-outro.md)
- **Data:** AAAA-MM-DD

## Contexto

O que forçou a decisão. Restrições reais, não teoria.

## Decisão

O que foi decidido, na voz ativa: "usamos X".

## Consequências

O que fica mais fácil, o que fica mais difícil, o que passa a ser proibido.
Inclua o custo — ADR que só lista vantagem não está terminado.

## Alternativas consideradas

Cada uma com o motivo real da recusa.
```

ADR não se edita depois de aceito. Mudou de ideia? Novo ADR, e o antigo vira
`substituído por`.
