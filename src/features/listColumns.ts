import type { ActivityDefinition, ActivityEntry, FieldDefinition, PartRecord } from '../domain'
import { evaluateRules, ruleContext } from '../engine'
import type { ModelRecord, TemplateRow } from '../domain'
import { formatValue } from './mywork/gridModel'
import { fieldVisibleToPersona } from './scope'

/** The two part lists an Admin can add activity-field columns to (set per field in the Builder). */
export type ListKind = 'part' | 'drill'

/** File, button and table fields have no single-cell text, so they cannot be list columns. */
export function canBeListColumn(field: FieldDefinition): boolean {
  return field.type !== 'file' && field.type !== 'button' && field.type !== 'table'
}

/** The activity's fields the Admin ticked for the list, in field order. */
export function listColumnFields(activity: ActivityDefinition, kind: ListKind, persona?: string): FieldDefinition[] {
  return activity.fields.filter(
    (f) =>
      canBeListColumn(f) &&
      // Data-only fields exist only for dashboards, so the Workspace part list (built from form entries) skips them.
      !(kind === 'part' && f.dataOnly) &&
      (kind === 'part' ? f.showInPartList === true : f.showInDrillList === true) &&
      // A vendor gets only the columns of fields they may see.
      (!persona || fieldVisibleToPersona(f, persona))
  )
}

/**
 * Display text for each column field of one part, matching the entry grid: calculated values are recomputed, a field
 * hidden by a rule reads "n/a", an empty value reads "—". A part with no entry yet, or marked Not applicable, is "—".
 */
export function listCellTexts(
  activity: ActivityDefinition,
  fields: FieldDefinition[],
  entry: ActivityEntry | undefined,
  part: PartRecord,
  milestoneMrd: string | undefined,
  row?: TemplateRow,
  model?: ModelRecord
): string[] {
  if (!entry || entry.notApplicable) return fields.map(() => '—')
  // Same shared helper as the forms. With a template row + model the planned dates are included; otherwise the MRD alone.
  const rx = row ? ruleContext(activity, row, part, entry, model) : { ...ruleContext(activity, { milestoneId: '' }, part, entry, undefined), mrd: milestoneMrd }
  const { values, states: cond } = evaluateRules(activity, { ...entry.values }, part, rx)
  return fields.map((f) => {
    if (cond[f.key]?.visible === false) return 'n/a'
    const text = formatValue(f, values[f.key])
    // C5: an overridden value shows both: the final value and the system value (details in listCellTitles).
    return f.override && !isBlankVal(values[`${f.key}__override`]) ? `${text} (overridden; system: ${String(values[`${f.key}__system`] ?? '—')})` : text
  })
}
const isBlankVal = (v: unknown) => v === undefined || v === null || v === ''

/** Tooltip text per column: "System value: … · Override: …" for an overridden calculated field, else empty. */
export function listCellTitles(
  activity: ActivityDefinition,
  fields: FieldDefinition[],
  entry: ActivityEntry | undefined,
  part: PartRecord,
  milestoneMrd: string | undefined,
  row?: TemplateRow,
  model?: ModelRecord
): string[] {
  if (!entry || entry.notApplicable) return fields.map(() => '')
  const rx = row ? ruleContext(activity, row, part, entry, model) : { ...ruleContext(activity, { milestoneId: '' }, part, entry, undefined), mrd: milestoneMrd }
  const { values } = evaluateRules(activity, { ...entry.values }, part, rx)
  return fields.map((f) =>
    f.override && !isBlankVal(values[`${f.key}__override`])
      ? `System value: ${String(values[`${f.key}__system`] ?? '—')} · Override (${f.override.role}): ${String(values[`${f.key}__override`])} · Final: ${String(values[f.key] ?? '—')}`
      : ''
  )
}


