# ATRITO

Registro de fricção do uso real (DBee.md §10).

Toda vez que a ferramenta atrapalhar, uma linha aqui **no momento em que doeu**.
Sem formatar, sem julgar se vale, sem abrir issue na hora.

Também é onde vai ideia boa que está fora do escopo da fase atual — para não
virar código antes da hora (CLAUDE.md, "O que não fazer sem perguntar").

Formato:

```
AAAA-MM-DD · o que aconteceu, em uma linha
```

**Triagem semanal de 15 min:** lê o arquivo, converte o que sobreviveu em issue
com label `atrito`, limpa o resto. O que aparecer 3 vezes vira prioridade
automática.

---

2026-09-04 · a tela de conexões subiu sem revisão visual — a extensão do Chrome não estava conectada, então validei só por build (tokens no CSS, classes presentes, tipo e lint limpos) e nunca vi a página renderizada. Pendente: screenshot em 375/768/1024/1440 e revisão.

2026-09-04 · headers de segurança da §7 (CSP, X-Content-Type-Options, Referrer-Policy) ainda não existem. **Disparo: ao ligar o `@elysiajs/static`.** Enquanto o server só devolve JSON não há página a proteger e falta só o `nosniff`; no commit que passar a servir o build do web, a CSP vira dívida imediata. Registrado aqui e não só na §7 porque item de doc de arquitetura ninguém lê no dia certo.

2026-09-05 · conferência de contrato para o autocomplete da v0.3 (não implementar agora). O `GET /connections/:id/schema` **atende** o que o `@codemirror/lang-sql` 6.10 precisa: o `SQLNamespace` dele é `{ [nome]: SQLNamespace } | { self, children } | (Completion | string)[]`, e a árvore já dá schema → relação → coluna com `dataType` (vira `Completion.detail`) e `kind` (vira `Completion.type`). Montar o objeto é transformação pura, sem rota nova.

Duas coisas que faltam, para a fatia do editor não descobrir tarde:

1. **`search_path` / schema default não é exposto.** O `SQLConfig.defaultSchema` do lang-sql é o que permite completar `SELECT * FROM cli…` sem digitar `public.` antes. Hoje `isDefault` existe só para *database*, não para schema, e nada devolve o `search_path` da sessão. Sem isso o autocomplete só funciona com nome qualificado — que é justamente o que o usuário quer evitar digitar.

2. **A árvore é pesada para alimentar autocomplete.** Ela carrega índices, FKs, comentários, defaults e `estimatedRows` de toda relação; o editor precisa só de nome e tipo. Num banco com centenas de tabelas isso é bastante JSON por montagem do editor. Não é bloqueio — o cache de 5 min já cobre, e a árvore é buscada de qualquer forma para a navegação — mas se o editor ficar lento, é aqui que se olha primeiro, e a saída é um parâmetro de projeção na rota, não uma rota nova.
