/**
 * C9 · Stage pattern macro. Writes ordinary fields + C2 / C3 / C4 rules for a "Plan / Actual / Status" stage.
 * It is only a config generator: the Builder button and the seed data call it, and the result is edited like any other field.
 *  - 'range'  : Planned Start / End, Actual Start / End, auto Status (Pending → Started → Completed), Delay remark.
 *  - 'single' : Planned Date, Actual Date, auto Status (Pending → Done), Delay remark.
 * Status (actual dates only): actual start filled and end blank = Started; actual start and end filled = Completed;
 * ELSE Pending (so an end date without a start is Pending). Planned dates never change the status. The stage's checks
 * block a future actual date, an end before the start and an end without a start.
 */
import type { FieldDefinition, ValidationRule } from './index'
import type { PersonaId } from '../store/personaStore'
import { AND, F, OR, blank, filled, ge, gt, val } from './ruleDsl'

export interface StageMacroOptions {
  /** Key prefix and base of the labels, e.g. `tool_cutting` / "Tool Cutting". */
  prefix: string
  label: string
  kind: 'range' | 'single'
  section?: string
  /** Who enters planned / actual dates. */
  filler?: PersonaId
  /** Roles told when a planned date changes. */
  notifyRoles?: PersonaId[]
  /** Status words (defaults: Pending / Started / Completed, or Pending / Done). */
  statusWords?: string[]
}

const mk = (o: Partial<FieldDefinition> & { key: string; label: string }): FieldDefinition => ({
  type: 'text',
  mandatory: false,
  enteredBy: 'Vendor',
  source: 'manual',
  validatedBy: null,
  showOnDashboard: false,
  ...o
})

export function buildStage(o: StageMacroOptions): { fields: FieldDefinition[]; validationRules: ValidationRule[] } {
  const by = o.filler ?? 'Vendor'
  const notify = o.notifyRoles ?? ['PIC']
  const sec = o.section
  const k = (s: string) => `${o.prefix}_${s}`
  const date = (key: string, label: string, planned: boolean) =>
    mk({ key: k(key), label: `${o.label} ${label}`, type: 'date', enteredBy: by, validatedBy: 'PIC', section: sec, ...(planned ? { notifyOnChange: { roles: notify } } : {}) })
  const ids = (s: string) => `${o.prefix}-${s}`
  const rules: ValidationRule[] = []
  const base = { scope: 'fields' as const, left: [], right: [] }
  const fields: FieldDefinition[] = []

  if (o.kind === 'range') {
    const words = o.statusWords ?? ['Pending', 'Started', 'Completed']
    fields.push(
      date('planned_start_date', 'Planned Start Date', true),
      date('planned_end_date', 'Planned End Date', true),
      date('actual_start_date', 'Actual Start Date', false),
      date('actual_end_date', 'Actual End Date', false),
      mk({
        key: k('status'), label: `${o.label} Status`, type: 'dropdown', options: words, enteredBy: 'System', source: 'calculated', section: sec, visibleToVendor: true,
        calc: {
          rules: [
            { when: AND(filled(F(k('actual_start_date'))), blank(F(k('actual_end_date')))), value: val(words[1]) },
            { when: AND(filled(F(k('actual_start_date'))), filled(F(k('actual_end_date')))), value: val(words[2]) }
          ],
          else: val(words[0])
        }
      }),
      mk({
        key: k('delay_remark'), label: `${o.label} Delay Remark`, type: 'longText', enteredBy: by, validatedBy: 'PIC', section: sec,
        rules: [
          { when: OR(gt(F(k('actual_start_date')), F(k('planned_start_date'))), gt(F(k('actual_end_date')), F(k('planned_end_date')))), action: 'show' },
          { when: OR(gt(F(k('actual_start_date')), F(k('planned_start_date'))), gt(F(k('actual_end_date')), F(k('planned_end_date')))), action: 'makeMandatory' }
        ]
      })
    )
    rules.push(
      { ...base, id: ids('plan-order'), op: '>=', type: 'compare', field: k('planned_end_date'), compareTo: F(k('planned_start_date')), message: `${o.label}: Planned End must be on or after Planned Start` },
      { ...base, id: ids('as-future'), op: '<=', type: 'notFuture', field: k('actual_start_date'), message: `${o.label}: Actual Start cannot be in the future` },
      { ...base, id: ids('ae-future'), op: '<=', type: 'notFuture', field: k('actual_end_date'), message: `${o.label}: Actual End cannot be in the future` },
      { ...base, id: ids('ae-needs-as'), op: '=', type: 'requires', field: k('actual_end_date'), requiresField: k('actual_start_date'), message: `${o.label}: enter Actual Start before Actual End` },
      { ...base, id: ids('ae-order'), op: '>=', type: 'compare', field: k('actual_end_date'), compareTo: F(k('actual_start_date')), message: `${o.label}: Actual End must be on or after Actual Start` }
    )
  } else {
    const words = o.statusWords ?? ['Pending', 'Done']
    fields.push(
      date('planned_date', 'Planned Date', true),
      date('actual_date', 'Actual Date', false),
      mk({
        key: k('status'), label: `${o.label} Status`, type: 'dropdown', options: words, enteredBy: 'System', source: 'calculated', section: sec, visibleToVendor: true,
        calc: { rules: [{ when: filled(F(k('actual_date'))), value: val(words[1]) }], else: val(words[0]) }
      }),
      mk({
        key: k('delay_remark'), label: `${o.label} Delay Remark`, type: 'longText', enteredBy: by, validatedBy: 'PIC', section: sec,
        rules: [
          { when: gt(F(k('actual_date')), F(k('planned_date'))), action: 'show' },
          { when: gt(F(k('actual_date')), F(k('planned_date'))), action: 'makeMandatory' }
        ]
      })
    )
    rules.push({ ...base, id: ids('a-future'), op: '<=', type: 'notFuture', field: k('actual_date'), message: `${o.label}: Actual Date cannot be in the future` })
  }
  // `ge` is re-exported for callers that extend the generated rules.
  void ge
  return { fields, validationRules: rules }
}
