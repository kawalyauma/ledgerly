import type {MobileSession} from "../auth";
import {ledgerlyRequest,ledgerlyTextRequest,query,type SessionUpdater} from "../apiClient";
import type {BookReference,BookStudent,BooksOverview,BookType,ClassReport,Distribution,DistributionBatch,LearnerReport,Paged,PeriodReport,StockMovement,StockRow,UnissuedReport} from "./types";
type Client={session:MobileSession;onSession?:SessionUpdater};
type Filters={bookType?:BookType;studentId?:string;classId?:string;streamId?:string;academicYearId?:string;termId?:string;from?:string;to?:string;limit?:number;offset?:number};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,`/books${path}`,init,c.onSession);
const text=(c:Client,path:string)=>ledgerlyTextRequest(c.session,`/books${path}`,{},c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,body:body===undefined?undefined:JSON.stringify(body)});
export const booksApi={
 overview:(c:Client)=>req<BooksOverview>(c,"/overview"),
 reference:(c:Client)=>req<BookReference>(c,"/reference"),
 students:(c:Client,filters:{classId?:string;streamId?:string;q?:string;limit?:number}={})=>req<BookStudent[]>(c,`/students${query(filters)}`),
 stock:(c:Client)=>req<StockRow[]>(c,"/stock"),
 stockMovements:(c:Client,filters:Filters={})=>req<Paged<StockMovement>>(c,`/stock-movements${query(filters)}`),
 addStockMovement:(c:Client,body:{bookType:BookType;movementType:"receipt"|"adjustment";quantityDelta:number;movementOn:string;referenceText?:string|null;notes?:string|null})=>req<StockMovement>(c,"/stock-movements",json("POST",body)),
 reverseStockMovement:(c:Client,id:string,reason:string)=>req<StockMovement>(c,`/stock-movements/${id}/reverse`,json("POST",{reason})),
 distributions:(c:Client,filters:Filters={})=>req<Paged<Distribution>>(c,`/distributions${query(filters)}`),
 batches:(c:Client,filters:Filters={})=>req<DistributionBatch[]>(c,`/distribution-batches${query(filters)}`),
 issueLearner:(c:Client,body:{studentId:string;bookType:BookType;quantity:number;academicYearId?:string|null;termId?:string|null;distributedOn:string;notes?:string|null})=>req<Distribution>(c,"/distributions",json("POST",body)),
 bulkIssue:(c:Client,body:{classId:string;streamId?:string|null;bookType:BookType;quantityPerLearner:number;academicYearId?:string|null;termId?:string|null;distributedOn:string;notes?:string|null})=>req<any>(c,"/distributions/bulk",json("POST",body)),
 reverseDistribution:(c:Client,id:string,reason:string)=>req<Distribution>(c,`/distributions/${id}/reverse`,json("POST",{reason})),
 reverseBatch:(c:Client,id:string,reason:string)=>req<any>(c,`/distribution-batches/${id}/reverse`,json("POST",{reason})),
 learnerReport:(c:Client,studentId:string,filters:Filters={})=>req<LearnerReport>(c,`/reports/learner${query({...filters,studentId})}`),
 classReport:(c:Client,classId:string,filters:Filters={})=>req<ClassReport>(c,`/reports/class${query({...filters,classId})}`),
 unissued:(c:Client,classId:string,filters:Filters={})=>req<UnissuedReport>(c,`/reports/unissued${query({...filters,classId})}`),
 periodReport:(c:Client,filters:Filters={})=>req<PeriodReport>(c,`/reports/period${query(filters)}`),
 stockReport:(c:Client,filters:Filters={})=>req<{stock:StockRow[];movements:StockMovement[]}>(c,`/reports/stock${query(filters)}`),
 exportCsv:(c:Client,report:"distributions"|"class"|"unissued"|"learner"|"stock"|"period",filters:Filters={})=>text(c,`/reports/export${query({report,...filters})}`),
};
