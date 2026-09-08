-- Offline-first School Fees bridge. Mobile captures immutable intents; official accounting remains server-authoritative.
CREATE TABLE IF NOT EXISTS school_mobile_fee_receipt_intents (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, device_id TEXT, student_id TEXT, payer_contact_id TEXT,
 payment_method_id TEXT NOT NULL, supporting_file_id TEXT, payment_date TEXT NOT NULL, currency TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), reference TEXT, notes TEXT, allocations_json TEXT NOT NULL DEFAULT '[]',
 auto_allocate INTEGER NOT NULL DEFAULT 1, captured_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','processing','posted','failed','cancelled')),
 official_receipt_id TEXT, payment_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, next_attempt_at TEXT, last_error TEXT,
 processed_at TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,id)
);
CREATE INDEX IF NOT EXISTS school_mobile_fee_intents_queue_idx ON school_mobile_fee_receipt_intents(status,updated_at,created_at);
CREATE INDEX IF NOT EXISTS school_mobile_fee_intents_org_idx ON school_mobile_fee_receipt_intents(organization_id,status,created_at);

CREATE VIEW IF NOT EXISTS school_mobile_fee_balances AS
WITH charge_totals AS (
 SELECT organization_id,student_id,MAX(currency) currency,SUM(total_minor) billed_minor,SUM(credited_minor) credited_minor,
        SUM(written_off_minor) written_off_minor,MAX(updated_at) updated_at
 FROM school_student_fee_charges
 WHERE status IN ('invoiced','partially_settled','settled','credited','written_off')
 GROUP BY organization_id,student_id
), doc_student AS (
 SELECT DISTINCT organization_id,student_id,document_id FROM school_student_fee_charges
 WHERE document_id IS NOT NULL AND status IN ('invoiced','partially_settled','settled','credited','written_off')
), paid_totals AS (
 SELECT ds.organization_id,ds.student_id,COALESCE(SUM(pa.amount_minor),0) paid_minor,MAX(COALESCE(pa.updated_at,pa.created_at)) updated_at
 FROM doc_student ds JOIN payment_allocations pa ON pa.organization_id=ds.organization_id AND pa.document_id=ds.document_id
 WHERE pa.reversed_at IS NULL GROUP BY ds.organization_id,ds.student_id
)
SELECT s.organization_id,s.id student_id,s.admission_number,s.student_number,
 trim(s.first_name||' '||COALESCE(s.middle_name||' ','')||s.last_name) student_name,
 ct.currency,COALESCE(ct.billed_minor,0) billed_minor,COALESCE(ct.credited_minor,0) credited_minor,
 COALESCE(ct.written_off_minor,0) written_off_minor,COALESCE(pt.paid_minor,0) paid_minor,
 MAX(0,COALESCE(ct.billed_minor,0)-COALESCE(ct.credited_minor,0)-COALESCE(ct.written_off_minor,0)-COALESCE(pt.paid_minor,0)) balance_minor,
 CASE WHEN COALESCE(pt.updated_at,'')>COALESCE(ct.updated_at,'') THEN pt.updated_at ELSE ct.updated_at END updated_at
FROM school_students s JOIN charge_totals ct ON ct.organization_id=s.organization_id AND ct.student_id=s.id
LEFT JOIN paid_totals pt ON pt.organization_id=s.organization_id AND pt.student_id=s.id
WHERE s.deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS school_fees_mobile_sync_emit(id INTEGER PRIMARY KEY AUTOINCREMENT,organization_id TEXT NOT NULL,collection_key TEXT NOT NULL,record_id TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),payload_json TEXT,changed_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER IF NOT EXISTS school_fees_mobile_sync_emit_ai AFTER INSERT ON school_fees_mobile_sync_emit BEGIN
 INSERT INTO mobile_sync_record_versions(organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
 VALUES(NEW.organization_id,'school-management',NEW.collection_key,NEW.record_id,1,CASE WHEN NEW.operation='delete' THEN 1 ELSE 0 END,CURRENT_TIMESTAMP,NULL)
 ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET version=mobile_sync_record_versions.version+1,deleted=excluded.deleted,server_updated_at=CURRENT_TIMESTAMP,last_device_id=NULL;
 INSERT INTO mobile_sync_tombstones(organization_id,module_key,collection_key,record_id,version,deleted_at,device_id)
 SELECT NEW.organization_id,'school-management',NEW.collection_key,NEW.record_id,v.version,CURRENT_TIMESTAMP,NULL FROM mobile_sync_record_versions v
 WHERE NEW.operation='delete' AND v.organization_id=NEW.organization_id AND v.module_key='school-management' AND v.collection_key=NEW.collection_key AND v.record_id=NEW.record_id
 ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET version=excluded.version,deleted_at=CURRENT_TIMESTAMP,device_id=NULL;
 DELETE FROM mobile_sync_tombstones WHERE NEW.operation='upsert' AND organization_id=NEW.organization_id AND module_key='school-management' AND collection_key=NEW.collection_key AND record_id=NEW.record_id;
 INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
 SELECT NEW.organization_id,'school-management',NEW.collection_key,NEW.record_id,v.version,NEW.operation,NEW.payload_json,NEW.changed_by,NULL,CURRENT_TIMESTAMP FROM mobile_sync_record_versions v
 WHERE v.organization_id=NEW.organization_id AND v.module_key='school-management' AND v.collection_key=NEW.collection_key AND v.record_id=NEW.record_id;
 DELETE FROM school_fees_mobile_sync_emit WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS sfms_methods_ai AFTER INSERT ON school_payment_methods BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-payment-methods',NEW.id,'upsert',json_object('id',NEW.id,'name',NEW.name,'methodType',NEW.method_type,'accountId',NEW.account_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS sfms_methods_au AFTER UPDATE ON school_payment_methods BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-payment-methods',NEW.id,'upsert',json_object('id',NEW.id,'name',NEW.name,'methodType',NEW.method_type,'accountId',NEW.account_id,'active',NEW.active,'updatedAt',NEW.updated_at),NULL); END;
CREATE TRIGGER IF NOT EXISTS sfms_methods_ad AFTER DELETE ON school_payment_methods BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'fee-payment-methods',OLD.id,'delete',NULL,NULL); END;

CREATE TRIGGER IF NOT EXISTS sfms_charges_ai AFTER INSERT ON school_student_fee_charges BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-charges',NEW.id,'upsert',json_object('id',NEW.id,'studentId',NEW.student_id,'payerContactId',NEW.payer_contact_id,'academicYearId',NEW.academic_year_id,'termId',NEW.term_id,'classId',NEW.class_id,'streamId',NEW.stream_id,'feeCategoryId',NEW.fee_category_id,'description',NEW.description,'grossMinor',NEW.gross_minor,'discountMinor',NEW.discount_minor,'scholarshipMinor',NEW.scholarship_minor,'waiverMinor',NEW.waiver_minor,'totalMinor',NEW.total_minor,'creditedMinor',NEW.credited_minor,'writtenOffMinor',NEW.written_off_minor,'currency',NEW.currency,'chargeDate',NEW.charge_date,'dueDate',NEW.due_date,'status',NEW.status,'documentId',NEW.document_id,'updatedAt',NEW.updated_at),NEW.created_by);
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) SELECT b.organization_id,'fee-balances',b.student_id,'upsert',json_object('studentId',b.student_id,'admissionNumber',b.admission_number,'studentNumber',b.student_number,'studentName',b.student_name,'currency',b.currency,'billedMinor',b.billed_minor,'creditedMinor',b.credited_minor,'writtenOffMinor',b.written_off_minor,'paidMinor',b.paid_minor,'balanceMinor',b.balance_minor,'updatedAt',b.updated_at),NEW.created_by FROM school_mobile_fee_balances b WHERE b.organization_id=NEW.organization_id AND b.student_id=NEW.student_id; END;
CREATE TRIGGER IF NOT EXISTS sfms_charges_au AFTER UPDATE ON school_student_fee_charges BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-charges',NEW.id,'upsert',json_object('id',NEW.id,'studentId',NEW.student_id,'payerContactId',NEW.payer_contact_id,'academicYearId',NEW.academic_year_id,'termId',NEW.term_id,'classId',NEW.class_id,'streamId',NEW.stream_id,'feeCategoryId',NEW.fee_category_id,'description',NEW.description,'grossMinor',NEW.gross_minor,'discountMinor',NEW.discount_minor,'scholarshipMinor',NEW.scholarship_minor,'waiverMinor',NEW.waiver_minor,'totalMinor',NEW.total_minor,'creditedMinor',NEW.credited_minor,'writtenOffMinor',NEW.written_off_minor,'currency',NEW.currency,'chargeDate',NEW.charge_date,'dueDate',NEW.due_date,'status',NEW.status,'documentId',NEW.document_id,'updatedAt',NEW.updated_at),NEW.created_by);
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) SELECT b.organization_id,'fee-balances',b.student_id,'upsert',json_object('studentId',b.student_id,'admissionNumber',b.admission_number,'studentNumber',b.student_number,'studentName',b.student_name,'currency',b.currency,'billedMinor',b.billed_minor,'creditedMinor',b.credited_minor,'writtenOffMinor',b.written_off_minor,'paidMinor',b.paid_minor,'balanceMinor',b.balance_minor,'updatedAt',b.updated_at),NEW.created_by FROM school_mobile_fee_balances b WHERE b.organization_id=NEW.organization_id AND b.student_id=NEW.student_id; END;
CREATE TRIGGER IF NOT EXISTS sfms_charges_ad AFTER DELETE ON school_student_fee_charges BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'fee-charges',OLD.id,'delete',NULL,OLD.created_by); END;

CREATE TRIGGER IF NOT EXISTS sfms_docs_au AFTER UPDATE OF paid_minor,status ON documents WHEN NEW.type='invoice' BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 SELECT ch.organization_id,'fee-charges',ch.id,'upsert',json_object('id',ch.id,'studentId',ch.student_id,'payerContactId',ch.payer_contact_id,'feeCategoryId',ch.fee_category_id,'description',ch.description,'totalMinor',ch.total_minor,'creditedMinor',ch.credited_minor,'writtenOffMinor',ch.written_off_minor,'currency',ch.currency,'chargeDate',ch.charge_date,'dueDate',ch.due_date,'status',ch.status,'documentId',ch.document_id,'documentTotalMinor',NEW.total_minor,'documentPaidMinor',NEW.paid_minor,'documentStatus',NEW.status,'outstandingMinor',MAX(0,NEW.total_minor-NEW.paid_minor),'updatedAt',NEW.updated_at),NULL FROM school_student_fee_charges ch WHERE ch.organization_id=NEW.organization_id AND ch.document_id=NEW.id;
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 SELECT b.organization_id,'fee-balances',b.student_id,'upsert',json_object('studentId',b.student_id,'admissionNumber',b.admission_number,'studentNumber',b.student_number,'studentName',b.student_name,'currency',b.currency,'billedMinor',b.billed_minor,'creditedMinor',b.credited_minor,'writtenOffMinor',b.written_off_minor,'paidMinor',b.paid_minor,'balanceMinor',b.balance_minor,'updatedAt',b.updated_at),NULL FROM school_mobile_fee_balances b WHERE b.organization_id=NEW.organization_id AND b.student_id IN (SELECT DISTINCT student_id FROM school_student_fee_charges WHERE organization_id=NEW.organization_id AND document_id=NEW.id); END;

CREATE TRIGGER IF NOT EXISTS sfms_receipts_ai AFTER INSERT ON school_fee_receipts BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-receipts',NEW.id,'upsert',json_object('id',NEW.id,'receiptNumber',NEW.receipt_number,'studentId',NEW.student_id,'payerContactId',NEW.payer_contact_id,'paymentMethodId',NEW.payment_method_id,'paymentId',NEW.payment_id,'paymentDate',NEW.payment_date,'currency',NEW.currency,'amountMinor',NEW.amount_minor,'allocatedMinor',NEW.allocated_minor,'unallocatedMinor',NEW.unallocated_minor,'reference',NEW.reference,'notes',NEW.notes,'status',NEW.status,'reversedAt',NEW.reversed_at,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS sfms_receipts_au AFTER UPDATE ON school_fee_receipts BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-receipts',NEW.id,'upsert',json_object('id',NEW.id,'receiptNumber',NEW.receipt_number,'studentId',NEW.student_id,'payerContactId',NEW.payer_contact_id,'paymentMethodId',NEW.payment_method_id,'paymentId',NEW.payment_id,'paymentDate',NEW.payment_date,'currency',NEW.currency,'amountMinor',NEW.amount_minor,'allocatedMinor',NEW.allocated_minor,'unallocatedMinor',NEW.unallocated_minor,'reference',NEW.reference,'notes',NEW.notes,'status',NEW.status,'reversedAt',NEW.reversed_at,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS sfms_receipts_ad AFTER DELETE ON school_fee_receipts BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'fee-receipts',OLD.id,'delete',NULL,OLD.created_by); END;

CREATE TRIGGER IF NOT EXISTS sfms_plans_ai AFTER INSERT ON school_fee_payment_plans BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-payment-plans',NEW.id,'upsert',json_object('id',NEW.id,'planNumber',NEW.plan_number,'studentId',NEW.student_id,'payerContactId',NEW.payer_contact_id,'academicYearId',NEW.academic_year_id,'termId',NEW.term_id,'totalMinor',NEW.total_minor,'currency',NEW.currency,'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,'status',NEW.status,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS sfms_plans_au AFTER UPDATE ON school_fee_payment_plans BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-payment-plans',NEW.id,'upsert',json_object('id',NEW.id,'planNumber',NEW.plan_number,'studentId',NEW.student_id,'payerContactId',NEW.payer_contact_id,'academicYearId',NEW.academic_year_id,'termId',NEW.term_id,'totalMinor',NEW.total_minor,'currency',NEW.currency,'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,'status',NEW.status,'updatedAt',NEW.updated_at),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS sfms_plans_ad AFTER DELETE ON school_fee_payment_plans BEGIN INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(OLD.organization_id,'fee-payment-plans',OLD.id,'delete',NULL,OLD.created_by); END;


-- Payment-plan installment changes must republish the parent plan because installments are embedded in the plan payload.
CREATE TRIGGER IF NOT EXISTS sfms_installments_ai AFTER INSERT ON school_fee_payment_plan_installments BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 SELECT p.organization_id,'fee-payment-plans',p.id,'upsert',json_object('id',p.id,'planNumber',p.plan_number,'studentId',p.student_id,'payerContactId',p.payer_contact_id,'academicYearId',p.academic_year_id,'termId',p.term_id,'totalMinor',p.total_minor,'currency',p.currency,'startsOn',p.starts_on,'endsOn',p.ends_on,'status',p.status,'installments',json(COALESCE((SELECT json_group_array(json_object('id',i.id,'sequenceNo',i.sequence_no,'dueDate',i.due_date,'amountMinor',i.amount_minor,'paidMinor',i.paid_minor,'status',i.status)) FROM school_fee_payment_plan_installments i WHERE i.organization_id=p.organization_id AND i.plan_id=p.id),'[]')),'updatedAt',p.updated_at),p.created_by FROM school_fee_payment_plans p WHERE p.organization_id=NEW.organization_id AND p.id=NEW.plan_id; END;
CREATE TRIGGER IF NOT EXISTS sfms_installments_au AFTER UPDATE ON school_fee_payment_plan_installments BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 SELECT p.organization_id,'fee-payment-plans',p.id,'upsert',json_object('id',p.id,'planNumber',p.plan_number,'studentId',p.student_id,'payerContactId',p.payer_contact_id,'academicYearId',p.academic_year_id,'termId',p.term_id,'totalMinor',p.total_minor,'currency',p.currency,'startsOn',p.starts_on,'endsOn',p.ends_on,'status',p.status,'installments',json(COALESCE((SELECT json_group_array(json_object('id',i.id,'sequenceNo',i.sequence_no,'dueDate',i.due_date,'amountMinor',i.amount_minor,'paidMinor',i.paid_minor,'status',i.status)) FROM school_fee_payment_plan_installments i WHERE i.organization_id=p.organization_id AND i.plan_id=p.id),'[]')),'updatedAt',CURRENT_TIMESTAMP),p.created_by FROM school_fee_payment_plans p WHERE p.organization_id=NEW.organization_id AND p.id=NEW.plan_id; END;
CREATE TRIGGER IF NOT EXISTS sfms_installments_ad AFTER DELETE ON school_fee_payment_plan_installments BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by)
 SELECT p.organization_id,'fee-payment-plans',p.id,'upsert',json_object('id',p.id,'planNumber',p.plan_number,'studentId',p.student_id,'payerContactId',p.payer_contact_id,'academicYearId',p.academic_year_id,'termId',p.term_id,'totalMinor',p.total_minor,'currency',p.currency,'startsOn',p.starts_on,'endsOn',p.ends_on,'status',p.status,'installments',json(COALESCE((SELECT json_group_array(json_object('id',i.id,'sequenceNo',i.sequence_no,'dueDate',i.due_date,'amountMinor',i.amount_minor,'paidMinor',i.paid_minor,'status',i.status)) FROM school_fee_payment_plan_installments i WHERE i.organization_id=p.organization_id AND i.plan_id=p.id),'[]')),'updatedAt',CURRENT_TIMESTAMP),p.created_by FROM school_fee_payment_plans p WHERE p.organization_id=OLD.organization_id AND p.id=OLD.plan_id; END;

-- Initial mobile insert is versioned atomically by Mobile Sync core; only server processing updates are emitted here.
CREATE TRIGGER IF NOT EXISTS sfms_intents_au AFTER UPDATE ON school_mobile_fee_receipt_intents BEGIN
 INSERT INTO school_fees_mobile_sync_emit(organization_id,collection_key,record_id,operation,payload_json,changed_by) VALUES(NEW.organization_id,'fee-receipt-intents',NEW.id,'upsert',json_object('id',NEW.id,'studentId',NEW.student_id,'payerContactId',NEW.payer_contact_id,'paymentMethodId',NEW.payment_method_id,'supportingFileId',NEW.supporting_file_id,'paymentDate',NEW.payment_date,'currency',NEW.currency,'amountMinor',NEW.amount_minor,'reference',NEW.reference,'notes',NEW.notes,'allocations',json(NEW.allocations_json),'autoAllocate',NEW.auto_allocate,'capturedAt',NEW.captured_at,'status',NEW.status,'officialReceiptId',NEW.official_receipt_id,'paymentId',NEW.payment_id,'attempts',NEW.attempts,'nextAttemptAt',NEW.next_attempt_at,'lastError',NEW.last_error,'processedAt',NEW.processed_at,'updatedAt',NEW.updated_at),NEW.created_by); END;
