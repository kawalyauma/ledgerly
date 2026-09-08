import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { exchangeOfflineGrant } from "./device-service";

export const mobileSyncPublicRoutes = new Hono<{ Bindings: Env }>();

const exchange = z.object({
  deviceId: z.string().trim().min(8).max(160),
  offlineGrant: z.string().trim().min(32).max(512),
  appVersion: z.string().trim().min(1).max(40).optional(),
  clientSchemaVersion: z.number().int().positive().optional(),
});

mobileSyncPublicRoutes.post("/exchange", async c => {
  const parsed = exchange.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid offline grant exchange request", parsed.error.flatten());
  return c.json({ data: await exchangeOfflineGrant(c.env, parsed.data) });
});
