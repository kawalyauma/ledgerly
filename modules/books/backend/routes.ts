// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { AppError } from "../../../src/lib/errors";
import { schoolPermission } from "../../school/backend/common";
import * as S from "./service";

export const bookRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
bookRoutes.use("*", requireModuleEnabled("books"));
bookRoutes.use("*", requireScope("school:read"));
bookRoutes.use("*", async (c,next) => {
  await S.ensureDefaultPermissions(c.env.FINANCE_DB,c.get("principal").organizationId);
  await next();
});

const payload = async (c:any) => c.req.json<Record<string,any>>().catch(()=>({}));
const filters = (c:any) => ({
  bookType:c.req.query("bookType")||null,
  studentId:c.req.query("studentId")||null,
  classId:c.req.query("classId")||null,
  streamId:c.req.query("streamId")||null,
  academicYearId:c.req.query("academicYearId")||null,
  termId:c.req.query("termId")||null,
  from:c.req.query("from")||null,
  to:c.req.query("to")||null,
  limit:Math.min(200,Math.max(1,Number(c.req.query("limit"))||50)),
  offset:Math.max(0,Number(c.req.query("offset"))||0),
});
const required = (value:any,name:string) => {
  const v=String(value??"").trim();
  if(!v)throw new AppError(422,"VALIDATION_ERROR",`${name} is required`);
  return v;
};
const csvCell=(value:any)=>`"${String(value??"").replaceAll('"','""')}"`;
const toCsv=(columns:Array<[string,string]>,rows:Record<string,any>[]) =>
  [columns.map(([label])=>csvCell(label)).join(","),...rows.map(row=>columns.map(([,key])=>csvCell(row[key])).join(","))].join("\n");
const csvResponse=(c:any,name:string,csv:string)=>{
  c.header("Content-Type","text/csv; charset=utf-8");
  c.header("Content-Disposition",`attachment; filename="${name}"`);
  return c.body(csv);
};

bookRoutes.get("/manifest", c=>c.json({data:{
  key:"books",
  name:"Books",
  version:"1.0.0",
  standalone:true,
  requiresModules:["school-management"],
  sharedEntities:["school_students","school_classes","school_streams","school_academic_years","school_terms"],
  bookTypes:["small","a4"],
}}));

bookRoutes.get("/overview",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.overview(c.env.FINANCE_DB,p.organizationId)});
});
bookRoutes.get("/reference",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.referenceData(c.env.FINANCE_DB,p.organizationId)});
});
bookRoutes.get("/students",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.listStudents(c.env.FINANCE_DB,p.organizationId,{
    classId:c.req.query("classId"),streamId:c.req.query("streamId"),q:c.req.query("q"),limit:Number(c.req.query("limit"))||200
  })});
});

bookRoutes.get("/stock",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.stockSummary(c.env.FINANCE_DB,p.organizationId)});
});
bookRoutes.get("/stock-movements",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.listStockMovements(c.env.FINANCE_DB,p.organizationId,filters(c))});
});
bookRoutes.post("/stock-movements",requireScope("school:write"),schoolPermission("school.books:write"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.addStockMovement(c.env.FINANCE_DB,p.organizationId,p.userId,await payload(c))},201);
});
bookRoutes.post("/stock-movements/:id/reverse",requireScope("school:write"),schoolPermission("school.books:manage"),async c=>{
  const p=c.get("principal"),d=await payload(c);
  return c.json({data:await S.reverseStockMovement(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),String(d.reason||"Reversed"))});
});

bookRoutes.get("/distributions",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.listDistributions(c.env.FINANCE_DB,p.organizationId,filters(c))});
});
bookRoutes.get("/distribution-batches",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.distributionBatches(c.env.FINANCE_DB,p.organizationId,filters(c))});
});
bookRoutes.post("/distributions",requireScope("school:write"),schoolPermission("school.books:write"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.issueToLearner(c.env.FINANCE_DB,p.organizationId,p.userId,await payload(c))},201);
});
bookRoutes.post("/distributions/bulk",requireScope("school:write"),schoolPermission("school.books:write"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.bulkIssue(c.env.FINANCE_DB,p.organizationId,p.userId,await payload(c))},201);
});
bookRoutes.post("/distributions/:id/reverse",requireScope("school:write"),schoolPermission("school.books:manage"),async c=>{
  const p=c.get("principal"),d=await payload(c);
  return c.json({data:await S.reverseDistribution(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),String(d.reason||"Reversed"))});
});
bookRoutes.post("/distribution-batches/:id/reverse",requireScope("school:write"),schoolPermission("school.books:manage"),async c=>{
  const p=c.get("principal"),d=await payload(c);
  return c.json({data:await S.reverseBatch(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),String(d.reason||"Bulk issue reversed"))});
});

bookRoutes.get("/reports/learner",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal"),studentId=required(c.req.query("studentId"),"studentId");
  return c.json({data:await S.learnerReport(c.env.FINANCE_DB,p.organizationId,studentId,filters(c))});
});
bookRoutes.get("/reports/class",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal"),classId=required(c.req.query("classId"),"classId");
  return c.json({data:await S.classReport(c.env.FINANCE_DB,p.organizationId,classId,filters(c))});
});
bookRoutes.get("/reports/unissued",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal"),classId=required(c.req.query("classId"),"classId");
  return c.json({data:await S.unissuedReport(c.env.FINANCE_DB,p.organizationId,classId,filters(c))});
});
bookRoutes.get("/reports/period",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await S.periodReport(c.env.FINANCE_DB,p.organizationId,filters(c))});
});
bookRoutes.get("/reports/stock",schoolPermission("school.books:read"),async c=>{
  const p=c.get("principal");
  const [stock,movements]=await Promise.all([
    S.stockSummary(c.env.FINANCE_DB,p.organizationId),
    S.listStockMovements(c.env.FINANCE_DB,p.organizationId,{...filters(c),limit:100,offset:0})
  ]);
  return c.json({data:{stock,movements:movements.rows}});
});

bookRoutes.get("/reports/export",schoolPermission("school.books:export"),async c=>{
  const p=c.get("principal"),kind=String(c.req.query("report")||"distributions"),f=filters(c);
  if(kind==="distributions"){
    const result=await S.listDistributions(c.env.FINANCE_DB,p.organizationId,{...f,limit:200,offset:0});
    const csv=toCsv([
      ["Date","distributedOn"],["Learner","studentName"],["Admission No.","admissionNumber"],["Class","className"],["Stream","streamName"],
      ["Academic Year","academicYearName"],["Term","termName"],["Book Type","bookType"],["Quantity","quantity"],["Source","source"],
      ["Status","status"],["Notes","notes"]
    ],result.rows.map((x:any)=>({...x,status:x.reversedAt?"Reversed":"Active"})));
    return csvResponse(c,`books-distributions-${new Date().toISOString().slice(0,10)}.csv`,csv);
  }
  if(kind==="class"||kind==="unissued"){
    const classId=required(c.req.query("classId"),"classId");
    const result=kind==="unissued"?await S.unissuedReport(c.env.FINANCE_DB,p.organizationId,classId,f):await S.classReport(c.env.FINANCE_DB,p.organizationId,classId,f);
    const csv=toCsv([
      ["Learner","studentName"],["Admission No.","admissionNumber"],["Student No.","studentNumber"],["Class","className"],["Stream","streamName"],
      ["Small Books","small"],["A4 Books","a4"],["Total Books","total"],["Last Issue","lastIssuedOn"]
    ],result.rows);
    return csvResponse(c,`books-${kind}-${new Date().toISOString().slice(0,10)}.csv`,csv);
  }
  if(kind==="learner"){
    const studentId=required(c.req.query("studentId"),"studentId");
    const result=await S.learnerReport(c.env.FINANCE_DB,p.organizationId,studentId,f);
    const csv=toCsv([
      ["Date","distributedOn"],["Book Type","bookType"],["Quantity","quantity"],["Class","className"],["Stream","streamName"],
      ["Academic Year","academicYearName"],["Term","termName"],["Source","source"],["Status","status"],["Notes","notes"]
    ],result.transactions.map((x:any)=>({...x,status:x.reversedAt?"Reversed":"Active"})));
    return csvResponse(c,`books-learner-${result.student.admissionNumber||result.student.studentNumber||studentId}.csv`,csv);
  }
  if(kind==="stock"){
    const rows=await S.stockSummary(c.env.FINANCE_DB,p.organizationId);
    return csvResponse(c,`books-stock-${new Date().toISOString().slice(0,10)}.csv`,toCsv([
      ["Book Type","bookType"],["Stock In","stockIn"],["Issued","issued"],["Available","available"]
    ],rows));
  }
  if(kind==="period"){
    const result=await S.periodReport(c.env.FINANCE_DB,p.organizationId,f);
    return csvResponse(c,`books-period-${new Date().toISOString().slice(0,10)}.csv`,toCsv([
      ["Date","date"],["Quantity Issued","quantity"],["Transactions","transactions"],["Learners","learners"]
    ],result.byDay));
  }
  throw new AppError(422,"VALIDATION_ERROR","report must be distributions, class, unissued, learner, stock or period");
});
