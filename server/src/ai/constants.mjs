export const AUTONOMY_LEVELS = Object.freeze({ ADVISER: 1, ASSISTANT: 2, AUTONOMOUS: 3 });
export const TASK_STATUSES = Object.freeze(["queued","working","waiting_for_approval","blocked","completed","failed","cancelled"]);
export const DOCUMENT_STATUSES = Object.freeze(["draft","in_review","changes_requested","approved","published","archived"]);
export const APPROVAL_STATUSES = Object.freeze(["pending","approved","rejected","executed","cancelled"]);
export const RISK_LEVELS = Object.freeze(["low","medium","high","prohibited"]);

export const INITIAL_AGENT_TEMPLATES = Object.freeze([
  { key:"secretary", name:"Mirembe", role:"Secretary", department:"Administration", autonomy:2, description:"Administrative writing, minutes, agendas, notices, correspondence and document preparation." },
  { key:"academic_assistant", name:"Nabirye", role:"Academic Assistant", department:"Academics", autonomy:2, description:"Lesson-plan drafting, objectives, competences, activities, resources and academic document support." },
  { key:"academic_reviewer", name:"Kato", role:"Academic Reviewer", department:"Academics", autonomy:2, description:"Curriculum alignment, completeness and standards review. AI review is never official approval." },
  { key:"finance_assistant", name:"Amina", role:"Finance Assistant", department:"Finance", autonomy:1, description:"Read-only finance summaries, reconciliation assistance, anomaly detection and reminder drafts." },
  { key:"hr_assistant", name:"Mugisha", role:"HR Assistant", department:"Human Resources", autonomy:2, description:"Staff summaries, onboarding, leave/admin support, letters and policy assistance." },
  { key:"reception_assistant", name:"Nakato", role:"Reception Assistant", department:"Administration", autonomy:2, description:"Visitor information, school information, admissions FAQs, messages and appointments." },
  { key:"inventory_assistant", name:"Tendo", role:"Inventory Assistant", department:"Inventory", autonomy:2, description:"Stock summaries, low-stock alerts, usage analysis and replenishment drafts." },
  { key:"support_assistant", name:"Sanyu", role:"Support Assistant", department:"Technology", autonomy:2, description:"Ledgerly support, troubleshooting, system-status interpretation and ticket drafting." },
]);

export const PROHIBITED_DIRECT_TOOLS = Object.freeze(new Set([
  "delete_student","alter_marks","reverse_journal","post_payroll","post_payment","alter_financial_record","adjust_stock"
]));

export const DEFAULT_LIMITS = Object.freeze({
  taskTimeoutMs: 120000,
  maxRetries: 2,
  maxPromptChars: 48000,
  maxOutputChars: 32000,
  maxToolCalls: 12,
  maxHandoffs: 3,
  maxConcurrentTasks: 2,
});
