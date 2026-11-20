/**
 * SOR Adherence (MPP) — seed configuration only. Everything here is an ordinary Activity Builder setting:
 *  - Adherence summary: categories + Agreed / Disagreed totals pulled from the PP SOR activity (derivedRows 'activity',
 *    column map), the Vendor's split per category, two "A + B = Total" checks on every row.
 *  - Three point tables generated from the split counts (derivedRows 'count'), the target date flagged red after MRD
 *    (column warn), the PIC's Classification hidden from the Vendor.
 *  - Conversion snapshot: calculated tiles (CalcValue 'aggregate' / 'percent'), not shown to the Vendor, on dashboards.
 * The engine and screens never name this activity or its fields.
 */
import type { ActivityDefinition, CalcSpec, FieldDefinition, TableColumn } from '../domain'
import { MRD, F, gt } from '../domain/ruleDsl'

export const SOR_ADHERENCE_ID = 'mpp-12'
const PP_SOR = { activityId: 'pp-3', fieldKey: 'sor_categories' }
const CLASSIFICATIONS = ['Alt Control', 'Not Feasible', 'Denial', 'Cost Up']

const base = { mandatory: false, source: 'manual', validatedBy: 'PIC', showOnDashboard: false } as const
const num = (key: string, label: string, group: string, pulled = false): TableColumn => ({
  key, label, type: 'number', group, ...(pulled ? { enteredBy: 'System' as const } : { required: true })
})
const category: TableColumn = { key: 'sor_category', label: 'SOR category', type: 'text', enteredBy: 'System' }
const point: TableColumn = { key: 'sor_point', label: 'SOR point', type: 'longText', required: true }
const delay: TableColumn = { key: 'delay_reason', label: 'Delay reason', type: 'longText', required: true }
const target: TableColumn = {
  key: 'target_date', label: 'Target date', type: 'date', required: true,
  warn: { when: gt(F('target_date'), MRD), message: 'Target date is after MRD' }
}
const classification: TableColumn = {
  key: 'classification', label: 'Classification', type: 'dropdown', options: CLASSIFICATIONS, enteredBy: 'PIC', hiddenFromVendor: true, required: true
}
const fromCount = (countColumn: string) => ({ from: 'count' as const, fieldKey: 'adherence_summary', countColumn, labelColumn: 'sor_category', targetLabelColumn: 'sor_category' })
const table = (key: string, label: string, columns: TableColumn[], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  ...base, key, label, type: 'table', enteredBy: 'Vendor', section: label, mandatory: true, columns, ...extra
})
const calc = (v: CalcSpec['else']): CalcSpec => ({ rules: [], else: v })
const SNAPSHOT = 'Conversion snapshot'
const tile = (key: string, label: string, type: FieldDefinition['type'], c: CalcSpec, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  ...base, key, label, type, enteredBy: 'System', source: 'calculated', validatedBy: null, section: SNAPSHOT, visibleToVendor: false,
  calc: c, tile: {}, showOnDashboard: true, ...extra
})

const fields: FieldDefinition[] = [
  table('adherence_summary', 'Adherence summary', [
    category,
    num('agreed_total', 'Total', 'Agreed at PP', true),
    num('agreed_impl', 'Implemented', 'Agreed at PP'),
    num('agreed_under', 'Under impl.', 'Agreed at PP'),
    num('disagreed_total', 'Total', 'Disagreed at PP', true),
    num('disagreed_impl', 'Implemented', 'Disagreed at PP'),
    num('disagreed_under', 'Under impl.', 'Disagreed at PP'),
    num('disagreed_not_impl', 'Not impl.', 'Disagreed at PP')
  ], {
    derivedRows: { from: 'activity', ...PP_SOR, columns: { sor_category: 'sor_category_name', agreed_total: 'agree', disagreed_total: 'disagree' } }
  }),
  table('agreed_under_points', 'Agreed points: under implementation', [category, point, delay, target], { derivedRows: fromCount('agreed_under'), rowNoun: 'point' }),
  table('disagreed_under_points', 'Disagreed points: under implementation', [category, point, delay, target, classification], { derivedRows: fromCount('disagreed_under'), rowNoun: 'point' }),
  table('disagreed_impl_points', 'Disagreed points: implemented', [category, point, classification], { derivedRows: fromCount('disagreed_impl'), rowNoun: 'point' }),
  // Conversion snapshot (not the Vendor's): calculated live; helper totals are planned (hidden) fields.
  tile('converted_points', 'Disagreed → Agreed', 'number',
    calc({ kind: 'aggregate', fn: 'sum', sources: [{ table: 'adherence_summary', column: 'disagreed_impl' }, { table: 'adherence_summary', column: 'disagreed_under' }] }),
    { tile: { secondary: 'conversion_pct', suffix: '%' } }),
  tile('converted_by_classification', 'Converted points by classification', 'text',
    calc({ kind: 'aggregate', fn: 'countBy', sources: [{ table: 'disagreed_under_points', column: 'classification' }, { table: 'disagreed_impl_points', column: 'classification' }] }),
    { showOnDashboard: false }),
  tile('points_under_impl', 'Total points under implementation', 'number',
    calc({ kind: 'aggregate', fn: 'sum', sources: [{ table: 'adherence_summary', column: 'agreed_under' }, { table: 'adherence_summary', column: 'disagreed_under' }] })),
  tile('points_after_mrd', 'Points with target date after MRD', 'number',
    calc({ kind: 'aggregate', fn: 'count', sources: [{ table: 'agreed_under_points' }, { table: 'disagreed_under_points' }], where: gt(F('target_date'), MRD) })),
  tile('disagreed_total_all', 'Disagreed total', 'number',
    calc({ kind: 'aggregate', fn: 'sum', sources: [{ table: 'adherence_summary', column: 'disagreed_total' }] }),
    { tile: undefined, hiddenFromForm: true, showOnDashboard: false }),
  tile('conversion_pct', 'Disagreed → Agreed %', 'number',
    calc({ kind: 'percent', part: 'converted_points', total: 'disagreed_total_all', decimals: 0 }),
    { tile: undefined, hiddenFromForm: true, kpiRole: 'percentage' })
]

export const SOR_ADHERENCE: ActivityDefinition = {
  id: SOR_ADHERENCE_ID,
  name: 'SOR Adherence',
  scope: 'Both',
  ownerPersona: 'PIC',
  description: 'SOR Adherence at MPP: the PP SOR points, implemented / under implementation, and their conversion.',
  allowNotApplicable: true,
  deviationFlow: ['PIC', 'SIC', 'DPM'],
  published: true,
  fields,
  validationRules: [
    { id: 'sora-agreed', scope: { tableField: 'adherence_summary' }, left: ['agreed_impl', 'agreed_under'], op: '=', right: ['agreed_total'], message: 'Agreed: Implemented + Under impl. ({left}) must equal Total ({right})' },
    { id: 'sora-disagreed', scope: { tableField: 'adherence_summary' }, left: ['disagreed_impl', 'disagreed_under', 'disagreed_not_impl'], op: '=', right: ['disagreed_total'], message: 'Disagreed: Implemented + Under impl. + Not impl. ({left}) must equal Total ({right})' }
  ],
  flow: {
    steps: [
      { stepIndex: 0, role: 'Vendor', label: 'Vendor Entry', allowedOutcomes: ['Submit'] },
      { stepIndex: 1, role: 'PIC', label: 'PIC Validation', allowedOutcomes: ['Approve', 'Edit', 'Send back'] }
    ]
  }
}
/** Activities configured outright (not from the EPMP field sheet), with the milestone they are tracked under. */
export const EXTRA_ACTIVITIES: { def: ActivityDefinition; milestone: string }[] = [{ def: SOR_ADHERENCE, milestone: 'MPP' }]
