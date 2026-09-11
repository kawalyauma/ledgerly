const bool = (value) => value == null ? value : Boolean(Number(value));

function table({ name, columns, conflict, booleans = [], dependencies = [] }) {
  return Object.freeze({
    name,
    columns: Object.freeze(columns),
    conflict: Object.freeze(conflict),
    dependencies: Object.freeze(dependencies),
    transform(row) {
      const next = {};
      for (const column of columns) next[column] = row[column] ?? null;
      for (const column of booleans) if (next[column] != null) next[column] = bool(next[column]);
      return next;
    },
  });
}

export const MODULE_REGISTRY_TABLES = Object.freeze([
  table({
    name: "app_modules",
    columns: ["module_key","name","version","description","category","core","manifest_json","active","created_at","updated_at"],
    conflict: ["module_key"],
    booleans: ["core","active"],
  }),
  table({
    name: "organization_modules",
    columns: ["organization_id","module_key","enabled","configuration_json","enabled_by","enabled_at","disabled_at","created_at","updated_at"],
    conflict: ["organization_id","module_key"],
    booleans: ["enabled"],
    dependencies: ["organizations","app_modules","users"],
  }),
]);
