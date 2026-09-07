// @ts-nocheck
import { AppError } from "../../../src/lib/errors";
import { bookType,orgRow,type QueryFilters } from "./common";
import { distributionWhere,listDistributions } from "./operations";

export async function overview(db: D1Database, organizationId: string) {
  const { currentPeriod, stockSummary } = await import("./common");
  const stock = await stockSummary(db, organizationId);
  const current = await currentPeriod(db, organizationId);
  const totals = await db.prepare(`SELECT COALESCE(SUM(quantity),0) AS issued,COUNT(*) AS transactions,COUNT(DISTINCT student_id) AS learners
    FROM bks_distributions WHERE organization_id=? AND reversed_at IS NULL`).bind(organizationId).first<Record<string, any>>();
  const term = current.term ? await db.prepare(`SELECT COALESCE(SUM(quantity),0) AS issued,COUNT(DISTINCT student_id) AS learners
    FROM bks_distributions WHERE organization_id=? AND term_id=? AND reversed_at IS NULL`).bind(organizationId,current.term.id).first<Record<string, any>>() : {issued:0,learners:0};
  const recent = await listDistributions(db, organizationId, {limit:8,offset:0});
  return {stock,totalIssued:Number(totals?.issued||0),transactions:Number(totals?.transactions||0),learnersServed:Number(totals?.learners||0),
    currentTermIssued:Number(term?.issued||0),currentTermLearners:Number(term?.learners||0),current,recent:recent.rows};
}

export async function learnerReport(db:D1Database,organizationId:string,studentId:string,filters:QueryFilters={}) {
  const student=await db.prepare(`SELECT s.id,s.admission_number AS admissionNumber,s.student_number AS studentNumber,
      trim(s.first_name || ' ' || COALESCE(s.middle_name || ' ','') || s.last_name) AS name,
      c.name AS currentClassName,st.name AS currentStreamName
    FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id
    WHERE s.id=? AND s.organization_id=? AND s.deleted_at IS NULL`).bind(studentId,organizationId).first<Record<string,any>>();
  if(!student)throw new AppError(404,"STUDENT_NOT_FOUND","Learner not found");
  const list=await listDistributions(db,organizationId,{...filters,studentId,limit:200,offset:0});
  const active=list.rows.filter((r:any)=>!r.reversedAt);
  const totals={small:0,a4:0,total:0};
  for(const r of active){totals[r.bookType as "small"|"a4"]+=Number(r.quantity||0);totals.total+=Number(r.quantity||0);}
  return {student,totals,transactions:list.rows};
}

export async function classReport(db:D1Database,organizationId:string,classId:string,filters:QueryFilters={}) {
  const classRow=await orgRow(db,organizationId,"school_classes",classId,"Class") as Record<string,any>;
  const distConditions=["d.organization_id=s.organization_id","d.student_id=s.id","d.class_id=?","d.reversed_at IS NULL"];
  const distArgs:unknown[]=[classId];
  if(filters.bookType){distConditions.push("d.book_type=?");distArgs.push(bookType(filters.bookType));}
  if(filters.streamId){distConditions.push("d.stream_id=?");distArgs.push(filters.streamId);}
  if(filters.academicYearId){distConditions.push("d.academic_year_id=?");distArgs.push(filters.academicYearId);}
  if(filters.termId){distConditions.push("d.term_id=?");distArgs.push(filters.termId);}
  if(filters.from){distConditions.push("d.distributed_on>=?");distArgs.push(filters.from);}
  if(filters.to){distConditions.push("d.distributed_on<=?");distArgs.push(filters.to);}

  const histConditions=["h.organization_id=?","h.class_id=?","h.reversed_at IS NULL"];
  const histArgs:unknown[]=[organizationId,classId];
  if(filters.streamId){histConditions.push("h.stream_id=?");histArgs.push(filters.streamId);}
  if(filters.academicYearId){histConditions.push("h.academic_year_id=?");histArgs.push(filters.academicYearId);}
  if(filters.termId){histConditions.push("h.term_id=?");histArgs.push(filters.termId);}
  if(filters.from){histConditions.push("h.distributed_on>=?");histArgs.push(filters.from);}
  if(filters.to){histConditions.push("h.distributed_on<=?");histArgs.push(filters.to);}

  const studentWhere=["s.organization_id=?","s.deleted_at IS NULL","(s.current_class_id=? OR s.id IN (SELECT h.student_id FROM bks_distributions h WHERE "+histConditions.join(" AND ")+"))"];
  const studentArgs:unknown[]=[organizationId,classId,...histArgs];
  if(filters.streamId) studentWhere.push("(s.current_stream_id=? OR s.id IN (SELECT h.student_id FROM bks_distributions h WHERE "+histConditions.join(" AND ")+"))");
  const queryArgs=[...distArgs,...studentArgs];
  if(filters.streamId) queryArgs.push(filters.streamId,...histArgs);

  const rows=await db.prepare(`SELECT s.id AS studentId,s.admission_number AS admissionNumber,s.student_number AS studentNumber,
      trim(s.first_name || ' ' || COALESCE(s.middle_name || ' ','') || s.last_name) AS studentName,
      COALESCE(MAX(dst.name),curst.name) AS streamName,
      COALESCE(SUM(CASE WHEN d.book_type='small' THEN d.quantity ELSE 0 END),0) AS small,
      COALESCE(SUM(CASE WHEN d.book_type='a4' THEN d.quantity ELSE 0 END),0) AS a4,
      COALESCE(SUM(d.quantity),0) AS total,MAX(d.distributed_on) AS lastIssuedOn
    FROM school_students s
    LEFT JOIN school_streams curst ON curst.id=s.current_stream_id
    LEFT JOIN bks_distributions d ON ${distConditions.join(" AND ")}
    LEFT JOIN school_streams dst ON dst.id=d.stream_id
    WHERE ${studentWhere.join(" AND ")}
    GROUP BY s.id,curst.name ORDER BY streamName,s.last_name,s.first_name`)
    .bind(...queryArgs).all<Record<string,any>>();
  const result=rows.results.map(r=>({...r,className:String(classRow.name||""),small:Number(r.small||0),a4:Number(r.a4||0),total:Number(r.total||0)}));
  return {rows:result,totals:{learners:result.length,learnersServed:result.filter(x=>x.total>0).length,small:result.reduce((a,x)=>a+x.small,0),a4:result.reduce((a,x)=>a+x.a4,0),total:result.reduce((a,x)=>a+x.total,0)}};
}

export async function unissuedReport(db:D1Database,organizationId:string,classId:string,filters:QueryFilters={}) {
  const report=await classReport(db,organizationId,classId,filters);
  const where=["organization_id=?","deleted_at IS NULL","status='active'","current_class_id=?"];const args:unknown[]=[organizationId,classId];
  if(filters.streamId){where.push("current_stream_id=?");args.push(filters.streamId);}
  const current=await db.prepare(`SELECT id FROM school_students WHERE ${where.join(" AND ")}`).bind(...args).all<{id:string}>();
  const currentIds=new Set(current.results.map(x=>x.id));
  const currentRows=report.rows.filter((r:any)=>currentIds.has(String(r.studentId)));
  const rows=currentRows.filter((r:any)=>Number(r.total||0)===0);
  return {rows,total:rows.length,classLearners:currentRows.length,served:currentRows.filter((r:any)=>Number(r.total||0)>0).length};
}

export async function periodReport(db:D1Database,organizationId:string,filters:QueryFilters={}) {
  const {where,args}=distributionWhere(organizationId,filters);where.push("d.reversed_at IS NULL");
  const byType=await db.prepare(`SELECT d.book_type AS bookType,SUM(d.quantity) AS quantity,COUNT(*) AS transactions,COUNT(DISTINCT d.student_id) AS learners
    FROM bks_distributions d WHERE ${where.join(" AND ")} GROUP BY d.book_type ORDER BY d.book_type`).bind(...args).all<Record<string,any>>();
  const byClass=await db.prepare(`SELECT d.class_id AS classId,c.name AS className,d.stream_id AS streamId,st.name AS streamName,
      SUM(d.quantity) AS quantity,COUNT(DISTINCT d.student_id) AS learners
    FROM bks_distributions d LEFT JOIN school_classes c ON c.id=d.class_id LEFT JOIN school_streams st ON st.id=d.stream_id
    WHERE ${where.join(" AND ")} GROUP BY d.class_id,c.name,d.stream_id,st.name ORDER BY c.name,st.name`).bind(...args).all<Record<string,any>>();
  const byDay=await db.prepare(`SELECT d.distributed_on AS date,SUM(d.quantity) AS quantity,COUNT(*) AS transactions,COUNT(DISTINCT d.student_id) AS learners
    FROM bks_distributions d WHERE ${where.join(" AND ")} GROUP BY d.distributed_on ORDER BY d.distributed_on DESC LIMIT 120`).bind(...args).all<Record<string,any>>();
  const normalize=(r:any)=>({...r,quantity:Number(r.quantity||0),transactions:r.transactions===undefined?undefined:Number(r.transactions||0),learners:Number(r.learners||0)});
  return {byType:byType.results.map(normalize),byClass:byClass.results.map(normalize),byDay:byDay.results.map(normalize)};
}
