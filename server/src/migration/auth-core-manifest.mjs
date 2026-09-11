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

export const AUTH_CORE_TABLES = Object.freeze([
  table({
    name: "organizations",
    columns: ["id","name","legal_name","base_currency","timezone","fiscal_year_start_month","status","created_at","updated_at","branding_json"],
    conflict: ["id"],
  }),
  table({
    name: "users",
    columns: ["id","email","display_name","password_hash","status","created_at","updated_at","email_verified_at"],
    conflict: ["id"],
  }),
  table({
    name: "memberships",
    columns: ["organization_id","user_id","role","scopes","created_at","updated_at"],
    conflict: ["organization_id","user_id"],
    dependencies: ["organizations","users"],
  }),
  table({
    name: "accounts",
    columns: ["id","organization_id","code","name","type","subtype","normal_balance","currency","allow_posting","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["allow_posting","active"],
    dependencies: ["organizations"],
  }),
  table({
    name: "api_keys",
    columns: ["id","organization_id","name","prefix","key_hash","scopes","expires_at","last_used_at","revoked_at","created_by","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations"],
  }),
  table({
    name: "sessions",
    columns: ["id","user_id","organization_id","refresh_token_hash","expires_at","revoked_at","ip_address","user_agent","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["users","organizations"],
  }),
  table({
    name: "school_user_profiles",
    columns: ["organization_id","user_id","username","phone","profile_photo_url","signature_url","staff_number","status","force_password_change","failed_login_count","locked_until","last_login_at","notification_preferences_json","recovery_json","security_json","created_by","created_at","updated_at"],
    conflict: ["organization_id","user_id"],
    booleans: ["force_password_change"],
    dependencies: ["organizations","users"],
  }),
  table({
    name: "school_login_aliases",
    columns: ["id","organization_id","user_id","alias_type","alias_normalized","verified_at","created_at"],
    conflict: ["id"],
    dependencies: ["organizations","users"],
  }),
  table({
    name: "school_user_mfa",
    columns: ["organization_id","user_id","method","secret_encrypted","recovery_code_hashes_json","enabled","verified_at","created_at","updated_at"],
    conflict: ["organization_id","user_id","method"],
    booleans: ["enabled"],
    dependencies: ["organizations","users"],
  }),
  table({
    name: "school_login_events",
    columns: ["id","organization_id","user_id","identifier","event_type","ip_address","user_agent","device_json","reason","created_at"],
    conflict: ["id"],
    dependencies: ["organizations","users"],
  }),
]);

export function getAuthCoreTable(name) {
  return AUTH_CORE_TABLES.find((item) => item.name === name) ?? null;
}
