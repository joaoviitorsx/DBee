import { t, type Static } from "elysia";

/** `GET /api/health` — 200 se o app respondeu (DBee.md §8). */
export const HealthResponse = t.Object({
  status: t.Literal("ok"),
});
export type HealthResponse = Static<typeof HealthResponse>;

/**
 * Estado da atualização (DBee.md §8).
 *
 * `current` sai do binário: é injetado em tempo de compilação pelo Dockerfile
 * (`--define process.env.DBEE_VERSION`), não lido de `package.json` — a imagem
 * de runtime é `debian-slim` e não tem `package.json` nenhum. Fora do container
 * o valor é `dev`, e `dev` **nunca** compara com tag: um ambiente de
 * desenvolvimento não avisa que está desatualizado.
 *
 * `latest` é anulável de propósito. Rede caída, GitHub fora do ar ou verificação
 * desligada não são erro desta rota — o header não pode quebrar porque a
 * api.github.com não respondeu. Nesse caso vem `null` e `checkedAt` fica com o
 * horário da última verificação que deu certo, se houve alguma.
 *
 * `webhookConfigured` é booleano, **nunca a URL**. Quem tem a URL de deploy
 * redeploya o serviço; ela é credencial (CLAUDE.md regra 5) e não sai da API em
 * nenhuma resposta, nem de erro.
 */
export const VersionStatus = t.Object({
  current: t.String(),
  latest: t.Union([t.String(), t.Null()]),
  updateAvailable: t.Boolean(),
  releaseUrl: t.Union([t.String(), t.Null()]),
  releaseNotesUrl: t.String(),
  checkedAt: t.Union([t.String(), t.Null()]),
  autoCheck: t.Boolean(),
  webhookConfigured: t.Boolean(),
});
export type VersionStatus = Static<typeof VersionStatus>;

/**
 * Ajustes da atualização.
 *
 * `webhookUrl` chega em claro (a sessão já exige HTTPS na frente) e é guardada
 * cifrada com a mesma AES-256-GCM das senhas de conexão. `null` limpa o valor —
 * é como se desconfigura sem editar banco à mão. Ausente é "não mexe", que é
 * diferente de `null`: alternar `autoCheck` não pode apagar a URL.
 */
export const UpdateSettingsRequest = t.Object({
  autoCheck: t.Optional(t.Boolean()),
  webhookUrl: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
});
export type UpdateSettingsRequest = Static<typeof UpdateSettingsRequest>;

/** `POST /api/meta/update` — o webhook aceitou o disparo. */
export const UpdateTriggered = t.Object({
  triggered: t.Literal(true),
});
export type UpdateTriggered = Static<typeof UpdateTriggered>;
