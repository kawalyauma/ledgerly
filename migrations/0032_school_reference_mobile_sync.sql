-- School Management read-only academic reference data -> mobile change stream.
-- Academic context helper triggers. Each record has a namespaced stable ID inside one read-only collection.
CREATE TRIGGER IF NOT EXISTS school_ms_branches_ai AFTER INSERT ON school_branches BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','branch:'||NEW.id,'upsert',json_object('entityType','branch','id',NEW.id,'code',NEW.code,'name',NEW.name,'isMain',NEW.is_main,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_branches_au AFTER UPDATE ON school_branches BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','branch:'||NEW.id,'upsert',json_object('entityType','branch','id',NEW.id,'code',NEW.code,'name',NEW.name,'isMain',NEW.is_main,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_branches_ad AFTER DELETE ON school_branches BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','branch:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_years_ai AFTER INSERT ON school_academic_years BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','academic-year:'||NEW.id,'upsert',json_object('entityType','academic-year','id',NEW.id,'code',NEW.code,'name',NEW.name,'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,'status',NEW.status,'isCurrent',NEW.is_current,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_years_au AFTER UPDATE ON school_academic_years BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','academic-year:'||NEW.id,'upsert',json_object('entityType','academic-year','id',NEW.id,'code',NEW.code,'name',NEW.name,'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,'status',NEW.status,'isCurrent',NEW.is_current,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_years_ad AFTER DELETE ON school_academic_years BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','academic-year:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_terms_ai AFTER INSERT ON school_terms BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','term:'||NEW.id,'upsert',json_object('entityType','term','id',NEW.id,'academicYearId',NEW.academic_year_id,'code',NEW.code,'name',NEW.name,'sequenceNo',NEW.sequence_no,'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,'status',NEW.status,'isCurrent',NEW.is_current,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_terms_au AFTER UPDATE ON school_terms BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','term:'||NEW.id,'upsert',json_object('entityType','term','id',NEW.id,'academicYearId',NEW.academic_year_id,'code',NEW.code,'name',NEW.name,'sequenceNo',NEW.sequence_no,'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,'status',NEW.status,'isCurrent',NEW.is_current,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_terms_ad AFTER DELETE ON school_terms BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','term:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_departments_ai AFTER INSERT ON school_departments BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','department:'||NEW.id,'upsert',json_object('entityType','department','id',NEW.id,'campusId',NEW.campus_id,'code',NEW.code,'name',NEW.name,'parentId',NEW.parent_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_departments_au AFTER UPDATE ON school_departments BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','department:'||NEW.id,'upsert',json_object('entityType','department','id',NEW.id,'campusId',NEW.campus_id,'code',NEW.code,'name',NEW.name,'parentId',NEW.parent_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_departments_ad AFTER DELETE ON school_departments BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','department:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_levels_ai AFTER INSERT ON school_class_levels BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','class-level:'||NEW.id,'upsert',json_object('entityType','class-level','id',NEW.id,'code',NEW.code,'name',NEW.name,'sequenceNo',NEW.sequence_no,'educationLevel',NEW.education_level,'promotionLevelId',NEW.promotion_level_id,'terminal',NEW.terminal,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_levels_au AFTER UPDATE ON school_class_levels BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','class-level:'||NEW.id,'upsert',json_object('entityType','class-level','id',NEW.id,'code',NEW.code,'name',NEW.name,'sequenceNo',NEW.sequence_no,'educationLevel',NEW.education_level,'promotionLevelId',NEW.promotion_level_id,'terminal',NEW.terminal,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_levels_ad AFTER DELETE ON school_class_levels BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','class-level:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_classes_ai AFTER INSERT ON school_classes BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','class:'||NEW.id,'upsert',json_object('entityType','class','id',NEW.id,'academicYearId',NEW.academic_year_id,'campusId',NEW.campus_id,'classLevelId',NEW.class_level_id,'departmentId',NEW.department_id,'code',NEW.code,'name',NEW.name,'capacity',NEW.capacity,'classTeacherUserId',NEW.class_teacher_user_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_classes_au AFTER UPDATE ON school_classes BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','class:'||NEW.id,'upsert',json_object('entityType','class','id',NEW.id,'academicYearId',NEW.academic_year_id,'campusId',NEW.campus_id,'classLevelId',NEW.class_level_id,'departmentId',NEW.department_id,'code',NEW.code,'name',NEW.name,'capacity',NEW.capacity,'classTeacherUserId',NEW.class_teacher_user_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_classes_ad AFTER DELETE ON school_classes BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','class:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_streams_ai AFTER INSERT ON school_streams BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','stream:'||NEW.id,'upsert',json_object('entityType','stream','id',NEW.id,'classId',NEW.class_id,'campusId',NEW.campus_id,'code',NEW.code,'name',NEW.name,'capacity',NEW.capacity,'classTeacherUserId',NEW.class_teacher_user_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_streams_au AFTER UPDATE ON school_streams BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','stream:'||NEW.id,'upsert',json_object('entityType','stream','id',NEW.id,'classId',NEW.class_id,'campusId',NEW.campus_id,'code',NEW.code,'name',NEW.name,'capacity',NEW.capacity,'classTeacherUserId',NEW.class_teacher_user_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_streams_ad AFTER DELETE ON school_streams BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','stream:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_subjects_ai AFTER INSERT ON school_subjects BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','subject:'||NEW.id,'upsert',json_object('entityType','subject','id',NEW.id,'departmentId',NEW.department_id,'code',NEW.code,'name',NEW.name,'shortName',NEW.short_name,'subjectType',NEW.subject_type,'curriculumCode',NEW.curriculum_code,'passMark',NEW.pass_mark,'maxMark',NEW.max_mark,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_subjects_au AFTER UPDATE ON school_subjects BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','subject:'||NEW.id,'upsert',json_object('entityType','subject','id',NEW.id,'departmentId',NEW.department_id,'code',NEW.code,'name',NEW.name,'shortName',NEW.short_name,'subjectType',NEW.subject_type,'curriculumCode',NEW.curriculum_code,'passMark',NEW.pass_mark,'maxMark',NEW.max_mark,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_subjects_ad AFTER DELETE ON school_subjects BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','subject:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_class_subjects_ai AFTER INSERT ON school_class_subjects BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','class-subject:'||NEW.id,'upsert',json_object('entityType','class-subject','id',NEW.id,'classLevelId',NEW.class_level_id,'subjectId',NEW.subject_id,'academicYearId',NEW.academic_year_id,'compulsory',NEW.compulsory,'periodsPerWeek',NEW.periods_per_week,'teacherUserId',NEW.teacher_user_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_class_subjects_au AFTER UPDATE ON school_class_subjects BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','class-subject:'||NEW.id,'upsert',json_object('entityType','class-subject','id',NEW.id,'classLevelId',NEW.class_level_id,'subjectId',NEW.subject_id,'academicYearId',NEW.academic_year_id,'compulsory',NEW.compulsory,'periodsPerWeek',NEW.periods_per_week,'teacherUserId',NEW.teacher_user_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_class_subjects_ad AFTER DELETE ON school_class_subjects BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','class-subject:'||OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS school_ms_periods_ai AFTER INSERT ON school_lesson_periods BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','lesson-period:'||NEW.id,'upsert',json_object('entityType','lesson-period','id',NEW.id,'campusId',NEW.campus_id,'code',NEW.code,'name',NEW.name,'sequenceNo',NEW.sequence_no,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'periodType',NEW.period_type,'teachingPeriod',NEW.teaching_period,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_periods_au AFTER UPDATE ON school_lesson_periods BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'academic-context','lesson-period:'||NEW.id,'upsert',json_object('entityType','lesson-period','id',NEW.id,'campusId',NEW.campus_id,'code',NEW.code,'name',NEW.name,'sequenceNo',NEW.sequence_no,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'periodType',NEW.period_type,'teachingPeriod',NEW.teaching_period,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS school_ms_periods_ad AFTER DELETE ON school_lesson_periods BEGIN
 INSERT INTO school_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'academic-context','lesson-period:'||OLD.id,'delete',NULL,NULL); END;
