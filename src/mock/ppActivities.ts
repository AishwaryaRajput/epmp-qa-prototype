/**
 * The activity list, generated from "Copy of EPMP Fields.xlsx" (./epmpFields.ts, by tools/gen_epmp_fields.cjs):
 *  - PP trial: pp-1 … pp-18, tracked under the PP milestone
 *  - MPP trial: mpp-1 …, tracked under the MPP milestone
 *  - Pilot/SOP trial: sop-1 …, tracked under the SOP milestone
 * PP01–PP05, PP10 and PP11 keep their hand-built configuration (./ppFieldConfig.ts) for derived tables, validation
 * rules, NG rounds and timeline templates; every other activity takes its fields straight from the sheet.
 */
import type { ActivityDefinition, ApprovalFlow, FieldDefinition } from '../domain'
import { PP_FIELD_CONFIG } from './ppFieldConfig'
import type { PpFieldSpec } from './ppFieldConfig'
import { PP_CATALOGUE_META } from './ppCatalogueFields'
import { EPMP_ACTIVITIES } from './epmpFields'
import { EXTRA_ACTIVITIES } from './sorAdherence'
import { ACTIVITY_RULE_OVERLAY, DELAY_REASON_FIELD_KEYS, FIELD_CONFIG_OVERLAY, LATE_FIELD_VALUES, INSIGHT_FIELDS } from './ppRuleConfig'

/**
 * E-Doc: no system integration. The PIC enters the E-Doc number and picks the deviation approval status
 * (Approved / Pending / Rejected) — for every activity, including those built straight from the field sheet.
 */
export const DEVIATION_STATUS_OPTIONS = ['Approved', 'Pending', 'Rejected']
const isApprovalStatus = (s: PpFieldSpec) => (s.t ?? 'text') === 'dropdown' && /approval_status|deviation_status/.test(s.k)
const manualEdoc = (s: PpFieldSpec): PpFieldSpec =>
  s.dataOnly ? s
    : isApprovalStatus(s) && (s.src === 'edoc' || s.edocFrom) ? { ...s, by: 'PIC', src: 'manual', o: DEVIATION_STATUS_OPTIONS, edocFrom: undefined }
      : s.src === 'edoc' ? { ...s, by: 'PIC', src: 'manual', edocFrom: undefined, ...(/e_doc_number/.test(s.k) ? { t: 'text' as const } : {}) }
        : s

function toField(s0: PpFieldSpec): FieldDefinition {
  const s = manualEdoc(s0)
  return {
    key: s.k,
    label: s.l,
    type: s.t ?? 'text',
    options: s.o,
    columns: s.cols,
    derivedRows: s.derived,
    rowReview: s.rowReview,
    rowNoun: s.rowNoun,
    maxRows: s.maxRows,
    minRows: s.minRows,
    addRowsBy: s.addRowsBy,
    logRows: s.logRows || undefined,
    layout: s.layout,
    hiddenFrom: s.hiddenFrom,
    compare: s.compare,
    pivotSummary: s.pivotSummary,
    mandatory: s.req ?? false,
    enteredBy: s.by ?? 'PIC',
    visibleToVendor: s.vendor || undefined,
    dataOnly: s.dataOnly || undefined,
    countRows: s.countRows,
    sumRows: s.sumRows,
    source: s.src ?? 'manual',
    validatedBy: s.val ? 'PIC' : null,
    showOnDashboard: s.dash ?? false,
    showInPartList: s.list || undefined,
    conditionalRules: s.rules,
    rules: s.frules,
    calc: s.calc,
    notifyOnChange: s.notify,
    override: s.override,
    reasonRemark: s.reasonRemark,
    section: s.section,
    alsoEditableBy: s.alsoBy,
    optionsFrom: s.optionsFrom,
    alwaysEditable: s.alwaysEditable || undefined,
    edocFrom: s.edocFrom,
    isDelayReason: DELAY_REASON_FIELD_KEYS.includes(s.k) || undefined,
    lateWhen: LATE_FIELD_VALUES[s.k],
    insight: INSIGHT_FIELDS[s.k],
    hiddenFromForm: s.hidden || undefined,
    autoFetch: s.autoFetch || undefined,
    searchable: s.search || undefined
  }
}

const FLOW_VENDOR_PIC: ApprovalFlow = {
  steps: [
    { stepIndex: 0, role: 'Vendor', label: 'Vendor Entry', allowedOutcomes: ['Submit'] },
    { stepIndex: 1, role: 'PIC', label: 'PIC Validation', allowedOutcomes: ['Approve', 'Edit', 'Send back'] }
  ]
}
const FLOW_PIC: ApprovalFlow = {
  steps: [{ stepIndex: 0, role: 'PIC', label: 'PIC Confirmation', allowedOutcomes: ['Approve', 'Edit'] }]
}

/** Activity names after the configured renames (PpActivityConfig.name). */
const nameOf = (id: string, sheetName: string) => PP_FIELD_CONFIG[id]?.name ?? sheetName
const RENAMED = new Map(EPMP_ACTIVITIES.filter((a) => nameOf(a.id, a.name) !== a.name).map((a) => [a.name, nameOf(a.id, a.name)]))
/** Option lists that name activities (e.g. "Applicable activities for special part") follow the renames. */
const renameOptions = (s: PpFieldSpec): PpFieldSpec => (s.o?.some((o) => RENAMED.has(o)) ? { ...s, o: s.o.map((o) => RENAMED.get(o) ?? o) } : s)

export const PP_ACTIVITIES: ActivityDefinition[] = EPMP_ACTIVITIES.map((spec) => {
  const id = spec.id
  const cfg = PP_FIELD_CONFIG[id]
  const overlay = FIELD_CONFIG_OVERLAY[id] ?? {}
  const fields = (cfg?.fields ?? spec.fields).map((s) => toField(renameOptions(overlay[s.k] ? { ...s, ...overlay[s.k] } : s)))
  const act = ACTIVITY_RULE_OVERLAY[id]
  // The Vendor is in the flow only when a field on the input form is theirs (data-only fields are never on a form).
  const anyVendor = fields.some((x) => !x.dataOnly && (x.enteredBy === 'Vendor' || x.validatedBy === 'PIC'))
  const legacy = id.startsWith('pp-') ? PP_CATALOGUE_META[`PP${id.slice(3).padStart(2, '0')}`] : undefined
  return {
    id,
    name: nameOf(id, spec.name),
    scope: spec.scope,
    ownerPersona: 'PIC',
    description: legacy?.desc ?? `${nameOf(id, spec.name)}. Tracked under ${spec.milestone}; fields come from the EPMP field specification.`,
    allowNotApplicable: true,
    allowVendorPlannedTimeline: (cfg?.vendorTimeline ?? false) || undefined,
    deviationFlow: ['PIC', 'SIC', 'DPM'],
    trackNgRounds: cfg?.trackNgRounds || undefined,
    timelineTemplate: cfg?.timelineTemplate,
    canReferenceOtherActivities: cfg?.canReferenceOtherActivities || undefined,
    published: true,
    fields,
    validationRules: cfg?.validationRules,
    parameters: cfg?.parameters ?? act?.parameters,
    groupReviews: cfg?.groupReviews ?? act?.groupReviews,
    deviation: cfg?.deviation ?? act?.deviation,
    delayPopup: cfg?.delayPopup,
    showApplicability: cfg?.showApplicability || undefined,
    lockWhen: cfg?.lockWhen,
    testScenarios: cfg?.testScenarios,
    flow: anyVendor ? FLOW_VENDOR_PIC : FLOW_PIC
  }
})

/** The milestone each activity is tracked under (PP, MPP or SOP). */
export const ACTIVITY_MILESTONE: Record<string, string> = Object.fromEntries([
  ...EPMP_ACTIVITIES.map((a) => [a.id, a.milestone]),
  ...EXTRA_ACTIVITIES.map((x) => [x.def.id, x.milestone])
])

/** Every seed activity: the EPMP field-sheet activities, then those configured outright (e.g. SOR Adherence). */
export const ALL_BLUEPRINTS = [...PP_ACTIVITIES, ...EXTRA_ACTIVITIES.map((x) => x.def)]


