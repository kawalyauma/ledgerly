import type { MobileSyncCollectionDefinition } from "../../mobile-sync/backend/contracts";
import { registerMobileSyncCollection } from "../../mobile-sync/backend/registry";
import { prepareDocumentIntent, prepareJournalIntent } from "./mobile-intents";
import { snapshotAccounts,snapshotBankAccounts,snapshotDimensions,snapshotDocumentIntents,snapshotDocumentLines,snapshotDocuments,snapshotJournalIntents,snapshotJournalLines,snapshotJournals,snapshotPeriods,snapshotProducts,snapshotProjects } from "./mobile-sync-snapshots";

const read=(collectionKey:string,pullScope:string,snapshot:MobileSyncCollectionDefinition["snapshot"],dependsOn?:MobileSyncCollectionDefinition["dependsOn"]):MobileSyncCollectionDefinition=>({moduleKey:"ledgerly-core",collectionKey,schemaVersion:1,mode:"read-only",sourceOfTruth:"server",conflictPolicy:"server-wins",pullScope,snapshot,dependsOn});
const collections:MobileSyncCollectionDefinition[]=[
  read("accounts","accounts:read",snapshotAccounts),read("dimensions","accounts:read",snapshotDimensions),read("products","products:read",snapshotProducts),read("projects","documents:read",snapshotProjects),read("fiscal-periods","periods:read",snapshotPeriods),read("bank-accounts","accounts:read",snapshotBankAccounts),
  read("documents","documents:read",snapshotDocuments),read("document-lines","documents:read",snapshotDocumentLines,[{moduleKey:"ledgerly-core",collectionKey:"documents"}]),read("journals","journals:read",snapshotJournals),read("journal-lines","journals:read",snapshotJournalLines,[{moduleKey:"ledgerly-core",collectionKey:"journals"}]),
  {moduleKey:"ledgerly-core",collectionKey:"document-intents",schemaVersion:1,mode:"append-only",sourceOfTruth:"merge",conflictPolicy:"append-only",pullScope:"documents:read",pushScope:"documents:write",prepareMutation:prepareDocumentIntent,snapshot:snapshotDocumentIntents,dependsOn:[{moduleKey:"ledgerly-core",collectionKey:"accounts"}]},
  {moduleKey:"ledgerly-core",collectionKey:"journal-intents",schemaVersion:1,mode:"append-only",sourceOfTruth:"merge",conflictPolicy:"append-only",pullScope:"journals:read",pushScope:"journals:write",prepareMutation:prepareJournalIntent,snapshot:snapshotJournalIntents,dependsOn:[{moduleKey:"ledgerly-core",collectionKey:"accounts"},{moduleKey:"ledgerly-core",collectionKey:"fiscal-periods"}]},
];
for(const definition of collections)registerMobileSyncCollection(definition);
export const ledgerlyFinanceMobileSyncCollections=collections;
