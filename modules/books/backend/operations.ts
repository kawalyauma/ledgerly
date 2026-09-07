// @ts-nocheck
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { assertStock,bookType,dateValue,isoDate,orgRow,positiveInt,resolvePeriod,signedInt,stockSummary,studentContext,type QueryFilters } from "./common";

export async function addStockMovement(db: D1Database, organizationId: string, userId: string, data: Record<string, any>) {
  const type = bookType(data.bookType ?? data.book_type);
  const movementType = String(data.movementType ?? data.movement_type ?? "receipt");
  if (!["receipt","adjustment"].includes(movementType)) throw new AppError(422, "VALIDATION_ERROR", "movementType must be receipt or adjustment");
  const delta = signedInt(data.quantityDelta ?? data.quantity_delta);
  if (movementType === "receipt" && delta < 0) throw new AppError(422, "VALIDATION_ERROR", "A stock receipt must add books, not subtract them");
  if (delta < 0) await assertStock(db, organizationId, type, Math.abs(delta));
  const on = dateValue(data.movementOn ?? data.movement_on ?? isoDate(), "movementOn");
  const id = createId("bsm");
  await db.prepare(`INSERT INTO bks_stock_movements
    (id,organization_id,book_type,movement_type,quantity_delta,movement_on,reference_text,notes,recorded_by)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id,organizationId,type,movementType,delta,on,data.referenceText??data.reference_text??null,data.notes??null,userId).run();
  return getStockMovement(db, organizationId, id);
}

async function getStockMovement(db: D1Database, organizationId: string, id: string) {
  return db.prepare(`SELECT m.id,m.book_type AS bookType,m.movement_type AS movementType,m.quantity_delta AS quantityDelta,
      m.movement_on AS movementOn,m.reference_text AS referenceText,m.notes,m.recorded_by AS recordedBy,
      m.reversed_at AS reversedAt,m.reversal_reason AS reversalReason,m.created_at AS createdAt,
      COALESCE(u.display_name,u.email) AS recordedByName
    FROM bks_stock_movements m LEFT JOIN users u ON u.id=m.recorded_by
    WHERE m.id=? AND m.organization_id=?`).bind(id,organizationId).first<Record<string, any>>();
}

export async function listStockMovements(db: D1Database, organizationId: string, filters: QueryFilters = {}) {
  const where=["m.organization_id=?"]; const args:unknown[]=[organizationId];
  if(filters.bookType){where.push("m.book_type=?");args.push(bookType(filters.bookType));}
  if(filters.from){where.push("m.movement_on>=?");args.push(filters.from);}
  if(filters.to){where.push("m.movement_on<=?");args.push(filters.to);}
  const limit=Math.max(1,Math.min(200,Number(filters.limit)||50)),offset=Math.max(0,Number(filters.offset)||0);
  const total=await db.prepare(`SELECT COUNT(*) AS count FROM bks_stock_movements m WHERE ${where.join(" AND ")}`).bind(...args).first<{count:number}>();
  const rows=await db.prepare(`SELECT m.id,m.book_type AS bookType,m.movement_type AS movementType,m.quantity_delta AS quantityDelta,
      m.movement_on AS movementOn,m.reference_text AS referenceText,m.notes,m.recorded_by AS recordedBy,
      m.reversed_at AS reversedAt,m.reversal_reason AS reversalReason,m.created_at AS createdAt,
      COALESCE(u.display_name,u.email) AS recordedByName
    FROM bks_stock_movements m LEFT JOIN users u ON u.id=m.recorded_by
    WHERE ${where.join(" AND ")} ORDER BY m.movement_on DESC,m.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...args,limit,offset).all();
  return {rows:rows.results,total:Number(total?.count||0),limit,offset};
}

export async function reverseStockMovement(db:D1Database,organizationId:string,userId:string,id:string,reason:string) {
  const row=await getStockMovement(db,organizationId,id);
  if(!row)throw new AppError(404,"STOCK_MOVEMENT_NOT_FOUND","Stock movement not found");
  if(row.reversedAt)throw new AppError(409,"ALREADY_REVERSED","This stock movement has already been reversed");
  if(Number(row.quantityDelta)>0){
    const type=bookType(row.bookType);
    const summary=await stockSummary(db,organizationId),available=Number(summary.find(x=>x.bookType===type)?.available||0);
    if(available<Number(row.quantityDelta))throw new AppError(409,"REVERSAL_WOULD_OVERDRAW_STOCK","This receipt cannot be reversed because some of those books have already been issued",{available,receiptQuantity:Number(row.quantityDelta)});
  }
  await db.prepare("UPDATE bks_stock_movements SET reversed_at=CURRENT_TIMESTAMP,reversed_by=?,reversal_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND reversed_at IS NULL")
    .bind(userId,reason||"Reversed",id,organizationId).run();
  return getStockMovement(db,organizationId,id);
}

export async function issueToLearner(db:D1Database,organizationId:string,userId:string,data:Record<string,any>) {
  const studentId=String(data.studentId??data.student_id??"").trim();
  if(!studentId)throw new AppError(422,"VALIDATION_ERROR","studentId is required");
  const student=await studentContext(db,organizationId,studentId);
  const type=bookType(data.bookType??data.book_type),quantity=positiveInt(data.quantity);
  const period=await resolvePeriod(db,organizationId,data.academicYearId??student.academicYearId,data.termId);
  if(student.academicYearId&&period.academicYearId&&student.academicYearId!==period.academicYearId)
    throw new AppError(422,"STUDENT_PERIOD_MISMATCH","The learner's current academic year does not match the selected issue period");
  await assertStock(db,organizationId,type,quantity);
  const id=createId("bdi"),on=dateValue(data.distributedOn??data.distributed_on??isoDate(),"distributedOn");
  await db.prepare(`INSERT INTO bks_distributions
    (id,organization_id,student_id,academic_year_id,term_id,class_id,stream_id,book_type,quantity,distributed_on,source,notes,distributed_by)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'individual',?,?)`)
    .bind(id,organizationId,studentId,period.academicYearId,period.termId,student.classId??null,student.streamId??null,type,quantity,on,data.notes??null,userId).run();
  return getDistribution(db,organizationId,id);
}

export async function bulkIssue(db:D1Database,organizationId:string,userId:string,data:Record<string,any>) {
  const classId=String(data.classId??data.class_id??"").trim();
  if(!classId)throw new AppError(422,"VALIDATION_ERROR","classId is required");
  const classRow=await orgRow(db,organizationId,"school_classes",classId,"Class") as Record<string,any>;
  const streamId=String(data.streamId??data.stream_id??"").trim()||null;
  if(streamId){
    const stream=await orgRow(db,organizationId,"school_streams",streamId,"Stream") as Record<string,unknown>;
    if(String(stream.class_id||"")!==classId)throw new AppError(422,"CLASS_STREAM_MISMATCH","The selected stream does not belong to the selected class");
  }
  const type=bookType(data.bookType??data.book_type),perLearner=positiveInt(data.quantityPerLearner??data.quantity??1,"quantityPerLearner");
  const period=await resolvePeriod(db,organizationId,data.academicYearId??classRow.academic_year_id,data.termId);
  if(classRow.academic_year_id&&period.academicYearId&&String(classRow.academic_year_id)!==period.academicYearId)
    throw new AppError(422,"CLASS_PERIOD_MISMATCH","The selected class belongs to a different academic year");
  const where=["organization_id=?","deleted_at IS NULL","status='active'","current_class_id=?"];const args:unknown[]=[organizationId,classId];
  if(streamId){where.push("current_stream_id=?");args.push(streamId);}
  if(period.academicYearId){where.push("(current_academic_year_id=? OR current_academic_year_id IS NULL)");args.push(period.academicYearId);}
  const students=await db.prepare(`SELECT id,current_stream_id AS streamId FROM school_students WHERE ${where.join(" AND ")} ORDER BY last_name,first_name`).bind(...args).all<{id:string;streamId:string|null}>();
  if(!students.results.length)throw new AppError(409,"NO_ACTIVE_LEARNERS","No active learners were found in the selected class/stream");
  const total=students.results.length*perLearner;
  await assertStock(db,organizationId,type,total);
  const batchId=createId("bbt"),on=dateValue(data.distributedOn??data.distributed_on??isoDate(),"distributedOn");
  const batch=db.prepare(`INSERT INTO bks_distribution_batches
    (id,organization_id,academic_year_id,term_id,class_id,stream_id,book_type,quantity_per_learner,learner_count,total_quantity,distributed_on,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(batchId,organizationId,period.academicYearId,period.termId,classId,streamId,type,perLearner,students.results.length,total,on,data.notes??null,userId);
  const inserts=students.results.map(s=>db.prepare(`INSERT INTO bks_distributions
    (id,organization_id,student_id,academic_year_id,term_id,class_id,stream_id,batch_id,book_type,quantity,distributed_on,source,notes,distributed_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'bulk',?,?)`)
    .bind(createId("bdi"),organizationId,s.id,period.academicYearId,period.termId,classId,s.streamId??streamId,batchId,type,perLearner,on,data.notes??null,userId));
  await db.batch([batch,...inserts]);
  return {batchId,learnerCount:students.results.length,quantityPerLearner:perLearner,totalQuantity:total,bookType:type,distributedOn:on};
}

async function getDistribution(db:D1Database,organizationId:string,id:string) {
  return db.prepare(`SELECT d.id,d.student_id AS studentId,d.academic_year_id AS academicYearId,d.term_id AS termId,
      d.class_id AS classId,d.stream_id AS streamId,d.batch_id AS batchId,d.book_type AS bookType,d.quantity,
      d.distributed_on AS distributedOn,d.source,d.notes,d.distributed_by AS distributedBy,
      d.reversed_at AS reversedAt,d.reversal_reason AS reversalReason,d.created_at AS createdAt,
      trim(s.first_name || ' ' || COALESCE(s.middle_name || ' ','') || s.last_name) AS studentName,
      s.admission_number AS admissionNumber,s.student_number AS studentNumber,
      c.name AS className,st.name AS streamName,y.name AS academicYearName,t.name AS termName,
      COALESCE(u.display_name,u.email) AS distributedByName
    FROM bks_distributions d
    JOIN school_students s ON s.id=d.student_id
    LEFT JOIN school_classes c ON c.id=d.class_id
    LEFT JOIN school_streams st ON st.id=d.stream_id
    LEFT JOIN school_academic_years y ON y.id=d.academic_year_id
    LEFT JOIN school_terms t ON t.id=d.term_id
    LEFT JOIN users u ON u.id=d.distributed_by
    WHERE d.id=? AND d.organization_id=?`).bind(id,organizationId).first<Record<string,any>>();
}

export function distributionWhere(organizationId:string,filters:QueryFilters,alias="d"){
  const where=[`${alias}.organization_id=?`],args:unknown[]=[organizationId];
  if(filters.bookType){where.push(`${alias}.book_type=?`);args.push(bookType(filters.bookType));}
  if(filters.studentId){where.push(`${alias}.student_id=?`);args.push(filters.studentId);}
  if(filters.classId){where.push(`${alias}.class_id=?`);args.push(filters.classId);}
  if(filters.streamId){where.push(`${alias}.stream_id=?`);args.push(filters.streamId);}
  if(filters.academicYearId){where.push(`${alias}.academic_year_id=?`);args.push(filters.academicYearId);}
  if(filters.termId){where.push(`${alias}.term_id=?`);args.push(filters.termId);}
  if(filters.from){where.push(`${alias}.distributed_on>=?`);args.push(filters.from);}
  if(filters.to){where.push(`${alias}.distributed_on<=?`);args.push(filters.to);}
  return {where,args};
}

export async function listDistributions(db:D1Database,organizationId:string,filters:QueryFilters={}) {
  const {where,args}=distributionWhere(organizationId,filters);
  const limit=Math.max(1,Math.min(200,Number(filters.limit)||50)),offset=Math.max(0,Number(filters.offset)||0);
  const total=await db.prepare(`SELECT COUNT(*) AS count FROM bks_distributions d WHERE ${where.join(" AND ")}`).bind(...args).first<{count:number}>();
  const rows=await db.prepare(`SELECT d.id,d.student_id AS studentId,d.academic_year_id AS academicYearId,d.term_id AS termId,
      d.class_id AS classId,d.stream_id AS streamId,d.batch_id AS batchId,d.book_type AS bookType,d.quantity,
      d.distributed_on AS distributedOn,d.source,d.notes,d.reversed_at AS reversedAt,d.reversal_reason AS reversalReason,d.created_at AS createdAt,
      trim(s.first_name || ' ' || COALESCE(s.middle_name || ' ','') || s.last_name) AS studentName,
      s.admission_number AS admissionNumber,s.student_number AS studentNumber,
      c.name AS className,st.name AS streamName,y.name AS academicYearName,t.name AS termName,
      COALESCE(u.display_name,u.email) AS distributedByName
    FROM bks_distributions d JOIN school_students s ON s.id=d.student_id
    LEFT JOIN school_classes c ON c.id=d.class_id LEFT JOIN school_streams st ON st.id=d.stream_id
    LEFT JOIN school_academic_years y ON y.id=d.academic_year_id LEFT JOIN school_terms t ON t.id=d.term_id
    LEFT JOIN users u ON u.id=d.distributed_by
    WHERE ${where.join(" AND ")}
    ORDER BY d.distributed_on DESC,d.created_at DESC LIMIT ? OFFSET ?`).bind(...args,limit,offset).all();
  return {rows:rows.results,total:Number(total?.count||0),limit,offset};
}

export async function reverseDistribution(db:D1Database,organizationId:string,userId:string,id:string,reason:string) {
  const row=await getDistribution(db,organizationId,id);
  if(!row)throw new AppError(404,"DISTRIBUTION_NOT_FOUND","Book issue transaction not found");
  if(row.reversedAt)throw new AppError(409,"ALREADY_REVERSED","This book issue has already been reversed");
  await db.prepare("UPDATE bks_distributions SET reversed_at=CURRENT_TIMESTAMP,reversed_by=?,reversal_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND reversed_at IS NULL")
    .bind(userId,reason||"Reversed",id,organizationId).run();
  return getDistribution(db,organizationId,id);
}

export async function reverseBatch(db:D1Database,organizationId:string,userId:string,id:string,reason:string) {
  const batch=await db.prepare("SELECT id,reversed_at AS reversedAt FROM bks_distribution_batches WHERE id=? AND organization_id=?").bind(id,organizationId).first<Record<string,any>>();
  if(!batch)throw new AppError(404,"BATCH_NOT_FOUND","Distribution batch not found");
  if(batch.reversedAt)throw new AppError(409,"ALREADY_REVERSED","This distribution batch has already been reversed");
  const why=reason||"Bulk issue reversed";
  const result=await db.batch([
    db.prepare("UPDATE bks_distribution_batches SET reversed_at=CURRENT_TIMESTAMP,reversed_by=?,reversal_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND reversed_at IS NULL").bind(userId,why,id,organizationId),
    db.prepare("UPDATE bks_distributions SET reversed_at=CURRENT_TIMESTAMP,reversed_by=?,reversal_reason=?,updated_at=CURRENT_TIMESTAMP WHERE batch_id=? AND organization_id=? AND reversed_at IS NULL").bind(userId,why,id,organizationId),
  ]);
  return {id,reversed:true,transactionsReversed:Number(result[1]?.meta?.changes||0)};
}

export async function distributionBatches(db:D1Database,organizationId:string,filters:QueryFilters={}) {
  const where=["b.organization_id=?"];const args:unknown[]=[organizationId];
  if(filters.classId){where.push("b.class_id=?");args.push(filters.classId);}
  if(filters.streamId){where.push("b.stream_id=?");args.push(filters.streamId);}
  if(filters.bookType){where.push("b.book_type=?");args.push(bookType(filters.bookType));}
  if(filters.termId){where.push("b.term_id=?");args.push(filters.termId);}
  const rows=await db.prepare(`SELECT b.id,b.book_type AS bookType,b.quantity_per_learner AS quantityPerLearner,
      b.learner_count AS learnerCount,b.total_quantity AS totalQuantity,b.distributed_on AS distributedOn,b.notes,
      b.reversed_at AS reversedAt,c.name AS className,st.name AS streamName,t.name AS termName,y.name AS academicYearName
    FROM bks_distribution_batches b LEFT JOIN school_classes c ON c.id=b.class_id LEFT JOIN school_streams st ON st.id=b.stream_id
    LEFT JOIN school_terms t ON t.id=b.term_id LEFT JOIN school_academic_years y ON y.id=b.academic_year_id
    WHERE ${where.join(" AND ")} ORDER BY b.distributed_on DESC,b.created_at DESC LIMIT 100`).bind(...args).all();
  return rows.results;
}
