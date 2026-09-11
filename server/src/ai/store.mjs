import { INITIAL_AGENT_TEMPLATES } from "./constants.mjs";

export class AiWorkforceStore {
  constructor({ database }) { if (!database?.query) throw new TypeError("AiWorkforceStore requires database"); this.database=database; }

  async ensureSchema() {
    await this.database.query(`CREATE SCHEMA IF NOT EXISTS ledgerly_ai`);
    await this.database.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.agents (
        agent_id text PRIMARY KEY, organization_id text NOT NULL, name text NOT NULL, avatar text,
        role text NOT NULL, department text, description text, system_instructions text NOT NULL DEFAULT '',
        provider text NOT NULL DEFAULT 'ollama', model text, status text NOT NULL DEFAULT 'active',
        permissions jsonb NOT NULL DEFAULT '[]'::jsonb, allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
        autonomy_level integer NOT NULL DEFAULT 2 CHECK (autonomy_level BETWEEN 1 AND 3),
        knowledge_sources jsonb NOT NULL DEFAULT '[]'::jsonb, working_schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
        approval_rules jsonb NOT NULL DEFAULT '{}'::jsonb, template_key text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, name)
      )`);
    await this.database.query(`CREATE INDEX IF NOT EXISTS ai_agents_org_idx ON ledgerly_ai.agents (organization_id, status)`);

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.tasks (
        task_id uuid PRIMARY KEY, organization_id text NOT NULL, assigned_agent text NOT NULL,
        requested_by text NOT NULL, instruction text NOT NULL, priority integer NOT NULL DEFAULT 50,
        status text NOT NULL DEFAULT 'queued', due_time timestamptz, input_references jsonb NOT NULL DEFAULT '[]'::jsonb,
        output_references jsonb NOT NULL DEFAULT '[]'::jsonb, approval_state text,
        idempotency_key text, parent_task_id uuid, handoff_depth integer NOT NULL DEFAULT 0,
        attempts integer NOT NULL DEFAULT 0, last_error text, history jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
        UNIQUE (organization_id, idempotency_key)
      )`);
    await this.database.query(`CREATE INDEX IF NOT EXISTS ai_tasks_org_status_idx ON ledgerly_ai.tasks (organization_id, status, priority DESC, created_at)`);

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.approvals (
        approval_id uuid PRIMARY KEY, organization_id text NOT NULL, task_id uuid, agent_id text NOT NULL,
        requested_action text NOT NULL, reason text, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        risk_level text NOT NULL DEFAULT 'medium', requested_approver text, status text NOT NULL DEFAULT 'pending',
        decision_by text, decision_reason text, requested_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz, executed_at timestamptz, executed_result jsonb
      )`);
    await this.database.query(`CREATE INDEX IF NOT EXISTS ai_approvals_org_status_idx ON ledgerly_ai.approvals (organization_id, status, requested_at DESC)`);

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.documents (
        document_id uuid PRIMARY KEY, organization_id text NOT NULL, type text NOT NULL, title text NOT NULL,
        content jsonb NOT NULL DEFAULT '{}'::jsonb, version integer NOT NULL DEFAULT 1,
        status text NOT NULL DEFAULT 'draft', creator jsonb NOT NULL, ai_provenance jsonb,
        human_editors jsonb NOT NULL DEFAULT '[]'::jsonb, approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb, rendered_pdf_ref text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.document_versions (
        document_id uuid NOT NULL, version integer NOT NULL, organization_id text NOT NULL,
        content jsonb NOT NULL, provenance jsonb, edited_by jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (document_id, version)
      )`);

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.knowledge_sources (
        source_id uuid PRIMARY KEY, organization_id text NOT NULL, name text NOT NULL, source_type text NOT NULL,
        storage_ref text, status text NOT NULL DEFAULT 'pending', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), indexed_at timestamptz
      )`);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.knowledge_chunks (
        chunk_id uuid PRIMARY KEY, organization_id text NOT NULL, source_id uuid NOT NULL,
        chunk_index integer NOT NULL, content text NOT NULL, token_count integer,
        embedding vector(768), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_id, chunk_index)
      )`);
    await this.database.query(`CREATE INDEX IF NOT EXISTS ai_knowledge_org_source_idx ON ledgerly_ai.knowledge_chunks (organization_id, source_id)`);

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.memories (
        memory_id uuid PRIMARY KEY, organization_id text NOT NULL, agent_id text NOT NULL,
        memory_type text NOT NULL CHECK (memory_type IN ('task','durable')),
        key text NOT NULL, value jsonb NOT NULL, expires_at timestamptz, disabled boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, agent_id, memory_type, key)
      )`);

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_ai.activity (
        activity_id uuid PRIMARY KEY, organization_id text NOT NULL, agent_id text, task_id uuid,
        activity_type text NOT NULL, summary text NOT NULL, data jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL DEFAULT now()
      )`);
    await this.database.query(`CREATE INDEX IF NOT EXISTS ai_activity_org_time_idx ON ledgerly_ai.activity (organization_id, occurred_at DESC)`);
  }

  async seedTemplates(organizationId, makeId) {
    for (const template of INITIAL_AGENT_TEMPLATES) {
      await this.database.query(`INSERT INTO ledgerly_ai.agents
        (agent_id, organization_id, name, role, department, description, autonomy_level, template_key, allowed_tools, permissions)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
        ON CONFLICT (organization_id, name) DO NOTHING`, [
        makeId(template.key), organizationId, template.name, template.role, template.department, template.description,
        template.autonomy, template.key, JSON.stringify(defaultTools(template.key)), JSON.stringify(defaultPermissions(template.key))
      ]);
    }
  }
}

function defaultTools(key) {
  const map = {
    secretary:["get_school_profile","update_document_draft","create_task","send_notification","generate_report","request_approval"],
    academic_assistant:["get_school_profile","get_staff","get_academic_context","get_lesson_plan","create_lesson_plan_draft","update_document_draft","create_task","generate_report","request_approval"],
    academic_reviewer:["get_school_profile","get_academic_context","get_lesson_plan","update_document_draft","create_task","generate_report","request_approval"],
    finance_assistant:["get_student","get_student_balance","get_finance_summary","prepare_fee_reminder","generate_report","request_approval"],
    hr_assistant:["get_staff","get_school_profile","update_document_draft","create_task","generate_report","request_approval"],
    reception_assistant:["search_students","get_student","get_staff","get_school_profile","create_task","send_notification"],
    inventory_assistant:["generate_report","create_task","request_approval"],
    support_assistant:["generate_report","create_task","request_approval"]
  };
  return map[key] ?? [];
}
function defaultPermissions(key) {
  const map = {
    secretary:["school:read","documents:write","tasks:write","reports:read","approvals:write"],
    academic_assistant:["school:read","staff:read","academics:read","academics:write","documents:write","tasks:write","reports:read","approvals:write"],
    academic_reviewer:["school:read","academics:read","documents:write","tasks:write","reports:read","approvals:write"],
    finance_assistant:["students:read","fees:read","finance:read","reports:read","approvals:write"],
    hr_assistant:["staff:read","school:read","documents:write","tasks:write","reports:read","approvals:write"],
    reception_assistant:["students:read","staff:read","school:read","tasks:write"],
    inventory_assistant:["inventory:read","reports:read","tasks:write","approvals:write"],
    support_assistant:["support:read","reports:read","tasks:write","approvals:write"]
  };
  return map[key] ?? [];
}
