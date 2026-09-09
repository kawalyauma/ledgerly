import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { registerDevice, listDevices, revokeDevice, assertOwnedActiveDevice } from "./device-service";
import { getMobileSyncCollection, listMobileSyncCollections } from "./registry";
import { acknowledgeBootstrap, acknowledgePull, acknowledgeSchemas, bootstrap, mobileSyncManifest, pull, push, recoveryState } from "./sync-service";

export const mobileSyncRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const id = z.string().trim().min(8).max(160);
const registration = z.object({
  installationId: z.string().trim().min(16).max(128),
  deviceName: z.string().trim().min(1).max(120),
  platform: z.enum(["android", "ios"]),
  appVersion: z.string().trim().min(1).max(40),
  clientSchemaVersion: z.number().int().positive(),
  deviceModel: z.string().trim().max(120).nullable().optional(),
  osVersion: z.string().trim().max(80).nullable().optional(),
});
const dependency = z.union([
  z.object({ operationId: id }),
  z.object({ moduleKey: z.string().trim().min(1).max(80), collectionKey: z.string().trim().min(1).max(80), recordId: id, minVersion: z.number().int().nonnegative().optional() }),
]);
const mutation = z.object({
  operationId: id,
  sequence: z.number().int().positive(),
  moduleKey: z.string().trim().min(1).max(80),
  collectionKey: z.string().trim().min(1).max(80),
  recordId: id,
  kind: z.enum(["upsert", "delete"]),
  schemaVersion: z.number().int().positive(),
  baseVersion: z.number().int().nonnegative(),
  clientTimestamp: z.string().trim().min(10).max(64),
  payload: z.unknown().optional(),
  dependencies: z.array(dependency).max(50).default([]),
});
const pushBody = z.object({ deviceId: id, batchId: id, protocolVersion: z.number().int().positive(), operations: z.array(mutation).min(1).max(250) });
const collection = z.object({ moduleKey: z.string().trim().min(1).max(80), collectionKey: z.string().trim().min(1).max(80) });
const pullBody = z.object({ deviceId: id, requestId: id, protocolVersion: z.number().int().positive(), collections: z.array(collection.extend({ limit: z.number().int().positive().max(1000).optional() })).min(1).max(100) });
const bootstrapBody = z.object({ deviceId: id, protocolVersion: z.number().int().positive(), collections: z.array(collection).min(1).max(100) });
const schemasBody = z.object({ deviceId: id, schemas: z.array(collection.extend({ schemaVersion: z.number().int().positive() })).min(1).max(100) });
const ackPullBody = z.object({ deviceId: id, acknowledgements: z.array(z.object({ deliveryId: id, cursor: z.number().int().nonnegative() })).min(1).max(100) });
const ackBootstrapBody = z.object({ deviceId: id, bootstrapId: id });

async function json<T extends z.ZodTypeAny>(c: any, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid mobile synchronization request", parsed.error.flatten());
  return parsed.data;
}

async function authorizeCollections(c:any,deviceId:string,items:Array<{moduleKey:string;collectionKey:string}>,direction:"pull"|"push") {
  const principal=c.get("principal"),seen=new Set<string>();
  for(const item of items){
    const key=`${item.moduleKey}:${item.collectionKey}`;if(seen.has(key))continue;seen.add(key);
    const definition=getMobileSyncCollection(item.moduleKey,item.collectionKey);if(!definition)continue;
    const authorize=direction==="pull"?definition.authorizePull:definition.authorizePush;
    if(authorize)await authorize({db:c.env.FINANCE_DB,principal,organizationId:principal.organizationId,userId:principal.userId,deviceId});
  }
}

function hasScope(principal:any,scope?:string){return !scope||principal.role==="owner"||principal.role==="admin"||Array.isArray(principal.scopes)&&principal.scopes.includes(scope)}

mobileSyncRoutes.get("/manifest", c => c.json({ data: mobileSyncManifest() }));
mobileSyncRoutes.get("/eligible/:deviceId", async c => {
  const deviceId=c.req.param("deviceId"),principal=c.get("principal");
  await assertOwnedActiveDevice(c.env.FINANCE_DB,principal,deviceId);
  const eligible=[] as Array<{moduleKey:string;collectionKey:string;schemaVersion:number;minClientSchemaVersion:number;mode:string;sourceOfTruth:string;conflictPolicy:string}>;
  for(const definition of listMobileSyncCollections()){
    if(!hasScope(principal,definition.pullScope))continue;
    if(definition.authorizePull){
      try{await definition.authorizePull({db:c.env.FINANCE_DB,principal,organizationId:principal.organizationId,userId:principal.userId,deviceId})}
      catch(error){if(error instanceof AppError&&(error.status===403||error.status===404))continue;throw error}
    }
    eligible.push({moduleKey:definition.moduleKey,collectionKey:definition.collectionKey,schemaVersion:definition.schemaVersion,minClientSchemaVersion:definition.minClientSchemaVersion??definition.schemaVersion,mode:definition.mode,sourceOfTruth:definition.sourceOfTruth,conflictPolicy:definition.conflictPolicy});
  }
  return c.json({data:{deviceId,collections:eligible}});
});
mobileSyncRoutes.post("/devices", async c => {
  const input = await json(c, registration);
  return c.json({ data: await registerDevice(c.env.FINANCE_DB, c.get("principal"), input) }, 201);
});
mobileSyncRoutes.get("/devices", async c => c.json({ data: await listDevices(c.env.FINANCE_DB, c.get("principal")) }));
mobileSyncRoutes.post("/devices/:id/revoke", async c => {
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
  return c.json({ data: await revokeDevice(c.env.FINANCE_DB, c.get("principal"), c.req.param("id"), String(body.reason ?? "").trim() || undefined) });
});
mobileSyncRoutes.post("/schemas/ack", async c => {
  const input = await json(c, schemasBody);
  return c.json({ data: await acknowledgeSchemas(c.env.FINANCE_DB, c.get("principal"), input) });
});
mobileSyncRoutes.post("/bootstrap", async c => {
  const input = await json(c, bootstrapBody);
  await authorizeCollections(c,input.deviceId,input.collections,"pull");
  return c.json({ data: await bootstrap(c.env.FINANCE_DB, c.get("principal"), input) });
});
mobileSyncRoutes.post("/bootstrap/ack", async c => {
  const input = await json(c, ackBootstrapBody);
  return c.json({ data: await acknowledgeBootstrap(c.env.FINANCE_DB, c.get("principal"), input) });
});
mobileSyncRoutes.post("/push", async c => {
  const input = await json(c, pushBody);
  await authorizeCollections(c,input.deviceId,input.operations,"push");
  return c.json({ data: await push(c.env.FINANCE_DB, c.get("principal"), input) });
});
mobileSyncRoutes.post("/pull", async c => {
  const input = await json(c, pullBody);
  await authorizeCollections(c,input.deviceId,input.collections,"pull");
  return c.json({ data: await pull(c.env.FINANCE_DB, c.get("principal"), input) });
});
mobileSyncRoutes.post("/pull/ack", async c => {
  const input = await json(c, ackPullBody);
  return c.json({ data: await acknowledgePull(c.env.FINANCE_DB, c.get("principal"), input) });
});
mobileSyncRoutes.get("/recovery/:deviceId", async c => {
  return c.json({ data: await recoveryState(c.env.FINANCE_DB, c.get("principal"), c.req.param("deviceId"), c.req.query("batchId")) });
});
