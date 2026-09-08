-- Attendance mobile synchronization bridge.
ALTER TABLE att_events ADD COLUMN mobile_sync_device_id TEXT REFERENCES mobile_sync_devices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS att_events_mobile_device_idx ON att_events(organization_id,mobile_sync_device_id,captured_at);
CREATE UNIQUE INDEX IF NOT EXISTS att_events_mobile_client_uq
  ON att_events(organization_id,mobile_sync_device_id,client_event_id)
  WHERE mobile_sync_device_id IS NOT NULL AND client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS att_mobile_reconciliation_issues(
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL REFERENCES att_events(id) ON DELETE CASCADE,
 person_type TEXT NOT NULL CHECK(person_type IN('student','staff')),person_id TEXT NOT NULL,attendance_date TEXT NOT NULL,
 reason_code TEXT NOT NULL CHECK(reason_code IN('NO_ENROLLMENT_FOR_CAPTURE_DATE','SESSION_CLOSED','RECORD_FINALIZED','OTHER')),
 details_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','resolved','dismissed')),
 resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,resolution_notes TEXT,resolved_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_id));
CREATE INDEX IF NOT EXISTS att_mobile_reconciliation_org_idx ON att_mobile_reconciliation_issues(organization_id,status,attendance_date);

-- Small transactional emitter: domain triggers write one row; this trigger updates version/tombstone/change metadata atomically.
CREATE TABLE IF NOT EXISTS att_mobile_sync_emit(
 id INTEGER PRIMARY KEY AUTOINCREMENT,organization_id TEXT NOT NULL,collection_key TEXT NOT NULL,record_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('upsert','delete')),payload_json TEXT,changed_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TRIGGER IF NOT EXISTS att_mobile_sync_emit_ai AFTER INSERT ON att_mobile_sync_emit BEGIN
 INSERT INTO mobile_sync_record_versions(organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
 VALUES(NEW.organization_id,'attendance',NEW.collection_key,NEW.record_id,1,CASE WHEN NEW.operation='delete' THEN 1 ELSE 0 END,CURRENT_TIMESTAMP,NULL)
 ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET
  version=mobile_sync_record_versions.version+1,deleted=CASE WHEN NEW.operation='delete' THEN 1 ELSE 0 END,
  server_updated_at=CURRENT_TIMESTAMP,last_device_id=NULL;
 INSERT INTO mobile_sync_tombstones(organization_id,module_key,collection_key,record_id,version,deleted_at,device_id)
 SELECT NEW.organization_id,'attendance',NEW.collection_key,NEW.record_id,
  (SELECT version FROM mobile_sync_record_versions WHERE organization_id=NEW.organization_id AND module_key='attendance'
   AND collection_key=NEW.collection_key AND record_id=NEW.record_id),CURRENT_TIMESTAMP,NULL WHERE NEW.operation='delete'
 ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET version=excluded.version,deleted_at=CURRENT_TIMESTAMP,device_id=NULL;
 DELETE FROM mobile_sync_tombstones WHERE NEW.operation='upsert' AND organization_id=NEW.organization_id
  AND module_key='attendance' AND collection_key=NEW.collection_key AND record_id=NEW.record_id;
 INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
 VALUES(NEW.organization_id,'attendance',NEW.collection_key,NEW.record_id,
  (SELECT version FROM mobile_sync_record_versions WHERE organization_id=NEW.organization_id AND module_key='attendance'
   AND collection_key=NEW.collection_key AND record_id=NEW.record_id),NEW.operation,NEW.payload_json,NEW.changed_by,NULL,CURRENT_TIMESTAMP);
 DELETE FROM att_mobile_sync_emit WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS att_ms_records_ai AFTER INSERT ON att_records BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'records',NEW.id,'upsert',json_object('id',NEW.id,'sessionId',NEW.session_id,'attendanceDate',NEW.attendance_date,'personType',NEW.person_type,
'personId',NEW.person_id,'status',NEW.status,'firstInAt',NEW.first_in_at,'lastOutAt',NEW.last_out_at,'minutesLate',NEW.minutes_late,
'workedMinutes',NEW.worked_minutes,'breakMinutes',NEW.break_minutes,'overtimeMinutes',NEW.overtime_minutes,'reasonCode',NEW.reason_code,
'reason',NEW.reason,'notes',NEW.notes,'sourceMethod',NEW.source_method,'official',NEW.official,'finalized',NEW.finalized,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_records_au AFTER UPDATE ON att_records BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'records',NEW.id,'upsert',json_object('id',NEW.id,'sessionId',NEW.session_id,'attendanceDate',NEW.attendance_date,'personType',NEW.person_type,
'personId',NEW.person_id,'status',NEW.status,'firstInAt',NEW.first_in_at,'lastOutAt',NEW.last_out_at,'minutesLate',NEW.minutes_late,
'workedMinutes',NEW.worked_minutes,'breakMinutes',NEW.break_minutes,'overtimeMinutes',NEW.overtime_minutes,'reasonCode',NEW.reason_code,
'reason',NEW.reason,'notes',NEW.notes,'sourceMethod',NEW.source_method,'official',NEW.official,'finalized',NEW.finalized,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_records_ad AFTER DELETE ON att_records BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(OLD.organization_id,'records',OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS att_ms_sessions_ai AFTER INSERT ON att_sessions BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'sessions',NEW.id,'upsert',json_object('id',NEW.id,'academicYearId',NEW.academic_year_id,'termId',NEW.term_id,'campusId',NEW.campus_id,'attendanceDate',NEW.attendance_date,
'sessionType',NEW.session_type,'population',NEW.population,'classId',NEW.class_id,'streamId',NEW.stream_id,'subjectId',NEW.subject_id,
'lessonPeriodId',NEW.lesson_period_id,'title',NEW.title,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'status',NEW.status,
'expectedCount',NEW.expected_count,'markedCount',NEW.marked_count,'source',NEW.source,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_sessions_au AFTER UPDATE ON att_sessions BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'sessions',NEW.id,'upsert',json_object('id',NEW.id,'academicYearId',NEW.academic_year_id,'termId',NEW.term_id,'campusId',NEW.campus_id,'attendanceDate',NEW.attendance_date,
'sessionType',NEW.session_type,'population',NEW.population,'classId',NEW.class_id,'streamId',NEW.stream_id,'subjectId',NEW.subject_id,
'lessonPeriodId',NEW.lesson_period_id,'title',NEW.title,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'status',NEW.status,
'expectedCount',NEW.expected_count,'markedCount',NEW.marked_count,'source',NEW.source,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_sessions_ad AFTER DELETE ON att_sessions BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(OLD.organization_id,'sessions',OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS att_ms_events_ai AFTER INSERT ON att_events WHEN NEW.mobile_sync_device_id IS NULL BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'events',NEW.id,'upsert',
 json_object('personType',NEW.person_type,'personId',NEW.person_id,'direction',NEW.direction,'method',NEW.method,
 'verificationMode',NEW.verification_mode,'verificationStatus',NEW.verification_status,'confidence',NEW.confidence,
 'livenessScore',NEW.liveness_score,'capturedAt',NEW.captured_at,'official',NEW.official,'recordId',NEW.record_id),NEW.created_by); END;

CREATE TRIGGER IF NOT EXISTS att_ms_policies_ai AFTER INSERT ON att_policies BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'policies',NEW.id,'upsert',json_object('id',NEW.id,'name',NEW.name,'population',NEW.population,'schoolStartsAt',NEW.school_starts_at,'lateAfter',NEW.late_after,
'absenceAfter',NEW.absence_after,'expectedDepartureAt',NEW.expected_departure_at,'duplicateCooldownSeconds',NEW.duplicate_cooldown_seconds,
'earlyDepartureMinutes',NEW.early_departure_minutes,'timezone',NEW.timezone,'active',NEW.active,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_policies_au AFTER UPDATE ON att_policies BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'policies',NEW.id,'upsert',json_object('id',NEW.id,'name',NEW.name,'population',NEW.population,'schoolStartsAt',NEW.school_starts_at,'lateAfter',NEW.late_after,
'absenceAfter',NEW.absence_after,'expectedDepartureAt',NEW.expected_departure_at,'duplicateCooldownSeconds',NEW.duplicate_cooldown_seconds,
'earlyDepartureMinutes',NEW.early_departure_minutes,'timezone',NEW.timezone,'active',NEW.active,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_policies_ad AFTER DELETE ON att_policies BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(OLD.organization_id,'policies',OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS att_ms_identifiers_ai AFTER INSERT ON att_person_identifiers BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'identifiers',NEW.id,'upsert',json_object('id',NEW.id,'personType',NEW.person_type,'personId',NEW.person_id,'method',NEW.method,'identifier',NEW.identifier,
'active',NEW.active,'createdAt',NEW.created_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_identifiers_au AFTER UPDATE ON att_person_identifiers BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'identifiers',NEW.id,'upsert',json_object('id',NEW.id,'personType',NEW.person_type,'personId',NEW.person_id,'method',NEW.method,'identifier',NEW.identifier,
'active',NEW.active,'createdAt',NEW.created_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_identifiers_ad AFTER DELETE ON att_person_identifiers BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(OLD.organization_id,'identifiers',OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS att_ms_bio_ai AFTER INSERT ON att_biometric_settings BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'biometric-settings','settings','upsert',json_object('algorithmVersion',NEW.algorithm_version,'matchThreshold',NEW.match_threshold,'ambiguityMargin',NEW.ambiguity_margin,
'livenessThreshold',NEW.liveness_threshold,'qualityThreshold',NEW.quality_threshold,'updatedAt',NEW.updated_at),NEW.updated_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_bio_au AFTER UPDATE ON att_biometric_settings BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'biometric-settings','settings','upsert',json_object('algorithmVersion',NEW.algorithm_version,'matchThreshold',NEW.match_threshold,'ambiguityMargin',NEW.ambiguity_margin,
'livenessThreshold',NEW.liveness_threshold,'qualityThreshold',NEW.quality_threshold,'updatedAt',NEW.updated_at),NEW.updated_by); END;
CREATE TRIGGER IF NOT EXISTS att_ms_bio_ad AFTER DELETE ON att_biometric_settings BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(OLD.organization_id,'biometric-settings','settings','delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS att_ms_roster_students_ai AFTER INSERT ON school_students BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'roster','student:'||NEW.id,'upsert',json_object('personType','student','personId',NEW.id,'admissionNumber',NEW.admission_number,'studentNumber',NEW.student_number,
'firstName',NEW.first_name,'lastName',NEW.last_name,'classId',NEW.current_class_id,'streamId',NEW.current_stream_id,'className',(SELECT name FROM school_classes WHERE id=NEW.current_class_id),'streamName',(SELECT name FROM school_streams WHERE id=NEW.current_stream_id),'status',NEW.status,
'active',CASE WHEN NEW.deleted_at IS NULL AND NEW.status='active' THEN 1 ELSE 0 END,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS att_ms_roster_students_au AFTER UPDATE ON school_students BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'roster','student:'||NEW.id,'upsert',json_object('personType','student','personId',NEW.id,'admissionNumber',NEW.admission_number,'studentNumber',NEW.student_number,
'firstName',NEW.first_name,'lastName',NEW.last_name,'classId',NEW.current_class_id,'streamId',NEW.current_stream_id,'className',(SELECT name FROM school_classes WHERE id=NEW.current_class_id),'streamName',(SELECT name FROM school_streams WHERE id=NEW.current_stream_id),'status',NEW.status,
'active',CASE WHEN NEW.deleted_at IS NULL AND NEW.status='active' THEN 1 ELSE 0 END,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS att_ms_roster_students_ad AFTER DELETE ON school_students BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(OLD.organization_id,'roster','student:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS att_ms_roster_staff_ai AFTER INSERT ON school_staff_profiles BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'roster','staff:'||NEW.id,'upsert',json_object('personType','staff','personId',NEW.id,'staffNumber',NEW.staff_number,'firstName',NEW.first_name,'lastName',NEW.last_name,
'departmentId',NEW.department_id,'departmentName',(SELECT name FROM school_departments WHERE id=NEW.department_id),'employmentStatus',NEW.employment_status,
'active',CASE WHEN NEW.deleted_at IS NULL AND NEW.employment_status='active' THEN 1 ELSE 0 END,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS att_ms_roster_staff_au AFTER UPDATE ON school_staff_profiles BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(NEW.organization_id,'roster','staff:'||NEW.id,'upsert',json_object('personType','staff','personId',NEW.id,'staffNumber',NEW.staff_number,'firstName',NEW.first_name,'lastName',NEW.last_name,
'departmentId',NEW.department_id,'departmentName',(SELECT name FROM school_departments WHERE id=NEW.department_id),'employmentStatus',NEW.employment_status,
'active',CASE WHEN NEW.deleted_at IS NULL AND NEW.employment_status='active' THEN 1 ELSE 0 END,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS att_ms_roster_staff_ad AFTER DELETE ON school_staff_profiles BEGIN
 INSERT INTO att_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 VALUES(OLD.organization_id,'roster','staff:'||OLD.id,'delete',NULL,NULL); END;
