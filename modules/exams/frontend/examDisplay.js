// ============================================================
// lib/examDisplay.js
//
// Single source of truth for how division/grade/aggregate values
// from the exam backend are labeled and colored in the UI.
//
// Backend division values (see services/exams/service.js):
//   '1' | '2' | '3' | '4'  — normal PLE divisions, lower is better
//   'U'                    — sat every required subject, but the
//                             aggregate itself falls in the ungraded
//                             band (35-36)
//   'X'                    — INCOMPLETE: student is missing at least
//                             one gradable subject that's configured
//                             for their class/exam (no mark row at
//                             all). Aggregate may still look good —
//                             it's only computed from the subjects
//                             that WERE entered — so this must never
//                             be visually confused with a real division.
//
// Per-subject mark rows can also carry grade:'X' (see marks[] in the
// student report card response) — these are synthetic rows the
// backend inserts for subjects with no mark at all, always paired
// with remarks:"Missing — no mark recorded for this subject".
// ============================================================

export const DIVISION_META = {
  '1': { label: 'Div 1',      shortLabel: '1', color: '#059669', bg: '#ECFDF5', description: 'Division 1' },
  '2': { label: 'Div 2',      shortLabel: '2', color: '#1D4ED8', bg: '#EFF6FF', description: 'Division 2' },
  '3': { label: 'Div 3',      shortLabel: '3', color: '#7C3AED', bg: '#F5F3FF', description: 'Division 3' },
  '4': { label: 'Div 4',      shortLabel: '4', color: '#D97706', bg: '#FFFBEB', description: 'Division 4' },
  'U': { label: 'Ungraded',   shortLabel: 'U', color: '#DC2626', bg: '#FEF2F2', description: 'Ungraded — aggregate falls outside the graded bands' },
  'X': { label: 'Incomplete', shortLabel: 'X', color: '#B45309', bg: '#FFF7ED', description: 'Incomplete — missing one or more required subject marks' },
}

const DEFAULT_DIVISION_META = { label: '—', shortLabel: '—', color: '#94A3B8', bg: '#F8FAFC', description: 'Not yet computed' }

// Resolves a display-ready division descriptor from a report card row.
// Always trust `division` from the backend when present — never
// re-derive it from `aggregate` on the frontend, since the backend is
// the only place that knows about subjects_missing / gradableSubjectsSat.
export function getDivisionMeta(division) {
  if (!division) return DEFAULT_DIVISION_META
  return DIVISION_META[division] || DEFAULT_DIVISION_META
}

// Per-subject grade badge colors (D1-F9 scale + synthetic states)
export const GRADE_COLORS = {
  D1: '#059669', D2: '#10B981', C3: '#1D4ED8', C4: '#3B82F6',
  C5: '#60A5FA', C6: '#93C5FD', P7: '#D97706', P8: '#F59E0B', F9: '#DC2626',
  NG: '#94A3B8',  // non-gradable subject
  X:  '#B45309',  // missing subject — matches division 'X' color
}

export function getGradeColor(grade) {
  return GRADE_COLORS[grade] || '#94A3B8'
}

// Aggregate number color — independent of division, purely a visual
// scale from best (low) to worst (high) aggregate. Note aggregate can
// look "good" even when division is 'X' (few subjects entered, all
// scored well) — callers must show division alongside this, never
// aggregate alone, when subjects_missing > 0.
export function getAggregateColor(aggregate) {
  if (aggregate == null) return '#64748B'
  if (aggregate <= 8)  return '#059669'
  if (aggregate <= 14) return '#1D4ED8'
  if (aggregate <= 20) return '#7C3AED'
  if (aggregate <= 28) return '#D97706'
  return '#DC2626'
}

// True if a mark row represents a subject with no mark entered at all
// (backend synthetic row, grade === 'X', not the same as is_absent).
export function isMissingMark(mark) {
  return mark?.grade === 'X' && !mark?.is_absent
}

// Human-readable one-liner for why a student has division 'X', derived
// straight from the report card fields — no re-computation, just
// formatting what the backend already told us.
export function describeIncomplete(card) {
  const missing = card?.grade_summary?.X ?? card?.subjects_missing
  if (!missing) return null
  return `Missing marks in ${missing} subject${missing === 1 ? '' : 's'} — division cannot be computed until all required subjects have marks.`
}