/**
 * Row review: every row of a `table` field is decided stage by stage (e.g. PIC, then SIC, then DPM deciding on each
 * disagreed SOR point). Everything here is configuration-driven (see FieldDefinition.rowReview and TableColumn rules),
 * so any activity can use it. Pure functions, no store access.
 *
 * Reserved keys on a row:
 *   _stage   -1 / missing = with the Vendor, 0..n-1 = awaiting that stage, n = closed
 *   _outcome 'Accepted' | 'Rejected' once closed
 *   _note    { by, text } the reason a row was sent back (the Vendor sees it only when the row is back with the Vendor)
 *   _log     short trail of the decisions taken on the row
 */
import type { ActivityDefinition, ColumnCondition, ConditionNode, FieldDefinition, RowReview, RowReviewStage, TableColumn } from '../domain'
import type { PersonaId } from '../store/personaStore'

export type Row = Record<string, any>
/**
 * Evaluates a column's row rule (TableColumn.showRule / requiredRule) against one row. Supplied by the caller, which
 * knows the MRD, today and the activity settings (engine/rules.rowRuleFor). Without it, row rules are not applied.
 */
export type RowRule = (node: ConditionNode, row: Row) => boolean

const isBlank = (v: unknown) => v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim() === '')
export const matches = (c: ColumnCondition, row: Row) => c.equals.includes(String(row?.[c.column] ?? ''))

/** Table fields of the activity that have a row review chain. */
export function reviewFields(def: Pick<ActivityDefinition, 'fields'>): FieldDefinition[] {
  return def.fields.filter((f) => f.type === 'table' && f.rowReview && f.rowReview.stages.length > 0)
}

/** True when the activity has a review table that currently holds rows (so entry-level Approve / Send back do not apply). */
export function hasReviewRows(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any> | undefined): boolean {
  return reviewFields(def).some((f) => Array.isArray(values?.[f.key]) && values![f.key].length > 0)
}

/** Every column a stage fills (decision, route, comment and its extra columns). */
export function stageColumnKeys(st: RowReviewStage): string[] {
  return [...new Set([st.decisionColumn, st.routeColumn, st.commentColumn, ...st.columns].filter((k): k is string => !!k))]
}

/** Index of the stage that fills this column, or -1 when it is a Vendor (or plain) column. */
export function columnStage(rv: RowReview, key: string): number {
  return rv.stages.findIndex((s) => stageColumnKeys(s).includes(key))
}

/** -1 = with the Vendor, 0..n-1 = awaiting that stage, n = closed. */
export function rowStage(row: Row, rv: RowReview): number {
  const s = row?._stage
  if (typeof s !== 'number' || s < 0) return -1
  return Math.min(s, rv.stages.length)
}
export const isRowClosed = (row: Row, rv: RowReview) => rowStage(row, rv) >= rv.stages.length

/** Label for the status cell. The Vendor sees "Under review" instead of the internal stage names. */
export function rowStatusLabel(row: Row, rv: RowReview, persona: string): string {
  const s = rowStage(row, rv)
  if (s < 0) return row?._note ? 'Returned to Vendor' : 'With Vendor'
  if (s >= rv.stages.length) return row?._outcome === 'Rejected' ? 'Closed – Rejected' : 'Closed – Accepted'
  if (persona === 'Vendor') return 'Under review'
  if (s === 0 && row?._note) return 'Returned to PIC'
  return `With ${rv.stages[s].role}`
}

export function isRequired(col: TableColumn, row: Row, rule?: RowRule): boolean {
  if (col.requiredRule && rule && rule(col.requiredRule, row)) return true
  if (col.mandatoryMode === 'never') return false
  if (col.mandatoryMode === 'always') return true
  if (col.mandatoryMode === 'when') return !!col.requiredWhen && matches(col.requiredWhen, row)
  return !!col.required || (!!col.requiredWhen && matches(col.requiredWhen, row))
}

/** Whether the column is shown on this row to this persona. */
export function columnVisible(field: FieldDefinition, col: TableColumn, row: Row, persona: string, rule?: RowRule): boolean {
  if (col.visibleTo && !col.visibleTo.includes(persona as any)) return false
  if (col.showRule && rule && !rule(col.showRule, row)) return false
  // "Fill after accept" columns appear once the row has been accepted.
  if (col.fillAfterAccept && field.rowReview && !(isRowClosed(row, field.rowReview) && row?._outcome !== 'Rejected')) return false
  const rv0 = field.rowReview
  if (persona === 'Vendor') {
    // A reviewer's comment is shown to the Vendor on the row that reviewer sent back to them (and only there).
    if (rv0 && rowStage(row, rv0) < 0 && row?._note && rv0.stages.some((s) => s.role === row._note.by && s.commentColumn === col.key)) return true
    if (col.hiddenFromVendor) return false
    if (col.visibleWhen && !matches(col.visibleWhen, row)) return false
  } else if (col.visibleWhen && !matches(col.visibleWhen, row)) {
    return false
  }
  if (col.showWhen && !matches(col.showWhen, row)) return false
  const rv = field.rowReview
  if (rv) {
    const i = columnStage(rv, col.key)
    if (i >= 0 && rowStage(row, rv) < i && persona !== 'Admin' && rowStage(row, rv) >= 0) return false // that stage has not been reached yet
  }
  return true
}

/** Columns of the table that are visible on at least one row (used for the header). */
export function visibleColumns(field: FieldDefinition, rows: Row[], persona: string): TableColumn[] {
  const cols = field.columns ?? []
  return cols.filter((c) => {
    if (c.visibleTo && !c.visibleTo.includes(persona as any)) return false
    if (persona === 'Vendor' && c.hiddenFromVendor && !c.visibleWhen) return false
    if (rows.length === 0) return !c.showWhen && !c.visibleWhen
    return rows.some((r) => columnVisible(field, c, r, persona))
  })
}

/**
 * Whether `persona` may edit this cell now. A reviewer edits only the cells of the stage a row is awaiting them at.
 * The Vendor (or any other owner) edits while the entry is a draft or sent back, and only on rows not yet in review.
 * `entryState` is the entry's validation state ('Draft', 'Submitted', …).
 */
export function cellEditable(field: FieldDefinition, col: TableColumn, row: Row, persona: string, entryState: string | undefined, rule?: RowRule): boolean {
  if (!columnVisible(field, col, row, persona, rule)) return false
  const rv = field.rowReview
  const i = rv ? columnStage(rv, col.key) : -1
  if (rv && i >= 0) return persona === rv.stages[i].role && rowStage(row, rv) === i
  const owner = col.enteredBy ?? field.enteredBy
  if (owner === 'System' || owner !== persona) return false
  // Filled by its owner after the row was accepted, whatever the entry's state (columnVisible checked the acceptance).
  if (col.fillAfterAccept) return true
  if (rv && rowStage(row, rv) >= 0) return false // the Vendor's columns lock once the row is submitted
  return entryState === undefined || entryState === 'Draft' || entryState === 'Sent back'
}

/** Messages for required cells that `persona` owns on rows they can edit. Used before Save / Submit. */
export function missingRequiredCells(field: FieldDefinition, rows: Row[], persona: string, entryState: string | undefined, rule?: RowRule): string[] {
  const out: string[] = []
  const cols = field.columns ?? []
  rows.forEach((row, i) => {
    const miss = cols
      .filter((c) => isRequired(c, row, rule) && cellEditable(field, c, row, persona, entryState, rule) && isBlank(row[c.key]))
      .map((c) => c.label)
    if (miss.length) out.push(`${field.label} · row ${row._sl ?? i + 1}: fill ${miss.join(', ')}`)
  })
  return out
}

/** True when `persona` can type into an entry cell (not a decision stage's) on some row, e.g. the PIC writing the observations. */
export function entryCellsOpen(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any> | undefined, persona: string, entryState: string | undefined): boolean {
  return reviewFields(def).some((f) => {
    const rows: Row[] = Array.isArray(values?.[f.key]) ? values![f.key] : []
    return (f.columns ?? []).some((c) => columnStage(f.rowReview!, c.key) < 0 && rows.some((r) => cellEditable(f, c, r, persona, entryState)))
  })
}

/** True when `persona` can fill a "fill after accept" cell on some accepted row of the activity (the form then offers Save). */
export function fillAfterAcceptOpen(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any> | undefined, persona: string): boolean {
  return reviewFields(def).some((f) => {
    const rows: Row[] = Array.isArray(values?.[f.key]) ? values![f.key] : []
    return (f.columns ?? []).some((c) => c.fillAfterAccept && rows.some((r) => cellEditable(f, c, r, persona, undefined)))
  })
}

const stageIndexOfRole = (rv: RowReview, role: string, before: number) => rv.stages.findIndex((s, i) => i < before && s.role === role)

/**
 * Takes the decision `persona` has entered on a row that is awaiting them. `edits` carries the cells they typed
 * (only this stage's columns are taken from it). Returns the row after the move, or an error message.
 */
export function decideRow(field: FieldDefinition, stored: Row, persona: string, edits?: Row): { row?: Row; error?: string } {
  const rv = field.rowReview
  if (!rv) return { error: 'This table has no review chain.' }
  const i = rowStage(stored, rv)
  const n = rv.stages.length
  if (i < 0 || i >= n) return { error: 'This row is not awaiting a decision.' }
  const st = rv.stages[i]
  if (st.role !== persona) return { error: `Waiting for ${st.role}.` }

  const cols = field.columns ?? []
  const colOf = (k: string) => cols.find((c) => c.key === k)
  let row: Row = { ...stored }
  if (edits) for (const k of stageColumnKeys(st)) if (k in edits) row[k] = edits[k]

  const decision = String(row[st.decisionColumn] ?? '')
  if (!decision) return { error: `Choose ${colOf(st.decisionColumn)?.label ?? 'a decision'}.` }
  if (decision !== st.acceptValue && decision !== st.rejectValue) return { error: `“${decision}” is not a valid decision.` }

  const missing = stageColumnKeys(st)
    .map(colOf)
    .filter((c): c is TableColumn => !!c && c.key !== st.decisionColumn)
    .filter((c) => (!c.showWhen || matches(c.showWhen, row)) && isRequired(c, row) && isBlank(row[c.key]))
    .map((c) => c.label)
  if (missing.length) return { error: `Fill: ${missing.join(', ')}.` }

  // Drop values of this stage's columns that are hidden by the decision (e.g. a classification typed before switching to Reject).
  for (const k of stageColumnKeys(st)) {
    const c = colOf(k)
    if (c?.showWhen && !matches(c.showWhen, row)) delete row[k]
  }

  const noteText = st.commentColumn && !isBlank(row[st.commentColumn]) ? String(row[st.commentColumn]) : ''
  const log = [...(Array.isArray(row._log) ? row._log : []), `${st.role}: ${decision}${noteText ? ` – ${noteText}` : ''}`]
  row._log = log
  delete row._note

  const clearFrom = (from: number) => {
    stageIndexList(rv, from).forEach((s) => {
      for (const k of stageColumnKeys(rv.stages[s])) delete row[k]
    })
  }

  if (decision === st.acceptValue) {
    row._stage = i + 1
    if (i + 1 >= n) row._outcome = 'Accepted'
    return { row }
  }

  // Reject: pick the route.
  let route = st.rejectTo.length === 1 ? st.rejectTo[0] : st.rejectTo.find((r) => r.label === String(row[st.routeColumn ?? ''] ?? ''))
  if (!route) return { error: `Choose where to send it${st.routeColumn ? ` (${colOf(st.routeColumn)?.label ?? 'route'})` : ''}.` }

  if (route.to === 'Close') {
    row._stage = n
    row._outcome = 'Rejected'
    return { row }
  }
  const note = { by: st.role as string, text: noteText || '(no comment)' }
  if (route.to === 'Vendor') {
    clearFrom(0) // the whole row is decided again after the Vendor resubmits; the trail stays in _log
    row._stage = -1
    row._note = note
    if (st.commentColumn && noteText) {
      row[st.commentColumn] = noteText
    }
    delete row._outcome
    return { row }
  }
  const target = stageIndexOfRole(rv, route.to, i)
  if (target < 0) return { error: `${route.label} is not an earlier stage.` }
  clearFrom(target + 1)
  // The target stage decides again: keep what it typed, clear only its decision (and route).
  const t = rv.stages[target]
  delete row[t.decisionColumn]
  if (t.routeColumn) delete row[t.routeColumn]
  row._stage = target
  row._note = note
  delete row._outcome
  return { row }
}

function stageIndexList(rv: RowReview, from: number): number[] {
  const out: number[] = []
  for (let s = Math.max(0, from); s < rv.stages.length; s++) out.push(s)
  return out
}

/**
 * What `persona` still has to fill before submitting decisions on the rows awaiting them: a decision per row and that
 * decision's mandatory cells. Returns the rows awaiting and a one-line description of what is missing ('' when complete).
 */
export function decisionStatus(field: FieldDefinition, rows: Row[], persona: string): { awaiting: number[]; missing: string } {
  const rv = field.rowReview
  const awaiting = rowsAwaiting(field, rows, persona)
  if (!rv || awaiting.length === 0) return { awaiting, missing: '' }
  const st = rv.stages.find((s) => s.role === persona)!
  const cols = field.columns ?? []
  const colOf = (k: string) => cols.find((c) => c.key === k)
  const noDecision: string[] = []
  const incomplete: string[] = []
  for (const i of awaiting) {
    const r = rows[i]
    const sl = String(r._sl ?? i + 1)
    if (isBlank(r[st.decisionColumn])) { noDecision.push(sl); continue }
    const bad = stageColumnKeys(st)
      .map(colOf)
      .filter((c): c is TableColumn => !!c && c.key !== st.decisionColumn && (!c.showWhen || matches(c.showWhen, r)) && isRequired(c, r) && isBlank(r[c.key]))
    if (bad.length) incomplete.push(sl)
  }
  const parts: string[] = []
  if (noDecision.length) parts.push(`no decision on ${noDecision.join(', ')}`)
  if (incomplete.length) parts.push(`required cells missing on ${incomplete.join(', ')}`)
  return { awaiting, missing: parts.length ? `Missing: ${parts.join('; ')}.` : '' }
}

/** On Vendor Submit: every row still with the Vendor enters stage 0. Returns new values (unchanged object when nothing applies). */
export function startReview(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any>): Record<string, any> {
  const fields = reviewFields(def)
  if (fields.length === 0) return values
  const next = { ...values }
  for (const f of fields) {
    const rv = f.rowReview!
    if (!Array.isArray(next[f.key])) continue
    // Rows going (back) to review start clean: the reviewers decide again; the trail stays in _log.
    next[f.key] = next[f.key].map((r: Row) => {
      if (rowStage(r, rv) >= 0) return r
      const o: Row = { ...r, _stage: 0 }
      for (const st of rv.stages) for (const k of stageColumnKeys(st)) delete o[k]
      delete o._note
      return o
    })
  }
  return next
}

/**
 * The whole form sent back to the Vendor (e.g. the category counts are wrong): every row not yet closed returns to the
 * Vendor with the reviewer's note, so the Vendor corrects it and submits again; closed rows stay closed.
 */
export function returnOpenRows(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any>, by: string, text: string): Record<string, any> {
  const next = { ...values }
  for (const f of reviewFields(def)) {
    const rv = f.rowReview!
    if (!Array.isArray(next[f.key])) continue
    next[f.key] = next[f.key].map((r: Row) => (isRowClosed(r, rv) || rowStage(r, rv) < 0 ? r : { ...r, _stage: -1, _note: { by, text } }))
  }
  return next
}

/**
 * The entry's state implied by its rows once the Vendor has submitted: Sent back while any row has been returned to the
 * Vendor (so the Vendor can fix it while other rows stay in review), Submitted while any row awaits a reviewer,
 * Approved when every row is closed. Null when the activity has no rows to review.
 */
export function reviewEntryState(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any> | undefined): 'Approved' | 'Submitted' | 'Sent back' | null {
  const fields = reviewFields(def)
  let any = false, inReview = false, withVendor = false
  for (const f of fields) {
    const rv = f.rowReview!
    const rows: Row[] = Array.isArray(values?.[f.key]) ? values![f.key] : []
    for (const r of rows) {
      any = true
      const s = rowStage(r, rv)
      if (s < 0) withVendor = true
      else if (s < rv.stages.length) inReview = true
    }
  }
  if (!any) return null
  if (withVendor) return 'Sent back'
  return inReview ? 'Submitted' : 'Approved'
}

/** Roles that currently have rows to decide (for the My Work queues). */
export function waitingRoles(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any> | undefined): PersonaId[] {
  const out = new Set<PersonaId>()
  for (const f of reviewFields(def)) {
    const rv = f.rowReview!
    const rows: Row[] = Array.isArray(values?.[f.key]) ? values![f.key] : []
    for (const r of rows) {
      const s = rowStage(r, rv)
      if (s >= 0 && s < rv.stages.length) out.add(rv.stages[s].role)
    }
  }
  return [...out]
}

/** Rows (indexes) in the table that are awaiting `persona`. */
export function rowsAwaiting(field: FieldDefinition, rows: Row[], persona: string): number[] {
  const rv = field.rowReview
  if (!rv) return []
  return rows.flatMap((r, i) => {
    const s = rowStage(r, rv)
    return s >= 0 && s < rv.stages.length && rv.stages[s].role === persona ? [i] : []
  })
}

/**
 * Demo data: spreads the rows of a review table over the journey so every state is visible.
 * `state` is the entry's final state. Rows keep their Vendor columns; the reviewers' columns are filled to match.
 */
export function seedReviewRows(field: FieldDefinition, rows: Row[], state: 'Approved' | 'Submitted' | 'Draft' | 'Sent back', seed: number): Row[] {
  const rv = field.rowReview
  if (!rv) return rows
  const cols = field.columns ?? []
  const optionsOf = (k: string) => cols.find((c) => c.key === k)?.options ?? []
  const clean = (r: Row): Row => {
    const o: Row = { ...r }
    for (const st of rv.stages) for (const k of stageColumnKeys(st)) delete o[k]
    delete o._stage; delete o._outcome; delete o._note; delete o._log
    return o
  }
  const accept = (r: Row, stage: number, k: number): Row => {
    const st = rv.stages[stage]
    const o: Row = { ...r, [st.decisionColumn]: st.acceptValue }
    for (const key of st.columns) {
      const c = cols.find((x) => x.key === key)
      if (!c || (c.showWhen && !matches(c.showWhen, o))) continue
      const opts = optionsOf(key)
      o[key] = c.type === 'dropdown' && opts.length ? opts[(seed + k) % opts.length] : `${c.label} noted`
    }
    if (st.commentColumn && !(st.commentColumn in o)) o[st.commentColumn] = 'Agreed.'
    return o
  }
  return rows.map((raw, k) => {
    let r = clean(raw)
    if (state === 'Draft' || state === 'Sent back') return r
    const reachable = state === 'Approved' ? rv.stages.length : k % (rv.stages.length + 1) // Submitted: rows spread over the stages
    if (state === 'Approved' && k % 4 === 3) {
      // PIC rejects: the row closes straight away.
      const st = rv.stages[0]
      const rej = st.rejectTo[0]
      r = { ...r, [st.decisionColumn]: st.rejectValue }
      for (const key of st.columns) {
        const c = cols.find((x) => x.key === key)
        if (c?.showWhen && matches(c.showWhen, r)) r[key] = 'Not acceptable to MSIL.'
      }
      return { ...r, _stage: rej?.to === 'Close' ? rv.stages.length : 1, _outcome: 'Rejected', _log: [`${st.role}: ${st.rejectValue}`] }
    }
    for (let s = 0; s < reachable; s++) r = accept(r, s, k)
    const stage = state === 'Approved' ? rv.stages.length : reachable
    return { ...r, _stage: stage, ...(stage >= rv.stages.length ? { _outcome: 'Accepted' } : {}) }
  })
}

/** Clears every reviewer's cells and the review state of all rows (used when an entry is reset to the Vendor). */
export function resetReview(def: Pick<ActivityDefinition, 'fields'>, values: Record<string, any>): Record<string, any> {
  const fields = reviewFields(def)
  if (fields.length === 0) return values
  const next = { ...values }
  for (const f of fields) {
    const rv = f.rowReview!
    if (!Array.isArray(next[f.key])) continue
    next[f.key] = next[f.key].map((r: Row) => {
      const o: Row = { ...r }
      for (const st of rv.stages) for (const k of stageColumnKeys(st)) delete o[k]
      delete o._stage; delete o._outcome; delete o._note; delete o._log
      return o
    })
  }
  return next
}
