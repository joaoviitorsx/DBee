# Arquitetura

Como o código está separado e onde uma mudança deve cair. Descreve também a estrutura de pastas do projeto.

---

## Regra única

**Uma camada só conhece a de baixo.** Se um arquivo precisa importar de cima,
a responsabilidade está no lugar errado.

```
  ┌─────────────────────────────────────────────┐
  │  apps/web            React, TanStack Query   │
  │    routes/  →  hooks de dados  →  lib/api    │
  └────────────────────┬────────────────────────┘
                       │  Eden Treaty (tipos do server, sem codegen)
  ┌────────────────────┴────────────────────────┐
  │  apps/server                                 │
  │    routes/     HTTP: valida, mapeia status   │
  │       ↓                                      │
  │    services/   regra que cruza camadas       │
  │       ↓                     ↓                │
  │    db/         SQLite    pg/    Postgres     │
  │       ↓                     ↓                │
  │    lib/        cripto, config, ids           │
  └─────────────────────────────────────────────┘
                       ↑
        packages/shared  schemas TypeBox (os dois lados)
```

---

## Server — o que mora em cada pasta

| Pasta | Responsabilidade | **Não** faz |
|---|---|---|
| `routes/` | Valida entrada com TypeBox, chama o serviço, traduz falha em status HTTP | Abrir conexão, montar SQL, decidir regra |
| `services/` | Regra que envolve mais de uma fonte (SQLite + Postgres) | Conhecer `Request`, `Response` ou status |
| `db/` | SQLite: migrations, repositórios, statements preparados | Falar com Postgres, conhecer HTTP |
| `pg/` | Postgres: pools, cursor, teste de conexão, mapa de SSL | Tocar no SQLite |
| `lib/` | Utilitário puro: cripto, config, ids | Depender de qualquer camada acima |

### Por que existe `services/`

A rota de teste de conexão precisa de **duas** fontes: lê a conexão do SQLite,
decifra a senha e abre uma conexão no Postgres. Sem uma camada intermediária,
essa coordenação cai dentro do handler HTTP — e aí a mesma regra não pode ser
reaproveitada por uma CLI, um job ou um teste sem arrastar o Elysia junto.

O serviço também é onde a falha vira **tipo**, não exceção:

```ts
type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: "not_found" | "decryption_failed" }
```

A rota é o único arquivo que sabe que `not_found` é 404. O serviço não sabe o
que é 404.

### Erro do Postgres

Princípio do projeto: o erro do banco é informação útil, não ruído. Ele atravessa as
camadas intacto — `code`, `message` e, quando existir, `position` — até a UI.
Nenhuma camada engole nem reescreve.

---

## Web — o que mora em cada pasta

| Pasta | Responsabilidade | **Não** faz |
|---|---|---|
| `routes/<dominio>/` | Uma tela: apresentação e estado de interface | Chamar `fetch`, montar URL |
| `routes/<dominio>/use*.ts` | Acesso a dados: queries, mutations, invalidação | Renderizar |
| `components/ui/` | Primitivos do design system, um por arquivo | Conhecer domínio |
| `components/` | Componentes com significado no produto (`Mark`) | — |
| `lib/` | Cliente da API, `cn`, QueryClient | Conhecer tela |

O componente de tela não sabe que existe HTTP. Ele consome
`useConnections()` e recebe estado pronto — o espelho do que `services/` faz do
lado do servidor.

### Eden Treaty

`lib/api.ts` é o **único** ponto que fala com a rede, tipado a partir do tipo
exportado do server. Mudar uma rota quebra o build do web — comportamento
desejado, não bug a contornar com `any`.

Consequência prática: o `tsc` do web atravessa o fonte de `apps/server`. É por
isso que `apps/web/src/env.d.ts` declara o módulo `*.sql` — sem ela o typecheck
do web quebra num arquivo que não é dele.

---

## `packages/shared`

Só schemas TypeBox e os tipos derivados deles. É a única coisa que os dois lados
importam, e não pode depender de nenhum dos dois.

Um schema nasce aqui quando aparece numa rota — nunca antes, para o pacote não
virar depósito de tipo especulativo.

---

## Onde cai uma mudança

| Mudança | Onde |
|---|---|
| Campo novo em conexão | migration + `shared` + repositório + formulário |
| Regra nova de validação de entrada | schema TypeBox em `shared` |
| Regra que cruza SQLite e Postgres | `services/` |
| Status HTTP diferente para um caso | `routes/`, no mapa de falhas |
| Cor, espaçamento, tipo | `apps/web/src/index.css` (`@theme`) e `docs/design-system.md` |
| Componente visual reutilizável | `components/ui/`, um arquivo por componente |

---

## Testes

`bun test`, colocados ao lado do que testam (`crypto.test.ts` junto de
`crypto.ts`). Três níveis:

- **Unidade** — `lib/`, `pg/ssl`, `db/migrate`: puros, rápidos.
- **Integração** — `app.test.ts` roda a app inteira contra SQLite em memória via
  `app.handle()`, sem abrir porta.
- **Contra Postgres real** — feito à mão com container descartável. Não entra no
  CI: o CI não deve depender de banco externo.

Custo a saber: `openTestStore()` deriva a chave scrypt (~700 ms). Deriva uma vez
por suíte, no `beforeAll` — nunca por teste.
