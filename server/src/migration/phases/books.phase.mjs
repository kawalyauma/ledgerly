import people from "./school-people.phase.mjs";
import { BOOKS_TABLES } from "../books-manifest.mjs";
import { ensureBooksSchema, finalizeBooksSchema } from "../books-schema.mjs";
import { BOOKS_RELATIONSHIP_CHECKS } from "../books-validators.mjs";

export default {
  name: "books",
  description: "School exercise-book stock, learner distribution and offline operation intents",
  prerequisites: ["auth-core", "school-reference", "school-configuration", "contacts", "mobile-sync-core", "school-people"],
  tables: BOOKS_TABLES,
  ensureSchema: async (database) => {
    await people.ensureSchema(database);
    await ensureBooksSchema(database);
  },
  finalizeSchema: finalizeBooksSchema,
  relationshipChecks: BOOKS_RELATIONSHIP_CHECKS,
};
