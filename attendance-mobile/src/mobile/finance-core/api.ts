import {financeApi as onlineFinanceApi} from "./onlineApi";
import {financeOfflineFallback,offlineAccounts,offlineBankAccounts,offlineContacts,offlineDashboard,offlineDimensions,offlineDocument,offlineDocuments,offlineJournal,offlineJournals,offlinePeriods,offlineProducts,offlineProjects,offlineReference,queueDocumentIntent,queueJournalIntent} from "./offline";

type C=Parameters<typeof onlineFinanceApi.dashboard>[0];
const empty=<T>(online:()=>Promise<T[]>)=>financeOfflineFallback(online,async()=>[] as T[]);

export const financeApi={
 ...onlineFinanceApi,
 dashboard:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.dashboard(c),offlineDashboard),
 accounts:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.accounts(c),offlineAccounts),
 groups:(c:C)=>empty(()=>onlineFinanceApi.groups(c)),
 contacts:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.contacts(c),offlineContacts),
 products:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.products(c),offlineProducts),
 projects:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.projects(c),offlineProjects),
 dimensions:(c:C,type?:string)=>financeOfflineFallback(()=>onlineFinanceApi.dimensions(c,type),()=>offlineDimensions(type)),
 taxCodes:(c:C)=>empty(()=>onlineFinanceApi.taxCodes(c)),
 bankAccounts:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.bankAccounts(c),offlineBankAccounts),
 reference:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.reference(c),offlineReference),
 journals:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.journals(c),offlineJournals),
 journal:(c:C,id:string)=>financeOfflineFallback(()=>onlineFinanceApi.journal(c,id),()=>offlineJournal(id) as any),
 createJournal:(c:C,body:any)=>financeOfflineFallback(()=>onlineFinanceApi.createJournal(c,body),()=>queueJournalIntent(body)),
 documents:(c:C,type?:string)=>financeOfflineFallback(()=>onlineFinanceApi.documents(c,type),()=>offlineDocuments(type)),
 document:(c:C,id:string)=>financeOfflineFallback(()=>onlineFinanceApi.document(c,id),()=>offlineDocument(id)),
 createDocument:(c:C,body:any)=>financeOfflineFallback(()=>onlineFinanceApi.createDocument(c,body),()=>queueDocumentIntent(body)),
 periods:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.periods(c),offlinePeriods),
 bankTransactions:(c:C,id:string)=>empty(()=>onlineFinanceApi.bankTransactions(c,id)),
 reconciliations:(c:C,id:string)=>empty(()=>onlineFinanceApi.reconciliations(c,id)),
 budgets:(c:C)=>empty(()=>onlineFinanceApi.budgets(c)),
 inventoryLocations:(c:C)=>empty(()=>onlineFinanceApi.inventoryLocations(c)),
 inventoryBalances:(c:C)=>empty(()=>onlineFinanceApi.inventoryBalances(c)),
 inventoryMovements:(c:C,params:any={})=>empty(()=>onlineFinanceApi.inventoryMovements(c,params)),
 taxJurisdictions:(c:C)=>empty(()=>onlineFinanceApi.taxJurisdictions(c)),
 taxExemptions:(c:C)=>empty(()=>onlineFinanceApi.taxExemptions(c)),
 taxReturns:(c:C)=>empty(()=>onlineFinanceApi.taxReturns(c)),
 reportTypes:(c:C)=>financeOfflineFallback(()=>onlineFinanceApi.reportTypes(c),async()=>[]),
};
