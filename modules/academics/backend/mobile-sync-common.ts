import { AppError } from "../../../src/lib/errors";
import type { MobileSyncMutationContext } from "../../mobile-sync/backend/contracts";
import { canManageTeacher } from "./mobile-sync-permissions";

export type R = Record<string, any>;
const stable = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,149}$/;
export const guard = (db: D1Database, collection: string, id: string, org: string) => db.prepare("INSERT OR REPLACE INTO academics_mobile_sync_suppression(record_key) VALUES (?)").bind(`${org}:${collection}:${id}`);
export const unguard = (db: D1Database, collection: string, id: string, org: string) => db.prepare("DELETE FROM academics_mobile_sync_suppression WHERE record_key=?").bind(`${org}:${collection}:${id}`);
export async function own(c: MobileSyncMutationContext, teacher: string) {
  if (!await canManageTeacher(c, teacher)) throw new AppError(403, "FORBIDDEN", "You cannot change another teacher's academic records from mobile");
}
export function requireStableId(id: string, label: string) {
  if (!stable.test(id)) throw new AppError(422, "INVALID_RECORD_ID", `${label} IDs must be stable UUID-style identifiers`);
}
