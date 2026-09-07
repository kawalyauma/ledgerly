import { moduleCatalog } from "../../modules/catalog.generated";

export type EnabledModule = { key: string; name: string; category: string; core: boolean; manifest: Record<string, unknown> };

export async function getEnabledModules(db: D1Database, organizationId: string): Promise<EnabledModule[]> {
  const rows = await db.prepare("SELECT module_key AS moduleKey,enabled FROM organization_modules WHERE organization_id=?").bind(organizationId).all<{moduleKey:string;enabled:number}>();
  const overrides = new Map(rows.results.map(row => [row.moduleKey, Boolean(row.enabled)]));
  return moduleCatalog.filter(module => module.active && (module.core || overrides.get(module.key) === true)).map(module => ({ key: module.key, name: module.name, category: module.category, core: module.core, manifest: module.manifest as unknown as Record<string, unknown> }));
}

export const enabledModuleKeys = async (db: D1Database, organizationId: string) => new Set((await getEnabledModules(db, organizationId)).map(module => module.key));
