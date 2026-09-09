-- Students Mobile Sync privacy v2.
-- Remove arbitrary custom fields from mobile projections and scrub historical change payloads.
DROP TRIGGER IF EXISTS school_ms_students_ai;
DROP TRIGGER IF EXISTS school_ms_students_au;

CREATE TRIGGER school_ms_students_ai AFTER INSERT ON school_students
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':students:'||NEW.id
) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'students',NEW.id,'upsert',json_object(
    'id',NEW.id,'admissionNumber',NEW.admission_number,'studentNumber',NEW.student_number,
    'firstName',NEW.first_name,'middleName',NEW.middle_name,'lastName',NEW.last_name,'preferredName',NEW.preferred_name,
    'gender',NEW.gender,'dateOfBirth',NEW.date_of_birth,'nationality',NEW.nationality,'placeOfBirth',NEW.place_of_birth,
    'religion',NEW.religion,'homeLanguage',NEW.home_language,'phone',NEW.phone,'email',NEW.email,
    'physicalAddress',NEW.physical_address,'previousSchool',NEW.previous_school,'previousClass',NEW.previous_class,
    'admissionDate',NEW.admission_date,'studentCategory',NEW.student_category,'residencyStatus',NEW.residency_status,
    'house',NEW.house,'status',NEW.status,'profilePhotoUrl',NEW.profile_photo_url,'campusId',NEW.campus_id,
    'currentAcademicYearId',NEW.current_academic_year_id,'currentClassId',NEW.current_class_id,
    'className',(SELECT name FROM school_classes WHERE id=NEW.current_class_id AND organization_id=NEW.organization_id),
    'currentStreamId',NEW.current_stream_id,
    'streamName',(SELECT name FROM school_streams WHERE id=NEW.current_stream_id AND organization_id=NEW.organization_id),
    'campusName',(SELECT name FROM school_branches WHERE id=NEW.campus_id AND organization_id=NEW.organization_id),
    'academicYearName',(SELECT name FROM school_academic_years WHERE id=NEW.current_academic_year_id AND organization_id=NEW.organization_id),
    'updatedAt',NEW.updated_at
  ),NEW.updated_by);
END;

CREATE TRIGGER school_ms_students_au AFTER UPDATE ON school_students
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM school_mobile_sync_suppression WHERE record_key=NEW.organization_id||':students:'||NEW.id
) BEGIN
  INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
  VALUES(NEW.organization_id,'students',NEW.id,'upsert',json_object(
    'id',NEW.id,'admissionNumber',NEW.admission_number,'studentNumber',NEW.student_number,
    'firstName',NEW.first_name,'middleName',NEW.middle_name,'lastName',NEW.last_name,'preferredName',NEW.preferred_name,
    'gender',NEW.gender,'dateOfBirth',NEW.date_of_birth,'nationality',NEW.nationality,'placeOfBirth',NEW.place_of_birth,
    'religion',NEW.religion,'homeLanguage',NEW.home_language,'phone',NEW.phone,'email',NEW.email,
    'physicalAddress',NEW.physical_address,'previousSchool',NEW.previous_school,'previousClass',NEW.previous_class,
    'admissionDate',NEW.admission_date,'studentCategory',NEW.student_category,'residencyStatus',NEW.residency_status,
    'house',NEW.house,'status',NEW.status,'profilePhotoUrl',NEW.profile_photo_url,'campusId',NEW.campus_id,
    'currentAcademicYearId',NEW.current_academic_year_id,'currentClassId',NEW.current_class_id,
    'className',(SELECT name FROM school_classes WHERE id=NEW.current_class_id AND organization_id=NEW.organization_id),
    'currentStreamId',NEW.current_stream_id,
    'streamName',(SELECT name FROM school_streams WHERE id=NEW.current_stream_id AND organization_id=NEW.organization_id),
    'campusName',(SELECT name FROM school_branches WHERE id=NEW.campus_id AND organization_id=NEW.organization_id),
    'academicYearName',(SELECT name FROM school_academic_years WHERE id=NEW.current_academic_year_id AND organization_id=NEW.organization_id),
    'updatedAt',NEW.updated_at
  ),NEW.updated_by);
END;

-- Sensitive payloads from v1 must not remain pullable by long-offline devices.
DELETE FROM mobile_sync_changes
WHERE module_key='school-management' AND collection_key='students';

-- Republish every active learner with the safe v2 projection. Existing record versions advance,
-- so already-bootstrapped devices receive an authoritative sanitized refresh.
INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
SELECT s.organization_id,'students',s.id,'upsert',json_object(
  'id',s.id,'admissionNumber',s.admission_number,'studentNumber',s.student_number,
  'firstName',s.first_name,'middleName',s.middle_name,'lastName',s.last_name,'preferredName',s.preferred_name,
  'gender',s.gender,'dateOfBirth',s.date_of_birth,'nationality',s.nationality,'placeOfBirth',s.place_of_birth,
  'religion',s.religion,'homeLanguage',s.home_language,'phone',s.phone,'email',s.email,
  'physicalAddress',s.physical_address,'previousSchool',s.previous_school,'previousClass',s.previous_class,
  'admissionDate',s.admission_date,'studentCategory',s.student_category,'residencyStatus',s.residency_status,
  'house',s.house,'status',s.status,'profilePhotoUrl',s.profile_photo_url,'campusId',s.campus_id,
  'currentAcademicYearId',s.current_academic_year_id,'currentClassId',s.current_class_id,
  'className',(SELECT name FROM school_classes WHERE id=s.current_class_id AND organization_id=s.organization_id),
  'currentStreamId',s.current_stream_id,
  'streamName',(SELECT name FROM school_streams WHERE id=s.current_stream_id AND organization_id=s.organization_id),
  'campusName',(SELECT name FROM school_branches WHERE id=s.campus_id AND organization_id=s.organization_id),
  'academicYearName',(SELECT name FROM school_academic_years WHERE id=s.current_academic_year_id AND organization_id=s.organization_id),
  'updatedAt',s.updated_at
),s.updated_by
FROM school_students s
WHERE s.deleted_at IS NULL;
