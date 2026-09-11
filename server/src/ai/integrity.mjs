async function addConstraint(database, table, name, definition) {
  await database.query(`DO $$ BEGIN
    ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition};
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`);
}

export async function ensureAiIntegrity(database) {
  // Composite unique keys let every child relation include organization_id in its foreign key.
  await database.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_org_agent_uq ON ledgerly_ai.agents (organization_id, agent_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ai_tasks_org_task_uq ON ledgerly_ai.tasks (organization_id, task_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ai_documents_org_document_uq ON ledgerly_ai.documents (organization_id, document_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_sources_org_source_uq ON ledgerly_ai.knowledge_sources (organization_id, source_id);
  `);

  for (const [table,name] of [
    ["ledgerly_ai.agents","ai_agents_org_fk"],
    ["ledgerly_ai.tasks","ai_tasks_org_fk"],
    ["ledgerly_ai.approvals","ai_approvals_org_fk"],
    ["ledgerly_ai.documents","ai_documents_org_fk"],
    ["ledgerly_ai.document_versions","ai_document_versions_org_fk"],
    ["ledgerly_ai.knowledge_sources","ai_knowledge_sources_org_fk"],
    ["ledgerly_ai.knowledge_chunks","ai_knowledge_chunks_org_fk"],
    ["ledgerly_ai.memories","ai_memories_org_fk"],
    ["ledgerly_ai.activity","ai_activity_org_fk"],
    ["ledgerly_ai.academic_reviews","ai_academic_reviews_org_fk"],
  ]) await addConstraint(database,table,name,"FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE");

  await addConstraint(database,"ledgerly_ai.tasks","ai_tasks_agent_fk","FOREIGN KEY (organization_id,assigned_agent) REFERENCES ledgerly_ai.agents(organization_id,agent_id) ON DELETE RESTRICT");
  await addConstraint(database,"ledgerly_ai.tasks","ai_tasks_parent_fk","FOREIGN KEY (organization_id,parent_task_id) REFERENCES ledgerly_ai.tasks(organization_id,task_id) ON DELETE SET NULL");
  await addConstraint(database,"ledgerly_ai.approvals","ai_approvals_agent_fk","FOREIGN KEY (organization_id,agent_id) REFERENCES ledgerly_ai.agents(organization_id,agent_id) ON DELETE RESTRICT");
  await addConstraint(database,"ledgerly_ai.approvals","ai_approvals_task_fk","FOREIGN KEY (organization_id,task_id) REFERENCES ledgerly_ai.tasks(organization_id,task_id) ON DELETE CASCADE");
  await addConstraint(database,"ledgerly_ai.document_versions","ai_document_versions_document_fk","FOREIGN KEY (organization_id,document_id) REFERENCES ledgerly_ai.documents(organization_id,document_id) ON DELETE CASCADE");
  await addConstraint(database,"ledgerly_ai.knowledge_chunks","ai_knowledge_chunks_source_fk","FOREIGN KEY (organization_id,source_id) REFERENCES ledgerly_ai.knowledge_sources(organization_id,source_id) ON DELETE CASCADE");
  await addConstraint(database,"ledgerly_ai.memories","ai_memories_agent_fk","FOREIGN KEY (organization_id,agent_id) REFERENCES ledgerly_ai.agents(organization_id,agent_id) ON DELETE CASCADE");
  await addConstraint(database,"ledgerly_ai.activity","ai_activity_agent_fk","FOREIGN KEY (organization_id,agent_id) REFERENCES ledgerly_ai.agents(organization_id,agent_id) ON DELETE SET NULL");
  await addConstraint(database,"ledgerly_ai.activity","ai_activity_task_fk","FOREIGN KEY (organization_id,task_id) REFERENCES ledgerly_ai.tasks(organization_id,task_id) ON DELETE SET NULL");
  await addConstraint(database,"ledgerly_ai.academic_reviews","ai_academic_reviews_document_fk","FOREIGN KEY (organization_id,document_id) REFERENCES ledgerly_ai.documents(organization_id,document_id) ON DELETE CASCADE");
  await addConstraint(database,"ledgerly_ai.academic_reviews","ai_academic_reviews_task_fk","FOREIGN KEY (organization_id,task_id) REFERENCES ledgerly_ai.tasks(organization_id,task_id) ON DELETE SET NULL");
  await addConstraint(database,"ledgerly_ai.academic_reviews","ai_academic_reviews_agent_fk","FOREIGN KEY (organization_id,agent_id) REFERENCES ledgerly_ai.agents(organization_id,agent_id) ON DELETE RESTRICT");

  await addConstraint(database,"ledgerly_ai.agents","ai_agents_status_check","CHECK (status IN ('active','disabled'))");
  await addConstraint(database,"ledgerly_ai.tasks","ai_tasks_status_check","CHECK (status IN ('queued','working','waiting_for_approval','blocked','completed','failed','cancelled'))");
  await addConstraint(database,"ledgerly_ai.tasks","ai_tasks_priority_check","CHECK (priority BETWEEN 0 AND 100)");
  await addConstraint(database,"ledgerly_ai.approvals","ai_approvals_status_check","CHECK (status IN ('pending','approved','rejected','executed','cancelled'))");
  await addConstraint(database,"ledgerly_ai.approvals","ai_approvals_risk_check","CHECK (risk_level IN ('low','medium','high','prohibited'))");
  await addConstraint(database,"ledgerly_ai.documents","ai_documents_status_check","CHECK (status IN ('draft','in_review','changes_requested','approved','published','archived'))");
  await addConstraint(database,"ledgerly_ai.knowledge_sources","ai_knowledge_sources_status_check","CHECK (status IN ('pending','indexed','failed','disabled'))");
}
