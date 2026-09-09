import{booksApi as onlineBooksApi}from"./onlineApi";
import{booksOfflineFallback,offlineBatches,offlineClassReport,offlineLearnerReport,offlineMovements,offlineOverview,offlinePagedDistributions,offlinePagedMovements,offlinePeriod,offlineReference,offlineStock,offlineStudents,offlineUnissued,queueBookIntent}from"./offline";
type C=Parameters<typeof onlineBooksApi.overview>[0];
export const booksApi={...onlineBooksApi,
 overview:(c:C)=>booksOfflineFallback(()=>onlineBooksApi.overview(c),offlineOverview),
 reference:(c:C)=>booksOfflineFallback(()=>onlineBooksApi.reference(c),offlineReference),
 students:(c:C,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.students(c,f),()=>offlineStudents(f)),
 stock:(c:C)=>booksOfflineFallback(()=>onlineBooksApi.stock(c),offlineStock),
 stockMovements:(c:C,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.stockMovements(c,f),()=>offlinePagedMovements(f)),
 addStockMovement:(c:C,b:any)=>booksOfflineFallback(()=>onlineBooksApi.addStockMovement(c,b),()=>queueBookIntent({kind:"stock_movement",...b}) as any),
 distributions:(c:C,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.distributions(c,f),()=>offlinePagedDistributions(f)),
 batches:(c:C,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.batches(c,f),async()=>{const x=await offlineBatches();return x.filter(r=>(!f.bookType||r.bookType===f.bookType)&&(!f.classId||r.classId===f.classId)&&(!f.streamId||r.streamId===f.streamId)&&(!f.academicYearId||r.academicYearId===f.academicYearId)&&(!f.termId||r.termId===f.termId))}),
 issueLearner:(c:C,b:any)=>booksOfflineFallback(()=>onlineBooksApi.issueLearner(c,b),()=>queueBookIntent({kind:"individual_issue",...b}) as any),
 bulkIssue:(c:C,b:any)=>booksOfflineFallback(()=>onlineBooksApi.bulkIssue(c,b),()=>queueBookIntent({kind:"bulk_issue",...b})),
 learnerReport:(c:C,id:string,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.learnerReport(c,id,f),()=>offlineLearnerReport(id,f)),
 classReport:(c:C,id:string,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.classReport(c,id,f),()=>offlineClassReport(id,f)),
 unissued:(c:C,id:string,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.unissued(c,id,f),()=>offlineUnissued(id,f)),
 periodReport:(c:C,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.periodReport(c,f),()=>offlinePeriod(f)),
 stockReport:(c:C,f:any={})=>booksOfflineFallback(()=>onlineBooksApi.stockReport(c,f),async()=>({stock:await offlineStock(),movements:await offlineMovements()})),
};