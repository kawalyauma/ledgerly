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

export const SCHOOL_REFERENCE_TABLES = Object.freeze([
  table({
    name: "school_profiles",
    columns: ["organization_id","school_code","registration_number","logo_url","motto","school_type","ownership_type","education_level","curriculum","phone_numbers_json","email_addresses_json","website","physical_address","postal_address","country","district_region","location_text","head_teacher_name","head_teacher_phone","head_teacher_email","language","timezone","date_format","time_format","default_currency","multi_campus_enabled","branding_json","system_preferences_json","created_at","updated_at"],
    conflict: ["organization_id"],
    booleans: ["multi_campus_enabled"],
    dependencies: ["organizations"],
  }),
  table({
    name: "school_branches",
    columns: ["id","organization_id","code","name","registration_number","phone","email","physical_address","postal_address","district_region","location_text","principal_name","is_main","active","metadata_json","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["is_main","active"],
    dependencies: ["organizations"],
  }),
  table({
    name: "school_academic_years",
    columns: ["id","organization_id","code","name","starts_on","ends_on","status","is_current","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["is_current"],
    dependencies: ["organizations"],
  }),
  table({
    name: "school_terms",
    columns: ["id","organization_id","academic_year_id","code","name","sequence_no","starts_on","ends_on","status","is_current","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["is_current"],
    dependencies: ["organizations","school_academic_years"],
  }),
  table({
    name: "school_departments",
    columns: ["id","organization_id","campus_id","code","name","description","head_user_id","parent_id","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["active"],
    dependencies: ["organizations","school_branches","users","school_departments"],
  }),
  table({
    name: "school_class_levels",
    columns: ["id","organization_id","code","name","sequence_no","education_level","promotion_level_id","terminal","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["terminal","active"],
    dependencies: ["organizations","school_class_levels"],
  }),
  table({
    name: "school_classes",
    columns: ["id","organization_id","academic_year_id","campus_id","class_level_id","department_id","code","name","capacity","class_teacher_user_id","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["active"],
    dependencies: ["organizations","school_academic_years","school_branches","school_class_levels","school_departments","users"],
  }),
  table({
    name: "school_streams",
    columns: ["id","organization_id","class_id","campus_id","code","name","capacity","class_teacher_user_id","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["active"],
    dependencies: ["organizations","school_classes","school_branches","users"],
  }),
  table({
    name: "school_subjects",
    columns: ["id","organization_id","department_id","code","name","short_name","subject_type","curriculum_code","pass_mark","max_mark","active","metadata_json","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["active"],
    dependencies: ["organizations","school_departments"],
  }),
  table({
    name: "school_class_subjects",
    columns: ["id","organization_id","class_level_id","subject_id","academic_year_id","compulsory","periods_per_week","teacher_user_id","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["compulsory","active"],
    dependencies: ["organizations","school_class_levels","school_subjects","school_academic_years","users"],
  }),
  table({
    name: "school_lesson_periods",
    columns: ["id","organization_id","campus_id","code","name","sequence_no","starts_at","ends_at","period_type","teaching_period","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["teaching_period","active"],
    dependencies: ["organizations","school_branches"],
  }),
]);
