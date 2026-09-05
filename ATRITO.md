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

2026-09-05 · revisão de interface contra a premissa da v0.1 apontou que **o app não abre pela tailnet**: o `Dockerfile` copia o build do web para `/app/public` e nada no server lê esse diretório — não há `@elysiajs/static` em lugar nenhum. Hoje o DBee só existe como `bun run dev` na máquina do autor, com Vite em `:5173`, que é literalmente o "setup por máquina" que a §1 diz que a ferramenta existe para eliminar. Sem isso, nenhum outro item importa.

2026-09-05 · **o executor de query está inalcançável pela interface.** Rota, serviço, cursor, correção de position e query_log estão prontos e testados, e não existe nenhum caminho para criar uma aba de query: `workspace.ts` não tem `openQuery()`, o menu da árvore não tem o item, a barra de abas não tem "+". Foi decisão explícita de escopo na fatia do executor (as quatro portas de entrada foram excluídas), mas o efeito prático é que a funcionalidade não pode ser usada.

2026-09-05 · **a busca da árvore só filtra o que já foi expandido.** `filterSchema` roda sobre `schema?.data`, que só existe depois de expandir conexão *e* database. Com tudo fechado — que é o estado ao abrir o app — digitar no campo não produz efeito nenhum. A tela afirma uma capacidade que não tem, e o item está marcado como concluído no CHANGELOG.

2026-09-05 · **servidor fora do ar diz "Nenhuma conexão ainda".** `App.tsx` usa `query.data ?? []` e nunca lê `isError` nem `isPending`. Com a API caída, a tela afirma que as conexões do usuário não existem. É a classe de defeito que a definição de pronto nomeia: a tela afirmando a coisa errada.

2026-09-05 · **excluir conexão não pede confirmação.** O item está no menu de contexto e é navegável por seta + Enter: uma seta a mais apaga a conexão de produção e a senha cifrada, sem volta.

2026-09-05 · **nada sobrevive a fechar a aba do navegador**: abas abertas, expansão da árvore, largura do painel, saúde das conexões e o SQL que estava sendo escrito. O SQL some inclusive só ao trocar de aba, porque o componente é remontado por `key`. O ciclo "volto amanhã e reencontro o que estava fazendo" não existe em nenhum eixo.

2026-09-05 · **o histórico existe no banco e na rota, e não na tela.** `GET /connections/:id/history` responde e `query_log` grava tudo; nenhum componente consome. "Aquela query do fechamento" está gravada e inalcançável.

2026-09-05 · **não dá para saber em qual servidor você está.** A árvore mostra o nome que o usuário deu; a barra superior mostra nome + database.schema.relação. O `host:porta` nunca aparece. Duas conexões chamadas "Produção Assertivus" apontando para hosts diferentes são indistinguíveis sem abrir o formulário — e a §2.1 do design system reserva a mono justamente para esse endereço.

2026-09-05 · **os três estados de carregamento documentados no §7 são código morto** desde a fatia do shell. Ver o aviso no próprio design-system.md.

2026-09-05 · **acessibilidade: selecionar coluna é mouse-only** (`<tr onClick>` sem tabIndex, role ou onKeyDown), e como o inspetor só abre por seleção de coluna, o inspetor inteiro é inacessível por teclado. O menu de contexto nunca move o foco do DOM. A árvore não usa `role="tree"`. Contradiz "a ferramenta é operada por teclado" do §6.
