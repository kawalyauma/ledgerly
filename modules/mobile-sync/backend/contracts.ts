import type { AuthPrincipal } from "../../../src/types";

export const MOBILE_SYNC_PROTOCOL_VERSION = 1;

export type MobileSyncSourceOfTruth = "server" | "client" | "merge";
export type MobileSyncConflictPolicy = "server-wins" | "reject-stale" | "append-only" | "client-wins" | "custom";
export type MobileSyncCollectionMode = "read-write" | "read-only" | "append-only";
export type MobileSyncMutationKind = "upsert" | "delete";

export type MobileSyncDependency =
  | { operationId: string }
  | { moduleKey: string; collectionKey: string; recordId: string; minVersion?: number };

export type MobileSyncMutation = {
  operationId: string;
  sequence: number;
  moduleKey: string;
  collectionKey: string;
  recordId: string;
  kind: MobileSyncMutationKind;
  schemaVersion: number;
  baseVersion: number;
  clientTimestamp: string;
  payload?: unknown;
  dependencies: MobileSyncDependency[];
};

export type MobileSyncRecord = {
  id: string;
  version: number;
  updatedAt: string;
  deleted?: boolean;
  payload?: unknown;
};

export type MobileSyncAuthorizationContext = {
  db: D1Database;
  principal: AuthPrincipal;
  organizationId: string;
  userId: string;
  deviceId: string;
};

export type MobileSyncMutationContext = MobileSyncAuthorizationContext & {
  currentVersion: number;
  nextVersion: number;
};

export type PreparedMobileSyncMutation = {
  /** Domain statements only. The core appends version/change/audit/ack statements in the same D1 batch. */
  statements: D1PreparedStatement[];
  serverPayload?: unknown;
  result?: unknown;
};

export type MobileSyncSnapshotContext = MobileSyncAuthorizationContext & {
  watermark: number;
};

export type MobileSyncCollectionDefinition = {
  moduleKey: string;
  collectionKey: string;
  schemaVersion: number;
  minClientSchemaVersion?: number;
  mode: MobileSyncCollectionMode;
  sourceOfTruth: MobileSyncSourceOfTruth;
  conflictPolicy: MobileSyncConflictPolicy;
  pullScope?: string;
  pushScope?: string;
  /** Optional domain authorization executed in addition to coarse JWT scope checks. */
  authorizePull?: (context: MobileSyncAuthorizationContext) => Promise<void>;
  /** Optional domain authorization executed in addition to coarse JWT scope checks. */
  authorizePush?: (context: MobileSyncAuthorizationContext) => Promise<void>;
  dependsOn?: Array<{ moduleKey: string; collectionKey: string }>;
  prepareMutation?: (context: MobileSyncMutationContext, mutation: MobileSyncMutation) => Promise<PreparedMobileSyncMutation>;
  snapshot?: (context: MobileSyncSnapshotContext) => Promise<MobileSyncRecord[]>;
};
