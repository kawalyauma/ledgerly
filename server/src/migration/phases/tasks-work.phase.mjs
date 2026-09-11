import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { TASKS_WORK_TABLES } from "../tasks-work-manifest.mjs";
import { ensureTasksWorkSchema } from "../tasks-work-schema.mjs";
import { TASKS_WORK_RELATIONSHIP_CHECKS } from "../tasks-work-validators.mjs";

export default {
  name: "tasks-work",
  description: "Tasks, projects, collaboration, notifications and Work Chat",
  prerequisites: ["auth-core"],
  tables: TASKS_WORK_TABLES,
  ensureSchema: async (database) => {
    await ensureAuthCoreSchema(database);
    await ensureTasksWorkSchema(database);
  },
  finalizeSchema: null,
  relationshipChecks: TASKS_WORK_RELATIONSHIP_CHECKS,
};
