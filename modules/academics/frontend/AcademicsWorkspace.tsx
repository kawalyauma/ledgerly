import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BarChart3,
  BookMarked,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  GraduationCap,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import {
  ApiError,
  can,
  errorText,
  get,
  post,
  patch,
  del,
  uploadFile,
} from "../../../web/api";
import { useAuth } from "../../../web/auth";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Notice,
  Spinner,
} from "../../../web/components/ui";

const base = "/academics";
type R = Record<string, any>;
type Setup = {
  years: R[];
  terms: R[];
  departments: R[];
  classes: R[];
  streams: R[];
  subjects: R[];
  teachers: R[];
  rooms: R[];
  periods: R[];
  teacherAllocations: R[];
};
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const words = (v: any) =>
  String(v ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const val = (f: FormData, k: string) => String(f.get(k) || "").trim();
function useLoad<T>(path: string, initial: T) {
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await get<T>(path));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [path]);
  return { data, setData, loading, error, load };
}
function Head({
  title,
  text,
  actions,
}: {
  title: string;
  text: string;
  actions?: ReactNode;
}) {
  return (
    <div className="acad-head">
      <div>
        <small>ACADEMICS</small>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {actions && <div className="acad-head-actions">{actions}</div>}
    </div>
  );
}
function Status({ value }: { value: any }) {
  const v = String(value || "draft"),
    tone =
      v.includes("approved") ||
      v === "published" ||
      v === "taught" ||
      v === "covered" ||
      v === "closed"
        ? "success"
        : v.includes("rejected") || v === "missed"
          ? "danger"
          : v.includes("submitted") ||
              v.includes("followup") ||
              v === "postponed"
            ? "warning"
            : "neutral";
  return <Badge tone={tone as any}>{words(v)}</Badge>;
}
function Select({
  name,
  items,
  labelKey = "name",
  valueKey = "id",
  required = false,
  defaultValue = "",
  onChange,
}: {
  name: string;
  items: R[];
  labelKey?: string;
  valueKey?: string;
  required?: boolean;
  defaultValue?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <select
      name={name}
      required={required}
      defaultValue={defaultValue}
      onChange={(e) => onChange?.(e.target.value)}
    >
      <option value="">Select…</option>
      {items.map((x) => (
        <option key={x[valueKey]} value={x[valueKey]}>
          {x[labelKey]}
        </option>
      ))}
    </select>
  );
}
const currentYear = (setup: Setup) =>
  setup.years.find((x) => x.isCurrent)?.id || "";
function PeriodClassFields({
  setup,
  period = true,
  classAndStream = true,
  fixedYearId = "",
  classRequired = true,
}: {
  setup: Setup;
  period?: boolean;
  classAndStream?: boolean;
  fixedYearId?: string;
  classRequired?: boolean;
}) {
  const [yearId, setYearId] = useState(fixedYearId || currentYear(setup)),
    [classId, setClassId] = useState("");
  useEffect(() => {
    const next = fixedYearId || currentYear(setup);
    if (fixedYearId && fixedYearId !== yearId) {
      setYearId(fixedYearId);
      setClassId("");
    } else if (next && !yearId) setYearId(next);
  }, [fixedYearId, setup.years, yearId]);
  const terms = setup.terms.filter(
      (x) => !yearId || x.academicYearId === yearId,
    ),
    classes = setup.classes.filter(
      (x) => !yearId || x.academicYearId === yearId,
    ),
    streams = setup.streams.filter((x) => classId && x.classId === classId);
  return (
    <>
      {period && (
        <>
          <Field label="Academic year">
            <select
              name="year"
              value={yearId}
              onChange={(e) => {
                setYearId(e.target.value);
                setClassId("");
              }}
              required
            >
              <option value="">Select…</option>
              {setup.years.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Term">
            <Select key={yearId} name="term" items={terms} required />
          </Field>
        </>
      )}
      {classAndStream && (
        <>
          <Field label="Class">
            <select
              name="class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              required={classRequired}
            >
              <option value="">Select…</option>
              {classes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stream">
            <Select key={classId} name="stream" items={streams} />
          </Field>
        </>
      )}
    </>
  );
}
function TeachingFields({
  setup,
  fixedYearId = "",
  period = true,
}: {
  setup: Setup;
  fixedYearId?: string;
  period?: boolean;
}) {
  const [yearId, setYearId] = useState(fixedYearId || currentYear(setup)),
    [termId, setTermId] = useState(""),
    [classId, setClassId] = useState(""),
    [streamId, setStreamId] = useState(""),
    [subjectId, setSubjectId] = useState(""),
    [teacherId, setTeacherId] = useState("");
  useEffect(() => {
    if (fixedYearId && fixedYearId !== yearId) {
      setYearId(fixedYearId);
      setClassId("");
      setStreamId("");
    }
  }, [fixedYearId, yearId]);
  useEffect(() => {
    const a = setup.teacherAllocations.find(
      (x) =>
        x.classId === classId &&
        x.subjectId === subjectId &&
        (!x.academicYearId || x.academicYearId === yearId) &&
        (!x.termId || x.termId === termId) &&
        (!x.streamId || x.streamId === streamId),
    );
    setTeacherId(a?.teacherUserId || "");
  }, [setup.teacherAllocations, yearId, termId, classId, streamId, subjectId]);
  const terms = setup.terms.filter(
      (x) => !yearId || x.academicYearId === yearId,
    ),
    classes = setup.classes.filter(
      (x) => !yearId || x.academicYearId === yearId,
    ),
    streams = setup.streams.filter((x) => x.classId === classId);
  return (
    <>
      {period && (
        <>
          <Field label="Academic year">
            <select
              name="year"
              value={yearId}
              required
              onChange={(e) => {
                setYearId(e.target.value);
                setTermId("");
                setClassId("");
                setStreamId("");
              }}
            >
              <option value="">Select…</option>
              {setup.years.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Term">
            <select
              name="term"
              value={termId}
              required
              onChange={(e) => setTermId(e.target.value)}
            >
              <option value="">Select…</option>
              {terms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label="Class">
        <select
          name="class"
          value={classId}
          required
          onChange={(e) => {
            setClassId(e.target.value);
            setStreamId("");
          }}
        >
          <option value="">Select…</option>
          {classes.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Stream">
        <select
          name="stream"
          value={streamId}
          onChange={(e) => setStreamId(e.target.value)}
        >
          <option value="">All streams</option>
          {streams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subject">
        <select
          name="subject"
          value={subjectId}
          required
          onChange={(e) => setSubjectId(e.target.value)}
        >
          <option value="">Select…</option>
          {setup.subjects.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Teacher">
        <select
          name="teacher"
          value={teacherId}
          required
          onChange={(e) => setTeacherId(e.target.value)}
        >
          <option value="">
            {classId && subjectId
              ? "No allocation — select teacher"
              : "Select class and subject first"}
          </option>
          {setup.teachers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: any;
  icon: any;
}) {
  return (
    <Card className="acad-metric">
      <span>
        <Icon size={19} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </Card>
  );
}

export function AcademicsWorkspace() {
  const { principal } = useAuth(),
    [state, setState] = useState<
      "loading" | "school-required" | "disabled" | "ready"
    >("loading"),
    [error, setError] = useState(""),
    [view, setView] = useState(
      () => sessionStorage.getItem("ledgerly.academics.view") || "overview",
    );
  const check = async () => {
    setError("");
    try {
      const mods = await get<R[]>("/modules"),
        school = mods.find((x) => x.moduleKey === "school-management"),
        acad = mods.find((x) => x.moduleKey === "academics");
      setState(
        !school?.enabled
          ? "school-required"
          : !acad?.enabled
            ? "disabled"
            : "ready",
      );
    } catch (e) {
      setError(errorText(e));
      setState("disabled");
    }
  };
  useEffect(() => {
    void check();
  }, []);
  const choose = (v: string) => {
    sessionStorage.setItem("ledgerly.academics.view", v);
    setView(v);
  };
  if (state === "loading")
    return (
      <div className="acad-page">
        <Spinner label="Loading Academics" />
      </div>
    );
  if (state === "school-required")
    return (
      <div className="acad-page">
        <Head
          title="Academics"
          text="Teaching, planning and supervision depend on the School Management master data."
        />
        <Card className="acad-gate">
          <XCircle size={42} />
          <h2>School Management must be enabled first</h2>
          <p>
            Academics reuses the school's classes, subjects, terms, academic
            years, teachers, departments and files. Attendance is linked through
            its standalone canonical module when enabled.
          </p>
          <Button onClick={() => (location.hash = "#school")}>
            Open School Management
          </Button>
          {error && <Notice tone="danger">{error}</Notice>}
        </Card>
      </div>
    );
  if (state === "disabled")
    return (
      <div className="acad-page">
        <Head
          title="Academics"
          text="Standalone academic operations linked to School Management."
        />
        <Card className="acad-gate">
          <BookOpenCheck size={42} />
          <h2>Academics is not enabled</h2>
          <p>
            Enable it after School Management to use timetables, schemes, lesson
            plans, lesson delivery, supervision and inspections.
          </p>
          {can(principal, "admin:write") ? (
            <Button
              onClick={async () => {
                try {
                  await post("/modules/academics/enable", {
                    configuration: {},
                  });
                  await check();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Enable Academics
            </Button>
          ) : (
            <Notice tone="warning">
              Ask an organization administrator to enable Academics.
            </Notice>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </Card>
      </div>
    );
  const items = [
    ["overview", "Overview", BarChart3],
    ["timetables", "Timetables", CalendarClock],
    ["schemes", "Schemes of work", BookMarked],
    ["lesson-plans", "Lesson planning", FileText],
    ["delivery", "Lesson delivery", CheckCircle2],
    ["supervision", "Teacher supervision", UserCheck],
    ["inspections", "Book & record inspection", ClipboardCheck],
  ] as const;
  return (
    <div className="acad-shell">
      <aside className="acad-sidebar">
        <div className="acad-brand">
          <BookOpenCheck size={22} />
          <div>
            <b>Academics</b>
            <small>Teaching & supervision</small>
          </div>
        </div>
        <nav>
          {items.map(([k, l, I]) => (
            <button
              key={k}
              className={view === k ? "active" : ""}
              onClick={() => choose(k)}
            >
              <I size={17} />
              <span>{l}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="acad-sidebar-foot">
          <small>Depends on</small>
          <b>School Management</b>
          <span>Exams remain separate</span>
        </div>
      </aside>
      <section className="acad-work">
        {view === "overview" ? (
          <Overview />
        ) : view === "timetables" ? (
          <Timetables />
        ) : view === "schemes" ? (
          <Schemes />
        ) : view === "lesson-plans" ? (
          <LessonPlans />
        ) : view === "delivery" ? (
          <Delivery />
        ) : view === "supervision" ? (
          <Supervision />
        ) : (
          <Inspections />
        )}
      </section>
    </div>
  );
}

function Overview() {
  const x = useLoad<R>(`${base}/overview`, {} as R);
  return (
    <div className="acad-page">
      <Head
        title="Academic operations"
        text="One workspace for teaching preparation, delivery, coverage and supervision."
        actions={
          <Button variant="secondary" onClick={x.load}>
            <RefreshCw size={15} /> Refresh
          </Button>
        }
      />
      {x.loading ? (
        <Spinner />
      ) : (
        <>
          <div className="acad-metrics">
            <Metric
              label="Timetables"
              value={x.data.timetables || 0}
              icon={CalendarClock}
            />
            <Metric
              label="Schemes"
              value={x.data.schemes || 0}
              icon={BookMarked}
            />
            <Metric
              label="Lesson plans"
              value={x.data.lessonPlans || 0}
              icon={FileText}
            />
            <Metric
              label="Today's lessons"
              value={x.data.todaysLessons || 0}
              icon={Clock3}
            />
            <Metric
              label="Average coverage"
              value={`${x.data.averageCoverage || 0}%`}
              icon={GraduationCap}
            />
            <Metric
              label="Open supervision"
              value={
                (x.data.openObservations || 0) + (x.data.openInspections || 0)
              }
              icon={ShieldCheck}
            />
          </div>
          <div className="acad-grid-2">
            <Card>
              <h2>Academic control cycle</h2>
              <div className="acad-flow">
                <span>Timetable</span>
                <i>→</i>
                <span>Scheme</span>
                <i>→</i>
                <span>Lesson plan</span>
                <i>→</i>
                <span>Delivery</span>
                <i>→</i>
                <span>Coverage</span>
              </div>
              <p>
                The system compares planned work against scheduled and actually
                delivered lessons without managing examinations.
              </p>
            </Card>
            <Card>
              <h2>Supervision cycle</h2>
              <div className="acad-flow">
                <span>Observe</span>
                <i>→</i>
                <span>Feedback</span>
                <i>→</i>
                <span>Acknowledge</span>
                <i>→</i>
                <span>Follow-up</span>
              </div>
              <p>
                HODs, DOS and school leaders can review preparation, classroom
                delivery and academic records with evidence.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function useSetup() {
  return useLoad<Setup>(`${base}/setup`, {
    years: [],
    terms: [],
    departments: [],
    classes: [],
    streams: [],
    subjects: [],
    teachers: [],
    rooms: [],
    periods: [],
    teacherAllocations: [],
  });
}
function Timetables() {
  const setup = useSetup(),
    t = useLoad<R[]>(`${base}/timetables`, []),
    [selected, setSelected] = useState(""),
    [entries, setEntries] = useState<R[]>([]),
    [workload, setWorkload] = useState<R[]>([]),
    [modal, setModal] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [conflicts, setConflicts] = useState<R[]>([]),
    [filter, setFilter] = useState({ type: "class", id: "" });
  const table = t.data.find((x) => x.id === selected);
  const loadEntries = async (id = selected) => {
    if (!id) {
      setEntries([]);
      return;
    }
    setEntries(await get<R[]>(`${base}/timetables/${id}/entries`));
    setWorkload(await get<R[]>(`${base}/timetables/${id}/workload`));
  };
  useEffect(() => {
    void loadEntries();
  }, [selected]);
  const filtered = entries.filter((e) =>
    !filter.id || filter.type === "teacher"
      ? !filter.id || e.teacherUserId === filter.id
      : filter.type === "department"
        ? e.departmentId === filter.id
        : e.classId === filter.id,
  );
  const workflow = async (action: string) => {
    await post(`${base}/timetables/${selected}/workflow`, { action });
    await t.load();
    setMessage(`${words(action)} completed.`);
  };
  return (
    <div className="acad-page">
      <Head
        title="Timetable management"
        text="Class, teacher and department timetables with rooms, teacher availability, conflicts, substitutes, temporary changes, approval and workload."
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal("room")}>
              <Building2 size={15} /> Rooms
            </Button>
            <Button
              variant="secondary"
              onClick={() => setModal("availability")}
            >
              <Users size={15} /> Availability
            </Button>
            <Button variant="secondary" onClick={() => setModal("allocations")}>
              <BookOpenCheck size={15} /> Teacher allocations
            </Button>
            <Button onClick={() => setModal("timetable")}>
              <Plus size={15} /> New timetable
            </Button>
          </>
        }
      />
      {message && <Notice tone="success">{message}</Notice>}
      <Card>
        <div className="acad-toolbar">
          <Field label="Timetable">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select timetable…</option>
              {t.data.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name} · {x.termName} · {words(x.status)}
                </option>
              ))}
            </select>
          </Field>
          {table && (
            <>
              <Status value={table.status} />
              {table.status === "draft" && (
                <Button variant="secondary" onClick={() => workflow("submit")}>
                  Submit
                </Button>
              )}
              {table.status === "submitted" && (
                <Button variant="secondary" onClick={() => workflow("approve")}>
                  Approve
                </Button>
              )}
              {table.status === "approved" && (
                <Button onClick={() => workflow("publish")}>Publish</Button>
              )}
              <Button
                variant="secondary"
                onClick={() => printTimetable(filtered, table.name)}
              >
                <Printer size={15} /> Print
              </Button>
              <Button
                onClick={() => setModal("entry")}
                disabled={
                  table.status === "published" || table.status === "archived"
                }
              >
                <Plus size={15} /> Add lesson
              </Button>
            </>
          )}
        </div>
      </Card>
      {selected && (
        <>
          <Card>
            <div className="acad-toolbar">
              <Field label="View">
                <select
                  value={filter.type}
                  onChange={(e) => setFilter({ type: e.target.value, id: "" })}
                >
                  <option value="class">Class timetable</option>
                  <option value="teacher">Teacher timetable</option>
                  <option value="department">Department timetable</option>
                </select>
              </Field>
              <Field label={words(filter.type)}>
                <select
                  value={filter.id}
                  onChange={(e) => setFilter({ ...filter, id: e.target.value })}
                >
                  <option value="">All</option>
                  {(filter.type === "teacher"
                    ? setup.data.teachers
                    : filter.type === "department"
                      ? setup.data.departments
                      : setup.data.classes.filter(
                          (x) =>
                            !table?.academicYearId ||
                            x.academicYearId === table.academicYearId,
                        )
                  ).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <TimetableGrid
              entries={filtered}
              onChange={(e) => {
                sessionStorage.setItem("acad.entry", JSON.stringify(e));
                setModal("change");
              }}
              onSub={(e) => {
                sessionStorage.setItem("acad.entry", JSON.stringify(e));
                setModal("sub");
              }}
            />
          </Card>
          <Card>
            <h2>Teacher workload analysis</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Lessons</th>
                    <th>Periods</th>
                    <th>Weekly minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.map((x) => (
                    <tr key={x.teacherUserId}>
                      <td>{x.teacherName}</td>
                      <td>{x.lessons}</td>
                      <td>{x.periods}</td>
                      <td>{x.minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {modal === "timetable" && (
        <BasicModal
          title="New timetable"
          close={() => setModal(null)}
          onSubmit={async (f) => {
            await post(`${base}/timetables`, {
              academicYearId: val(f, "year"),
              termId: val(f, "term"),
              name: val(f, "name"),
            });
            setModal(null);
            await t.load();
          }}
        >
          <PeriodClassFields setup={setup.data} classAndStream={false} />
          <Field label="Name">
            <input name="name" required placeholder="Term 1 Master Timetable" />
          </Field>
        </BasicModal>
      )}
      {modal === "entry" && (
        <BasicModal
          title="Add timetable lesson"
          close={() => {
            setModal(null);
            setConflicts([]);
          }}
          onSubmit={async (f) => {
            const d = {
              classId: val(f, "class"),
              streamId: val(f, "stream"),
              subjectId: val(f, "subject"),
              teacherUserId: val(f, "teacher"),
              departmentId: val(f, "department"),
              roomId: val(f, "room"),
              weekday: Number(val(f, "weekday")),
              startsAt: val(f, "starts"),
              endsAt: val(f, "ends"),
              lessonType: val(f, "lessonType"),
            };
            try {
              await post(`${base}/timetables/${selected}/entries`, d);
              setModal(null);
              setConflicts([]);
              await loadEntries();
            } catch (e) {
              if (e instanceof ApiError && e.code === "TIMETABLE_CONFLICT")
                setConflicts((e.details as any)?.conflicts || []);
              else throw e;
            }
          }}
        >
          <div className="acad-form-grid">
            <TeachingFields
              setup={setup.data}
              period={false}
              fixedYearId={table?.academicYearId}
            />
            <Field label="Department">
              <Select name="department" items={setup.data.departments} />
            </Field>
            <Field label="Room">
              <Select name="room" items={setup.data.rooms} />
            </Field>
            <Field label="Day">
              <select name="weekday" required>
                {DAYS.map((d, i) => (
                  <option value={i + 1} key={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lesson type">
              <select name="lessonType">
                <option value="single">Single lesson</option>
                <option value="double">Double lesson</option>
              </select>
            </Field>
            <Field label="Start">
              <input name="starts" type="time" required />
            </Field>
            <Field label="End">
              <input name="ends" type="time" required />
            </Field>
          </div>
          {conflicts.length > 0 && (
            <Notice tone="danger">
              <span>
                <b>Conflict detected:</b>
                {conflicts.map((x, i) => (
                  <small key={i} className="acad-conflict">
                    {x.message}
                  </small>
                ))}
              </span>
            </Notice>
          )}
        </BasicModal>
      )}
      {modal === "room" && (
        <RoomsModal
          close={() => {
            setModal(null);
            void setup.load();
          }}
        />
      )}
      {modal === "availability" && (
        <AvailabilityModal setup={setup.data} close={() => setModal(null)} />
      )}{" "}
      {modal === "allocations" && (
        <TeacherAllocationsModal
          setup={setup.data}
          close={() => {
            setModal(null);
            void setup.load();
          }}
        />
      )}{" "}
      {modal === "change" && (
        <ChangeModal
          entry={JSON.parse(sessionStorage.getItem("acad.entry") || "{}")}
          setup={setup.data}
          close={() => setModal(null)}
        />
      )}{" "}
      {modal === "sub" && (
        <SubModal
          entry={JSON.parse(sessionStorage.getItem("acad.entry") || "{}")}
          setup={setup.data}
          close={() => setModal(null)}
        />
      )}
    </div>
  );
}
function TimetableGrid({
  entries,
  onChange,
  onSub,
}: {
  entries: R[];
  onChange: (x: R) => void;
  onSub: (x: R) => void;
}) {
  if (!entries.length)
    return (
      <EmptyState
        title="No timetable lessons"
        description="Add lessons or change the selected view."
      />
    );
  return (
    <div className="table-wrap">
      <table className="acad-table">
        <thead>
          <tr>
            <th>Day</th>
            <th>Time</th>
            <th>Class</th>
            <th>Subject</th>
            <th>Teacher</th>
            <th>Room</th>
            <th>Type</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{DAYS[Number(e.weekday) - 1]}</td>
              <td>
                {e.startsAt}–{e.endsAt}
              </td>
              <td>
                {e.className}
                {e.streamName ? ` · ${e.streamName}` : ""}
              </td>
              <td>{e.subjectName}</td>
              <td>{e.teacherName}</td>
              <td>{e.roomName || "—"}</td>
              <td>
                <Badge>{e.lessonType}</Badge>
              </td>
              <td>
                <div className="row-actions">
                  <button onClick={() => onChange(e)}>Temporary change</button>
                  <button onClick={() => onSub(e)}>Substitute</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function printTimetable(entries: R[], name: string) {
  const w = open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.write(
    `<html><head><title>${name}</title><style>body{font:13px Arial;padding:28px;color:#17212b}h1{margin:0 0 4px}p{color:#667085}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{border:1px solid #cfd7df;padding:7px;text-align:left}th{background:#f2f5f7}@media print{button{display:none}}</style></head><body><h1>${name}</h1><p>Official academic timetable · Printed ${new Date().toLocaleString()}</p><table><thead><tr><th>Day</th><th>Time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead><tbody>${entries.map((e) => `<tr><td>${DAYS[e.weekday - 1]}</td><td>${e.startsAt}–${e.endsAt}</td><td>${e.className}</td><td>${e.subjectName}</td><td>${e.teacherName || ""}</td><td>${e.roomName || ""}</td></tr>`).join("")}</tbody></table><script>print()</script></body></html>`,
  );
  w.document.close();
}
function RoomsModal({ close }: { close: () => void }) {
  const x = useLoad<R[]>(`${base}/rooms`, []);
  return (
    <Modal title="Rooms & learning spaces" onClose={close}>
      <div className="acad-modal-body">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Capacity</th>
              </tr>
            </thead>
            <tbody>
              {x.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{words(r.roomType)}</td>
                  <td>{r.capacity || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="acad-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await post(`${base}/rooms`, {
              code: val(f, "code"),
              name: val(f, "name"),
              roomType: val(f, "type"),
              capacity: Number(val(f, "capacity") || 0) || null,
            });
            e.currentTarget.reset();
            await x.load();
          }}
        >
          <input name="code" placeholder="Code" required />
          <input name="name" placeholder="Room name" required />
          <select name="type">
            <option value="classroom">Classroom</option>
            <option value="library">Library</option>
            <option value="laboratory">Laboratory</option>
            <option value="hall">Hall</option>
            <option value="outdoor">Outdoor</option>
          </select>
          <input name="capacity" type="number" placeholder="Capacity" />
          <Button type="submit">Add</Button>
        </form>
      </div>
    </Modal>
  );
}
function AvailabilityModal({
  setup,
  close,
}: {
  setup: Setup;
  close: () => void;
}) {
  const x = useLoad<R[]>(`${base}/teacher-availability`, []);
  return (
    <Modal title="Teacher availability" onClose={close}>
      <div className="acad-modal-body">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Day</th>
                <th>Time</th>
                <th>State</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {x.data.map((a) => (
                <tr key={a.id}>
                  <td>{a.teacherName}</td>
                  <td>{DAYS[a.weekday - 1]}</td>
                  <td>
                    {a.startsAt}–{a.endsAt}
                  </td>
                  <td>
                    <Status value={a.availability} />
                  </td>
                  <td>{a.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="acad-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await post(`${base}/teacher-availability`, {
              teacherUserId: val(f, "teacher"),
              weekday: Number(val(f, "day")),
              startsAt: val(f, "starts"),
              endsAt: val(f, "ends"),
              availability: val(f, "state"),
              reason: val(f, "reason"),
            });
            await x.load();
          }}
        >
          <Select name="teacher" items={setup.teachers} required />
          <select name="day">
            {DAYS.map((d, i) => (
              <option value={i + 1} key={d}>
                {d}
              </option>
            ))}
          </select>
          <input type="time" name="starts" required />
          <input type="time" name="ends" required />
          <select name="state">
            <option value="unavailable">Unavailable</option>
            <option value="preferred">Preferred</option>
            <option value="available">Available</option>
          </select>
          <input name="reason" placeholder="Reason" />
          <Button type="submit">Save</Button>
        </form>
      </div>
    </Modal>
  );
}
function TeacherAllocationsModal({
  setup,
  close,
}: {
  setup: Setup;
  close: () => void;
}) {
  const [rows, setRows] = useState(setup.teacherAllocations),
    [yearId, setYearId] = useState(currentYear(setup)),
    [termId, setTermId] = useState(""),
    [classId, setClassId] = useState(""),
    [streamId, setStreamId] = useState(""),
    [subjectId, setSubjectId] = useState(""),
    [staffId, setStaffId] = useState("");
  const terms = setup.terms.filter((x) => x.academicYearId === yearId),
    classes = setup.classes.filter((x) => x.academicYearId === yearId),
    streams = setup.streams.filter((x) => x.classId === classId);
  return (
    <Modal title="Teacher subject allocations" onClose={close}>
      <div className="acad-modal-body">
        <p className="acad-help">
          Allocate each School Management teacher to a class and subject.
          Academics will auto-fill that teacher in timetables, schemes and
          lesson plans.
        </p>
        <form
          className="acad-form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            await post(`${base}/teacher-allocations`, {
              staffId,
              academicYearId: yearId,
              termId: termId || null,
              classId,
              streamId: streamId || null,
              subjectId,
            });
            const fresh = await get<R[]>(`${base}/teacher-allocations`);
            setRows(fresh);
            setSubjectId("");
          }}
        >
          <Field label="Academic year">
            <select
              value={yearId}
              onChange={(e) => {
                setYearId(e.target.value);
                setTermId("");
                setClassId("");
              }}
              required
            >
              {setup.years.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Term">
            <select value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">All terms</option>
              {terms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Class">
            <select
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setStreamId("");
              }}
              required
            >
              <option value="">Select…</option>
              {classes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stream">
            <select
              value={streamId}
              onChange={(e) => setStreamId(e.target.value)}
            >
              <option value="">All streams</option>
              {streams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject">
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              required
            >
              <option value="">Select…</option>
              {setup.subjects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Teacher">
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              required
            >
              <option value="">Select…</option>
              {setup.teachers.map((x) => (
                <option key={x.staffId} value={x.staffId}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit">Add allocation</Button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Class</th>
                <th>Subject</th>
                <th>Term</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.teacherName}</td>
                  <td>
                    {x.className}
                    {x.streamName ? ` · ${x.streamName}` : ""}
                  </td>
                  <td>{x.subjectName}</td>
                  <td>
                    {setup.terms.find((t) => t.id === x.termId)?.name ||
                      "All terms"}
                  </td>
                  <td>
                    <button
                      className="acad-link"
                      onClick={async () => {
                        await del(`${base}/teacher-allocations/${x.id}`);
                        setRows(rows.filter((r) => r.id !== x.id));
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
function ChangeModal({
  entry,
  setup,
  close,
}: {
  entry: R;
  setup: Setup;
  close: () => void;
}) {
  return (
    <BasicModal
      title={`Temporary change · ${entry.className || "Lesson"}`}
      close={close}
      onSubmit={async (f) => {
        await post(`${base}/timetable-entries/${entry.id}/temporary-change`, {
          changeDate: val(f, "date"),
          changedTeacherUserId: val(f, "teacher"),
          changedRoomId: val(f, "room"),
          changedStartsAt: val(f, "starts"),
          changedEndsAt: val(f, "ends"),
          reason: val(f, "reason"),
        });
        close();
      }}
    >
      <Field label="Date">
        <input name="date" type="date" required />
      </Field>
      <Field label="Replacement teacher">
        <Select name="teacher" items={setup.teachers} />
      </Field>
      <Field label="Replacement room">
        <Select name="room" items={setup.rooms} />
      </Field>
      <div className="acad-form-grid">
        <Field label="New start">
          <input name="starts" type="time" />
        </Field>
        <Field label="New end">
          <input name="ends" type="time" />
        </Field>
      </div>
      <Field label="Reason">
        <textarea name="reason" required />
      </Field>
    </BasicModal>
  );
}
function SubModal({
  entry,
  setup,
  close,
}: {
  entry: R;
  setup: Setup;
  close: () => void;
}) {
  return (
    <BasicModal
      title={`Substitute teacher · ${entry.className || "Lesson"}`}
      close={close}
      onSubmit={async (f) => {
        await post(`${base}/substitutes`, {
          timetableEntryId: entry.id,
          lessonDate: val(f, "date"),
          substituteTeacherUserId: val(f, "teacher"),
          reason: val(f, "reason"),
        });
        close();
      }}
    >
      <Field label="Lesson date">
        <input name="date" type="date" required />
      </Field>
      <Field label="Substitute teacher">
        <Select name="teacher" items={setup.teachers} required />
      </Field>
      <Field label="Reason">
        <textarea name="reason" required />
      </Field>
    </BasicModal>
  );
}

function Schemes() {
  const setup = useSetup(),
    x = useLoad<R[]>(`${base}/schemes`, []),
    [selected, setSelected] = useState<R | null>(null),
    [modal, setModal] = useState(false),
    [message, setMessage] = useState("");
  const open = async (id: string) =>
    setSelected(await get(`${base}/schemes/${id}`));
  const action = async (a: string) => {
    if (!selected) return;
    await post(`${base}/schemes/${selected.id}/workflow`, { action: a });
    setSelected(await get(`${base}/schemes/${selected.id}`));
    await x.load();
  };
  return (
    <div className="acad-page">
      <Head
        title="Schemes of work"
        text="Termly topic planning, objectives, competencies, methods, materials, assessment, coverage, reflection, HOD review, DOS approval and version history."
        actions={
          <Button onClick={() => setModal(true)}>
            <Plus size={15} /> New scheme
          </Button>
        }
      />
      {message && <Notice tone="success">{message}</Notice>}
      <Card>
        {x.loading ? (
          <Spinner />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scheme</th>
                  <th>Class / subject</th>
                  <th>Teacher</th>
                  <th>Coverage</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {x.data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.title}</b>
                      <small>
                        {s.termName} · {s.academicYearName}
                      </small>
                    </td>
                    <td>
                      {s.className} · {s.subjectName}
                    </td>
                    <td>{s.teacherName}</td>
                    <td>
                      <b>{s.coveragePercent}%</b>
                    </td>
                    <td>
                      <Status value={s.status} />
                    </td>
                    <td>
                      <button
                        className="acad-link"
                        onClick={() => void open(s.id)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {modal && (
        <BasicModal
          title="New termly scheme"
          close={() => setModal(false)}
          onSubmit={async (f) => {
            await post(`${base}/schemes`, {
              academicYearId: val(f, "year"),
              termId: val(f, "term"),
              classId: val(f, "class"),
              streamId: val(f, "stream"),
              subjectId: val(f, "subject"),
              teacherUserId: val(f, "teacher"),
              title: val(f, "title"),
            });
            setModal(false);
            await x.load();
          }}
        >
          <div className="acad-form-grid">
            <TeachingFields setup={setup.data} />
          </div>
          <Field label="Title">
            <input
              name="title"
              required
              placeholder="P5 Mathematics · Term 2 Scheme"
            />
          </Field>
        </BasicModal>
      )}
      {selected && (
        <Modal
          title={selected.title || "Scheme of work"}
          onClose={() => setSelected(null)}
        >
          <div className="acad-modal-body">
            <div className="acad-detail-head">
              <div>
                <Status value={selected.status} />
                <b>
                  {selected.coverage_percent ?? selected.coveragePercent ?? 0}%
                  covered
                </b>
                <small>
                  Version {selected.version_no ?? selected.versionNo}
                </small>
              </div>
              <div className="row-actions">
                {["draft", "rejected"].includes(selected.status) && (
                  <button onClick={() => void action("submit_hod")}>
                    Submit to HOD
                  </button>
                )}
                {selected.status === "submitted_hod" && (
                  <button onClick={() => void action("hod_approve")}>
                    HOD approve
                  </button>
                )}
                {selected.status === "hod_approved" && (
                  <button onClick={() => void action("submit_dos")}>
                    Submit to DOS
                  </button>
                )}
                {selected.status === "submitted_dos" && (
                  <button onClick={() => void action("dos_approve")}>
                    DOS approve
                  </button>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Lesson</th>
                    <th>Topic / subtopic</th>
                    <th>Objectives</th>
                    <th>Methods / materials</th>
                    <th>Assessment</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.items || []).map((i: R) => (
                    <tr key={i.id}>
                      <td>{i.weekNo}</td>
                      <td>{i.lessonNo || "—"}</td>
                      <td>
                        <b>{i.topic}</b>
                        <small>{i.subtopic}</small>
                      </td>
                      <td>{i.learningObjectives || "—"}</td>
                      <td>
                        {[i.teachingMethods, i.learningMaterials]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td>{i.assessmentActivities || "—"}</td>
                      <td>
                        <select
                          value={i.coverageStatus}
                          onChange={async (e) => {
                            await patch(`${base}/scheme-items/${i.id}`, {
                              coverageStatus: e.target.value,
                            });
                            await open(selected.id);
                          }}
                        >
                          <option value="planned">Planned</option>
                          <option value="in_progress">In progress</option>
                          <option value="covered">Covered</option>
                          <option value="carried_forward">
                            Carried forward
                          </option>
                          <option value="skipped">Skipped</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              className="acad-scheme-add"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await post(`${base}/schemes/${selected.id}/items`, {
                  weekNo: Number(val(f, "week")),
                  lessonNo: Number(val(f, "lesson") || 0) || null,
                  topic: val(f, "topic"),
                  subtopic: val(f, "subtopic"),
                  learningObjectives: val(f, "objectives"),
                  competencies: val(f, "competencies"),
                  teachingMethods: val(f, "methods"),
                  learningMaterials: val(f, "materials"),
                  referencesText: val(f, "references"),
                  plannedActivities: val(f, "activities"),
                  assessmentActivities: val(f, "assessment"),
                });
                e.currentTarget.reset();
                await open(selected.id);
              }}
            >
              <h3>Add scheme item</h3>
              <div className="acad-form-grid">
                <input
                  name="week"
                  type="number"
                  min="1"
                  placeholder="Week"
                  required
                />
                <input
                  name="lesson"
                  type="number"
                  min="1"
                  placeholder="Lesson"
                />
                <input name="topic" placeholder="Topic" required />
                <input name="subtopic" placeholder="Subtopic" />
                <input name="objectives" placeholder="Learning objectives" />
                <input name="competencies" placeholder="Competencies" />
                <input name="methods" placeholder="Teaching methods" />
                <input
                  name="materials"
                  placeholder="Teaching / learning materials"
                />
                <input name="references" placeholder="References" />
                <input name="activities" placeholder="Planned activities" />
                <input name="assessment" placeholder="Assessment activities" />
              </div>
              <Button type="submit">Add item</Button>
            </form>
            {(selected.versions || []).length > 0 && (
              <div>
                <h3>Revision & version history</h3>
                <div className="acad-version-list">
                  {selected.versions.map((v: R) => (
                    <span key={v.id}>
                      <b>v{v.versionNo}</b>
                      {v.changeNote || "Snapshot"}
                      <small>{new Date(v.createdAt).toLocaleString()}</small>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function LessonPlans() {
  const setup = useSetup(),
    x = useLoad<R[]>(`${base}/lesson-plans`, []),
    templates = useLoad<R[]>(`${base}/lesson-plan-templates`, []),
    [modal, setModal] = useState(false),
    [detail, setDetail] = useState<R | null>(null);
  const open = async (id: string) =>
    setDetail(await get(`${base}/lesson-plans/${id}`));
  return (
    <div className="acad-page">
      <Head
        title="Lesson planning"
        text="Daily and weekly lesson plans with objectives, prior knowledge, lesson development, learner activities, differentiation, special-needs accommodations, assessment, homework, reflection and HOD approval."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={async () => {
                const name = prompt("Template name");
                if (name) {
                  await post(`${base}/lesson-plan-templates`, {
                    name,
                    template: {},
                  });
                  await templates.load();
                }
              }}
            >
              <Plus size={15} /> Template
            </Button>
            <Button onClick={() => setModal(true)}>
              <Plus size={15} /> New lesson plan
            </Button>
          </>
        }
      />
      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Class / subject</th>
                <th>Topic</th>
                <th>Teacher</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {x.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.lessonDate}</td>
                  <td>
                    {p.className} · {p.subjectName}
                  </td>
                  <td>
                    {p.topic}
                    <small>{p.subtopic}</small>
                  </td>
                  <td>{p.teacherName}</td>
                  <td>
                    <Status value={p.status} />
                  </td>
                  <td>
                    <button
                      className="acad-link"
                      onClick={() => void open(p.id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {modal && (
        <LessonPlanForm
          setup={setup.data}
          templates={templates.data}
          close={() => setModal(false)}
          saved={async () => {
            setModal(false);
            await x.load();
          }}
        />
      )}
      {detail && (
        <Modal
          title={detail.topic || "Lesson plan"}
          onClose={() => setDetail(null)}
        >
          <div className="acad-modal-body">
            <div className="acad-detail-head">
              <Status value={detail.status} />
              <div className="row-actions">
                {detail.status === "draft" && (
                  <button
                    onClick={async () => {
                      await post(`${base}/lesson-plans/${detail.id}/workflow`, {
                        action: "submit",
                      });
                      await open(detail.id);
                      await x.load();
                    }}
                  >
                    Submit
                  </button>
                )}
                {detail.status === "submitted" && (
                  <>
                    <button
                      onClick={async () => {
                        await post(
                          `${base}/lesson-plans/${detail.id}/workflow`,
                          { action: "approve" },
                        );
                        await open(detail.id);
                        await x.load();
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={async () => {
                        await post(
                          `${base}/lesson-plans/${detail.id}/workflow`,
                          { action: "reject", feedback: "Revise and resubmit" },
                        );
                        await open(detail.id);
                        await x.load();
                      }}
                    >
                      Return
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="acad-plan-grid">
              {[
                ["Objectives", detail.lesson_objectives],
                ["Prior knowledge", detail.prior_knowledge],
                ["Introduction", detail.introduction_text],
                ["Lesson development", detail.lesson_development],
                ["Teacher activities", detail.teacher_activities],
                ["Learner activities", detail.learner_activities],
                ["Teaching methods", detail.teaching_methods],
                ["Materials", detail.required_materials],
                [
                  "Differentiated instruction",
                  detail.differentiated_instruction,
                ],
                [
                  "Special-needs accommodations",
                  detail.special_needs_accommodations,
                ],
                ["Assessment", detail.lesson_assessment],
                ["Conclusion", detail.lesson_conclusion],
                ["Homework", detail.homework],
                ["Teacher reflection", detail.teacher_reflection],
                ["HOD feedback", detail.hod_feedback],
              ].map(([a, b]) => (
                <div key={a as string}>
                  <small>{a}</small>
                  <p>{b || "—"}</p>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function LessonPlanForm({
  setup,
  templates,
  close,
  saved,
}: {
  setup: Setup;
  templates: R[];
  close: () => void;
  saved: () => void;
}) {
  return (
    <BasicModal
      title="New lesson plan"
      close={close}
      wide
      onSubmit={async (f) => {
        const obj: any = {
          academicYearId: val(f, "year"),
          termId: val(f, "term"),
          classId: val(f, "class"),
          streamId: val(f, "stream"),
          subjectId: val(f, "subject"),
          teacherUserId: val(f, "teacher"),
          templateId: val(f, "template"),
          lessonDate: val(f, "date"),
          weekNo: Number(val(f, "week") || 0) || null,
          lessonNo: Number(val(f, "lesson") || 0) || null,
          topic: val(f, "topic"),
          subtopic: val(f, "subtopic"),
        };
        for (const k of [
          "lessonObjectives",
          "priorKnowledge",
          "introductionText",
          "lessonDevelopment",
          "teacherActivities",
          "learnerActivities",
          "teachingMethods",
          "requiredMaterials",
          "differentiatedInstruction",
          "specialNeedsAccommodations",
          "lessonAssessment",
          "lessonConclusion",
          "homework",
        ])
          obj[k] = val(f, k);
        await post(`${base}/lesson-plans`, obj);
        await saved();
      }}
    >
      <div className="acad-form-grid">
        <TeachingFields setup={setup} />
        <Field label="Template">
          <Select name="template" items={templates} />
        </Field>
        <Field label="Date">
          <input name="date" type="date" required />
        </Field>
        <Field label="Week">
          <input name="week" type="number" min="1" />
        </Field>
        <Field label="Lesson">
          <input name="lesson" type="number" min="1" />
        </Field>
        <Field label="Topic">
          <input name="topic" required />
        </Field>
        <Field label="Subtopic">
          <input name="subtopic" />
        </Field>
      </div>
      {[
        ["lessonObjectives", "Lesson objectives"],
        ["priorKnowledge", "Prior knowledge"],
        ["introductionText", "Introduction"],
        ["lessonDevelopment", "Lesson development"],
        ["teacherActivities", "Teacher activities"],
        ["learnerActivities", "Learner activities"],
        ["teachingMethods", "Teaching methods"],
        ["requiredMaterials", "Required materials"],
        ["differentiatedInstruction", "Differentiated instruction"],
        ["specialNeedsAccommodations", "Special-needs accommodations"],
        ["lessonAssessment", "Lesson assessment"],
        ["lessonConclusion", "Lesson conclusion"],
        ["homework", "Homework"],
      ].map(([n, l]) => (
        <Field key={n} label={l}>
          <textarea name={n} rows={2} />
        </Field>
      ))}
    </BasicModal>
  );
}

function Delivery() {
  const setup = useSetup(),
    tables = useLoad<R[]>(`${base}/timetables`, []),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    x = useLoad<R[]>(`${base}/deliveries?date=${date}`, []),
    [edit, setEdit] = useState<R | null>(null),
    [message, setMessage] = useState("");
  return (
    <div className="acad-page">
      <Head
        title="Lesson delivery & coverage"
        text="Scheduled lesson register, taught/missed/postponed lessons, actual topics, attendance summaries, recovery lessons, substitutes, evidence and automatic timetable/scheme comparison."
      />
      <Card>
        <div className="acad-toolbar">
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Published timetable">
            <select id="sync-table">
              <option value="">Select…</option>
              {tables.data
                .filter((t) => t.status === "published")
                .map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            onClick={async () => {
              const id = (
                document.getElementById("sync-table") as HTMLSelectElement
              )?.value;
              if (!id) return;
              const r: any = await post(`${base}/deliveries/sync-timetable`, {
                timetableId: id,
                date,
              });
              setMessage(`${r.scheduled} scheduled lessons synchronized.`);
              await x.load();
            }}
          >
            <RefreshCw size={15} /> Sync timetable
          </Button>
        </div>
      </Card>
      {message && <Notice tone="success">{message}</Notice>}
      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Class</th>
                <th>Subject</th>
                <th>Teacher</th>
                <th>Status</th>
                <th>Actual topic</th>
                <th>Timetable</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {x.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.scheduledStartsAt || "—"}–{d.scheduledEndsAt || "—"}
                  </td>
                  <td>{d.className}</td>
                  <td>{d.subjectName}</td>
                  <td>{d.teacherName}</td>
                  <td>
                    <Status value={d.deliveryStatus} />
                  </td>
                  <td>{d.actualTopic || "—"}</td>
                  <td>
                    {d.timetableMatched ? (
                      <Badge tone="success">Matched</Badge>
                    ) : (
                      <Badge>Manual</Badge>
                    )}
                  </td>
                  <td>
                    <button className="acad-link" onClick={() => setEdit(d)}>
                      Record
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {edit && (
        <BasicModal
          title={`${edit.className} · ${edit.subjectName}`}
          close={() => setEdit(null)}
          onSubmit={async (f) => {
            await patch(`${base}/deliveries/${edit.id}`, {
              deliveryStatus: val(f, "status"),
              actualStartsAt: val(f, "starts"),
              actualEndsAt: val(f, "ends"),
              actualTopic: val(f, "topic"),
              actualSubtopic: val(f, "subtopic"),
              studentAttendanceSummary: val(f, "attendance"),
              lessonNotes: val(f, "notes"),
              missedReason: val(f, "reason"),
              recoveryDate: val(f, "recovery"),
            });
            setEdit(null);
            await x.load();
          }}
        >
          <Field label="Delivery status">
            <select name="status" defaultValue={edit.deliveryStatus}>
              <option value="scheduled">Scheduled</option>
              <option value="taught">Taught</option>
              <option value="missed">Missed</option>
              <option value="postponed">Postponed</option>
              <option value="recovery">Recovery lesson</option>
            </select>
          </Field>
          <div className="acad-form-grid">
            <Field label="Actual start">
              <input type="time" name="starts" />
            </Field>
            <Field label="Actual completion">
              <input type="time" name="ends" />
            </Field>
            <Field label="Actual topic">
              <input name="topic" />
            </Field>
            <Field label="Actual subtopic">
              <input name="subtopic" />
            </Field>
            <Field label="Recovery date">
              <input type="date" name="recovery" />
            </Field>
          </div>
          <Field label="Student attendance summary">
            <input name="attendance" placeholder="e.g. 42 present, 3 absent" />
          </Field>
          <Field label="Lesson notes">
            <textarea name="notes" />
          </Field>
          <Field label="Reason for missed/postponed lesson">
            <textarea name="reason" />
          </Field>
          <Evidence kind="deliveries" id={edit.id} />
        </BasicModal>
      )}
    </div>
  );
}
function Evidence({
  kind,
  id,
}: {
  kind: "deliveries" | "observations" | "inspections";
  id: string;
}) {
  const [message, setMessage] = useState("");
  return (
    <Field label="Evidence attachment">
      <input
        type="file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const up = await uploadFile<R>(
              "/school/files",
              file,
              "academic-evidence",
            );
            await post(`${base}/${kind}/${id}/attachments`, {
              fileId: up.id,
              caption: file.name,
            });
            setMessage(`Attached ${file.name}`);
          } catch (err) {
            setMessage(errorText(err));
          }
        }}
      />
      {message && <small>{message}</small>}
    </Field>
  );
}

function Supervision() {
  const { principal } = useAuth(),
    setup = useSetup(),
    x = useLoad<R[]>(`${base}/observations`, []),
    [modal, setModal] = useState(false),
    [edit, setEdit] = useState<R | null>(null),
    [ack, setAck] = useState<R | null>(null);
  return (
    <div className="acad-page">
      <Head
        title="Teacher supervision"
        text="Classroom observations, walkthroughs, formal observations, rubrics, lesson preparation checks, classroom practice, teacher acknowledgement and follow-up."
        actions={
          <Button onClick={() => setModal(true)}>
            <Plus size={15} /> Schedule observation
          </Button>
        }
      />
      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Teacher</th>
                <th>Type</th>
                <th>Class / subject</th>
                <th>Status</th>
                <th>Follow-up</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {x.data.map((o) => (
                <tr key={o.id}>
                  <td>{o.observedAt || o.scheduledFor || "—"}</td>
                  <td>{o.teacherName}</td>
                  <td>{words(o.observationType)}</td>
                  <td>
                    {[o.className, o.subjectName].filter(Boolean).join(" · ") ||
                      "—"}
                  </td>
                  <td>
                    <Status value={o.status} />
                    {o.teacherAcknowledgedAt && (
                      <small className="acad-inline-note">Acknowledged</small>
                    )}
                  </td>
                  <td>{o.followupDate || "—"}</td>
                  <td>
                    <div className="acad-row-actions">
                      <button className="acad-link" onClick={() => setEdit(o)}>
                        Record findings
                      </button>
                      {o.teacherUserId === principal?.userId &&
                        o.status === "completed" &&
                        !o.teacherAcknowledgedAt && (
                          <button
                            className="acad-link"
                            onClick={() => setAck(o)}
                          >
                            Acknowledge
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {modal && (
        <BasicModal
          title="Schedule observation"
          close={() => setModal(false)}
          onSubmit={async (f) => {
            await post(`${base}/observations`, {
              observationType: val(f, "type"),
              scheduledFor: val(f, "scheduled"),
              teacherUserId: val(f, "teacher"),
              classId: val(f, "class"),
              subjectId: val(f, "subject"),
            });
            setModal(false);
            await x.load();
          }}
        >
          <Field label="Observation type">
            <select name="type">
              <option value="classroom">Classroom observation</option>
              <option value="walkthrough">Walkthrough</option>
              <option value="formal">Formal lesson observation</option>
            </select>
          </Field>
          <Field label="Teacher">
            <Select name="teacher" items={setup.data.teachers} required />
          </Field>
          <div className="acad-form-grid">
            <PeriodClassFields
              setup={setup.data}
              period={false}
              classRequired={false}
            />
            <Field label="Subject">
              <Select name="subject" items={setup.data.subjects} />
            </Field>
          </div>
          <Field label="Scheduled date/time">
            <input name="scheduled" type="datetime-local" />
          </Field>
        </BasicModal>
      )}
      {edit && (
        <BasicModal
          title={`Observation · ${edit.teacherName}`}
          close={() => setEdit(null)}
          onSubmit={async (f) => {
            await patch(`${base}/observations/${edit.id}`, {
              observedAt: new Date().toISOString(),
              status: "completed",
              preparationScore: Number(val(f, "prep") || 0) || null,
              teachingMethodsScore: Number(val(f, "methods") || 0) || null,
              classroomManagementScore:
                Number(val(f, "classroom") || 0) || null,
              learnerParticipationScore:
                Number(val(f, "participation") || 0) || null,
              materialsUseScore: Number(val(f, "materials") || 0) || null,
              timeManagementScore: Number(val(f, "time") || 0) || null,
              strengths: val(f, "strengths"),
              areasForImprovement: val(f, "improve"),
              recommendations: val(f, "recommendations"),
              confidentialNotes: val(f, "confidential"),
              followupDate: val(f, "followup"),
            });
            setEdit(null);
            await x.load();
          }}
        >
          <p className="acad-help">
            Score each observation criterion using the school's supervision
            rubric. Confidential notes are kept separately from teacher-facing
            recommendations.
          </p>
          <div className="acad-form-grid">
            {[
              ["prep", "Lesson preparation"],
              ["methods", "Teaching methods"],
              ["classroom", "Classroom management"],
              ["participation", "Learner participation"],
              ["materials", "Use of materials"],
              ["time", "Time management"],
            ].map(([n, l]) => (
              <Field key={n} label={`${l} score`}>
                <input name={n} type="number" min="0" max="5" step="0.5" />
              </Field>
            ))}
          </div>
          <Field label="Teacher strengths">
            <textarea name="strengths" />
          </Field>
          <Field label="Areas for improvement">
            <textarea name="improve" />
          </Field>
          <Field label="Supervisor recommendations">
            <textarea name="recommendations" />
          </Field>
          <Field label="Confidential supervision notes">
            <textarea name="confidential" />
          </Field>
          <Field label="Follow-up date">
            <input name="followup" type="date" />
          </Field>
          <Evidence kind="observations" id={edit.id} />
        </BasicModal>
      )}
      {ack && (
        <BasicModal
          title="Acknowledge observation"
          close={() => setAck(null)}
          onSubmit={async (f) => {
            await post(`${base}/observations/${ack.id}/acknowledge`, {
              response: val(f, "response"),
            });
            setAck(null);
            await x.load();
          }}
        >
          <Notice tone="info">
            By acknowledging, you confirm that you have received the
            supervisor's findings and recommendations. This does not prevent a
            scheduled follow-up observation.
          </Notice>
          <Field label="Teacher response">
            <textarea
              name="response"
              placeholder="Add your response, action points or comments…"
            />
          </Field>
        </BasicModal>
      )}
    </div>
  );
}
function Inspections() {
  const setup = useSetup(),
    x = useLoad<R[]>(`${base}/inspections`, []),
    [modal, setModal] = useState(false),
    [edit, setEdit] = useState<R | null>(null);
  return (
    <div className="acad-page">
      <Head
        title="Book & record inspection"
        text="Exercise books, teacher records, lesson plans, schemes, attendance registers and mark-book inspection without managing examinations."
        actions={
          <Button onClick={() => setModal(true)}>
            <Plus size={15} /> New inspection
          </Button>
        }
      />
      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Inspection</th>
                <th>Teacher</th>
                <th>Class / subject</th>
                <th>Sample</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {x.data.map((i) => (
                <tr key={i.id}>
                  <td>{i.inspectedOn}</td>
                  <td>{words(i.inspectionType)}</td>
                  <td>{i.teacherName || "—"}</td>
                  <td>
                    {[i.className, i.subjectName].filter(Boolean).join(" · ") ||
                      "—"}
                  </td>
                  <td>{i.sampleSize || "—"}</td>
                  <td>
                    <Status value={i.status} />
                  </td>
                  <td>
                    <button className="acad-link" onClick={() => setEdit(i)}>
                      Follow up
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {modal && (
        <BasicModal
          title="New academic inspection"
          close={() => setModal(false)}
          wide
          onSubmit={async (f) => {
            await post(`${base}/inspections`, {
              inspectionType: val(f, "type"),
              inspectedOn: val(f, "date"),
              teacherUserId: val(f, "teacher"),
              classId: val(f, "class"),
              streamId: val(f, "stream"),
              subjectId: val(f, "subject"),
              sampleSize: Number(val(f, "sample") || 0) || null,
              quantityOfWork: val(f, "quantity"),
              qualityOfMarking: val(f, "marking"),
              correctionFeedbackChecks: val(f, "corrections"),
              dateOfLastMarking: val(f, "lastMarking"),
              findings: val(f, "findings"),
              recommendations: val(f, "recommendations"),
              followupDate: val(f, "followup"),
              confidentialNotes: val(f, "confidential"),
            });
            setModal(false);
            await x.load();
          }}
        >
          <div className="acad-form-grid">
            <Field label="Inspection type">
              <select name="type">
                <option value="exercise_books">Learner exercise books</option>
                <option value="teacher_records">Teacher records</option>
                <option value="lesson_plans">Lesson plans</option>
                <option value="schemes">Schemes of work</option>
                <option value="attendance_register">Attendance register</option>
                <option value="mark_book">Mark book (inspection only)</option>
              </select>
            </Field>
            <Field label="Inspection date">
              <input name="date" type="date" required />
            </Field>
            <Field label="Teacher">
              <Select name="teacher" items={setup.data.teachers} />
            </Field>
            <PeriodClassFields
              setup={setup.data}
              period={false}
              classRequired={false}
            />
            <Field label="Subject">
              <Select name="subject" items={setup.data.subjects} />
            </Field>
            <Field label="Sample size">
              <input name="sample" type="number" min="1" />
            </Field>
            <Field label="Date of last marking">
              <input name="lastMarking" type="date" />
            </Field>
          </div>
          <Field label="Quantity of work given">
            <textarea name="quantity" />
          </Field>
          <Field label="Quality of marking">
            <textarea name="marking" />
          </Field>
          <Field label="Corrections and feedback checks">
            <textarea name="corrections" />
          </Field>
          <Field label="Findings">
            <textarea name="findings" required />
          </Field>
          <Field label="Recommendations">
            <textarea name="recommendations" />
          </Field>
          <Field label="Follow-up date">
            <input name="followup" type="date" />
          </Field>
          <Field label="Confidential notes">
            <textarea name="confidential" />
          </Field>
        </BasicModal>
      )}
      {edit && (
        <BasicModal
          title={`Follow-up · ${words(edit.inspectionType)}`}
          close={() => setEdit(null)}
          onSubmit={async (f) => {
            await patch(`${base}/inspections/${edit.id}`, {
              status: val(f, "status"),
              teacherResponse: val(f, "response"),
              findings: val(f, "findings") || edit.findings,
              recommendations:
                val(f, "recommendations") || edit.recommendations,
              followupDate: val(f, "followup"),
            });
            setEdit(null);
            await x.load();
          }}
        >
          <Field label="Status">
            <select name="status" defaultValue={edit.status}>
              <option value="open">Open</option>
              <option value="responded">Teacher responded</option>
              <option value="followup_due">Follow-up due</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
          <Field label="Teacher response">
            <textarea name="response" defaultValue={edit.teacherResponse} />
          </Field>
          <Field label="Findings">
            <textarea name="findings" defaultValue={edit.findings} />
          </Field>
          <Field label="Recommendations">
            <textarea
              name="recommendations"
              defaultValue={edit.recommendations}
            />
          </Field>
          <Field label="Follow-up date">
            <input
              name="followup"
              type="date"
              defaultValue={edit.followupDate}
            />
          </Field>
          <Evidence kind="inspections" id={edit.id} />
        </BasicModal>
      )}
    </div>
  );
}

function BasicModal({
  title,
  children,
  close,
  onSubmit,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  onSubmit: (f: FormData) => Promise<void>;
  wide?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={title} onClose={close} locked={busy}>
      <form
        className={`acad-modal-body ${wide ? "acad-wide" : ""}`}
        onSubmit={async (e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSubmit(new FormData(e.currentTarget));
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="acad-modal-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
