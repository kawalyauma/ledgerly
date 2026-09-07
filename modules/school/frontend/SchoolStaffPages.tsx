import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  CircleDollarSign,
  Download,
  FileText,
  GraduationCap,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  WalletCards,
} from "lucide-react";
import { can, del, downloadFile, errorText, get, post, put } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { SchoolFileUpload } from "../../../web/components/SchoolFileUpload";
import { Badge, Button, Card, EmptyState, Field, Modal, Notice, SearchableSelect, Spinner } from "../../../web/components/ui";

type R = Record<string, any>;
const B = "/school/staff-management";
const S = "/school/setup";
const today = () => new Date().toISOString().slice(0, 10);
const cash = (n: any, c = "UGX") => new Intl.NumberFormat("en-UG", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(Number(n || 0) / 100);
const words = (v: any) => String(v ?? "—").replaceAll("_", " ");
const staffName = (r: R) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ");
const truthy = (v: any) => v === true || v === 1 || v === "1";

function tone(v: string): "success" | "warning" | "danger" | "neutral" {
  return ["active", "paid", "posted", "verified"].includes(v)
    ? "success"
    : ["suspended", "on_leave", "partially_paid", "unpaid", "draft"].includes(v)
      ? "warning"
      : ["terminated", "resigned", "retired", "reversed"].includes(v)
        ? "danger"
        : "neutral";
}

function useRows(path: string) {
  const [data, setData] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    setError("");
    get<R[]>(path).then(setData).catch(e => setError(errorText(e))).finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, [path]);
  return { data, loading, error, load };
}

export function StaffWorkspace() {
  const { principal } = useAuth();
  const write = can(principal, "school:write");
  const staff = useRows(`${B}/staff?limit=500`);
  const positions = useRows(`${B}/positions`);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [teacher, setTeacher] = useState("");
  const [open, setOpen] = useState<"staff" | "positions" | null>(null);
  const [selected, setSelected] = useState<R | null>(null);
  const [message, setMessage] = useState("");
  const [accounting, setAccounting] = useState<R[]>([]);

  useEffect(() => {
    get<R[]>(`${B}/accounting/defaults`).then(setAccounting).catch(() => {});
  }, []);

  const rows = useMemo(() => staff.data.filter(r => {
    const text = `${staffName(r)} ${r.staffNumber} ${r.email} ${r.phone} ${r.departmentName} ${r.positionName} ${r.campusName}`.toLowerCase();
    return (!q || text.includes(q.toLowerCase()))
      && (!status || r.employmentStatus === status)
      && (!teacher || (teacher === "teacher" ? !!r.isTeacher : !r.isTeacher));
  }), [staff.data, q, status, teacher]);

  const payrollTotal = staff.data
    .filter(r => r.employmentStatus === "active" && r.payType === "salary")
    .reduce((n, r) => n + Number(r.basePayMinor || 0), 0);

  return <div className="school-section">
    <div className="school-page-head">
      <div>
        <span className="eyebrow">People operations</span>
        <h1>Staff & teachers</h1>
        <p>Employee records, teaching assignments, qualifications, documents, recurring compensation and salary balances connected directly to Ledgerly accounting.</p>
      </div>
      <div className="heading-actions">
        <Button variant="secondary" onClick={() => setOpen("positions")}><BriefcaseBusiness size={15}/> Positions</Button>
        {write && <Button onClick={() => setOpen("staff")}><Plus size={15}/> Add staff member</Button>}
      </div>
    </div>

    {message && <Notice tone="success">{message}</Notice>}

    <div className="school-metrics">
      <Card><small>Active staff</small><strong>{staff.data.filter(r => r.employmentStatus === "active").length}</strong><span>Current employees</span></Card>
      <Card><small>Teachers</small><strong>{staff.data.filter(r => !!r.isTeacher).length}</strong><span>Teaching staff</span></Card>
      <Card><small>Positions</small><strong>{positions.data.filter(r => r.active !== 0).length}</strong><span>Job roles configured</span></Card>
      <Card><small>Monthly base payroll</small><strong>{cash(payrollTotal)}</strong><span>Before variable earnings & deductions</span></Card>
    </div>

    {accounting.length > 0 && <Card className="staff-accounting-strip">
      <div><ShieldCheck size={18}/><span><b>Payroll accounting is connected</b><small>Each school employee has an individual Staff Payable account. Core defaults are created automatically.</small></span></div>
      <div className="staff-accounting-pills">{accounting.map(a => <span key={a.id}>{a.code} · {a.name}</span>)}</div>
    </Card>}

    <Card>
      <div className="school-table-toolbar school-filter-wrap">
        <label><Search size={15}/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, staff number, phone, department…"/></label>
        <select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{["active", "on_leave", "suspended", "terminated", "resigned", "retired", "inactive"].map(v => <option key={v} value={v}>{words(v)}</option>)}</select>
        <select value={teacher} onChange={e => setTeacher(e.target.value)}><option value="">All staff</option><option value="teacher">Teachers only</option><option value="other">Non-teaching staff</option></select>
      </div>
      {staff.loading ? <Spinner label="Loading staff"/> : staff.error ? <Notice tone="danger">{staff.error}</Notice> : rows.length ?
        <div className="table-wrap"><table className="school-table"><thead><tr><th>Staff member</th><th>Department / position</th><th>Employment</th><th>Base pay</th><th>Accounting</th><th/></tr></thead><tbody>{rows.map(r => <tr key={r.id}>
          <td><b>{staffName(r)}</b><small>{r.staffNumber} · {r.email || r.phone || "No contact"}</small></td>
          <td>{r.departmentName || "—"}<small>{r.positionName || "No position"}{r.isTeacher ? " · Teacher" : ""}</small></td>
          <td><Badge tone={tone(r.employmentStatus)}>{words(r.employmentStatus)}</Badge><small>{words(r.employmentType)}</small></td>
          <td>{cash(r.basePayMinor, r.currency)}<small>{words(r.payType)}</small></td>
          <td><b>{r.payableAccountCode || "—"}</b><small>{r.payableAccountName || "Staff payable"}</small></td>
          <td><button onClick={() => setSelected(r)}>Manage</button></td>
        </tr>)}</tbody></table></div>
        : <EmptyState title="No staff found" description="Add your first employee or adjust the filters."/>}
    </Card>

    {open === "staff" && <StaffCreate close={() => setOpen(null)} done={() => { setOpen(null); staff.load(); setMessage("Staff member created, employee contact created, and payroll control account linked."); }} positions={positions.data}/>} 
    {open === "positions" && <PositionsManager close={() => setOpen(null)} rows={positions.data} reload={positions.load} write={write}/>} 
    {selected && <StaffDetail seed={selected} write={write} close={() => setSelected(null)} reload={() => { staff.load(); positions.load(); }}/>} 
  </div>;
}

function StaffCreate({ close, done, positions }: { close: () => void; done: () => void; positions: R[] }) {
  const [refs, setRefs] = useState<R>({ departments: [], branches: [], users: [] });
  const [v, setV] = useState<R>({
    firstName: "", middleName: "", lastName: "", preferredName: "", staffNumber: "", gender: "", dateOfBirth: "", nationality: "Ugandan",
    nationalId: "", taxIdentifier: "", email: "", phone: "", alternatePhone: "", physicalAddress: "", postalAddress: "",
    departmentId: "", positionId: "", campusId: "", employmentType: "permanent", employmentStatus: "active", isTeacher: false,
    hireDate: today(), payType: "salary", basePay: "0", currency: "UGX", userId: "", profilePhotoFileId: "", profilePhotoName: "", notes: "",
    emergencyName: "", emergencyRelationship: "", emergencyPhone: "", emergencyEmail: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([get<R[]>(`${S}/departments`), get<R[]>(`${S}/branches`), get<R[]>("/school/iam/users")])
      .then(([departments, branches, users]) => setRefs({ departments, branches, users }))
      .catch(e => setError(errorText(e)));
  }, []);

  const c = (k: string, x: any) => setV((a: R) => ({ ...a, [k]: x }));
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await post(`${B}/staff`, {
        staffNumber: v.staffNumber || null,
        firstName: v.firstName, middleName: v.middleName || null, lastName: v.lastName, preferredName: v.preferredName || null,
        gender: v.gender || null, dateOfBirth: v.dateOfBirth || null, nationality: v.nationality || null, nationalId: v.nationalId || null,
        taxIdentifier: v.taxIdentifier || null, phone: v.phone || null, alternatePhone: v.alternatePhone || null, email: v.email || null,
        physicalAddress: v.physicalAddress || null, postalAddress: v.postalAddress || null, departmentId: v.departmentId || null,
        positionId: v.positionId || null, campusId: v.campusId || null, employmentType: v.employmentType, employmentStatus: v.employmentStatus,
        isTeacher: !!v.isTeacher, hireDate: v.hireDate, payType: v.payType, basePayMinor: Math.round(Number(v.basePay || 0) * 100),
        currency: String(v.currency || "UGX").toUpperCase(), userId: v.userId || null, profilePhotoFileId: v.profilePhotoFileId || null, notes: v.notes || null,
        emergencyContact: v.emergencyName && v.emergencyPhone ? {
          name: v.emergencyName, relationship: v.emergencyRelationship || null, phone: v.emergencyPhone,
          alternatePhone: null, email: v.emergencyEmail || null, physicalAddress: null,
        } : undefined,
      });
      done();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return <Modal title="Add staff member" onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body staff-modal-body">
    <div className="school-form-section"><h3>Identity & contact</h3><div className="form-grid">
      <Field label="First name"><input value={v.firstName} onChange={e => c("firstName", e.target.value)} required/></Field>
      <Field label="Middle name"><input value={v.middleName} onChange={e => c("middleName", e.target.value)}/></Field>
      <Field label="Last name"><input value={v.lastName} onChange={e => c("lastName", e.target.value)} required/></Field>
      <Field label="Preferred name"><input value={v.preferredName} onChange={e => c("preferredName", e.target.value)}/></Field>
      <Field label="Staff number" hint="Leave blank to generate automatically"><input value={v.staffNumber} onChange={e => c("staffNumber", e.target.value)} placeholder="Automatic"/></Field>
      <Field label="Gender"><select value={v.gender} onChange={e => c("gender", e.target.value)}><option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field>
      <Field label="Date of birth"><input type="date" value={v.dateOfBirth} onChange={e => c("dateOfBirth", e.target.value)}/></Field>
      <Field label="Nationality"><input value={v.nationality} onChange={e => c("nationality", e.target.value)}/></Field>
      <Field label="Email"><input type="email" value={v.email} onChange={e => c("email", e.target.value)}/></Field>
      <Field label="Phone"><input value={v.phone} onChange={e => c("phone", e.target.value)}/></Field>
      <Field label="Alternate phone"><input value={v.alternatePhone} onChange={e => c("alternatePhone", e.target.value)}/></Field>
      <Field label="National ID"><input value={v.nationalId} onChange={e => c("nationalId", e.target.value)}/></Field>
      <Field label="Tax identifier"><input value={v.taxIdentifier} onChange={e => c("taxIdentifier", e.target.value)}/></Field>
      <Field label="Physical address"><textarea value={v.physicalAddress} onChange={e => c("physicalAddress", e.target.value)}/></Field>
      <Field label="Postal address"><textarea value={v.postalAddress} onChange={e => c("postalAddress", e.target.value)}/></Field>
      <div className="school-field-full"><Field label="Profile photo"><SchoolFileUpload purpose="staff-profile-photo" accept="image/*" valueName={v.profilePhotoName} onChange={f => setV({ ...v, profilePhotoFileId: f?.id || "", profilePhotoName: f?.originalName || "" })}/></Field></div>
    </div></div>

    <div className="school-form-section"><h3>Employment</h3><div className="form-grid">
      <Field label="Department"><select value={v.departmentId} onChange={e => c("departmentId", e.target.value)}><option value="">Not assigned</option>{refs.departments.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Position"><select value={v.positionId} onChange={e => c("positionId", e.target.value)}><option value="">Not assigned</option>{positions.filter(r => r.active !== 0).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Campus"><select value={v.campusId} onChange={e => c("campusId", e.target.value)}><option value="">Default campus</option>{refs.branches.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Employment type"><select value={v.employmentType} onChange={e => c("employmentType", e.target.value)}>{["permanent", "contract", "part_time", "casual", "intern", "volunteer"].map(x => <option key={x} value={x}>{words(x)}</option>)}</select></Field>
      <Field label="Employment status"><select value={v.employmentStatus} onChange={e => c("employmentStatus", e.target.value)}>{["active", "on_leave", "suspended", "terminated", "resigned", "retired", "inactive"].map(x => <option key={x} value={x}>{words(x)}</option>)}</select></Field>
      <Field label="Hire date"><input type="date" value={v.hireDate} onChange={e => c("hireDate", e.target.value)} required/></Field>
      <Field label="Teaching staff"><label className="school-check"><input type="checkbox" checked={!!v.isTeacher} onChange={e => c("isTeacher", e.target.checked)}/> Teacher / instructor</label></Field>
      <Field label="Linked school login"><select value={v.userId} onChange={e => c("userId", e.target.value)}><option value="">No linked login</option>{refs.users.map((r: R) => <option key={r.id} value={r.id}>{r.displayName} · {r.email}</option>)}</select></Field>
      <div className="school-field-full"><Field label="HR notes"><textarea rows={4} value={v.notes} onChange={e => c("notes", e.target.value)}/></Field></div>
    </div></div>

    <div className="school-form-section"><h3>Payroll & accounting</h3><Notice tone="info">Ledgerly automatically creates an employee contact, payroll employee record and an individual Staff Payable control account.</Notice><div className="form-grid">
      <Field label="Pay type"><select value={v.payType} onChange={e => c("payType", e.target.value)}><option value="salary">Salary</option><option value="hourly">Hourly</option></select></Field>
      <Field label="Base pay"><input type="number" min="0" step=".01" value={v.basePay} onChange={e => c("basePay", e.target.value)} required/></Field>
      <Field label="Currency"><input value={v.currency} maxLength={3} onChange={e => c("currency", e.target.value.toUpperCase())} required/></Field>
    </div></div>

    <div className="school-form-section"><h3>Emergency contact <small>(optional)</small></h3><div className="form-grid">
      <Field label="Name"><input value={v.emergencyName} onChange={e => c("emergencyName", e.target.value)}/></Field>
      <Field label="Relationship"><input value={v.emergencyRelationship} onChange={e => c("emergencyRelationship", e.target.value)}/></Field>
      <Field label="Phone"><input value={v.emergencyPhone} onChange={e => c("emergencyPhone", e.target.value)}/></Field>
      <Field label="Email"><input type="email" value={v.emergencyEmail} onChange={e => c("emergencyEmail", e.target.value)}/></Field>
    </div></div>
    {error && <Notice tone="danger">{error}</Notice>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Creating…" : "Create staff member"}</Button></div></form></Modal>;
}

function PositionsManager({ close, rows, reload, write }: { close: () => void; rows: R[]; reload: () => void; write: boolean }) {
  const [refs, setRefs] = useState<R>({ departments: [], branches: [] });
  const [edit, setEdit] = useState<R | null>(null);
  const [v, setV] = useState<R>({ code: "", name: "", description: "", jobGrade: "", departmentId: "", campusId: "", isTeaching: false, isManagement: false, active: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([get<R[]>(`${S}/departments`), get<R[]>(`${S}/branches`)]).then(([departments, branches]) => setRefs({ departments, branches })).catch(e => setError(errorText(e)));
  }, []);

  function choose(r: R | null) {
    setEdit(r);
    setV(r ? {
      code: r.code || "", name: r.name || "", description: r.description || "", jobGrade: r.jobGrade || "",
      departmentId: r.departmentId || "", campusId: r.campusId || "", isTeaching: truthy(r.isTeaching), isManagement: truthy(r.isManagement), active: truthy(r.active),
    } : { code: "", name: "", description: "", jobGrade: "", departmentId: "", campusId: "", isTeaching: false, isManagement: false, active: true });
    setError("");
  }

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const body = { ...v, departmentId: v.departmentId || null, campusId: v.campusId || null, description: v.description || null, jobGrade: v.jobGrade || null };
      if (edit) await put(`${B}/positions/${edit.id}`, body); else await post(`${B}/positions`, body);
      choose(null); reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return <Modal title="Staff positions" onClose={close} locked={busy}><div className="modal-body staff-positions-manager">
    {write && <Card className="school-form-card"><h3>{edit ? `Edit ${edit.name}` : "Create position"}</h3><form className="form-grid" onSubmit={save}>
      <Field label="Code"><input value={v.code} onChange={e => setV({ ...v, code: e.target.value })} required/></Field>
      <Field label="Position"><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} required/></Field>
      <Field label="Job grade"><input value={v.jobGrade} onChange={e => setV({ ...v, jobGrade: e.target.value })}/></Field>
      <Field label="Department"><select value={v.departmentId} onChange={e => setV({ ...v, departmentId: e.target.value })}><option value="">Any department</option>{refs.departments.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Campus"><select value={v.campusId} onChange={e => setV({ ...v, campusId: e.target.value })}><option value="">Any campus</option>{refs.branches.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Teaching role"><label className="school-check"><input type="checkbox" checked={!!v.isTeaching} onChange={e => setV({ ...v, isTeaching: e.target.checked })}/> Teaching</label></Field>
      <Field label="Management role"><label className="school-check"><input type="checkbox" checked={!!v.isManagement} onChange={e => setV({ ...v, isManagement: e.target.checked })}/> Management</label></Field>
      <Field label="Status"><label className="school-check"><input type="checkbox" checked={!!v.active} onChange={e => setV({ ...v, active: e.target.checked })}/> Active</label></Field>
      <div className="school-field-full"><Field label="Description"><textarea rows={3} value={v.description} onChange={e => setV({ ...v, description: e.target.value })}/></Field></div>
      <div className="school-field-full staff-inline-actions"><Button disabled={busy}>{edit ? "Save changes" : "Create position"}</Button>{edit && <Button type="button" variant="ghost" onClick={() => choose(null)}>Cancel edit</Button>}</div>
    </form></Card>}
    {error && <Notice tone="danger">{error}</Notice>}
    <div className="school-session-list">{rows.map(r => <div key={r.id}><span><b>{r.name}</b><small>{r.code}{r.jobGrade ? ` · ${r.jobGrade}` : ""}{r.departmentName ? ` · ${r.departmentName}` : ""}</small></span><Badge tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Inactive"}</Badge>{write && <div className="row-actions"><button onClick={() => choose(r)}><Pencil size={13}/></button><button onClick={async () => { try { await del(`${B}/positions/${r.id}`); reload(); } catch (e) { setError(errorText(e)); } }}><Trash2 size={13}/></button></div>}</div>)}</div>
  </div><div className="modal-actions"><Button variant="ghost" onClick={close}>Close</Button></div></Modal>;
}

function StaffDetail({ seed, write, close, reload }: { seed: R; write: boolean; close: () => void; reload: () => void }) {
  const [data, setData] = useState<R | null>(null);
  const [tab, setTab] = useState("profile");
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () => get<R>(`${B}/staff/${seed.id}`).then(setData).catch(e => setError(errorText(e)));
  useEffect(() => { void load(); }, [seed.id]);

  if (!data) return <Modal title={staffName(seed)} onClose={close}><div className="modal-body">{error ? <Notice tone="danger">{error}</Notice> : <Spinner/>}</div></Modal>;

  const tabs = [
    { k: "profile", l: "Profile", i: UserRound },
    { k: "teaching", l: "Teaching", i: BookOpen },
    { k: "qualifications", l: "Qualifications & documents", i: GraduationCap },
    { k: "payroll", l: "Compensation & payroll", i: CircleDollarSign },
  ];

  async function remove(path: string, success?: string) {
    setError("");
    try { await del(path); if (success) setError(""); await load(); reload(); }
    catch (e) { setError(errorText(e)); }
  }
  async function verifyQualification(id: string) {
    setError("");
    try { await post(`${B}/staff/${data.id}/qualifications/${id}/verify`, {}); await load(); }
    catch (e) { setError(errorText(e)); }
  }

  return <Modal title={`${staffName(data)} · ${data.staffNumber}`} onClose={close}><div className="modal-body school-staff-detail">
    <div className="school-student-hero staff-profile-hero">
      <div className="school-student-avatar">{data.firstName?.[0]}{data.lastName?.[0]}</div>
      <div><h2>{staffName(data)}</h2><p>{data.positionName || data.contactName || "Staff member"} · {data.departmentName || "No department"}</p><Badge tone={tone(data.employmentStatus)}>{words(data.employmentStatus)}</Badge></div>
      <div><small>Staff payable</small><b>{data.payableAccountCode ? `${data.payableAccountCode} · ${data.payableAccountName || "Staff Payable"}` : (data.payableAccountId || "—")}</b><span>{cash(data.basePayMinor, data.currency)} base pay</span></div>
    </div>

    <div className="school-subtabs">{tabs.map(t => { const I = t.i; return <button key={t.k} className={tab === t.k ? "active" : ""} onClick={() => setTab(t.k)}><I size={14}/>{t.l}</button>; })}</div>
    {error && <Notice tone="danger">{error}</Notice>}

    {tab === "profile" && <>
      <div className="school-kv">{[
        ["Staff number", data.staffNumber], ["Preferred name", data.preferredName], ["Gender", words(data.gender)], ["Date of birth", data.dateOfBirth],
        ["Email", data.email], ["Phone", data.phone], ["Alternate phone", data.alternatePhone], ["Nationality", data.nationality], ["National ID", data.nationalId], ["Tax identifier", data.taxIdentifier],
        ["Employment", words(data.employmentType)], ["Status", words(data.employmentStatus)], ["Hire date", data.hireDate], ["Department", data.departmentName], ["Position", data.positionName], ["Campus", data.campusName],
        ["Payroll employee", data.payrollEmployeeId], ["Ledgerly employee contact", data.contactId], ["Linked user", data.userId],
      ].map(([k, val]) => <span key={String(k)}><small>{k}</small><b>{val || "—"}</b></span>)}</div>
      {(data.physicalAddress || data.postalAddress || data.notes) && <div className="school-two-col"><Card className="school-form-card"><h3>Address</h3><p>{data.physicalAddress || "No physical address"}</p><small>{data.postalAddress || ""}</small></Card><Card className="school-form-card"><h3>HR notes</h3><p>{data.notes || "No notes"}</p></Card></div>}
      {write && <div className="school-profile-actions"><Button variant="secondary" onClick={() => setAction("edit")}><Pencil size={14}/> Edit profile</Button><Button variant="secondary" onClick={() => setAction("emergency")}><Plus size={14}/> Emergency contact</Button><Button variant="danger" onClick={() => setAction("delete-staff")}><Trash2 size={14}/> Remove staff</Button></div>}
      <div className="school-detail-section"><h3>Emergency contacts</h3>{data.emergencyContacts?.length ? data.emergencyContacts.map((r: R) => <div className="school-list-item" key={r.id}><span><b>{r.name}</b><small>{r.relationship || "Contact"} · {r.phone}{r.email ? ` · ${r.email}` : ""}</small></span>{r.isPrimary && <Badge tone="success">Primary</Badge>}</div>) : <p className="school-muted">No emergency contacts recorded.</p>}</div>
    </>}

    {tab === "teaching" && <>
      <div className="school-profile-actions">{write && <><Button onClick={() => setAction("subject")}><Plus/> Subject taught</Button><Button variant="secondary" onClick={() => setAction("assignment")}><Plus/> Class assignment</Button></>}</div>
      <div className="school-two-col">
        <Card className="school-form-card"><h3>Subjects taught</h3>{data.subjects?.length ? data.subjects.map((r: R) => <div className="school-list-item" key={r.subjectId}><span><b>{r.subjectCode} · {r.subjectName}</b><small>{r.proficiencyLevel || ""}</small></span><div className="staff-list-actions">{r.isPrimary && <Badge tone="success">Primary</Badge>}{write && <button title="Remove subject" onClick={() => void remove(`${B}/staff/${data.id}/subjects/${r.subjectId}`)}><Trash2 size={13}/></button>}</div></div>) : <p className="school-muted">No subjects assigned.</p>}</Card>
        <Card className="school-form-card"><h3>Teaching assignments</h3>{data.assignments?.length ? data.assignments.map((r: R) => <div className="school-list-item" key={r.id}><span><b>{r.className}{r.streamName ? ` · ${r.streamName}` : ""}</b><small>{r.subjectName} · {r.academicYearName || "Any year"} {r.termName ? `· ${r.termName}` : ""}</small></span><div className="staff-list-actions"><Badge tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Inactive"}</Badge>{write && <button title="Remove assignment" onClick={() => void remove(`${B}/staff/${data.id}/assignments/${r.id}`)}><Trash2 size={13}/></button>}</div></div>) : <p className="school-muted">No class assignments.</p>}</Card>
      </div>
    </>}

    {tab === "qualifications" && <>
      <div className="school-profile-actions">{write && <><Button onClick={() => setAction("qualification")}><Plus/> Qualification</Button><Button variant="secondary" onClick={() => setAction("document")}><Plus/> Staff document</Button></>}</div>
      <div className="school-two-col">
        <Card className="school-form-card"><h3>Qualifications</h3>{data.qualifications?.length ? data.qualifications.map((r: R) => <div className="school-list-item staff-rich-list" key={r.id}><span><b>{r.qualificationName}</b><small>{[r.qualificationType, r.institution, r.level, r.grade].filter(Boolean).join(" · ") || "—"}</small>{r.awardedOn && <small>Awarded {r.awardedOn}{r.expiresOn ? ` · expires ${r.expiresOn}` : ""}</small>}</span><div className="staff-list-actions"><Badge tone={r.verified ? "success" : "warning"}>{r.verified ? "Verified" : "Unverified"}</Badge>{r.fileId && <button title="Download evidence" onClick={() => void downloadFile(`/school/files/${r.fileId}/content`, r.fileName || `${r.qualificationName}-evidence`)}><Download size={13}/></button>}{write && !r.verified && <button title="Verify qualification" onClick={() => void verifyQualification(r.id)}><BadgeCheck size={14}/></button>}{write && <button title="Delete qualification" onClick={() => void remove(`${B}/staff/${data.id}/qualifications/${r.id}`)}><Trash2 size={13}/></button>}</div></div>) : <p className="school-muted">No qualifications recorded.</p>}</Card>
        <Card className="school-form-card"><h3>Documents</h3>{data.documents?.length ? data.documents.map((r: R) => <div className="school-list-item staff-rich-list" key={r.id}><span><b>{r.name}</b><small>{words(r.documentType)} · {r.fileName}</small>{r.expiresOn && <small>Expires {r.expiresOn}</small>}</span><div className="staff-list-actions"><button type="button" className="school-file-link" onClick={() => void downloadFile(`/school/files/${r.fileId}/content`, r.fileName || r.name || "document")}><FileText size={14}/> Download</button>{write && <button title="Remove document record" onClick={() => void remove(`${B}/staff/${data.id}/documents/${r.id}`)}><Trash2 size={13}/></button>}</div></div>) : <p className="school-muted">No staff documents uploaded.</p>}</Card>
      </div>
    </>}

    {tab === "payroll" && <>
      <Notice tone="info">Payroll liabilities are posted to this employee's individual Staff Payable account. Salary can then be settled in one or many installments, and the payslip keeps the remaining balance.</Notice>
      <div className="staff-ledger-summary"><span><small>Contact</small><b>{data.contactName || staffName(data)}</b><em>{data.contactId}</em></span><span><small>Payroll employee</small><b>{data.employeeNumber || data.staffNumber}</b><em>{data.payrollEmployeeId}</em></span><span><small>Control account</small><b>{data.payableAccountCode || "—"}</b><em>{data.payableAccountName || "Staff Payable"}</em></span></div>
      <div className="school-profile-actions">{write && <><Button onClick={() => setAction("compensation")}><Plus/> Recurring earning/deduction</Button><Button variant="secondary" onClick={() => setAction("adjustment")}><Plus/> One-off adjustment</Button></>}</div>
      <div className="school-detail-section"><h3>Recurring compensation</h3>{data.compensation?.length ? data.compensation.map((r: R) => <div className="school-list-item" key={r.id}><span><b>{r.name}</b><small>{words(r.category)} · {r.calculationType === "percentage" ? `${Number(r.rateMicros || 0) / 10000}%` : cash(r.amountMinor, data.currency)} · from {r.effectiveFrom}</small></span><div className="staff-list-actions"><Badge tone={r.active ? "success" : "neutral"}>{r.componentType}</Badge>{write && r.active && <button title="Deactivate component" onClick={() => void remove(`${B}/staff/${data.id}/compensation/${r.id}`)}><Trash2 size={13}/></button>}</div></div>) : <p className="school-muted">Base salary only. Add commissions, allowances or deductions when needed.</p>}</div>
      <div className="school-detail-section"><h3>Payslips & outstanding salary</h3>{data.payslips?.length ? data.payslips.map((r: R) => <div className="staff-payslip" key={r.payrollLineId}><div><b>{r.number}</b><small>{r.periodStart} – {r.periodEnd} · pay date {r.payDate}</small></div><span><small>Gross</small><b>{cash(r.grossMinor, r.currency)}</b></span><span><small>Deductions</small><b>{cash(r.deductionsMinor, r.currency)}</b></span><span><small>Net</small><b>{cash(r.netMinor, r.currency)}</b></span><span><small>Paid</small><b>{cash(r.paidMinor, r.currency)}</b></span><span className={Number(r.balanceMinor) > 0 ? "staff-balance-open" : ""}><small>Balance</small><b>{cash(r.balanceMinor, r.currency)}</b></span><Badge tone={tone(r.paymentStatus)}>{words(r.paymentStatus)}</Badge>{write && r.payrollStatus === "posted" && Number(r.balanceMinor) > 0 && <Button variant="secondary" onClick={() => setAction(`pay:${r.payrollLineId}:${r.balanceMinor}:${r.currency}`)}><WalletCards size={14}/> Pay installment</Button>}</div>) : <p className="school-muted">No payroll runs have produced a payslip for this employee yet.</p>}</div>
      <div className="school-detail-section"><h3>Salary payment history</h3>{data.salaryPayments?.length ? data.salaryPayments.map((r: R) => <div className="school-list-item" key={r.id}><span><b>{r.number}</b><small>{r.paymentDate} · {cash(r.amountMinor, data.currency)} · {r.reference || "Salary installment"}</small></span><div className="staff-list-actions"><Badge tone={tone(r.status)}>{r.status}</Badge>{write && r.status === "posted" && <button title="Reverse installment" onClick={() => setAction(`reversepay:${r.id}`)}><RefreshCw size={13}/></button>}</div></div>) : <p className="school-muted">No salary installments posted yet.</p>}</div>
    </>}
  </div>{action && <StaffAction staff={data} action={action} close={() => setAction(null)} done={() => { setAction(null); load(); reload(); }} parentClose={close}/>}</Modal>;
}

function StaffAction({ staff, action, close, done, parentClose }: { staff: R; action: string; close: () => void; done: () => void; parentClose: () => void }) {
  const [refs, setRefs] = useState<R>({ subjects: [], classSubjects: [], levels: [], classes: [], streams: [], years: [], terms: [], branches: [], departments: [], positions: [], users: [], accounts: [] });
  const [v, setV] = useState<R>(() => ({
    firstName: staff.firstName || "", middleName: staff.middleName || "", lastName: staff.lastName || "", preferredName: staff.preferredName || "", gender: staff.gender || "", dateOfBirth: staff.dateOfBirth || "", nationality: staff.nationality || "",
    nationalId: staff.nationalId || "", taxIdentifier: staff.taxIdentifier || "", phone: staff.phone || "", alternatePhone: staff.alternatePhone || "", email: staff.email || "", physicalAddress: staff.physicalAddress || "", postalAddress: staff.postalAddress || "",
    departmentId: staff.departmentId || "", positionId: staff.positionId || "", campusId: staff.campusId || "", employmentType: staff.employmentType || "permanent", employmentStatus: staff.employmentStatus || "active", isTeacher: !!staff.isTeacher,
    hireDate: staff.hireDate || today(), payType: staff.payType || "salary", basePay: Number(staff.basePayMinor || 0) / 100, currency: staff.currency || "UGX", userId: staff.userId || "", profilePhotoFileId: staff.profilePhotoFileId || "", profilePhotoName: "", notes: staff.notes || "",
    inputDate: today(), effectiveFrom: today(), paymentDate: today(), postingDate: today(), componentType: "earning", category: "allowance", calculationType: "fixed", amount: "", rate: "", active: true, isPrimary: false, assignmentRole: "teacher", qualificationType: "academic", reason: "Salary payment correction",
  }));
  const [file, setFile] = useState<R | null>(null);
  const [refsLoading, setRefsLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pay = action.startsWith("pay:");
  const reversePay = action.startsWith("reversepay:");

  useEffect(() => {
    Promise.all([
      get<R[]>(`${S}/subjects`), get<R[]>(`${S}/classSubjects`), get<R[]>(`${S}/classLevels`), get<R[]>(`${S}/classes`), get<R[]>(`${S}/streams`), get<R[]>(`${S}/academicYears`), get<R[]>(`${S}/terms`),
      get<R[]>(`${S}/branches`), get<R[]>(`${S}/departments`), get<R[]>(`${B}/positions`), get<R[]>("/school/iam/users"), get<R[]>("/accounts?limit=500"),
    ]).then(([subjects, classSubjects, levels, classes, streams, years, terms, branches, departments, positions, users, accounts]) => setRefs({ subjects, classSubjects, levels, classes, streams, years, terms, branches, departments, positions, users, accounts })).catch(e => setError(errorText(e))).finally(() => setRefsLoading(false));
  }, []);

  const c = (k: string, x: any) => setV((a: R) => ({ ...a, [k]: x }));
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (action === "subject") await post(`${B}/staff/${staff.id}/subjects`, { subjectId: v.subjectId, isPrimary: !!v.isPrimary, proficiencyLevel: v.proficiencyLevel || null });
      else if (action === "assignment") await post(`${B}/staff/${staff.id}/assignments`, { academicYearId: v.academicYearId || null, termId: v.termId || null, campusId: v.campusId || null, classId: v.classId, streamId: v.streamId || null, subjectId: v.subjectId, assignmentRole: v.assignmentRole || "teacher", startsOn: v.startsOn || null, endsOn: v.endsOn || null, active: true });
      else if (action === "qualification") await post(`${B}/staff/${staff.id}/qualifications`, { qualificationType: v.qualificationType, qualificationName: v.qualificationName, institution: v.institution || null, fieldOfStudy: v.fieldOfStudy || null, level: v.level || null, grade: v.grade || null, awardedOn: v.awardedOn || null, expiresOn: v.expiresOn || null, registrationNumber: v.registrationNumber || null, fileId: file?.id || null });
      else if (action === "document") await post(`${B}/staff/${staff.id}/documents`, { documentType: v.documentType || "employment", name: v.name, fileId: file?.id, issuedOn: v.issuedOn || null, expiresOn: v.expiresOn || null, notes: v.notes || null });
      else if (action === "compensation") await post(`${B}/staff/${staff.id}/compensation`, { code: v.code, name: v.name, componentType: v.componentType, category: v.category, calculationType: v.calculationType, amountMinor: v.calculationType === "fixed" ? Math.round(Number(v.amount || 0) * 100) : null, rateMicros: v.calculationType === "percentage" ? Math.round(Number(v.rate || 0) * 10000) : null, taxable: !!v.taxable, pensionable: !!v.pensionable, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo || null, active: true, metadata: {} });
      else if (action === "adjustment") await post(`${B}/staff/${staff.id}/payroll-adjustments`, { inputDate: v.inputDate, type: v.type || "commission", amountMinor: Math.round(Number(v.amount || 0) * 100), unitsMicros: Math.round(Number(v.units || 0) * 1_000_000), notes: v.notes || null });
      else if (pay) {
        const [, lineId, balance] = action.split(":");
        await post(`${B}/staff/${staff.id}/payslips/${lineId}/payments`, { amountMinor: Math.round(Number(v.amount || Number(balance) / 100) * 100), bankAccountId: v.bankAccountId, paymentDate: v.paymentDate, reference: v.reference || null });
      } else if (reversePay) {
        const [, paymentRecordId] = action.split(":");
        await post(`${B}/staff/${staff.id}/salary-payments/${paymentRecordId}/reverse`, { postingDate: v.postingDate, reason: v.reason });
      } else if (action === "emergency") await post(`${B}/staff/${staff.id}/emergency-contacts`, { name: v.name, relationship: v.relationship || null, phone: v.phone, alternatePhone: v.alternatePhone || null, email: v.email || null, physicalAddress: v.physicalAddress || null, isPrimary: !!v.isPrimary });
      else if (action === "edit") await put(`${B}/staff/${staff.id}`, {
        firstName: v.firstName, middleName: v.middleName || null, lastName: v.lastName, preferredName: v.preferredName || null, gender: v.gender || null, dateOfBirth: v.dateOfBirth || null, nationality: v.nationality || null,
        nationalId: v.nationalId || null, taxIdentifier: v.taxIdentifier || null, phone: v.phone || null, alternatePhone: v.alternatePhone || null, email: v.email || null, physicalAddress: v.physicalAddress || null, postalAddress: v.postalAddress || null,
        departmentId: v.departmentId || null, positionId: v.positionId || null, campusId: v.campusId || null, employmentType: v.employmentType, employmentStatus: v.employmentStatus, isTeacher: !!v.isTeacher, hireDate: v.hireDate,
        payType: v.payType, basePayMinor: Math.round(Number(v.basePay || 0) * 100), currency: String(v.currency || "UGX").toUpperCase(), userId: v.userId || null, profilePhotoFileId: v.profilePhotoFileId || null, notes: v.notes || null,
      });
      else if (action === "delete-staff") { await del(`${B}/staff/${staff.id}`); parentClose(); }
      done();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const title = pay ? "Pay salary installment" : reversePay ? "Reverse salary installment" : ({ subject: "Assign subject", assignment: "Teaching assignment", qualification: "Add qualification", document: "Upload staff document", compensation: "Recurring compensation", adjustment: "One-off payroll adjustment", emergency: "Emergency contact", edit: "Edit staff profile", "delete-staff": "Remove staff member" } as R)[action] || "Staff action";
  const cashAccounts = refs.accounts.filter((r: R) => r.active !== false && r.active !== 0 && r.allowPosting !== false && r.allowPosting !== 0 && r.subtype === "cash");
  const assignmentClasses = refs.classes.filter((r: R) =>
    (!v.classLevelId || r.classLevelId === v.classLevelId) &&
    (!v.academicYearId || !r.academicYearId || r.academicYearId === v.academicYearId) &&
    (!v.campusId || !r.campusId || r.campusId === v.campusId) &&
    r.active !== false && r.active !== 0
  );
  const assignmentStreams = refs.streams.filter((r: R) => !!v.classId && r.classId === v.classId && r.active !== false && r.active !== 0);
  const curriculumSubjectIds = new Set(refs.classSubjects
    .filter((r: R) => (!v.classLevelId || r.classLevelId === v.classLevelId) && (!v.academicYearId || !r.academicYearId || r.academicYearId === v.academicYearId) && r.active !== false && r.active !== 0)
    .map((r: R) => r.subjectId));
  const assignmentSubjects = curriculumSubjectIds.size ? refs.subjects.filter((r: R) => curriculumSubjectIds.has(r.id)) : refs.subjects;

  return <Modal title={title} onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body form-grid">
    {action === "subject" && <><Field label="Subject"><select value={v.subjectId || ""} onChange={e => c("subjectId", e.target.value)} required><option value="">Select…</option>{refs.subjects.map((r: R) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></Field><Field label="Proficiency"><input value={v.proficiencyLevel || ""} onChange={e => c("proficiencyLevel", e.target.value)} placeholder="e.g. Advanced"/></Field><Field label="Primary subject"><label className="school-check"><input type="checkbox" checked={!!v.isPrimary} onChange={e => c("isPrimary", e.target.checked)}/> Primary teaching subject</label></Field></>}

    {action === "assignment" && <>
      <Field label="Academic year"><select value={v.academicYearId || ""} onChange={e => setV({ ...v, academicYearId: e.target.value, termId: "", classId: "", streamId: "", subjectId: "" })}><option value="">Any / current</option>{refs.years.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Term"><select value={v.termId || ""} onChange={e => c("termId", e.target.value)}><option value="">Any / current</option>{refs.terms.filter((r: R) => !v.academicYearId || r.academicYearId === v.academicYearId).map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Campus"><select value={v.campusId || ""} onChange={e => setV({ ...v, campusId: e.target.value, classId: "", streamId: "", subjectId: "" })}><option value="">Default campus</option>{refs.branches.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Class level" hint="Choose the level first to narrow the class list."><select value={v.classLevelId || ""} onChange={e => setV({ ...v, classLevelId: e.target.value, classId: "", streamId: "", subjectId: "" })} required><option value="">Select class level…</option>{refs.levels.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Class"><select value={v.classId || ""} onChange={e => setV({ ...v, classId: e.target.value, streamId: "", subjectId: "" })} required disabled={!v.classLevelId}><option value="">{v.classLevelId ? (assignmentClasses.length ? "Select class…" : "No matching classes configured") : "Select class level first"}</option>{assignmentClasses.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Stream"><select value={v.streamId || ""} onChange={e => c("streamId", e.target.value)} disabled={!v.classId}><option value="">Whole class</option>{assignmentStreams.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Subject" hint={curriculumSubjectIds.size ? "Showing subjects assigned to this class level." : "No class-subject map found; showing all subjects."}><select value={v.subjectId || ""} onChange={e => c("subjectId", e.target.value)} required disabled={!v.classLevelId}><option value="">Select subject…</option>{assignmentSubjects.map((r: R) => <option key={r.id} value={r.id}>{r.code ? `${r.code} · ` : ""}{r.name}</option>)}</select></Field>
      <Field label="Role"><select value={v.assignmentRole || "teacher"} onChange={e => c("assignmentRole", e.target.value)}><option value="teacher">Subject teacher</option><option value="class_teacher">Class teacher</option><option value="assistant">Assistant teacher</option><option value="co_teacher">Co-teacher</option><option value="substitute">Substitute</option></select></Field>
      <Field label="Starts on"><input type="date" value={v.startsOn || ""} onChange={e => c("startsOn", e.target.value)}/></Field>
      <Field label="Ends on"><input type="date" value={v.endsOn || ""} onChange={e => c("endsOn", e.target.value)}/></Field>
    </>}

    {action === "qualification" && <>
      <Field label="Type"><select value={v.qualificationType} onChange={e => c("qualificationType", e.target.value)}><option value="academic">Academic</option><option value="professional">Professional</option><option value="teaching_license">Teaching licence</option><option value="certificate">Certificate</option><option value="other">Other</option></select></Field>
      <Field label="Qualification"><input value={v.qualificationName || ""} onChange={e => c("qualificationName", e.target.value)} required/></Field>
      <Field label="Institution"><input value={v.institution || ""} onChange={e => c("institution", e.target.value)}/></Field>
      <Field label="Field of study"><input value={v.fieldOfStudy || ""} onChange={e => c("fieldOfStudy", e.target.value)}/></Field>
      <Field label="Level"><input value={v.level || ""} onChange={e => c("level", e.target.value)} placeholder="Diploma, degree, masters…"/></Field>
      <Field label="Grade / class"><input value={v.grade || ""} onChange={e => c("grade", e.target.value)}/></Field>
      <Field label="Registration number"><input value={v.registrationNumber || ""} onChange={e => c("registrationNumber", e.target.value)}/></Field>
      <Field label="Awarded on"><input type="date" value={v.awardedOn || ""} onChange={e => c("awardedOn", e.target.value)}/></Field>
      <Field label="Expires on"><input type="date" value={v.expiresOn || ""} onChange={e => c("expiresOn", e.target.value)}/></Field>
      <div className="school-field-full"><Field label="Evidence / certificate"><SchoolFileUpload purpose="staff-qualification" valueName={file?.originalName} onChange={setFile}/></Field></div>
    </>}

    {action === "document" && <>
      <Field label="Document type"><select value={v.documentType || "employment"} onChange={e => c("documentType", e.target.value)}><option value="employment">Employment</option><option value="contract">Contract</option><option value="identification">Identification</option><option value="license">Licence</option><option value="medical">Medical</option><option value="tax">Tax</option><option value="other">Other</option></select></Field>
      <Field label="Document name"><input value={v.name || ""} onChange={e => c("name", e.target.value)} required/></Field>
      <div className="school-field-full"><Field label="File"><SchoolFileUpload purpose="staff-document" valueName={file?.originalName} onChange={setFile} required/></Field></div>
      <Field label="Issued on"><input type="date" value={v.issuedOn || ""} onChange={e => c("issuedOn", e.target.value)}/></Field>
      <Field label="Expires on"><input type="date" value={v.expiresOn || ""} onChange={e => c("expiresOn", e.target.value)}/></Field>
      <div className="school-field-full"><Field label="Notes"><textarea rows={3} value={v.notes || ""} onChange={e => c("notes", e.target.value)}/></Field></div>
    </>}

    {action === "compensation" && <>
      <Field label="Code"><input value={v.code || ""} onChange={e => c("code", e.target.value)} required/></Field>
      <Field label="Name"><input value={v.name || ""} onChange={e => c("name", e.target.value)} required/></Field>
      <Field label="Earning / deduction"><select value={v.componentType} onChange={e => c("componentType", e.target.value)}><option value="earning">Earning</option><option value="deduction">Deduction</option></select></Field>
      <Field label="Category"><select value={v.category} onChange={e => c("category", e.target.value)}>{["salary", "commission", "allowance", "bonus", "overtime", "benefit", "deduction", "loan_recovery", "salary_advance", "other"].map(x => <option key={x} value={x}>{words(x)}</option>)}</select></Field>
      <Field label="Calculation"><select value={v.calculationType} onChange={e => c("calculationType", e.target.value)}><option value="fixed">Fixed amount</option><option value="percentage">% of base pay</option></select></Field>
      {v.calculationType === "fixed" ? <Field label="Amount"><input type="number" min="0" step=".01" value={v.amount} onChange={e => c("amount", e.target.value)} required/></Field> : <Field label="Percentage"><input type="number" min="0" step=".01" value={v.rate} onChange={e => c("rate", e.target.value)} required/></Field>}
      <Field label="Effective from"><input type="date" value={v.effectiveFrom} onChange={e => c("effectiveFrom", e.target.value)} required/></Field>
      <Field label="Effective to"><input type="date" value={v.effectiveTo || ""} onChange={e => c("effectiveTo", e.target.value)}/></Field>
      <Field label="Taxable"><label className="school-check"><input type="checkbox" checked={!!v.taxable} onChange={e => c("taxable", e.target.checked)}/> Include in taxable earnings</label></Field>
      <Field label="Pensionable"><label className="school-check"><input type="checkbox" checked={!!v.pensionable} onChange={e => c("pensionable", e.target.checked)}/> Pensionable component</label></Field>
    </>}

    {action === "adjustment" && <>
      <Field label="Date"><input type="date" value={v.inputDate} onChange={e => c("inputDate", e.target.value)} required/></Field>
      <Field label="Adjustment"><select value={v.type || "commission"} onChange={e => c("type", e.target.value)}>{["commission", "allowance", "bonus", "overtime", "benefit", "other_earning", "deduction", "loan_recovery", "salary_advance", "other_deduction", "leave_unpaid"].map(x => <option key={x} value={x}>{words(x)}</option>)}</select></Field>
      <Field label="Amount"><input type="number" min="0" step=".01" value={v.amount} onChange={e => c("amount", e.target.value)} required/></Field>
      <Field label="Units / hours"><input type="number" min="0" step=".000001" value={v.units || ""} onChange={e => c("units", e.target.value)}/></Field>
      <div className="school-field-full"><Field label="Notes"><textarea rows={3} value={v.notes || ""} onChange={e => c("notes", e.target.value)}/></Field></div>
    </>}

    {pay && <>
      <Field label="Payment date"><input type="date" value={v.paymentDate} onChange={e => c("paymentDate", e.target.value)} required/></Field>
      <Field label="Pay from"><SearchableSelect value={v.bankAccountId || ""} onChange={x => c("bankAccountId", x)} loading={refsLoading} options={cashAccounts.map((r: R) => ({ value: String(r.id), label: `${r.code} · ${r.name}` }))} placeholder="Select cash / bank ledger…" searchPlaceholder="Search cash or bank account…" emptyText="No cash / bank ledger accounts found." ariaLabel="Salary payment account"/></Field>
      <Field label="Installment amount" hint={`Outstanding ${cash(Number(action.split(":")[2]), action.split(":")[3] || staff.currency)}`}><input type="number" min=".01" max={Number(action.split(":")[2]) / 100} step=".01" value={v.amount || Number(action.split(":")[2]) / 100} onChange={e => c("amount", e.target.value)} required/></Field>
      <Field label="Reference"><input value={v.reference || ""} onChange={e => c("reference", e.target.value)} placeholder="Bank reference, cheque, mobile money…"/></Field>
      {!cashAccounts.length && <div className="school-field-full"><Notice tone="warning">No active posting account with the <b>cash</b> subtype is available. Create or configure a cash/bank ledger account in Ledgerly Banking first.</Notice></div>}
    </>}

    {reversePay && <><Field label="Reversal date"><input type="date" value={v.postingDate} onChange={e => c("postingDate", e.target.value)} required/></Field><div className="school-field-full"><Field label="Reason"><textarea rows={3} minLength={3} value={v.reason} onChange={e => c("reason", e.target.value)} required/></Field></div><div className="school-field-full"><Notice tone="warning">Reversing the installment creates a reversal journal and restores the outstanding payslip balance.</Notice></div></>}

    {action === "emergency" && <>
      <Field label="Name"><input value={v.name || ""} onChange={e => c("name", e.target.value)} required/></Field>
      <Field label="Relationship"><input value={v.relationship || ""} onChange={e => c("relationship", e.target.value)}/></Field>
      <Field label="Phone"><input value={v.phone || ""} onChange={e => c("phone", e.target.value)} required/></Field>
      <Field label="Alternate phone"><input value={v.alternatePhone || ""} onChange={e => c("alternatePhone", e.target.value)}/></Field>
      <Field label="Email"><input type="email" value={v.email || ""} onChange={e => c("email", e.target.value)}/></Field>
      <Field label="Primary"><label className="school-check"><input type="checkbox" checked={!!v.isPrimary} onChange={e => c("isPrimary", e.target.checked)}/> Primary emergency contact</label></Field>
      <div className="school-field-full"><Field label="Address"><textarea rows={3} value={v.physicalAddress || ""} onChange={e => c("physicalAddress", e.target.value)}/></Field></div>
    </>}

    {action === "edit" && <>
      <Field label="First name"><input value={v.firstName} onChange={e => c("firstName", e.target.value)} required/></Field><Field label="Middle name"><input value={v.middleName} onChange={e => c("middleName", e.target.value)}/></Field><Field label="Last name"><input value={v.lastName} onChange={e => c("lastName", e.target.value)} required/></Field><Field label="Preferred name"><input value={v.preferredName} onChange={e => c("preferredName", e.target.value)}/></Field>
      <Field label="Gender"><select value={v.gender} onChange={e => c("gender", e.target.value)}><option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field><Field label="Date of birth"><input type="date" value={v.dateOfBirth} onChange={e => c("dateOfBirth", e.target.value)}/></Field><Field label="Nationality"><input value={v.nationality} onChange={e => c("nationality", e.target.value)}/></Field><Field label="National ID"><input value={v.nationalId} onChange={e => c("nationalId", e.target.value)}/></Field><Field label="Tax identifier"><input value={v.taxIdentifier} onChange={e => c("taxIdentifier", e.target.value)}/></Field>
      <Field label="Email"><input type="email" value={v.email} onChange={e => c("email", e.target.value)}/></Field><Field label="Phone"><input value={v.phone} onChange={e => c("phone", e.target.value)}/></Field><Field label="Alternate phone"><input value={v.alternatePhone} onChange={e => c("alternatePhone", e.target.value)}/></Field>
      <Field label="Department"><select value={v.departmentId} onChange={e => c("departmentId", e.target.value)}><option value="">Not assigned</option>{refs.departments.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Position"><select value={v.positionId} onChange={e => c("positionId", e.target.value)}><option value="">Not assigned</option>{refs.positions.filter((r: R) => r.active !== 0).map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Campus"><select value={v.campusId} onChange={e => c("campusId", e.target.value)}><option value="">Default campus</option>{refs.branches.map((r: R) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Employment type"><select value={v.employmentType} onChange={e => c("employmentType", e.target.value)}>{["permanent", "contract", "part_time", "casual", "intern", "volunteer"].map(x => <option key={x} value={x}>{words(x)}</option>)}</select></Field><Field label="Employment status"><select value={v.employmentStatus} onChange={e => c("employmentStatus", e.target.value)}>{["active", "on_leave", "suspended", "terminated", "resigned", "retired", "inactive"].map(x => <option key={x} value={x}>{words(x)}</option>)}</select></Field><Field label="Hire date"><input type="date" value={v.hireDate} onChange={e => c("hireDate", e.target.value)} required/></Field>
      <Field label="Pay type"><select value={v.payType} onChange={e => c("payType", e.target.value)}><option value="salary">Salary</option><option value="hourly">Hourly</option></select></Field><Field label="Base pay"><input type="number" min="0" step=".01" value={v.basePay} onChange={e => c("basePay", e.target.value)}/></Field><Field label="Currency"><input maxLength={3} value={v.currency} onChange={e => c("currency", e.target.value.toUpperCase())}/></Field><Field label="Teacher"><label className="school-check"><input type="checkbox" checked={!!v.isTeacher} onChange={e => c("isTeacher", e.target.checked)}/> Teaching staff</label></Field><Field label="Linked school login"><select value={v.userId} onChange={e => c("userId", e.target.value)}><option value="">No linked login</option>{refs.users.map((r: R) => <option key={r.id} value={r.id}>{r.displayName} · {r.email}</option>)}</select></Field>
      <div className="school-field-full"><Field label="Profile photo"><SchoolFileUpload purpose="staff-profile-photo" accept="image/*" valueName={v.profilePhotoName || (v.profilePhotoFileId ? "Current uploaded photo" : undefined)} onChange={f => setV({ ...v, profilePhotoFileId: f?.id || "", profilePhotoName: f?.originalName || "" })}/></Field></div>
      <div className="school-field-full"><Field label="Physical address"><textarea rows={3} value={v.physicalAddress} onChange={e => c("physicalAddress", e.target.value)}/></Field></div><div className="school-field-full"><Field label="Postal address"><textarea rows={2} value={v.postalAddress} onChange={e => c("postalAddress", e.target.value)}/></Field></div><div className="school-field-full"><Field label="HR notes"><textarea rows={4} value={v.notes} onChange={e => c("notes", e.target.value)}/></Field></div>
    </>}

    {action === "delete-staff" && <div className="school-field-full"><Notice tone="warning">This removes the active school staff record and archives its Ledgerly employee contact/control account. Staff with payroll history cannot be deleted; change their employment status to terminated, resigned, retired or inactive instead.</Notice><p><b>{staffName(staff)}</b> · {staff.staffNumber}</p></div>}

    {error && <div className="school-field-full"><Notice tone="danger">{error}</Notice></div>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button variant={action === "delete-staff" || reversePay ? "danger" : "primary"} disabled={busy || (pay && !cashAccounts.length)}>{busy ? "Saving…" : action === "delete-staff" ? "Remove staff member" : reversePay ? "Reverse installment" : pay ? "Post installment" : "Save"}</Button></div></form></Modal>;
}
