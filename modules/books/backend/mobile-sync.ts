import type { MobileSyncCollectionDefinition } from "../../mobile-sync/backend/contracts";
import { registerMobileSyncCollection } from "../../mobile-sync/backend/registry";
import { prepareBookOperationIntent } from "./mobile-intents";
import { requireBooksRead,requireBooksWrite } from "./mobile-sync-permissions";
import { snapshotDistributionBatches,snapshotDistributions,snapshotOperationIntents,snapshotStockMovements } from "./mobile-sync-snapshots";
const read=(collectionKey:string,snapshot:MobileSyncCollectionDefinition["snapshot"]):MobileSyncCollectionDefinition=>({moduleKey:"books",collectionKey,schemaVersion:1,mode:"read-only",sourceOfTruth:"server",conflictPolicy:"server-wins",pullScope:"school:read",authorizePull:requireBooksRead,snapshot});
const collections:MobileSyncCollectionDefinition[]=[read("stock-movements",snapshotStockMovements),read("distributions",snapshotDistributions),read("distribution-batches",snapshotDistributionBatches),{moduleKey:"books",collectionKey:"operation-intents",schemaVersion:1,mode:"append-only",sourceOfTruth:"merge",conflictPolicy:"append-only",pullScope:"school:read",pushScope:"school:write",authorizePull:requireBooksRead,authorizePush:requireBooksWrite,prepareMutation:prepareBookOperationIntent,snapshot:snapshotOperationIntents,dependsOn:[{moduleKey:"school-management",collectionKey:"students"},{moduleKey:"school-management",collectionKey:"academic-context"}]}];
for(const definition of collections)registerMobileSyncCollection(definition);export const booksMobileSyncCollections=collections;
