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
