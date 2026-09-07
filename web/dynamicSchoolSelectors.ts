// @ts-nocheck
import { authStore, get } from "./api";

type Row = Record<string, any>;
type SetupData = {
  years: Row[];
  terms: Row[];
  classes: Row[];
  streams: Row[];
  subjects: Row[];
  classSubjects: Row[];
};

type Kind = "year" | "term" | "class" | "stream" | "subject";

const aliases: Record<Kind, Set<string>> = {
  year: new Set(["year", "yearid", "academicyear", "academicyearid", "schoolyear", "schoolyearid"]),
  term: new Set(["term", "termid", "schoolterm", "schooltermid"]),
  class: new Set(["class", "classid", "schoolclass", "schoolclassid"]),
  stream: new Set(["stream", "streamid", "schoolstream", "schoolstreamid"]),
  subject: new Set(["subject", "subjectid", "schoolsubject", "schoolsubjectid"]),
};

let cachedOrg = "";
let cached: SetupData | null = null;
let loading: Promise<SetupData | null> | null = null;

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const active = (row: Row) => row.active !== false && row.active !== 0 && row.active !== "0";

function labelText(select: HTMLSelectElement) {
  const label = select.closest("label");
  if (label) {
    const span = label.querySelector(":scope > span");
    if (span?.textContent) return span.textContent;
    if (label.textContent) return label.textContent;
  }
  const id = select.id;
  if (id) {
    const external = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (external?.textContent) return external.textContent;
  }
  return "";
}

function kindOf(select: HTMLSelectElement): Kind | null {
  const candidates = [
    select.name,
    select.id,
    select.getAttribute("aria-label") || "",
    labelText(select),
  ].map(normalize).filter(Boolean);

  for (const kind of Object.keys(aliases) as Kind[]) {
    if (candidates.some(value => aliases[kind].has(value))) return kind;
  }
  return null;
}

function scopeFor(select: HTMLSelectElement): ParentNode {
  return select.closest("form")
    || select.closest(".exam-modal,.acad-modal,.modal,[role='dialog']")
    || select.closest(".page,.exam-page,.acad-page")
    || document;
}

function selects(scope: ParentNode, kind: Kind) {
  return [...scope.querySelectorAll("select")].filter((el): el is HTMLSelectElement =>
    el instanceof HTMLSelectElement && kindOf(el) === kind
  );
}

function valueFrom(scope: ParentNode, kind: Kind) {
  return selects(scope, kind).find(select => select.value)?.value || "";
}

function inferYearId(scope: ParentNode, data: SetupData) {
  const selected = valueFrom(scope, "year");
  if (selected) return selected;

  const text = (scope instanceof Element ? scope.textContent : document.body.textContent) || "";
  const hits = data.years.filter(year => {
    const name = String(year.name || "").trim();
    const code = String(year.code || "").trim();
    return (name && text.includes(name)) || (code && text.includes(code));
  });
  return hits.length === 1 ? String(hits[0].id) : "";
}

function optionUsesCanonicalIds(select: HTMLSelectElement, rows: Row[]) {
  const ids = new Set(rows.map(row => String(row.id)));
  return [...select.options].some(option => option.value && ids.has(option.value));
}

function filterSelect(select: HTMLSelectElement, allRows: Row[], allowedIds: Set<string> | null) {
  if (!optionUsesCanonicalIds(select, allRows)) return;
  let selectedInvalid = false;

  for (const option of [...select.options]) {
    if (!option.value) {
      option.hidden = false;
      option.disabled = false;
      option.style.removeProperty("display");
      continue;
    }
    const valid = allowedIds == null || allowedIds.has(option.value);
    option.hidden = !valid;
    option.disabled = !valid;
    if (valid) option.style.removeProperty("display");
    else option.style.display = "none";
    if (!valid && option.selected) selectedInvalid = true;
  }

  if (selectedInvalid) {
    select.value = "";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function loadSetup(): Promise<SetupData | null> {
  const principal = authStore.principal();
  const org = principal?.organizationId || "";
  if (!org || !authStore.getAccess()) return null;

  if (org !== cachedOrg) {
    cachedOrg = org;
    cached = null;
    loading = null;
  }
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    try {
      const [years, terms, classes, streams, subjects, classSubjects] = await Promise.all([
        get<Row[]>("/school/setup/academicYears?limit=1000"),
        get<Row[]>("/school/setup/terms?limit=1000"),
        get<Row[]>("/school/setup/classes?limit=1000"),
        get<Row[]>("/school/setup/streams?limit=2000"),
        get<Row[]>("/school/setup/subjects?limit=1000"),
        get<Row[]>("/school/setup/classSubjects?limit=3000"),
      ]);
      cached = { years, terms, classes, streams, subjects, classSubjects };
      return cached;
    } catch {
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function applyDependencies(data: SetupData) {
  const all = [...document.querySelectorAll("select")].filter((el): el is HTMLSelectElement => el instanceof HTMLSelectElement);
  const handled = all.filter(select => kindOf(select));

  for (const select of handled) {
    const kind = kindOf(select);
    if (!kind || kind === "year") continue;
    const scope = scopeFor(select);
    const yearId = inferYearId(scope, data);
    const classId = valueFrom(scope, "class");

    if (kind === "term") {
      const allowed = yearId
        ? new Set(data.terms.filter(term => String(term.academicYearId || term.academic_year_id || "") === yearId).map(term => String(term.id)))
        : null;
      filterSelect(select, data.terms, allowed);
      continue;
    }

    if (kind === "class") {
      const allowed = yearId
        ? new Set(data.classes.filter(cls => {
            const clsYear = String(cls.academicYearId || cls.academic_year_id || "");
            return !clsYear || clsYear === yearId;
          }).map(cls => String(cls.id)))
        : null;
      filterSelect(select, data.classes, allowed);
      continue;
    }

    if (kind === "stream") {
      const allowed = classId
        ? new Set(data.streams.filter(stream => String(stream.classId || stream.class_id || "") === classId).map(stream => String(stream.id)))
        : null;
      filterSelect(select, data.streams, allowed);
      continue;
    }

    if (kind === "subject") {
      if (!classId) {
        filterSelect(select, data.subjects, null);
        continue;
      }
      const cls = data.classes.find(row => String(row.id) === classId);
      const classLevelId = String(cls?.classLevelId || cls?.class_level_id || "");
      const effectiveYearId = yearId || String(cls?.academicYearId || cls?.academic_year_id || "");
      const levelLinks = data.classSubjects.filter(link =>
        active(link) && String(link.classLevelId || link.class_level_id || "") === classLevelId
      );

      // Match the Exams backend semantics: if a class level has no explicit subject
      // configuration, all active school subjects remain available.
      const allowed = !classLevelId || levelLinks.length === 0
        ? null
        : new Set(levelLinks.filter(link => {
            const linkYear = String(link.academicYearId || link.academic_year_id || "");
            return !linkYear || !effectiveYearId || linkYear === effectiveYearId;
          }).map(link => String(link.subjectId || link.subject_id || "")));

      filterSelect(select, data.subjects.filter(active), allowed);
    }
  }
}

export function refreshDynamicSchoolSelectors() {
  void loadSetup().then(data => {
    if (data) applyDependencies(data);
  });
}

export function installDynamicSchoolSelectors() {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      refreshDynamicSchoolSelectors();
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("change", event => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && kindOf(target)) {
      schedule();
      setTimeout(schedule, 0);
    }
  }, true);

  window.addEventListener("finance:session-expired", () => {
    cached = null;
    cachedOrg = "";
    loading = null;
  });

  schedule();
  return () => observer.disconnect();
}
