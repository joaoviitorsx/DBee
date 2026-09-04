import { t, type Static } from "elysia";

/** `GET /api/health` — 200 se o app respondeu (DBee.md §8). */
export const HealthResponse = t.Object({
  status: t.Literal("ok"),
});
export type HealthResponse = Static<typeof HealthResponse>;
