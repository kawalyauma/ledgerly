import type { MobileSyncCollectionDefinition } from "../../mobile-sync/backend/contracts";
import { registerMobileSyncCollection } from "../../mobile-sync/backend/registry";
import { prepareAttendanceMobileEvent } from "./mobile-sync-event";
import {
  snapshotRoster,
  snapshotPolicies,
  snapshotIdentifiers,
  snapshotBiometricSettings,
  snapshotSessions,
  snapshotRecords,
} from "./mobile-sync-snapshots";

const collections: MobileSyncCollectionDefinition[] = [
  { moduleKey:"attendance", collectionKey:"events", schemaVersion:1, mode:"append-only", sourceOfTruth:"merge",
    conflictPolicy:"append-only", pullScope:"school:read", prepareMutation:prepareAttendanceMobileEvent, snapshot:async()=>[] },
  { moduleKey:"attendance", collectionKey:"records", schemaVersion:1, mode:"read-only", sourceOfTruth:"server",
    conflictPolicy:"server-wins", pullScope:"school:read", dependsOn:[{moduleKey:"attendance",collectionKey:"events"}], snapshot:snapshotRecords },
  { moduleKey:"attendance", collectionKey:"sessions", schemaVersion:1, mode:"read-only", sourceOfTruth:"server",
    conflictPolicy:"server-wins", pullScope:"school:read", snapshot:snapshotSessions },
  { moduleKey:"attendance", collectionKey:"roster", schemaVersion:1, mode:"read-only", sourceOfTruth:"server",
    conflictPolicy:"server-wins", pullScope:"school:read", snapshot:snapshotRoster },
  { moduleKey:"attendance", collectionKey:"policies", schemaVersion:1, mode:"read-only", sourceOfTruth:"server",
    conflictPolicy:"server-wins", pullScope:"school:read", snapshot:snapshotPolicies },
  { moduleKey:"attendance", collectionKey:"identifiers", schemaVersion:1, mode:"read-only", sourceOfTruth:"server",
    conflictPolicy:"server-wins", pullScope:"school:read", snapshot:snapshotIdentifiers },
  { moduleKey:"attendance", collectionKey:"biometric-settings", schemaVersion:1, mode:"read-only", sourceOfTruth:"server",
    conflictPolicy:"server-wins", pullScope:"school:read", snapshot:snapshotBiometricSettings },
];
for (const definition of collections) registerMobileSyncCollection(definition);
export const attendanceMobileSyncCollections = collections;
