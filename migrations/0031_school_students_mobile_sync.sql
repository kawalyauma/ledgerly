-- School Management / Students mobile sync bridge.
-- Mobile writes suppress domain triggers for exactly one transaction; the core sync engine then publishes once.
CREATE TABLE IF NOT EXISTS school_mobile_sync_suppression (
  record_key TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS school_mobile_sync_emit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
  payload_json TEXT,
  changed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS school_mobile_sync_emit_ai AFTER INSERT ON school_mobile_sync_emit BEGIN
  INSERT INTO mobile_sync_record_versions(organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
  VALUES(NEW.organization_id,'school-management',NEW.collection_key,NEW.record_id,1,CASE WHEN NEW.operation='delete' THEN 1 ELSE 0 END,CURRENT_TIMESTAMP,NULL)
  ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET
    version=mobile_sync_record_versions.version+1,
    deleted=CASE WHEN NEW.operation='delete' THEN 1 ELSE 0 END,
    server_updated_at=CURRENT_TIMESTAMP,last_device_id=NULL;

  INSERT INTO mobile_sync_tombstones(organization_id,module_key,collection_key,record_id,version,deleted_at,device_id)
  SELECT NEW.organization_id,'school-management',NEW.collection_key,NEW.record_id,
    (SELECT version FROM mobile_sync_record_versions WHERE organization_id=NEW.organization_id AND module_key='school-management'
      AND collection_key=NEW.collection_key AND record_id=NEW.record_id),CURRENT_TIMESTAMP,NULL
  WHERE NEW.operation='delete'
  ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET version=excluded.version,deleted_at=CURRENT_TIMESTAMP,device_id=NULL;

  DELETE FROM mobile_sync_tombstones
  WHERE NEW.operation='upsert' AND organization_id=NEW.organization_id AND module_key='school-management'
    AND collection_key=NEW.collection_key AND record_id=NEW.record_id;

  INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
  VALUES(NEW.organization_id,'school-management',NEW.collection_key,NEW.record_id,
    (SELECT version FROM mobile_sync_record_versions WHERE organization_id=NEW.organization_id AND module_key='school-management'
      AND collection_key=NEW.collection_key AND record_id=NEW.record_id),NEW.operation,NEW.payload_json,NEW.changed_by,NULL,CURRENT_TIMESTAMP);

  DELETE FROM school_mobile_sync_emit WHERE id=NEW.id;
END;

-- Student master data. Assignment/lifecycle fields are published but cannot be changed by the mobile adapter.
CREATE TRIGGER IF NOT EXISTS school_ms_students_ai AFTER INSERT ON school_students
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':students:'||NEW.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'students',NEW.id,'upsert',json_object(
    'id',NEW.id,'admissionNumber',NEW.admission_number,'studentNumber',NEW.student_number,'firstName',NEW.first_name,'middleName',NEW.middle_name,
    'lastName',NEW.last_name,'preferredName',NEW.preferred_name,'gender',NEW.gender,'dateOfBirth',NEW.date_of_birth,'nationality',NEW.nationality,
    'placeOfBirth',NEW.place_of_birth,'religion',NEW.religion,'homeLanguage',NEW.home_language,'phone',NEW.phone,'email',NEW.email,
    'physicalAddress',NEW.physical_address,'previousSchool',NEW.previous_school,'previousClass',NEW.previous_class,'admissionDate',NEW.admission_date,
    'studentCategory',NEW.student_category,'residencyStatus',NEW.residency_status,'house',NEW.house,'status',NEW.status,'profilePhotoUrl',NEW.profile_photo_url,
    'customFields',json(NEW.custom_fields_json),'campusId',NEW.campus_id,'currentAcademicYearId',NEW.current_academic_year_id,
    'currentClassId',NEW.current_class_id,'className',(SELECT name FROM school_classes WHERE id=NEW.current_class_id AND organization_id=NEW.organization_id),'currentStreamId',NEW.current_stream_id,'streamName',(SELECT name FROM school_streams WHERE id=NEW.current_stream_id AND organization_id=NEW.organization_id),'campusName',(SELECT name FROM school_branches WHERE id=NEW.campus_id AND organization_id=NEW.organization_id),'academicYearName',(SELECT name FROM school_academic_years WHERE id=NEW.current_academic_year_id AND organization_id=NEW.organization_id),'updatedAt',NEW.updated_at),NEW.updated_by); END;

CREATE TRIGGER IF NOT EXISTS school_ms_students_au AFTER UPDATE ON school_students
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':students:'||NEW.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'students',NEW.id,'upsert',json_object(
    'id',NEW.id,'admissionNumber',NEW.admission_number,'studentNumber',NEW.student_number,'firstName',NEW.first_name,'middleName',NEW.middle_name,
    'lastName',NEW.last_name,'preferredName',NEW.preferred_name,'gender',NEW.gender,'dateOfBirth',NEW.date_of_birth,'nationality',NEW.nationality,
    'placeOfBirth',NEW.place_of_birth,'religion',NEW.religion,'homeLanguage',NEW.home_language,'phone',NEW.phone,'email',NEW.email,
    'physicalAddress',NEW.physical_address,'previousSchool',NEW.previous_school,'previousClass',NEW.previous_class,'admissionDate',NEW.admission_date,
    'studentCategory',NEW.student_category,'residencyStatus',NEW.residency_status,'house',NEW.house,'status',NEW.status,'profilePhotoUrl',NEW.profile_photo_url,
    'customFields',json(NEW.custom_fields_json),'campusId',NEW.campus_id,'currentAcademicYearId',NEW.current_academic_year_id,
    'currentClassId',NEW.current_class_id,'className',(SELECT name FROM school_classes WHERE id=NEW.current_class_id AND organization_id=NEW.organization_id),'currentStreamId',NEW.current_stream_id,'streamName',(SELECT name FROM school_streams WHERE id=NEW.current_stream_id AND organization_id=NEW.organization_id),'campusName',(SELECT name FROM school_branches WHERE id=NEW.campus_id AND organization_id=NEW.organization_id),'academicYearName',(SELECT name FROM school_academic_years WHERE id=NEW.current_academic_year_id AND organization_id=NEW.organization_id),'updatedAt',NEW.updated_at),NEW.updated_by); END;

CREATE TRIGGER IF NOT EXISTS school_ms_students_soft_delete AFTER UPDATE OF deleted_at ON school_students
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':students:'||NEW.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'students',NEW.id,'delete',NULL,NEW.deleted_by); END;
CREATE TRIGGER IF NOT EXISTS school_ms_students_ad AFTER DELETE ON school_students
WHEN NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=OLD.organization_id||':students:'||OLD.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(OLD.organization_id,'students',OLD.id,'delete',NULL,OLD.deleted_by); END;

-- Non-confidential student notes are append-only on mobile. Confidential notes never enter the generic mobile stream.
CREATE TRIGGER IF NOT EXISTS school_ms_notes_ai AFTER INSERT ON school_student_notes
WHEN NEW.confidential=0 AND NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':student-notes:'||NEW.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'student-notes',NEW.id,'upsert',json_object('id',NEW.id,'studentId',NEW.student_id,'noteType',NEW.note_type,
    'body',NEW.body,'confidential',0,'createdBy',NEW.created_by,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS school_ms_notes_au_visible AFTER UPDATE ON school_student_notes
WHEN NEW.confidential=0 AND NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':student-notes:'||NEW.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'student-notes',NEW.id,'upsert',json_object('id',NEW.id,'studentId',NEW.student_id,'noteType',NEW.note_type,
    'body',NEW.body,'confidential',0,'createdBy',NEW.created_by,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS school_ms_notes_au_hidden AFTER UPDATE OF confidential ON school_student_notes
WHEN OLD.confidential=0 AND NEW.confidential=1 AND NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':student-notes:'||NEW.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'student-notes',NEW.id,'delete',NULL,NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS school_ms_notes_ad AFTER DELETE ON school_student_notes
WHEN OLD.confidential=0 AND NOT EXISTS(SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=OLD.organization_id||':student-notes:'||OLD.id) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(OLD.organization_id,'student-notes',OLD.id,'delete',NULL,OLD.created_by); END;

-- Enrollment history is server authoritative.
CREATE TRIGGER IF NOT EXISTS school_ms_enrollments_ai AFTER INSERT ON school_enrollments BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'enrollments',NEW.id,'upsert',json_object('id',NEW.id,'studentId',NEW.student_id,'academicYearId',NEW.academic_year_id,
    'classId',NEW.class_id,'streamId',NEW.stream_id,'campusId',NEW.campus_id,'enrolledOn',NEW.enrolled_on,'leftOn',NEW.left_on,
    'status',NEW.status,'reason',NEW.reason,'createdBy',NEW.created_by,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS school_ms_enrollments_au AFTER UPDATE ON school_enrollments BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'enrollments',NEW.id,'upsert',json_object('id',NEW.id,'studentId',NEW.student_id,'academicYearId',NEW.academic_year_id,
    'classId',NEW.class_id,'streamId',NEW.stream_id,'campusId',NEW.campus_id,'enrolledOn',NEW.enrolled_on,'leftOn',NEW.left_on,
    'status',NEW.status,'reason',NEW.reason,'createdBy',NEW.created_by,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS school_ms_enrollments_ad AFTER DELETE ON school_enrollments BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(OLD.organization_id,'enrollments',OLD.id,'delete',NULL,NULL); END;

-- Guardian relationship projection. National IDs and notification preference internals are intentionally excluded.
CREATE TRIGGER IF NOT EXISTS school_ms_guardian_link_ai AFTER INSERT ON school_student_guardians BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  SELECT NEW.organization_id,'student-guardians',NEW.student_id||':'||NEW.guardian_id,'upsert',json_object(
    'studentId',NEW.student_id,'guardianId',NEW.guardian_id,'firstName',g.first_name,'middleName',g.middle_name,'lastName',g.last_name,
    'phonePrimary',g.phone_primary,'phoneSecondary',g.phone_secondary,'email',g.email,'relationship',NEW.relationship,
    'relationshipDefault',g.relationship_default,'occupation',g.occupation,'physicalAddress',g.physical_address,'active',g.active,
    'isPrimary',NEW.is_primary,'isEmergencyContact',NEW.is_emergency_contact,'isAuthorizedPickup',NEW.is_authorized_pickup,
    'isFinanciallyResponsible',NEW.is_financially_responsible,'receivesAcademicUpdates',NEW.receives_academic_updates,
    'receivesFinancialUpdates',NEW.receives_financial_updates),NULL FROM school_guardians g WHERE g.id=NEW.guardian_id AND g.organization_id=NEW.organization_id; END;
CREATE TRIGGER IF NOT EXISTS school_ms_guardian_link_move AFTER UPDATE OF student_id,guardian_id ON school_student_guardians
WHEN OLD.student_id<>NEW.student_id OR OLD.guardian_id<>NEW.guardian_id BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(OLD.organization_id,'student-guardians',OLD.student_id||':'||OLD.guardian_id,'delete',NULL,NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_guardian_link_au AFTER UPDATE ON school_student_guardians BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  SELECT NEW.organization_id,'student-guardians',NEW.student_id||':'||NEW.guardian_id,'upsert',json_object(
    'studentId',NEW.student_id,'guardianId',NEW.guardian_id,'firstName',g.first_name,'middleName',g.middle_name,'lastName',g.last_name,
    'phonePrimary',g.phone_primary,'phoneSecondary',g.phone_secondary,'email',g.email,'relationship',NEW.relationship,
    'relationshipDefault',g.relationship_default,'occupation',g.occupation,'physicalAddress',g.physical_address,'active',g.active,
    'isPrimary',NEW.is_primary,'isEmergencyContact',NEW.is_emergency_contact,'isAuthorizedPickup',NEW.is_authorized_pickup,
    'isFinanciallyResponsible',NEW.is_financially_responsible,'receivesAcademicUpdates',NEW.receives_academic_updates,
    'receivesFinancialUpdates',NEW.receives_financial_updates),NULL FROM school_guardians g WHERE g.id=NEW.guardian_id AND g.organization_id=NEW.organization_id; END;
CREATE TRIGGER IF NOT EXISTS school_ms_guardian_link_ad AFTER DELETE ON school_student_guardians BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(OLD.organization_id,'student-guardians',OLD.student_id||':'||OLD.guardian_id,'delete',NULL,NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_guardians_au AFTER UPDATE ON school_guardians BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  SELECT sg.organization_id,'student-guardians',sg.student_id||':'||sg.guardian_id,'upsert',json_object(
    'studentId',sg.student_id,'guardianId',sg.guardian_id,'firstName',NEW.first_name,'middleName',NEW.middle_name,'lastName',NEW.last_name,
    'phonePrimary',NEW.phone_primary,'phoneSecondary',NEW.phone_secondary,'email',NEW.email,'relationship',sg.relationship,
    'relationshipDefault',NEW.relationship_default,'occupation',NEW.occupation,'physicalAddress',NEW.physical_address,'active',NEW.active,
    'isPrimary',sg.is_primary,'isEmergencyContact',sg.is_emergency_contact,'isAuthorizedPickup',sg.is_authorized_pickup,
    'isFinanciallyResponsible',sg.is_financially_responsible,'receivesAcademicUpdates',sg.receives_academic_updates,
    'receivesFinancialUpdates',sg.receives_financial_updates),NULL FROM school_student_guardians sg WHERE sg.organization_id=NEW.organization_id AND sg.guardian_id=NEW.id; END;
