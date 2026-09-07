import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BriefcaseBusiness,
  Clock3,
  FilePlus2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { ApiError, get, patch, post } from "../api";
import { usePermission } from "../auth";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Notice,
  SearchableSelect,
  Spinner,
} from "../components/ui";
import { Heading } from "./OrganizationPages";

type Account = {
  id: string;
  code: string;
  name: string;
  active: boolean | number;
  allowPosting: boolean | number;
};
type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  budgetAmountMinor: number;
  customer?: string;
  customerId?: string;
};
type Contact = { id: string; name: string; type?: string };
type ExpenseLine = {
  type: "expense" | "mileage" | "per_diem" | "card";
  expenseDate: string;
  description: string;
  accountId: string;
  amountMinor: number;
  taxMinor: number;
  projectId?: string;
  mileageMicros?: number;
  perDiemDays?: number;
  receiptAttachmentId?: string;
  receipt?: File;
};
type Claim = {
  id: string;
  number: string;
  claimDate: string;
  currency: string;
  employeeId: string;
  status: string;
  totalMinor: number;
  lines: ExpenseLine[];
};
type TimeEntry = {
  id: string;
  projectId: string;
  entryDate: string;
  minutes: number;
  description?: string;
  billable: boolean;
  costRateMinor: number;
  billingRateMinor: number;
  status: string;
};
type Recurring = {
  id: string;
  type: "invoice" | "bill" | "journal";
  name: string;
  template: Record<string, unknown>;
  cadence: string;
  nextRunAt: string;
  autoPost: boolean | number;
  active: boolean | number;
  lastRunAt?: string;
};
const today = () => new Date().toISOString().slice(0, 10),
  money = (n = 0, c = "UGX") =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(
      n / 100,
    ),
  tone = (s: string): "success" | "warning" | "danger" | "neutral" =>
    ["approved", "reimbursed", "active"].includes(s)
      ? "success"
      : ["rejected"].includes(s)
        ? "danger"
        : ["submitted", "draft"].includes(s)
          ? "warning"
          : "neutral";
function Tabs({
  value,
  set,
  items,
}: {
  value: string;
  set: (v: string) => void;
  items: [string, string][];
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([v, l]) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === v}
          className={value === v ? "active" : ""}
          onClick={() => set(v)}
          key={v}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
function ReadOnly({ children }: { children: React.ReactNode }) {
  return <Notice tone="warning">You have read access only. {children}</Notice>;
}
function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Card>
      <div className="empty">
        <h3>Unable to load this workspace</h3>
        <p>{error}</p>
        <Button variant="secondary" onClick={retry}>
          <RefreshCw size={15} /> Try again
        </Button>
      </div>
    </Card>
  );
}

export function ExpensesPage() {
  const write = usePermission("documents:write"),
    [tab, setTab] = useState("claims"),
    [claims, setClaims] = useState<Claim[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function act(c: Claim, action: string) {
    if (!write) return;
    const verb =
      action === "reject"
        ? "Reject"
        : action === "reimburse"
          ? "Mark as reimbursed"
          : "Approve";
    if (!confirm(`${verb} claim ${c.number}?`)) return;
    setError("");
    try {
      const r = await post<{ status: string }>(
        `/operations/expenses/${c.id}/${action}`,
        {},
      );
      setClaims((xs) =>
        xs.map((x) => (x.id === c.id ? { ...x, status: r.status } : x)),
      );
      setSuccess(`Claim ${c.number} is now ${r.status}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="page">
      <Heading
        title="Expense management"
        text="Employee claims, receipts, mileage, per diem and corporate-card spend."
        action={
          write ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> New claim
            </Button>
          ) : undefined
        }
      />
      {!write && (
        <ReadOnly>
          Creating and progressing claims requires documents:write.
        </ReadOnly>
      )}
      {success && <Notice tone="success">{success}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Tabs
        value={tab}
        set={setTab}
        items={[
          ["claims", "Claims"],
          ["cards", "Corporate cards"],
        ]}
      />
      {tab === "claims" ? (
        <Card>
          {claims.length === 0 ? (
            <EmptyState
              title="No claims in this session"
              description="The current API supports creating and progressing claims but does not expose a claim-list endpoint. Newly created claims remain visible here until this page is reloaded."
              action={
                write ? (
                  <Button onClick={() => setOpen(true)}>Create claim</Button>
                ) : undefined
              }
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Date</th>
                    <th>Lines</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <b>{c.number}</b>
                        <br />
                        <small>Employee {c.employeeId}</small>
                      </td>
                      <td>{c.claimDate}</td>
                      <td>{c.lines.length}</td>
                      <td>{money(c.totalMinor, c.currency)}</td>
                      <td>
                        <Badge tone={tone(c.status)}>{c.status}</Badge>
                      </td>
                      <td>
                        {write && (
                          <div className="row-actions">
                            {c.status === "draft" && (
                              <button onClick={() => act(c, "submit")}>
                                Submit
                              </button>
                            )}
                            {c.status === "submitted" && (
                              <>
                                <button onClick={() => act(c, "approve")}>
                                  Approve
                                </button>
                                <button onClick={() => act(c, "reject")}>
                                  Reject
                                </button>
                              </>
                            )}
                            {c.status === "approved" && (
                              <button onClick={() => act(c, "reimburse")}>
                                Reimburse
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="Corporate-card register unavailable"
            description="Expense lines can be classified as corporate-card charges. The current backend has no corporate-card list, create, assignment, or feed endpoints, so card records cannot yet be managed safely from this screen."
          />
        </Card>
      )}
      {open && (
        <ClaimModal
          close={() => setOpen(false)}
          done={(c) => {
            setClaims((x) => [c, ...x]);
            setOpen(false);
            setSuccess(`Claim ${c.number} created as draft.`);
          }}
        />
      )}
    </div>
  );
}
function ClaimModal({
  close,
  done,
}: {
  close: () => void;
  done: (c: Claim) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]),
    [accountsLoading, setAccountsLoading] = useState(true),
    [projects, setProjects] = useState<Project[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [f, setF] = useState({
      employeeId: "",
      number: "",
      claimDate: today(),
      currency: "UGX",
    }),
    [lines, setLines] = useState<ExpenseLine[]>([
      {
        type: "expense",
        expenseDate: today(),
        description: "",
        accountId: "",
        amountMinor: 0,
        taxMinor: 0,
      },
    ]);
  useEffect(() => {
    Promise.all([
      get<Account[]>("/accounts?limit=500"),
      get<Project[]>("/projects"),
    ])
      .then(([a, p]) => {
        setAccounts(a);
        setProjects(p);
      })
      .catch((e) => setError(e.message))
      .finally(() => setAccountsLoading(false));
  }, []);
  const setLine = (i: number, k: keyof ExpenseLine, v: unknown) =>
      setLines((xs) => xs.map((x, j) => (i === j ? { ...x, [k]: v } : x))),
    total = lines.reduce((n, x) => n + x.amountMinor + x.taxMinor, 0);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      lines.some((x) => !x.accountId || !x.description || x.amountMinor < 0)
    ) {
      setError("Complete every line and use non-negative amounts.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const uploaded = await Promise.all(
        lines.map(async (l, i) => {
          if (!l.receipt) return l;
          const a = await post<{ id: string }>(
            "/operations/attachments/presign",
            {
              entityType: "expense_claim",
              entityId: `pending-${f.number}`,
              filename: l.receipt.name,
              contentType: l.receipt.type || "application/octet-stream",
              sizeBytes: l.receipt.size,
            },
          );
          return { ...l, receiptAttachmentId: a.id };
        }),
      );
      const body = {
        ...f,
        lines: uploaded.map(({ receipt, ...l }) => ({
          ...l,
          projectId: l.projectId || undefined,
          mileageMicros: l.type === "mileage" ? l.mileageMicros : undefined,
          perDiemDays: l.type === "per_diem" ? l.perDiemDays : undefined,
        })),
      };
      const r = await post<{ id: string; status: string; totalMinor: number }>(
        "/operations/expenses",
        body,
      );
      done({ ...body, ...r, lines: uploaded });
    } catch (x) {
      setError((x as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create expense claim" onClose={close}>
      <form onSubmit={submit}>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-grid">
          <Field
            label="Employee ID"
            hint="Use the payroll employee identifier."
          >
            <input
              required
              value={f.employeeId}
              onChange={(e) => setF({ ...f, employeeId: e.target.value })}
            />
          </Field>
          <Field label="Claim number">
            <input
              required
              value={f.number}
              onChange={(e) => setF({ ...f, number: e.target.value })}
            />
          </Field>
          <Field label="Claim date">
            <input
              required
              type="date"
              value={f.claimDate}
              onChange={(e) => setF({ ...f, claimDate: e.target.value })}
            />
          </Field>
          <Field label="Currency">
            <input
              required
              maxLength={3}
              value={f.currency}
              onChange={(e) =>
                setF({ ...f, currency: e.target.value.toUpperCase() })
              }
            />
          </Field>
        </div>
        <h3>Expense lines</h3>
        {lines.map((l, i) => (
          <Card className="form-card" key={i}>
            <div className="form-grid">
              <Field label="Line type">
                <select
                  value={l.type}
                  onChange={(e) => setLine(i, "type", e.target.value)}
                >
                {["expense", "mileage", "per_diem", "card"].map(
                    (x) => (
                      <option key={x} value={x}>
                        {x.replaceAll("_", " ")}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Expense date">
                <input
                  required
                  type="date"
                  value={l.expenseDate}
                  onChange={(e) => setLine(i, "expenseDate", e.target.value)}
                />
              </Field>
              <Field label="Description">
                <input
                  required
                  value={l.description}
                  onChange={(e) => setLine(i, "description", e.target.value)}
                />
              </Field>
              <Field label="Expense account">
                <SearchableSelect value={l.accountId} onChange={(value) => setLine(i, "accountId", value)} loading={accountsLoading}
                  options={accounts.filter((a) => a.active && a.allowPosting).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
                  placeholder="Select account…" searchPlaceholder="Search account code or name…" emptyText="No posting accounts found." ariaLabel={`Expense account ${i + 1}`}/>
              </Field>
              <Field label="Amount">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.amountMinor / 100 || ""}
                  onChange={(e) =>
                    setLine(
                      i,
                      "amountMinor",
                      Math.round(Number(e.target.value) * 100),
                    )
                  }
                />
              </Field>
              <Field label="Tax">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.taxMinor / 100 || ""}
                  onChange={(e) =>
                    setLine(
                      i,
                      "taxMinor",
                      Math.round(Number(e.target.value) * 100),
                    )
                  }
                />
              </Field>
              <Field label="Project">
                <select
                  value={l.projectId || ""}
                  onChange={(e) => setLine(i, "projectId", e.target.value)}
                >
                  <option value="">No project</option>
                  {projects
                    .filter((p) => p.status === "active")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} · {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              {l.type === "mileage" && (
                <Field label="Distance (km)">
                  <input
                    required
                    type="number"
                    min="0.001"
                    step="0.001"
                    onChange={(e) =>
                      setLine(
                        i,
                        "mileageMicros",
                        Math.round(Number(e.target.value) * 1_000_000),
                      )
                    }
                  />
                </Field>
              )}
              {l.type === "per_diem" && (
                <Field label="Per-diem days">
                  <input
                    required
                    type="number"
                  min="1"
                  step="1"
                    onChange={(e) =>
                      setLine(i, "perDiemDays", Number(e.target.value))
                    }
                  />
                </Field>
              )}
              <Field label="Receipt (max 25 MB)">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setLine(i, "receipt", e.target.files?.[0])}
                />
              </Field>
            </div>
            {lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLines((x) => x.filter((_, j) => j !== i))}
              >
                <Trash2 size={14} /> Remove line
              </Button>
            )}
          </Card>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setLines((x) => [
              ...x,
              {
                type: "expense",
                expenseDate: today(),
                description: "",
                accountId: "",
                amountMinor: 0,
                taxMinor: 0,
              },
            ])
          }
        >
          <Plus size={14} /> Add line
        </Button>
        <p>
          <b>Claim total: {money(total, f.currency)}</b>
        </p>
        <Notice tone="info">
          <Upload size={15} /> Receipt metadata is registered with the
          attachment service. Object upload is not available through the current
          API response.
        </Notice>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? "Creating…" : "Create draft claim"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectsPage() {
  const write = usePermission("documents:write"),
    [rows, setRows] = useState<Project[]>([]),
    [entries, setEntries] = useState<TimeEntry[]>([]),
    [selected, setSelected] = useState<Project | null>(null),
    [open, setOpen] = useState(false),
    [timeOpen, setTimeOpen] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    setError("");
    get<Project[]>("/projects")
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(()=>{void load()},[]);
  if (error && loading === false)
    return (
      <div className="page">
        <Heading title="Projects & time" />
        <LoadError error={error} retry={load} />
      </div>
    );
  return (
    <div className="page">
      <Heading
        title="Projects & time"
        text="Budgets, customer work, time approvals and project economics."
        action={
          write ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> New project
            </Button>
          ) : undefined
        }
      />
      {!write && (
        <ReadOnly>
          Creating projects and time entries requires documents:write.
        </ReadOnly>
      )}
      <Card>
        {loading ? (
          <Spinner label="Loading projects" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No projects"
            description="Create a project to track budgets, time and profitability."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Customer</th>
                  <th>Budget</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>
                        {p.code} · {p.name}
                      </b>
                    </td>
                    <td>{p.customer || "—"}</td>
                    <td>{money(p.budgetAmountMinor)}</td>
                    <td>
                      <Badge tone={tone(p.status)}>{p.status}</Badge>
                    </td>
                    <td>
                      <button onClick={() => setSelected(p)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {selected && (
        <ProjectDetail
          project={selected}
          entries={entries.filter((x) => x.projectId === selected.id)}
          write={write}
          close={() => setSelected(null)}
          add={() => setTimeOpen(true)}
          approve={async (e) => {
            if (!confirm("Approve this time entry?")) return;
            try {
              const r = await patch<{ status: string }>(
                `/projects/${selected.id}/time-entries/${e.id}/approve`,
                {},
              );
              setEntries((xs) =>
                xs.map((x) => (x.id === e.id ? { ...x, status: r.status } : x)),
              );
            } catch (x) {
              setError((x as Error).message);
            }
          }}
        />
      )}{" "}
      {open && (
        <ProjectModal
          close={() => setOpen(false)}
          done={(p) => {
            setRows((x) => [...x, p]);
            setOpen(false);
          }}
        />
      )}
      {timeOpen && selected && (
        <TimeModal
          project={selected}
          close={() => setTimeOpen(false)}
          done={(e) => {
            setEntries((x) => [e, ...x]);
            setTimeOpen(false);
          }}
        />
      )}
    </div>
  );
}
function ProjectDetail({
  project,
  entries,
  write,
  close,
  add,
  approve,
}: {
  project: Project;
  entries: TimeEntry[];
  write: boolean;
  close: () => void;
  add: () => void;
  approve: (e: TimeEntry) => void;
}) {
  const cost = entries.reduce(
      (n, e) => n + Math.round((e.minutes / 60) * e.costRateMinor),
      0,
    ),
    revenue = entries
      .filter((e) => e.billable)
      .reduce(
        (n, e) => n + Math.round((e.minutes / 60) * e.billingRateMinor),
        0,
      );
  return (
    <Modal title={`${project.code} · ${project.name}`} onClose={close}>
      <div className="metadata">
        <b>Status</b>
        <span>{project.status}</span>
        <b>Customer</b>
        <span>{project.customer || "Not assigned"}</span>
        <b>Budget</b>
        <span>{money(project.budgetAmountMinor)}</span>
        <b>Recorded hours</b>
        <span>
          {(entries.reduce((n, e) => n + e.minutes, 0) / 60).toFixed(2)}
        </span>
        <b>Time revenue</b>
        <span>{money(revenue)}</span>
        <b>Time cost</b>
        <span>{money(cost)}</span>
        <b>Time profit</b>
        <span>{money(revenue - cost)}</span>
      </div>
      <Notice tone="info">
        Profitability shown here is calculated from time entries created in this
        session. Full ledger revenue and expense profitability is available from
        project reports.
      </Notice>
      {entries.length === 0 ? (
        <EmptyState
          title="No time entries in this session"
          description="The backend currently has create and approve endpoints, but no time-entry listing endpoint."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Work</th>
                <th>Hours</th>
                <th>Rates</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.entryDate}</td>
                  <td>
                    {e.description || "—"}
                    <br />
                    <small>{e.billable ? "Billable" : "Non-billable"}</small>
                  </td>
                  <td>{(e.minutes / 60).toFixed(2)}</td>
                  <td>
                    {money(e.costRateMinor)} cost
                    <br />
                    <small>{money(e.billingRateMinor)} billing</small>
                  </td>
                  <td>
                    <Badge tone={tone(e.status)}>{e.status}</Badge>
                  </td>
                  <td>
                    {write && e.status === "draft" && (
                      <button onClick={() => approve(e)}>Approve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="modal-actions">
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
        {write && project.status === "active" && (
          <Button onClick={add}>
            <Clock3 size={15} /> Add time
          </Button>
        )}
      </div>
    </Modal>
  );
}
function ProjectModal({
  close,
  done,
}: {
  close: () => void;
  done: (p: Project) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]),
    [f, setF] = useState({
      customerId: "",
      code: "",
      name: "",
      budgetAmountMinor: 0,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    get<Contact[]>("/contacts?type=customer&limit=500")
      .then(setContacts)
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await post<Project>("/projects", {
        ...f,
        customerId: f.customerId || undefined,
      });
      done({
        ...p,
        customer: contacts.find((c) => c.id === f.customerId)?.name,
      });
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create project" onClose={close}>
      <form onSubmit={submit}>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-grid">
          <Field label="Project code">
            <input
              required
              maxLength={40}
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
            />
          </Field>
          <Field label="Project name">
            <input
              required
              maxLength={160}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label="Customer">
            <select
              value={f.customerId}
              onChange={(e) => setF({ ...f, customerId: e.target.value })}
            >
              <option value="">No customer</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Budget">
            <input
              type="number"
              min="0"
              step="0.01"
              value={f.budgetAmountMinor / 100 || ""}
              onChange={(e) =>
                setF({
                  ...f,
                  budgetAmountMinor: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </Field>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function TimeModal({
  project,
  close,
  done,
}: {
  project: Project;
  close: () => void;
  done: (e: TimeEntry) => void;
}) {
  const [f, setF] = useState({
      entryDate: today(),
      minutes: 60,
      description: "",
      billable: true,
      costRateMinor: 0,
      billingRateMinor: 0,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.minutes <= 0 || f.minutes > 1440)
      return setError("Minutes must be between 1 and 1,440.");
    setBusy(true);
    try {
      const r = await post<Omit<TimeEntry, "projectId">>(
        `/projects/${project.id}/time-entries`,
        f,
      );
      done({ ...r, projectId: project.id });
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Add time · ${project.code}`} onClose={close}>
      <form onSubmit={submit}>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-grid">
          <Field label="Entry date">
            <input
              required
              type="date"
              value={f.entryDate}
              onChange={(e) => setF({ ...f, entryDate: e.target.value })}
            />
          </Field>
          <Field label="Minutes">
            <input
              required
              type="number"
              min="1"
              max="1440"
              value={f.minutes}
              onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Description">
            <textarea
              maxLength={500}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
          <Field label="Cost rate / hour">
            <input
              type="number"
              min="0"
              step="0.01"
              onChange={(e) =>
                setF({
                  ...f,
                  costRateMinor: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </Field>
          <Field label="Billing rate / hour">
            <input
              type="number"
              min="0"
              step="0.01"
              onChange={(e) =>
                setF({
                  ...f,
                  billingRateMinor: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={f.billable}
            onChange={(e) => setF({ ...f, billable: e.target.checked })}
          />{" "}
          Billable time
        </label>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? "Saving…" : "Save draft time"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function RecurringPage() {
  const write = usePermission("documents:write"),
    [rows, setRows] = useState<Recurring[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  const load = () => {
    setLoading(true);
    setError("");
    get<Recurring[]>("/operations/recurring")
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(()=>{void load()},[]);
  return (
    <div className="page">
      <Heading
        title="Recurring transactions"
        text="Reusable invoice, bill and journal schedules."
        action={
          write ? (
            <Button onClick={() => setOpen(true)}>
              <FilePlus2 size={16} /> New template
            </Button>
          ) : undefined
        }
      />
      <Notice tone="warning">
        <b>Execution limitation:</b> due templates run only through the deployed
        hourly scheduler. The current API has no manual “run now”, edit,
        pause/resume, or per-template execution log/error-status endpoint.
        Auto-post controls whether generated transactions are posted, not how
        often the scheduler checks.
      </Notice>
      {!write && (
        <ReadOnly>Creating templates requires documents:write.</ReadOnly>
      )}
      {error ? (
        <LoadError error={error} retry={load} />
      ) : (
        <Card>
          {loading ? (
            <Spinner label="Loading templates" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No recurring templates"
              description="Create an invoice, bill or journal schedule."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Cadence</th>
                    <th>Next run</th>
                    <th>Last run</th>
                    <th>Posting</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.name}</b>
                        <br />
                        <small>{r.type}</small>
                      </td>
                      <td>{r.cadence}</td>
                      <td>{new Date(r.nextRunAt).toLocaleString()}</td>
                      <td>
                        {r.lastRunAt
                          ? new Date(r.lastRunAt).toLocaleString()
                          : "Never"}
                      </td>
                      <td>{r.autoPost ? "Automatic" : "Create as draft"}</td>
                      <td>
                        <Badge tone={r.active ? "success" : "neutral"}>
                          {r.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {open && (
        <RecurringModal
          close={() => setOpen(false)}
          done={(r) => {
            setRows((x) => [r, ...x]);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
function RecurringModal({
  close,
  done,
}: {
  close: () => void;
  done: (r: Recurring) => void;
}) {
  const [f, setF] = useState({
      type: "invoice" as Recurring["type"],
      name: "",
      cadence: "monthly",
      nextRunAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
      autoPost: false,
      template: '{\n  "currency": "UGX"\n}',
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    let template: Record<string, unknown>;
    try {
      template = JSON.parse(f.template);
      if (!template || Array.isArray(template) || typeof template !== "object")
        throw new Error();
    } catch {
      return setError("Template data must be a valid JSON object.");
    }
    if (
      f.autoPost &&
      !confirm(
        "Auto-post will post each generated transaction when required posting fields are valid. Continue?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const r = await post<Recurring>("/operations/recurring", {
        type: f.type,
        name: f.name,
        cadence: f.cadence,
        nextRunAt: new Date(f.nextRunAt).toISOString(),
        autoPost: f.autoPost,
        template,
      });
      done(r);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create recurring template" onClose={close}>
      <form onSubmit={submit}>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-grid">
          <Field label="Transaction type">
            <select
              value={f.type}
              onChange={(e) =>
                setF({ ...f, type: e.target.value as Recurring["type"] })
              }
            >
              <option value="invoice">Invoice</option>
              <option value="bill">Bill</option>
              <option value="journal">Journal</option>
            </select>
          </Field>
          <Field label="Template name">
            <input
              required
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label="Cadence">
            <select
              value={f.cadence}
              onChange={(e) => setF({ ...f, cadence: e.target.value })}
            >
              {["weekly", "monthly", "quarterly", "yearly"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Next run">
            <input
              required
              type="datetime-local"
              value={f.nextRunAt}
              onChange={(e) => setF({ ...f, nextRunAt: e.target.value })}
            />
          </Field>
          <Field
            label="Template data (JSON)"
            hint="Use the same fields required by the corresponding invoice, bill or journal create API."
          >
            <textarea
              required
              rows={9}
              value={f.template}
              onChange={(e) => setF({ ...f, template: e.target.value })}
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={f.autoPost}
            onChange={(e) => setF({ ...f, autoPost: e.target.checked })}
          />{" "}
          Automatically post generated transactions
        </label>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? "Creating…" : "Create template"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
