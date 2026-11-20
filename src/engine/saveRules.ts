/**
 * One shared validation step for EVERY save path (part form, My Work, grids, bulk entry, part workspace, store guard).
 * Order of evaluation (documented in the design note): calculations → field states (visible / mandatory / read-only) →
 * mandatory fields → sum rules → field checks → change-reason (C4) → override-removes-deviation remark (C5).
 * Nothing here knows an activity id or a field key.
 */
import type { ActivityDefinition, ActivityEntry, GroupReview, ModelRecord, PartRecord, TemplateRow } from '../domain'
import {
  canEditField, detectNotifyChanges, evaluateFieldChecks, evaluateFieldStates, fieldMissing, groupFieldKeys, isBlank, overrideRemovesDeviation, ruleExtra,
  isBlankExtraRow,
} from './rules'
import type { FieldState, RuleExtra } from './rules'
import { evaluateCalculatedFields, evaluateValidationRules, getMilestoneMrd, resolveTrackedDates } from './index'

export interface SaveIssue {
  field?: string
  ruleId?: string
  message: string
  severity: 'block' | 'warn'
}

/**
 * THE rule context. Always carries MRD, the part, planned start / end, the activity's settings and the review state,
 * so every screen evaluates rules identically.
 */
export function ruleContext(
  activity: ActivityDefinition,
  row: Pick<TemplateRow, 'milestoneId'> & Partial<TemplateRow>,
  part: PartRecord | undefined,
  entry: Pick<ActivityEntry, 'groupReviews' | 'vendorTimeline'> & { values?: Record<string, any> } | undefined,
  model: ModelRecord | undefined,
  today?: string
): RuleExtra {
  const mrd = getMilestoneMrd(model, row.milestoneId)
  const dates = row.id ? resolveTrackedDates(row as TemplateRow, model, entry as ActivityEntry | undefined, activity, part) : undefined
  return {
    ...ruleExtra(activity, entry, {
      mrd,
      part,
      today,
      plannedStart: dates?.status === 'resolved' ? dates.start : undefined,
      plannedEnd: dates?.status === 'resolved' ? dates.end : undefined
    }),
    savedValues: entry?.values
  }
}

/** Calculations first (so a calculated value is current), then visibility / mandatory / read-only. */
export function evaluateRules(
  activity: ActivityDefinition,
  values: Record<string, any>,
  part: PartRecord | undefined,
  extra: RuleExtra
): { values: Record<string, any>; states: Record<string, FieldState> } {
  const calc = part ? evaluateCalculatedFields(activity, values, part, extra.mrd, extra.today, extra) : { ...values }
  const states = evaluateFieldStates(activity.fields, calc, { ...extra, def: activity })
  return { values: calc, states }
}

/** Keeps the issues that concern the fields this save touches (a bulk fill is not blocked by an unrelated, older problem). */
export function issuesForTouched(issues: SaveIssue[], touched: Iterable<string>): SaveIssue[] {
  const t = new Set(touched)
  return issues.filter((i) => i.severity === 'block' && (!i.field || t.has(i.field) || t.has(i.field.replace(/__(reason|override_remark|override)$/, ''))))
}

export interface ValidateSaveOpts {
  persona: string
  /** Keys the user is changing in this save (used for the reason / remark checks). */
  changedKeys?: string[]
  /** Also require every visible, mandatory field the persona can edit (submit / form save). */
  mandatory?: boolean
  /** Restrict mandatory + checks to these keys (a review loop). */
  onlyKeys?: string[]
  fieldVisible?: (f: ActivityDefinition['fields'][number]) => boolean
}

export function validateSave(
  activity: ActivityDefinition,
  entry: Pick<ActivityEntry, 'values' | 'validationState' | 'groupReviews'> | undefined,
  merged: Record<string, any>,
  part: PartRecord | undefined,
  extra: RuleExtra,
  opts: ValidateSaveOpts
): { issues: SaveIssue[]; values: Record<string, any>; states: Record<string, FieldState> } {
  const { values, states } = evaluateRules(activity, { ...merged }, part, extra)
  const issues: SaveIssue[] = []
  const only = opts.onlyKeys ? new Set(opts.onlyKeys) : undefined
  const inGroup = new Set((activity.groupReviews ?? []).flatMap((g) => groupFieldKeys(activity, g)))
  // A review loop's fields are the filler's job (checked when the loop is submitted): they never block another role's save.
  const othersLoop = new Set((activity.groupReviews ?? []).filter((g) => g.fillerRole !== opts.persona).flatMap((g) => groupFieldKeys(activity, g)))
  const vis: Record<string, { visible: boolean }> = {}
  for (const f of activity.fields) vis[f.key] = { visible: states[f.key]?.visible !== false && (opts.fieldVisible ? opts.fieldVisible(f) : true) }

  if (opts.mandatory) {
    for (const f of activity.fields) {
      if (f.dataOnly || (only && !only.has(f.key)) || (!only && othersLoop.has(f.key))) continue
      const st = states[f.key]
      if (!st?.visible || !st.mandatory) continue
      if (!canEditField(f, opts.persona, entry, st, inGroup.has(f.key))) continue
      const m = fieldMissing(f, values[f.key], opts.persona)
      if (m) issues.push({ field: f.key, message: m, severity: 'block' })
    }
    // Required columns of a plain table (e.g. a reason per rejected item): every row the persona fills needs them.
    // Tables reviewed row by row check their cells per stage instead (engine/rowReview.missingRequiredCells).
    for (const f of activity.fields) {
      if (f.type !== 'table' || f.rowReview || f.dataOnly || (only && !only.has(f.key))) continue
      const st = states[f.key]
      if (st?.visible === false || !vis[f.key]?.visible || !canEditField(f, opts.persona, entry, st, inGroup.has(f.key))) continue
      const rows: Record<string, any>[] = Array.isArray(values[f.key]) ? values[f.key] : []
      const req = (f.columns ?? []).filter((c) => c.required && (c.enteredBy ?? f.enteredBy) === opts.persona)
      const bad = rows.map((r, i) => ({ sl: r?._sl ?? i + 1, miss: isBlankExtraRow(f, r, i) ? [] : req.filter((c) => isBlank(r?.[c.key])).map((c) => (c.group ? `${c.group} ${c.label}` : c.label)) })).filter((x) => x.miss.length)
      if (bad.length) issues.push({ field: f.key, message: `${f.label}: fill ${bad[0].miss.join(', ')} on row ${bad.map((x) => x.sl).join(', ')}`, severity: 'block' })
    }
  }
  if (!only) {
    for (const v of evaluateValidationRules(activity, values, vis)) issues.push({ ruleId: v.ruleId, message: v.message, severity: 'block' })
  }
  for (const v of evaluateFieldChecks(activity, values, extra, vis)) {
    if (only && !only.has(v.field)) continue
    issues.push({ field: v.field, ruleId: v.ruleId, message: v.message, severity: v.severity })
  }
  // C4: a change to a notify-on-change field that asks for a reason needs one.
  for (const f of activity.fields) {
    const n = f.notifyOnChange
    if (!n?.requireReason || !entry || (only && !only.has(f.key))) continue
    const before = entry.values[f.key]
    if (!isBlank(before) && JSON.stringify(before) !== JSON.stringify(values[f.key]) && isBlank(String(values[`${f.key}__reason`] ?? '').trim())) {
      issues.push({ field: `${f.key}__reason`, message: `Give a reason for changing ${f.label}`, severity: 'block' })
    }
  }
  // C5: an override that removes a deviation requirement is audited, needs a remark (or is refused when the Admin said so).
  for (const f of overrideRemovesDeviation(activity, values, extra)) {
    if (f.override?.allowRemoveDeviation === false) {
      issues.push({ field: `${f.key}__override`, message: `${f.label}: this override would remove the deviation requirement and is not allowed`, severity: 'block' })
    } else if (isBlank(String(values[`${f.key}__override_remark`] ?? '').trim())) {
      issues.push({ field: `${f.key}__override_remark`, message: `${f.label}: give a remark — this override removes the deviation requirement`, severity: 'block' })
    }
  }
  return { issues, values, states }
}

/** Blocking failures of the checks that concern one review loop's fields (used by Submit / Resubmit). */
export function groupCheckIssues(
  activity: ActivityDefinition,
  g: GroupReview,
  values: Record<string, any>,
  part: PartRecord | undefined,
  extra: RuleExtra
): SaveIssue[] {
  const keys = groupFieldKeys(activity, g)
  const { values: v, states } = evaluateRules(activity, { ...values }, part, extra)
  const vis: Record<string, { visible: boolean }> = {}
  for (const f of activity.fields) vis[f.key] = { visible: states[f.key]?.visible !== false }
  return evaluateFieldChecks(activity, v, extra, vis)
    .filter((x) => keys.includes(x.field) && x.severity === 'block')
    .map((x) => ({ field: x.field, ruleId: x.ruleId, message: x.message, severity: x.severity }))
}

/** Fields of a save that changed notify-on-change values (re-exported helper for stores). */
export { detectNotifyChanges }
