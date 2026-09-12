const SPECS=Object.freeze([
  {table:'acad_rooms',collection:'scheduling',prefix:'room',entityType:'room',actor:'created_by'},
  {table:'acad_teacher_availability',collection:'scheduling',prefix:'availability',entityType:'availability',actor:'created_by'},
  {table:'acad_timetables',collection:'scheduling',prefix:'timetable',entityType:'timetable',actor:'created_by',seedWhere:"status<>'archived'"},
  {table:'acad_timetable_entries',collection:'scheduling',prefix:'entry',entityType:'entry',actor:'created_by',seedWhere:'active=true'},
  {table:'acad_timetable_changes',collection:'scheduling',prefix:'change',entityType:'change',actor:'created_by',seedWhere:"change_date>=CURRENT_DATE-400"},
  {table:'acad_substitute_lessons',collection:'scheduling',prefix:'substitute',entityType:'substitute',actor:'created_by',seedWhere:"lesson_date>=CURRENT_DATE-400"},
  {table:'school_staff_teaching_assignments',collection:'scheduling',prefix:'allocation',entityType:'allocation',actor:'created_by',seedWhere:'active=true'},
  {table:'acad_schemes',collection:'schemes',prefix:'',entityType:'',actor:'created_by',seedWhere:"status<>'archived'"},
  {table:'acad_scheme_items',collection:'scheme-items',prefix:'',entityType:'',actor:'',exclude:['created_at']},
  {table:'acad_lesson_plan_templates',collection:'templates',prefix:'',entityType:'',actor:'created_by',seedWhere:'active=true'},
  {table:'acad_lesson_plans',collection:'lesson-plans',prefix:'',entityType:'',actor:'created_by',seedWhere:"lesson_date>=CURRENT_DATE-400"},
  {table:'acad_lesson_deliveries',collection:'deliveries',prefix:'',entityType:'',actor:'created_by',seedWhere:"scheduled_date>=CURRENT_DATE-400"},
  {table:'acad_observations',collection:'supervision',prefix:'observation',entityType:'observation',actor:'created_by',exclude:['confidential_notes'],seedWhere:"COALESCE(observed_at,scheduled_for,created_at)>=now()-interval '400 days'"},
  {table:'acad_inspections',collection:'supervision',prefix:'inspection',entityType:'inspection',actor:'created_by',exclude:['confidential_notes'],seedWhere:"inspected_on>=CURRENT_DATE-400"},
]);

function safeIdent(value){if(!/^[a-z][a-z0-9_]*$/.test(value))throw new TypeError(`Unsafe SQL identifier: ${value}`);return value;}
function literal(value){return `'${String(value).replaceAll("'","''")}'`;}
function payloadExpr(alias,spec){const excludes=spec.exclude?.length?` - ARRAY[${spec.exclude.map(literal).join(',')}]::text[]`:'';const camel=`academics_camelize_jsonb(to_jsonb(${alias})${excludes})`;return spec.entityType?`jsonb_build_object('entityType',${literal(spec.entityType)}) || ${camel}`:camel;}
function recordExpr(alias,spec){return spec.prefix?`${literal(`${spec.prefix}:`)} || ${alias}.id`:`${alias}.id`;}

export async function ensureAcademicsMobileSyncSchema(database){
  await database.query(`
    CREATE OR REPLACE FUNCTION academics_snake_to_camel(input text)
    RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE parts text[]; result text; i integer; n integer;
    BEGIN
      parts:=string_to_array(input,'_');
      result:=coalesce(parts[1],'');
      n:=coalesce(array_length(parts,1),0);
      IF n>1 THEN
        FOR i IN 2..n LOOP result:=result||upper(substr(parts[i],1,1))||substr(parts[i],2); END LOOP;
      END IF;
      RETURN result;
    END $$;

    CREATE OR REPLACE FUNCTION academics_camelize_jsonb(input jsonb)
    RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
      SELECT coalesce(jsonb_object_agg(academics_snake_to_camel(key),value),'{}'::jsonb) FROM jsonb_each(input)
    $$;

    CREATE TABLE IF NOT EXISTS academics_mobile_sync_suppression(
      record_key text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION academics_mobile_sync_emit_row()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      source jsonb;
      org_id text;
      base_id text;
      record_key text;
      suppression_key text;
      collection_name text:=TG_ARGV[0];
      prefix text:=TG_ARGV[1];
      entity_type text:=TG_ARGV[2];
      actor_column text:=TG_ARGV[3];
      excluded_csv text:=TG_ARGV[4];
      actor_id text;
      body jsonb;
      next_version bigint;
      operation_name text;
    BEGIN
      source:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
      org_id:=source->>'organization_id';
      base_id:=source->>'id';
      record_key:=CASE WHEN prefix='' THEN base_id ELSE prefix||':'||base_id END;
      suppression_key:=org_id||':'||collection_name||':'||record_key;
      IF current_setting('ledgerly.academics_mobile_sync_suppression',true)=suppression_key
         OR EXISTS(SELECT 1 FROM academics_mobile_sync_suppression s WHERE s.record_key=suppression_key) THEN
        RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
      END IF;
      actor_id:=CASE WHEN actor_column='' THEN NULL ELSE nullif(source->>actor_column,'') END;
      operation_name:=CASE WHEN TG_OP='DELETE' THEN 'delete' ELSE 'upsert' END;
      IF operation_name='upsert' THEN
        IF excluded_csv<>'' THEN source:=source-string_to_array(excluded_csv,','); END IF;
        body:=academics_camelize_jsonb(source);
        IF entity_type<>'' THEN body:=jsonb_build_object('entityType',entity_type)||body; END IF;
      ELSE body:=NULL; END IF;

      INSERT INTO mobile_sync_record_versions(organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
      VALUES(org_id,'academics',collection_name,record_key,1,operation_name='delete',now(),NULL)
      ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE
        SET version=mobile_sync_record_versions.version+1,deleted=excluded.deleted,server_updated_at=now(),last_device_id=NULL
      RETURNING version INTO next_version;

      IF operation_name='delete' THEN
        INSERT INTO mobile_sync_tombstones(organization_id,module_key,collection_key,record_id,version,deleted_at,device_id)
        VALUES(org_id,'academics',collection_name,record_key,next_version,now(),NULL)
        ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET version=excluded.version,deleted_at=now(),device_id=NULL;
      ELSE
        DELETE FROM mobile_sync_tombstones WHERE organization_id=org_id AND module_key='academics' AND collection_key=collection_name AND record_id=record_key;
      END IF;

      INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
      VALUES(org_id,'academics',collection_name,record_key,next_version,operation_name,CASE WHEN body IS NULL THEN NULL ELSE body::text END,actor_id,NULL,now());
      RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    END $$;
  `);

  for(const spec of SPECS){
    const table=safeIdent(spec.table),trigger=safeIdent(`academics_ms_${table}`),excluded=(spec.exclude??[]).join(',');
    await database.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}; CREATE TRIGGER ${trigger} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION academics_mobile_sync_emit_row(${literal(spec.collection)},${literal(spec.prefix)},${literal(spec.entityType)},${literal(spec.actor)},${literal(excluded)});`);
  }

  for(const spec of SPECS){
    const table=safeIdent(spec.table),record=recordExpr('a',spec),payload=payloadExpr('a',spec),actor=spec.actor?`a.${safeIdent(spec.actor)}`:'NULL',where=spec.seedWhere?` AND (${spec.seedWhere})`:'';
    await database.query(`
      WITH source AS (
        SELECT a.organization_id,${record}::text AS record_id,${payload} AS payload,${actor}::text AS changed_by
        FROM ${table} a WHERE true${where}
      ), inserted AS (
        INSERT INTO mobile_sync_record_versions(organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
        SELECT s.organization_id,'academics',${literal(spec.collection)},s.record_id,1,false,now(),NULL FROM source s
        ON CONFLICT(organization_id,module_key,collection_key,record_id) DO NOTHING
        RETURNING organization_id,record_id,version
      )
      INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
      SELECT s.organization_id,'academics',${literal(spec.collection)},s.record_id,i.version,'upsert',s.payload::text,s.changed_by,NULL,now()
      FROM source s JOIN inserted i ON i.organization_id=s.organization_id AND i.record_id=s.record_id;
    `);
  }
}

export const ACADEMICS_MOBILE_SYNC_SPECS=SPECS;
