# CLAUDE.md — DBee

Instruções para agentes trabalhando neste repo. Leia `docs/DBee.md` antes de qualquer tarefa: ele é a fonte da verdade sobre escopo, arquitetura e decisões.

## O que é

Cliente PostgreSQL web self-hosted, usado em produção pelo autor no trabalho diário. **Isso não é um projeto de brinquedo** — bug aqui vira trabalho parado. Prefira correto e chato a esperto e frágil.

Stack: **Bun + Elysia + React**. Não é Node, não é Express, não é Fastify. Não sugira equivalentes de Node quando existir primitiva nativa do Bun.

## Comandos

```bash
bun install
bun run dev              # server :3001 + web :5173
bun test
bun run typecheck        # tsc --noEmit no workspace
bun run lint
bun run build            # web (Vite) + server (bun build --compile)
docker build -t dbee .
```

## Regras não negociáveis

1. **TypeScript strict.** Nada de `any`. Se o tipo está difícil, o desenho está errado.
2. **Validação com TypeBox (`t` do Elysia)** nas rotas, com os schemas em `packages/shared`. Não introduzir Zod — quebraria Eden e OpenAPI.
3. **Primitivas do Bun antes de dependência externa:** `bun:sqlite`, `Bun.password`, `Bun.file`, `bun test`. Só instale pacote se o Bun não resolver.
4. **Nada de módulo nativo no backend.** Quebra `bun build --compile`.
5. **Nunca logar nem retornar credencial.** Nem em erro, nem em debug, nem em exceção.
6. **Nunca conectar no PgBouncer (6432).** Sempre 5432 direto.
7. **Streaming é `DECLARE CURSOR` em SQL, com `FETCH` em lotes.** Não trazer `pg-cursor` nem `pg-query-stream`. `FETCH n` materializa n linhas na memória — export sempre em laço. Ver §6.
8. **Nunca validar SQL do usuário com regex ou parser.** A proteção contra escrita de linhas é o modo da transação: `BEGIN READ ONLY` (ou `BEGIN READ WRITE` no modo escrita), declarado no próprio `BEGIN`. **`SET LOCAL default_transaction_read_only` não protege a transação corrente** — se aparecer no código, é regressão de segurança. Ver §6 e §11.4b.

   **Ressalva de contenção (§11.37):** READ ONLY barra DML e DDL, **não** `COPY … TO PROGRAM`. Num papel superusuário isso é execução de comando no host do Postgres, dentro de uma conexão "somente leitura". Não dá para consertar sem parser (que esta regra proíbe); a mitigação é detectar o papel privilegiado no teste de conexão e avisar. Read-only é proteção contra o acidente comum, não caixa de contenção contra um papel privilegiado.
9. **Nunca montar o socket do Docker** no container do app.
10. **Todo valor de célula trafega como string.** Não confie na conversão automática de tipos do driver.
11. **Grid sempre virtualizado.** Nenhum `.map()` direto sobre linhas de resultado.

## Ao escrever código

- Rotas Elysia: um plugin por domínio em `apps/server/src/routes/`, compostos na instância principal. Use `.derive()` para contexto (sessão, conexão resolvida) em vez de repetir lookup em cada handler.
- O front consome a API por **Eden Treaty**, tipado a partir do tipo exportado do server. Não escreva client HTTP manual nem duplique tipos de resposta.
- Acesso ao SQLite só via repositórios em `apps/server/src/db/` — nada de SQL espalhado por rota. Use statements preparados do `bun:sqlite`.
- Erro de banco vira resposta com `code`, `message` e, quando existir, `position`, para a UI destacar no editor. Não engolir o erro do Postgres: ele é informação útil pro usuário.
- Componente novo no front: shadcn/ui primeiro, componente próprio só se não existir.
- Nada de CDN em runtime. Tudo bundlado.

## Definição de pronto

**Build limpo não é evidência.** Os três bugs mais graves do projeto até aqui — a
sessão read-only que não protegia nada, o `PATCH` que reapontava a conexão para
outro servidor, e o 422 que devolvia a senha do banco em claro — passavam por
typecheck, lint e a suíte inteira. Nenhum foi encontrado por teste unitário.
Todos apareceram em teste contra serviço real ou em revisão adversarial.

Por isso os itens 4 e 5 abaixo não são etapa opcional no fim: são o que
distingue "compila" de "funciona".

1. `bun run typecheck && bun run lint && bun test` — tem que passar. O `lint`
   inclui `check:bytes`, que barra byte de controle em fonte (§11.24).
2. Atualizar `CHANGELOG.md` se mudou comportamento visível.
3. Se a mudança contradiz algo em `docs/DBee.md`, atualizar o doc na mesma
   alteração. Doc desatualizado é pior que doc ausente.
4. **Teste de integração contra serviço real.** Fatia que toca Postgres roda
   contra um Postgres de verdade — container descartável serve — e o resultado
   é conferido, não presumido.
4b. **Fatia de UI não fecha sem screenshot.** Nos quatro breakpoints (375 · 768
   · 1024 · 1440), com a tela em estado real, não vazia. Build verde não conta.

   **Teste verifica comportamento; pixel verifica significado.** Os cinco
   defeitos da fatia de layout passaram por 466 asserções: cor de tag
   competindo com cor de estado, selo de PK herdando o âmbar que significa
   escrita, selo truncando o nome da conexão gravável. Nenhum é acabamento —
   os três são a tela afirmando a coisa errada, e nenhum teste de
   comportamento tem como notar.

   **Caminho padrão — Chrome headless por CDP**, não contorno da extensão:

   ```bash
   flatpak run --filesystem=home com.google.Chrome \
     --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
     --remote-debugging-port=9222 --user-data-dir="$HOME/.dbee-chrome" \
     "http://localhost:5173/"
   ```

   Depois, por WebSocket em `http://127.0.0.1:9222/json`:
   `Emulation.setDeviceMetricsOverride` redimensiona, `Runtime.evaluate` clica,
   `Page.captureScreenshot` captura. Isso permite navegar até um estado real —
   árvore expandida, aba aberta, menu de contexto — em vez de fotografar a
   tela inicial.
5. **Uma passada de revisão focada em segurança**, adversarial, antes de fechar.
   Perguntas mínimas: credencial vaza por algum caminho, inclusive de erro? SQL
   é montado por concatenação em algum lugar? Existe caminho que abre transação
   fora de `BEGIN READ ONLY`? Entrada do usuário chega a algum comando sem
   validação?
6. Decisão de arquitetura que alguém questionaria depois →
   `docs/adr/NNN-titulo.md`.
7. Todo número afirmado em documentação precisa de teste que o trave
   (`docs/design-system.md`), e toda rota declara `response` — foi a validação
   de resposta, não um teste, que pegou o `array_agg` devolvendo string crua.

## O que não fazer sem perguntar

- Adicionar dependência nova de peso (ORM, framework alternativo, biblioteca de UI concorrente).
- Trocar TypeBox por outro validador.
- Mudar o modelo de dados do SQLite sem migration.
- Introduzir serviço adicional no compose — o princípio "um container" é deliberado.
- Ampliar escopo além do roadmap da fase atual. Ideia boa fora de escopo vai para `ATRITO.md`, não para o código.
