/**
 * examPdf.js — Premium Academic PDF Generator
 * Uganda PLE | Streamlined & Professional Report Card
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import JsBarcode from 'jsbarcode'

// ── Palette ───────────────────────────────────────────────────────────────────
// Restrained "issued document" palette: one ink, one accent, desaturated
// status colors. Keys are unchanged from the original — gradeColor() below
// looks values up by these exact key names (letter grades, division codes),
// so only the hex values were retuned, never the keys themselves.
const C = {
  ink:       '#111318',
  inkSoft:   '#374151',
  slate:     '#5B6472',
  muted:     '#8B93A1',
  rule:      '#E2E5EA',
  surface:   '#F6F5F2',
  paper:     '#FDFDFC',
  white:     '#FFFFFF',
  headerBg:  '#111318',
  accent:    '#1E3A5F',
  accentBg:  '#EEF2F7',
  D1: '#3F6B4F', D2: '#4C7A5C',
  C3: '#3B5B7A', C4: '#4A6D8C', C5: '#5B7EA0', C6: '#6D8EAF',
  P7: '#8A6D3B', P8: '#9C7C4A',
  F9: '#8B4A4A', NG: '#8B93A1',
  X:  '#9A7B2E', // missing-subject grade — matches divX below
  div1: '#3F6B4F', div2: '#3B5B7A', div3: '#6B5B8A', div4: '#8A6D3B', divU: '#8B4A4A',
  divX: '#9A7B2E', // Incomplete — muted amber, distinct from divU brick-red, never confused with a real division color
}

// ── Page geometry ─────────────────────────────────────────────────────────────
const MARGIN    = 14
const RIGHT     = 210 - MARGIN
const CONTENT_W = 210 - MARGIN * 2   // 182
const FOOTER_H  = 10

function h2r(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}
const rgb  = (hex) => h2r(hex)
const setFill = (doc, hex) => doc.setFillColor(...rgb(hex))
const setDraw = (doc, hex) => doc.setDrawColor(...rgb(hex))
const setTxt  = (doc, hex) => doc.setTextColor(...rgb(hex))
const font    = (doc, style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size) }

// Mixes `hex` toward white by `amount` (0..1) — used for quiet tinted fills
// (status pills, the incomplete banner) instead of hand-rolled r+N math.
function tint(hex, amount) {
  const [r, g, b] = h2r(hex)
  const mix = (c) => Math.round(c + (255 - c) * amount)
  const toHex = (c) => c.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

// Simulates letter-spacing for short all-caps eyebrow labels (jsPDF has no
// letter-spacing property). Only for labels under ~20 chars — longer
// strings get unreadable and start overflowing their column.
function track(s) {
  return s.length <= 20 ? s.split('').join(' ') : s
}

// ── Grade / Division helpers ────────────────────────────────────────────────
// IMPORTANT: division must ALWAYS come from the backend's card.division field
// (or a marksheet row's c.division), never be re-derived from the aggregate
// number on this side. The backend is the only place that knows whether a
// student is missing required subjects (division 'X') — an aggregate alone
// can look excellent even when several subjects were never marked, because
// the aggregate is only computed from subjects that WERE entered. Re-deriving
// division from aggregate here would print a real division (e.g. "DIVISION
// I") on a report card for a student who is actually incomplete.
function gradeColor(grade, bands = []) {
  const band = bands.find(b => b.grade === grade)
  if (band?.color_hex) return band.color_hex
  return C[grade] || C.NG
}

const DIVISION_INFO = {
  '1': { label: 'Division I',   color: C.div1, range: '4–12'  },
  '2': { label: 'Division II',  color: C.div2, range: '13–23' },
  '3': { label: 'Division III', color: C.div3, range: '24–29' },
  '4': { label: 'Division IV',  color: C.div4, range: '30–34' },
  'U': { label: 'Ungraded',     color: C.divU, range: '35+'   },
  'X': { label: 'Incomplete',   color: C.divX, range: '—'     },
}

// Resolves display info strictly from the backend-provided division code.
// If division is missing entirely (older data, or a stub/_not_computed
// card), falls back to a neutral "Not Computed" state — NOT to a
// division inferred from aggregate.
function divisionInfo(division) {
  if (division && DIVISION_INFO[division]) return DIVISION_INFO[division]
  return { label: 'Not Computed', color: C.muted, range: '—' }
}

// ── Barcode (Professional Styling) ────────────────────────────────────────────
function barcodeImg(text) {
  try {
    const c = document.createElement('canvas')
    JsBarcode(c, String(text || '0'), {
      format: 'CODE128', width: 1.5, height: 28,
      displayValue: false, margin: 0, background: '#ffffff', lineColor: '#111318',
    })
    return c.toDataURL('image/png')
  } catch { return null }
}

// ── Page chrome ───────────────────────────────────────────────────────────────
function drawPageBg(doc) {
  setFill(doc, C.paper); doc.rect(0, 0, 210, 297, 'F')
}

function drawHeader(doc, schoolName, examLabel, scale) {
  const px = n => n * scale

  // A single slender accent rule at the very top — no heavy filled band.
  setDraw(doc, C.accent); doc.setLineWidth(0.5)
  doc.line(MARGIN, px(4), RIGHT, px(4))

  font(doc, 'bold', px(17)); setTxt(doc, C.ink)
  doc.text(schoolName || 'LUBOWA MEMORIAL JUNIOR SCHOOL', 105, px(13), { align: 'center' })

  font(doc, 'bold', px(7)); setTxt(doc, C.slate)
  doc.text(
    'Uganda   ·   Official School Academic Record',
    105, px(19), { align: 'center' }
  )

  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(MARGIN, px(23), RIGHT, px(23))

  font(doc, 'bold', px(7)); setTxt(doc, C.muted)
  doc.text(track('OFFICIAL TRANSCRIPT'), MARGIN, px(28.5))

  font(doc, 'bold', px(9)); setTxt(doc, C.ink)
  doc.text((examLabel || 'Report Card').toUpperCase(), 105, px(28.5), { align: 'center' })

  font(doc, 'bold', px(7)); setTxt(doc, C.accent)
  doc.text(track('CONFIDENTIAL'), RIGHT, px(28.5), { align: 'right' })

  return px(33)
}

function drawStudentPanel(doc, card, y, scale) {
  const px = n => n * scale
  const H = px(33)

  // Quiet panel: a soft fill and a single thin accent rule on the left,
  // no border box — the box-around-everything look is what makes these
  // scripts read as a filled-in form.
  setFill(doc, C.surface)
  doc.rect(MARGIN, y, CONTENT_W, H, 'F')
  setFill(doc, C.accent)
  doc.rect(MARGIN, y, 0.6, H, 'F')

  font(doc, 'bold', px(16)); setTxt(doc, C.ink)
  const fullName = `${card.first_name || ''} ${card.last_name || ''}`.trim() || '—'
  doc.text(fullName, MARGIN + px(6), y + px(10.5))

  font(doc, 'bold', px(9)); setTxt(doc, C.slate)
  const subtitle = [
    card.class_name,
    card.stream_name,
    card.academic_year_name,
    card.term_name,
  ].filter(Boolean).join('   ·   ')
  doc.text(subtitle, MARGIN + px(6), y + px(17.5))

  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(MARGIN + px(6), y + px(21), RIGHT - px(6), y + px(21))

  const bc = barcodeImg(card.student_number || card.student_id)
  if (bc) {
    doc.addImage(bc, 'PNG', RIGHT - px(38), y + px(3), px(34), px(9))
    font(doc, 'bold', px(5.5)); setTxt(doc, C.muted)
    doc.text(String(card.student_number || ''), RIGHT - px(21), y + px(15), { align: 'center' })
  }

  const meta = [
    ['ADM NO', card.student_number || '—'],
    ['CLASS',  `${card.class_name || '—'}${card.stream_name ? ' · ' + card.stream_name : ''}`],
    ['EXAM',   card.exam_name || '—'],
    ['TERM',   "II" || '—'],
  ]

  let mx = MARGIN + px(6)
  meta.forEach(([lbl, val]) => {
    font(doc, 'bold', px(6)); setTxt(doc, C.muted)
    doc.text(track(lbl), mx, y + px(26.5))
    font(doc, 'bold', px(8.5)); setTxt(doc, C.ink)
    doc.text(String(val).substring(0, 22), mx, y + px(31.5))
    mx += px(42)
  })

  return y + H + px(4)
}

function drawResultSummary(doc, card, bands, y, scale) {
  const px = n => n * scale
  const agg     = card.aggregate
  const divInfo = divisionInfo(card.division)
  const isIncomplete = card.division === 'X'

  // This is the one panel on the page that earns a stronger treatment: a
  // thin left accent bar, generous padding, and the aggregate set larger
  // than anything else — the headline number a reader's eye should land on.
  const H  = isIncomplete ? px(27) : px(20)
  const by = y

  setFill(doc, tint(divInfo.color, 0.94))
  doc.rect(MARGIN, by, CONTENT_W, H, 'F')
  setFill(doc, divInfo.color)
  doc.rect(MARGIN, by, px(1), H, 'F')

  font(doc, 'bold', px(7)); setTxt(doc, C.muted)
  doc.text(track('AGGREGATE'), MARGIN + px(7), by + px(7))
  font(doc, 'bold', px(22)); setTxt(doc, divInfo.color)
  doc.text(agg != null ? String(agg) : '—', MARGIN + px(7), by + px(17))

  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(MARGIN + px(40), by + px(3.5), MARGIN + px(40), by + H - px(3.5))

  font(doc, 'bold', px(7)); setTxt(doc, C.muted)
  doc.text(track('DIVISION'), MARGIN + px(46), by + px(7))
  font(doc, 'bold', px(16)); setTxt(doc, divInfo.color)
  doc.text(divInfo.label.toUpperCase(), MARGIN + px(46), by + px(17))

  doc.line(MARGIN + px(116), by + px(3.5), MARGIN + px(116), by + H - px(3.5))

  font(doc, 'bold', px(7)); setTxt(doc, C.muted)
  doc.text(track('NEXT TERM'), MARGIN + px(122), by + px(7))
  font(doc, 'bold', px(11)); setTxt(doc, C.ink)
  doc.text(card.next_term_begins || 'To Be Communicated', MARGIN + px(122), by + px(17))

  // Incomplete warning strip — printed directly on the report card so the
  // aggregate can never be misread as a genuine division result.
  if (isIncomplete) {
    const missing = card.subjects_missing ?? card.grade_summary?.X ?? null
    const msg = missing
      ? `Incomplete — missing marks in ${missing} subject${missing === 1 ? '' : 's'}; aggregate above excludes them and is not a division result.`
      : 'Incomplete — one or more required subjects have no recorded marks; aggregate above is not a division result.'
    setFill(doc, tint(C.divX, 0.88))
    doc.rect(MARGIN + px(1), by + H - px(6.5), CONTENT_W - px(1), px(6.5), 'F')
    font(doc, 'bold', px(6.5)); setTxt(doc, C.divX)
    doc.text(msg, 105, by + H - px(2.3), { align: 'center' })
  }

  return by + H + px(5)
}

function drawMarksTable(doc, marks, y, bands, scale) {
  if (!marks?.length) return y
  const px = n => n * scale

  function getRemark(mark, grade, isAbsent, isExempt, isMissing) {
    if (isMissing) return 'No mark recorded'
    if (isAbsent) return 'Absent'
    if (isExempt) return 'Exempted'
    if (mark == null) return ''
    if (mark >= 80) return 'Excellent'
    if (mark >= 70) return 'Very Good'
    if (mark >= 60) return 'Good'
    if (mark >= 50) return 'Fair'
    if (mark >= 40) return 'Needs Improvement'
    return 'Needs Improvement'
  }

  font(doc, 'bold', px(7.5)); setTxt(doc, C.muted)
  doc.text(track('SUBJECT PERFORMANCE'), MARGIN, y + px(3))
  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(MARGIN, y + px(5.5), RIGHT, y + px(5.5))

  autoTable(doc, {
    startY: y + px(7.5),
    head: [['#', 'Subject', 'Score', 'Grade', 'Remarks']],
    body: marks.map((m, i) => {
      // A synthetic "missing subject" row from the backend: grade 'X' and
      // no marks_obtained, but NOT flagged is_absent (that's a distinct,
      // explicitly-recorded state). Give it its own score label so it never
      // reads as a blank/ungraded entry.
      const isMissing = m.grade === 'X' && !m.is_absent
      const score = isMissing ? 'MISSING' : m.is_absent ? 'ABSENT' : m.is_exempt ? 'EXEMPT' : (m.marks_obtained ?? '—')
      const grade = m.grade || (m.is_gradable ? '—' : 'NG')
      return [
        i + 1,
        m.subject_name || '—',
        score,
        grade,
        m.remarks || getRemark(m.marks_obtained, grade, m.is_absent, m.is_exempt, isMissing),
      ]
    }),

    headStyles: {
      fillColor: rgb(C.ink),
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: px(8.5),
      halign: 'center',
      cellPadding: { top: px(3.2), bottom: px(3.2), left: 2, right: 2 },
    },

    bodyStyles: {
      fontSize: px(9),
      fontStyle: 'bold',
      textColor: rgb(C.inkSoft),
      cellPadding: { top: px(2.8), bottom: px(2.8), left: 2, right: 2 },
      valign: 'middle',
    },

    columnStyles: {
      0: { cellWidth: 8,  halign: 'center', textColor: rgb(C.muted), fontSize: px(7.5), fontStyle: 'bold' },
      1: { cellWidth: 74, fontStyle: 'bold', fontSize: px(9.5) },
      2: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 52, textColor: rgb(C.muted), fontStyle: 'bold', fontSize: px(7.5) },
    },

    didParseCell(data) {
      if (data.section === 'body') {
        const raw = data.cell.raw

        if (data.column.index === 3) {
          const gc = gradeColor(raw, bands)
          if (gc) {
            data.cell.styles.textColor = rgb(gc)
            data.cell.styles.fillColor = rgb(tint(gc, 0.9))
          }
        }

        if (data.column.index === 2) {
          if (raw === 'ABSENT') {
            data.cell.styles.textColor = rgb(C.F9)
            data.cell.styles.fontStyle = 'bold'
          }
          if (raw === 'MISSING') {
            data.cell.styles.textColor = rgb(C.divX)
            data.cell.styles.fontStyle = 'bold'
          }
          if (raw === 'EXEMPT') {
            data.cell.styles.textColor = rgb(C.slate)
            data.cell.styles.fontStyle = 'bold'
          }
        }

        if (data.column.index === 2 && typeof raw === 'number') {
          const scoreColor = raw >= 80 ? C.div1 : raw >= 60 ? C.div2 : raw >= 50 ? C.div4 : raw >= 40 ? C.P8 : C.F9
          data.cell.styles.textColor = rgb(scoreColor)
        }
      }

      if (data.section === 'head') {
        if (data.column.index === 1) data.cell.styles.halign = 'left'
      }
    },

    alternateRowStyles: { fillColor: rgb(C.surface) },
    styles: { lineColor: rgb(C.rule), lineWidth: 0.1, overflow: 'ellipsize', fontStyle: 'bold' },
    margin: { left: MARGIN, right: MARGIN },
  })

  return doc.lastAutoTable.finalY + px(4)
}

function drawNextTerm(doc, card, y, scale) {
  // Not currently invoked by renderCard (the next-term date already appears
  // inline in drawResultSummary) — kept, as in the original file, for
  // parity in case a caller wires it back in.
  const px = n => n * scale
  const H = px(11), by = y

  setFill(doc, C.accentBg)
  doc.rect(MARGIN, by, CONTENT_W, H, 'F')
  setFill(doc, C.accent)
  doc.rect(MARGIN, by, px(0.6), H, 'F')

  font(doc, 'bold', px(6)); setTxt(doc, C.accent)
  doc.text(track('NEXT TERM BEGINS'), MARGIN + px(6), by + px(4.5))

  font(doc, 'bold', px(8)); setTxt(doc, C.ink)
  doc.text(card.next_term_begins || 'To Be Communicated', MARGIN + px(6), by + px(9))

  font(doc, 'bold', px(6)); setTxt(doc, C.slate)
  doc.text('Please report with all requirements on time.', RIGHT, by + px(7), { align: 'right' })

  return by + H + px(4)
}

// ── Comments (Official Remarks) ─────────────────────────────────────────────
// Class Teacher and Head Teacher panels are stacked one above the other
// (full CONTENT_W each) rather than side-by-side. Each is a quiet
// surface-fill card with a thin left accent bar — matching the visual
// language of the student/result panels above — instead of a plain
// bordered rectangle. The signature line sits to the right within each
// panel so the comment text gets a clean, wide column to itself.
function drawComments(doc, card, y, scale) {
  const px = n => n * scale

  font(doc, 'bold', px(8)); setTxt(doc, C.muted)
  doc.text(track('OFFICIAL REMARKS'), MARGIN, y + px(3))
  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(MARGIN, y + px(5.5), RIGHT, y + px(5.5))

  const panW = CONTENT_W
  let py = y + px(9)

  // Layout constants for a comment panel, in px() units.
  const TEXT_TOP       = px(15)   // panelY -> baseline of first comment line
  const LINE_H         = px(6.4)  // line spacing at the larger comment font size
  const SIG_GAP        = px(8)    // gap between last comment line and signature line
  const SIG_LABEL_GAP  = px(4)    // signature line -> "Signature" caption
  const BOTTOM_PAD     = px(5)    // caption -> bottom of panel
  const TEXT_INDENT    = px(6)    // left inset for label/comment/signature

  function drawRemarkPanel(label, comment, panelY) {
    font(doc, 'bold', px(11)); setTxt(doc, C.inkSoft)
    const lines = doc.splitTextToSize(comment || 'No comment provided.', panW - TEXT_INDENT * 2)

    const panH = TEXT_TOP + (lines.length - 1) * LINE_H + SIG_GAP + SIG_LABEL_GAP + BOTTOM_PAD

    setFill(doc, C.surface)
    doc.rect(MARGIN, panelY, panW, panH, 'F')
    setFill(doc, C.accent)
    doc.rect(MARGIN, panelY, px(0.6), panH, 'F')

    font(doc, 'bold', px(7)); setTxt(doc, C.muted)
    doc.text(track(label), MARGIN + TEXT_INDENT, panelY + px(5.5))

    setDraw(doc, C.rule); doc.setLineWidth(0.1)
    doc.line(MARGIN + TEXT_INDENT, panelY + px(8), RIGHT - px(5), panelY + px(8))

    font(doc, 'bold', px(11)); setTxt(doc, C.inkSoft)
    for (let i = 0; i < lines.length; i++) {
      doc.text(lines[i], MARGIN + TEXT_INDENT, panelY + TEXT_TOP + i * LINE_H)
    }

    // Signature line — sits directly beneath this panel's own comment text.
    const textBottom = panelY + TEXT_TOP + (lines.length - 1) * LINE_H
    const sigY    = textBottom + SIG_GAP
    const sigX    = MARGIN + TEXT_INDENT
    const sigEndX = sigX + px(48)
    setDraw(doc, C.muted); doc.setLineWidth(0.2)
    doc.line(sigX, sigY, sigEndX, sigY)
    font(doc, 'bold', px(6)); setTxt(doc, C.muted)
    doc.text('Signature', sigX, sigY + SIG_LABEL_GAP)

    return panH
  }

  const h1 = drawRemarkPanel('CLASS TEACHER', card.class_teacher_comment, py)
  py += h1 + px(5)
  const h2 = drawRemarkPanel('HEAD TEACHER', card.head_teacher_comment, py)
  py += h2

  return py + px(5)
}

// ── Grading summary ──────────────────────────────────────────────────────────
// Single box spanning the full content width (the stamp panel that used to
// sit to its right has been removed entirely). Grade and division entries
// are spaced proportionally across the full row so they don't bunch up on
// the left with dead space on the right.
function drawGradingSummary(doc, y, bands, scale) {
  const px = n => n * scale

  font(doc, 'bold', px(7.5)); setTxt(doc, C.muted)
  doc.text(track('GRADING SYSTEM'), MARGIN, y + px(3))
  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(MARGIN, y + px(5.5), RIGHT, y + px(5.5))

  const sectionY = y + px(8.5)
  const sectionH = px(27)
  const fullW = CONTENT_W

  setDraw(doc, C.rule); doc.setLineWidth(0.1)
  doc.rect(MARGIN, sectionY, fullW, sectionH, 'S')

  if (!bands?.length) {
    font(doc, 'bold', px(8)); setTxt(doc, C.muted)
    doc.text('No grading scale defined.', MARGIN + px(3), sectionY + px(11))
  } else {
    font(doc, 'bold', px(6.5)); setTxt(doc, C.muted)
    doc.text('GRADES', MARGIN + px(3.5), sectionY + px(7.5))

    const gStartX = MARGIN + px(24)
    const gEndX   = MARGIN + fullW - px(4)
    const gStep   = bands.length > 1 ? (gEndX - gStartX) / bands.length : 0
    bands.forEach((b, i) => {
      const gx = gStartX + gStep * i
      font(doc, 'bold', px(8)); setTxt(doc, b.color_hex || C.accent)
      doc.text(b.grade, gx, sectionY + px(7.5))
      font(doc, 'bold', px(6)); setTxt(doc, C.muted)
      doc.text(`${b.min_mark}–${b.max_mark}`, gx, sectionY + px(12.5))
    })

    setDraw(doc, C.rule); doc.setLineWidth(0.1)
    doc.line(MARGIN + px(2), sectionY + px(15), MARGIN + fullW - px(2), sectionY + px(15))

    const DIVS = [
      { label: 'DIV I',   range: '4–12',  color: C.div1 },
      { label: 'DIV II',  range: '13–23', color: C.div2 },
      { label: 'DIV III', range: '24–29', color: C.div3 },
      { label: 'DIV IV',  range: '30–34', color: C.div4 },
      { label: 'U',       range: '35+',   color: C.divU },
      { label: 'X',       range: 'incomplete', color: C.divX },
    ]
    font(doc, 'bold', px(6.5)); setTxt(doc, C.muted)
    doc.text('DIVS', MARGIN + px(3.5), sectionY + px(21.5))

    const dStartX = MARGIN + px(24)
    const dEndX   = MARGIN + fullW - px(4)
    const dStep   = (dEndX - dStartX) / DIVS.length
    DIVS.forEach((d, i) => {
      const dx = dStartX + dStep * i
      font(doc, 'bold', px(7.2)); setTxt(doc, d.color)
      doc.text(d.label, dx, sectionY + px(21.5))
      font(doc, 'bold', px(5.4)); setTxt(doc, C.muted)
      doc.text(d.range, dx, sectionY + px(25.5))
    })
  }

  return sectionY + sectionH + px(5)
}

// ── Footer ────────────────────────────────────────────────────────────────────
function addFooter(doc, schoolName) {
  const n  = doc.internal.getNumberOfPages()
  const ts = new Date().toLocaleDateString('en-UG', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)

    // A hairline rule and quiet caption text — the accent color is spent
    // on the result panel, not repeated as a heavy footer band.
    setDraw(doc, C.rule); doc.setLineWidth(0.15)
    doc.line(MARGIN, 290, RIGHT, 290)

    font(doc, 'bold', 5.2); setTxt(doc, C.ink)
    doc.text(schoolName || 'School', MARGIN, 294)

    font(doc, 'bold', 5); setTxt(doc, C.muted)
    doc.text(`Ledgerly School ERP   ·   Generated ${ts}`, 105, 294, { align: 'center' })
  }
}

function ensureSpace(doc, y, needed) {
  if (y + needed > 297 - FOOTER_H) { doc.addPage(); drawPageBg(doc); return MARGIN + 4 }
  return y
}

// ── Core renderer ─────────────────────────────────────────────────────────────
// Draws one full report card at the given `scale` and returns the final
// y-cursor position. Used both to measure the natural (unscaled) height of
// a card and to render it for real — the one-page guarantee below relies on
// this being the single source of truth for layout, so measuring and
// rendering never drift apart.
function layoutCard(doc, card, schoolName, attendanceData, gradeBands, scale) {
  drawPageBg(doc)

  let y = drawHeader(doc, schoolName, card.exam_name || 'Report Card', scale)
  y = drawStudentPanel(doc, card, y, scale)
  y = drawResultSummary(doc, card, gradeBands, y, scale)
  y = drawMarksTable(doc, card.marks || [], y, gradeBands, scale)

  y = ensureSpace(doc, y, 10 * scale)
  y = drawGradingSummary(doc, y, gradeBands, scale)

  // Attendance & Conduct section removed per request. `attendanceData` is
  // still accepted by the public API below (unchanged signatures) — it's
  // just no longer drawn — so existing callers don't need to change what
  // they pass in.

  y = ensureSpace(doc, y, 9 * scale)
  y = drawComments(doc, card, y, scale)

  return y
}

async function renderCard(doc, card, schoolName, attendanceData, gradeBands, newPage) {
  if (newPage) doc.addPage()

  // Pass 1 — measure: run the exact same layout function on a throwaway
  // document at scale 1 and read back the y-cursor it would have reached.
  const measureDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const naturalY = layoutCard(measureDoc, card, schoolName, attendanceData, gradeBands, 1)

  // Budget = usable page height minus the footer chrome always reserved.
  const PAGE_BUDGET = 297 - FOOTER_H - 4

  // Only shrink if it doesn't already fit — never scale content up past 1.
  let scale = Math.min(1, PAGE_BUDGET / naturalY)
  // Clamp to a legibility floor; below this a second page is fairer to the
  // reader than agate-sized type.
  scale = Math.max(0.78, scale)

  // Pass 2 — render for real at the computed scale.
  layoutCard(doc, card, schoolName, attendanceData, gradeBands, scale)

  doc.__schoolName = schoolName
  doc.__examLabel  = card.exam_name || 'Report Card'
}

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

export async function printReportCard(card, schoolName, logoUrl, gradeBands, attendanceData = null) {
  gradeBands = Array.isArray(gradeBands) ? gradeBands : []
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  await renderCard(doc, card, schoolName, attendanceData, gradeBands, false)
  addFooter(doc, schoolName)
  doc.save(`report-card-${card.student_number || card.student_id}.pdf`)
}

export async function printClassReportCards(cards, examName, className, schoolName, logoUrl, gradeBands, attendanceMap = {}) {
  if (!cards?.length) return
  gradeBands = Array.isArray(gradeBands) ? gradeBands : []

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  for (let i = 0; i < cards.length; i++) {
    await renderCard(
      doc,
      { ...cards[i], exam_name: examName },
      schoolName,
      attendanceMap[cards[i].student_id] || null,
      gradeBands,
      i > 0,
    )
  }
  addFooter(doc, schoolName)
  doc.save(`report-cards-${className.replace(/\s/g, '-')}.pdf`)
}

export async function printClassMarksheet(cards, examName, className, schoolName, subjects = [], gradeBands = []) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const M = 14, W = 297 - M * 2

  setDraw(doc, C.accent); doc.setLineWidth(0.5)
  doc.line(M, 6, 297 - M, 6)

  font(doc, 'bold', 12); setTxt(doc, C.ink)
  doc.text(schoolName || 'School', M, 13)
  font(doc, 'bold', 7); setTxt(doc, C.slate)
  doc.text(`Assessment Marksheet   ·   ${className}   ·   ${examName}`, M, 18.5)
  font(doc, 'bold', 6.5); setTxt(doc, C.muted)
  doc.text(track(`${cards.length} ENTRIES`), 297 - M, 13, { align: 'right' })

  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(M, 21, 297 - M, 21)

  const head = ['#', 'Student Name', 'Adm. No.']
  subjects.forEach(s => head.push(s.subject_name || s.name || ''))
  head.push('Agg.', 'Div.', 'Pos.')

  const body = cards.map((c, i) => {
    const row = [i + 1, `${c.first_name} ${c.last_name}`, c.student_number || '—']
    subjects.forEach(s => {
      const m = (c.marks || []).find(mk =>
        mk.subject_id === s.subject_id || mk.subject_name === (s.subject_name || s.name))
      row.push(m ? (m.grade || (m.marks_obtained ?? '—')) : '—')
    })
    // Division always taken directly from the card — never re-derived from
    // aggregate. 'X' (Incomplete) prints as-is rather than being coerced to 'U'.
    row.push(c.aggregate ?? '—', c.division || '—', c.position_in_class ?? '—')
    return row
  })

  // Fixed columns (#, Name, Adm No, Agg., Div., Pos.) take 139mm; whatever
  // remains of the usable page width (W) is split evenly across subjects.
  const FIXED_COLS_W = 8 + 55 + 28 + 16 + 18 + 14
  const subW = subjects.length ? Math.max(10, Math.floor((W - FIXED_COLS_W) / subjects.length)) : 0
  const aggColIdx = head.length - 3
  const divColIdx = head.length - 2

  autoTable(doc, {
    startY: 25,
    head: [head],
    body,
    headStyles: {
      fillColor: rgb(C.ink), textColor: [255,255,255], fontStyle: 'bold', fontSize: 7,
      cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
    },
    bodyStyles: {
      fontSize: 8, fontStyle: 'bold', textColor: rgb(C.inkSoft),
      cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', textColor: rgb(C.muted), fontStyle: 'bold' },
      1: { cellWidth: 55, fontStyle: 'bold' },
      2: { cellWidth: 28, fontStyle: 'bold' },
      ...Object.fromEntries(subjects.map((_, i) => [i+3, { cellWidth: subW, halign: 'center', fontStyle: 'bold' }])),
      [aggColIdx]: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      [divColIdx]: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      [head.length-1]: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell(data) {
      if (data.section === 'body') {
        const raw = data.cell.raw
        const isSubjectCol = data.column.index >= 3 && data.column.index < aggColIdx
        if (isSubjectCol) {
          const gc = gradeColor(raw, gradeBands)
          if (gc && gc !== C.NG) data.cell.styles.textColor = rgb(gc)
        }

        // Aggregate column: color it using the SAME row's division, not a
        // re-derivation from the aggregate value itself. This keeps the
        // aggregate and division columns visually consistent — an
        // incomplete student's aggregate is colored amber (matching
        // Division='X'), never green just because the number looks good.
        if (data.column.index === aggColIdx) {
          const rowDivision = data.row.raw[divColIdx]
          data.cell.styles.textColor = rgb(divisionInfo(rowDivision).color)
        }

        if (data.column.index === divColIdx) {
          data.cell.styles.textColor = rgb(divisionInfo(raw).color)
        }
      }
    },
    alternateRowStyles: { fillColor: rgb(C.surface) },
    styles: { lineColor: rgb(C.rule), lineWidth: 0.1, fontStyle: 'bold' },
    margin: { left: M, right: M },
  })

  const n  = doc.internal.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    setDraw(doc, C.rule); doc.setLineWidth(0.15); doc.line(M, 198, 297 - M, 198)
    font(doc, 'bold', 5.5); setTxt(doc, C.muted)
    doc.text(`${schoolName} · ${examName} · ${className}`, M, 203)
    doc.text(`Page ${i} of ${n}`, 297 - M, 203, { align: 'right' })
  }

  doc.save(`marksheet-${className.replace(/\s/g, '-')}.pdf`)
}

export function printAttendanceReport(data, title, schoolName) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  drawPageBg(doc)

  setDraw(doc, C.accent); doc.setLineWidth(0.5)
  doc.line(MARGIN, 6, RIGHT, 6)
  font(doc, 'bold', 11); setTxt(doc, C.ink)
  doc.text(schoolName || 'School', MARGIN, 13)
  font(doc, 'bold', 7); setTxt(doc, C.slate)
  doc.text(title || 'Attendance Report', MARGIN, 18.5)
  setDraw(doc, C.rule); doc.setLineWidth(0.15)
  doc.line(MARGIN, 21, RIGHT, 21)

  let startY = 26

  if (data.summary) {
    const s = data.summary
    const rate = s.attendance_percent ?? 0
    const rateColor = rate >= 90 ? C.div1 : rate >= 75 ? C.div2 : rate >= 60 ? C.div4 : C.divU
    const stats = [
      { l: 'Total', v: s.total_days ?? '—' },
      { l: 'Present', v: s.present_days ?? '—', c: C.div1 },
      { l: 'Absent', v: s.absent_days ?? '—', c: C.divU },
      { l: 'Late', v: s.late_days ?? '—', c: C.div4 },
      { l: 'Rate', v: `${rate}%`, c: rateColor },
    ]
    setDraw(doc, C.rule); doc.setLineWidth(0.15); doc.rect(MARGIN, startY, CONTENT_W, 18, 'S')
    let sx = MARGIN + 10
    stats.forEach(st => {
      font(doc, 'bold', 14); setTxt(doc, st.c || C.ink)
      doc.text(String(st.v), sx + 12, startY + 11, { align: 'center' })
      font(doc, 'bold', 5); setTxt(doc, C.muted)
      doc.text(st.l, sx + 12, startY + 16, { align: 'center' })
      sx += 36
    })
    startY += 24
  }

  if (data.daily?.length) {
    autoTable(doc, {
      startY,
      head: [['Date', 'Day', 'Status', 'Check-In', 'Check-Out', 'Remarks']],
      body: data.daily.map(d => [
        d.attendance_date || '—',
        d.attendance_date ? new Date(d.attendance_date).toLocaleDateString('en-UG', { weekday: 'short' }) : '',
        (d.status || '').toUpperCase().replace(/_/g, ' '),
        d.check_in_time  || '—',
        d.check_out_time || '—',
        d.remarks || '',
      ]),
      headStyles: { fillColor: rgb(C.ink), textColor: [255,255,255], fontStyle: 'bold', fontSize: 7.5 },
      bodyStyles: { fontSize: 8.5, fontStyle: 'bold', textColor: rgb(C.inkSoft) },
      columnStyles: {
        0: { cellWidth: 28, fontStyle: 'bold' },
        1: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
        2: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        4: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      },
      didParseCell(data) {
        if (data.section === 'body' && data.column.index === 2) {
          const m = { PRESENT: C.div1, ABSENT: C.divU, LATE: C.div4, 'HALF DAY': '#6B5B8A', EXCUSED: '#3B6B7A' }
          const c = m[data.cell.raw?.toUpperCase()]
          if (c) data.cell.styles.textColor = rgb(c)
        }
      },
      alternateRowStyles: { fillColor: rgb(C.surface) },
      styles: { lineColor: rgb(C.rule), lineWidth: 0.1, fontStyle: 'bold' },
      margin: { left: MARGIN, right: MARGIN },
    })
  }

  addFooter(doc, schoolName)
  doc.save('attendance-report.pdf')
}