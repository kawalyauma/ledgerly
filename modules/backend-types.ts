import type { Hono } from "hono";
import type { AppVariables, Env } from "../src/types";

export type BackendRouter = Hono<{ Bindings: Env; Variables: AppVariables }>;

export type BackendRouteMount = {
  basePath: string;
  router: BackendRouter;
};

export type BackendQueueHandler = (batch: MessageBatch<any>, env: Env) => Promise<void>;

export type BackendModuleDefinition = {
  key: string;
  name: string;
  version: string;
  order?: number;
  /** Public module routes are mounted before the global /api/v1 auth middleware. */
  publicRoutes?: BackendRouteMount[];
  routes: BackendRouteMount[];
  /** Queue name -> handler. Keeps module-specific queues out of the core Worker. */
  queues?: Record<string, BackendQueueHandler>;
  scheduled?: (env: Env, controller?: ScheduledController) => Promise<void>;
};
