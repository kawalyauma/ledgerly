import { registerMobileSyncCollection } from "../../mobile-sync/backend/registry";
import { requireAcademicsRead, requireAcademicsWrite } from "./mobile-sync-permissions";
import { prepareScheme, prepareSchemeItem } from "./mobile-sync-schemes";
import { prepareLessonPlan, prepareDelivery } from "./mobile-sync-lessons";
import { prepareAcademicAction } from "./mobile-sync-actions";
import { snapshotActions, snapshotDeliveries, snapshotLessonPlans, snapshotScheduling, snapshotSchemeItems, snapshotSchemes, snapshotSupervision, snapshotTemplates } from "./mobile-sync-snapshots";

const read = { pullScope: "school:read", authorizePull: requireAcademicsRead } as const;
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "scheduling", schemaVersion: 1, mode: "read-only", sourceOfTruth: "server", conflictPolicy: "server-wins", ...read, dependsOn: [{ moduleKey: "school-management", collectionKey: "academic-context" }], snapshot: snapshotScheduling });
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "schemes", schemaVersion: 1, mode: "read-write", sourceOfTruth: "server", conflictPolicy: "reject-stale", ...read, pushScope: "school:write", authorizePush: requireAcademicsWrite, prepareMutation: prepareScheme, snapshot: snapshotSchemes });
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "scheme-items", schemaVersion: 1, mode: "read-write", sourceOfTruth: "server", conflictPolicy: "reject-stale", ...read, pushScope: "school:write", authorizePush: requireAcademicsWrite, dependsOn: [{ moduleKey: "academics", collectionKey: "schemes" }], prepareMutation: prepareSchemeItem, snapshot: snapshotSchemeItems });
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "templates", schemaVersion: 1, mode: "read-only", sourceOfTruth: "server", conflictPolicy: "server-wins", ...read, snapshot: snapshotTemplates });
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "lesson-plans", schemaVersion: 1, mode: "read-write", sourceOfTruth: "server", conflictPolicy: "reject-stale", ...read, pushScope: "school:write", authorizePush: requireAcademicsWrite, prepareMutation: prepareLessonPlan, snapshot: snapshotLessonPlans });
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "deliveries", schemaVersion: 1, mode: "read-write", sourceOfTruth: "server", conflictPolicy: "reject-stale", ...read, pushScope: "school:write", authorizePush: requireAcademicsWrite, prepareMutation: prepareDelivery, snapshot: snapshotDeliveries });
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "supervision", schemaVersion: 1, mode: "read-only", sourceOfTruth: "server", conflictPolicy: "server-wins", ...read, snapshot: snapshotSupervision });
registerMobileSyncCollection({ moduleKey: "academics", collectionKey: "actions", schemaVersion: 1, mode: "append-only", sourceOfTruth: "server", conflictPolicy: "append-only", ...read, pushScope: "school:write", authorizePush: requireAcademicsWrite, prepareMutation: prepareAcademicAction, snapshot: snapshotActions });
