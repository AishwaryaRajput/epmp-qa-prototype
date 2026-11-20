/**
 * Rule configuration as DATA for activities that use the generic rule engine (src/engine/rules.ts):
 *  - the calculations that used to be hard-coded `if (def.id === …)` branches in the engine (pp-1, pp-2, pp-10, pp-11, mpp-1),
 *  - the E-Doc deviation trigger of sop-1 (formerly a hard-coded pop-up condition in the part drawer),
 *  - pp-9 (OT status), built with the stage macro plus C1–C8 rules.
 * Nothing here is logic: every entry is the same JSON the Activity Builder edits.
 */
import type { MasterList, TableColumn, TestScenario } from '../domain'
import { DELAY_REASON_CATEGORIES } from '../domain'
import { AND, MRD, OFFSET, OR, anyRow, blank, eq, filled, F, gt, K, le, ne, val } from '../domain/ruleDsl'
import { buildStage } from '../domain/stageMacro'
import type { PpActivityConfig, PpFieldSpec } from './ppFieldConfig'

// ── Master lists (managed in Governance → Master lists) ───────────────────────────────────────────────────────────
/** OT status field sheet: reasons for a delay (slip past the vendor's own plan, still on or before MRD). */
export const OT_DELAY_REASONS = [
  'ECN case',
  'Tool maker selection delay',
  'Tool go-ahead delay (MSIL)',
  'Tool go-ahead delay (Vendor)',
  'Design finalization delay (Vendor internal)',
  'Tool maturation delay',
  'Others'
]
/** OT status field sheet: reasons for Non-OT (beyond MRD) — the delay reasons plus the system target-date case. */
/** Homologation marking: reasons for delay (the vendor or PIC also writes a free-text remark). */
export const HOMOLOG_DELAY_REASONS = ['Camera already planned but delay in implementation', 'SC approval pending', 'SC approved, vendor implementation pending']
export const NON_OT_REASONS = [...OT_DELAY_REASONS.slice(0, -1), 'OT plan date > system defined target date', 'Others']
export const SEED_MASTER_LISTS: MasterList[] = [
  { id: 'delay-reasons', name: 'Delay reasons', items: OT_DELAY_REASONS },
  { id: 'non-ot-reasons', name: 'Non-OT reasons', items: NON_OT_REASONS },
  { id: 'delay-categories', name: 'Delay categories (delay pop-up)', items: [...DELAY_REASON_CATEGORIES] },
  { id: 'homologation-delay-reasons', name: 'Homologation delay reasons', items: HOMOLOG_DELAY_REASONS }
]

/** Fields that hold a delay reason (Lessons → "top delay reason"). Config flag `isDelayReason` on the field, set here for the seeded sheet keys. */
export const DELAY_REASON_FIELD_KEYS = ['non_otop_reason', 'delay_reason', 'ot_delay_reason', 'otop_delay_reason']
/** Fields that feed the Lessons-learnt track record (FieldDefinition.insight), by seeded sheet key. */
export const INSIGHT_FIELDS: Record<string, import('../domain').FieldInsight> = {
  inspection_status: { kind: 'result', ngValue: 'NG' },
  status: { kind: 'result', ngValue: 'NG' },
  bcf_status: { kind: 'result', ngValue: 'NG' },
  audit_status: { kind: 'result', ngValue: 'NG' },
  ng_dropdown: { kind: 'ngCategory' },
  ng_category: { kind: 'ngCategory' },
  ng_rows: { kind: 'ngCategory', column: 'cat' },
  otop_status: { kind: 'onTime', onValue: 'OTOP', missValue: 'Non-OTOP' }
}
/** Fields whose value (compared as text) marks the part as late / beyond MRD. Config flag `lateWhen`. */
export const LATE_FIELD_VALUES: Record<string, string> = { actual_date_beyond_mrd: 'Y', correction_beyond_mrd: 'true' }

// ── Calculations moved out of the engine (identical behaviour) ───────────────────────────────────────────────────────
/** Field-level config merged onto the generated field list: activityId → field key → config. */
export const FIELD_CONFIG_OVERLAY: Record<string, Record<string, Partial<PpFieldSpec>>> = {
  // Target date – MSIL drawing = the milestone MRD; blank while the MRD is blank.
  'pp-1': { target_date_msil_drawing: { calc: { rules: [{ when: filled(MRD), value: { kind: 'operand', operand: MRD } }] } } },
  // Accuracy % = OK ÷ total × 100, one decimal; blank until total > 0 and OK is entered.
  'pp-10': { accuracy: { calc: { rules: [], else: { kind: 'percent', part: 'ok_parameters', total: 'total_parameters', decimals: 1 } } } },
  // A correction timeline later than the MRD is flagged.
  'pp-11': { correction_beyond_mrd: { calc: { rules: [{ when: AND(filled(MRD), anyRow('ng_rows', gt(F('date'), MRD))), value: val(true) }], else: val(false) } } },
}

/** Activity-level rule config for generated activities (deviation trigger of sop-1, previously a hard-coded pop-up). */
export const ACTIVITY_RULE_OVERLAY: Record<string, Pick<PpActivityConfig, 'deviation' | 'parameters' | 'groupReviews'>> = {
  'sop-1': {
    deviation: {
      when: AND(filled(F('actual_otop_date')), filled(MRD), gt(F('actual_otop_date'), MRD)),
      title: 'Deviation — Actual date beyond MRD',
      message: 'The actual date is beyond the MRD. A deviation E-Doc is required: enter the E-Doc number and the deviation approval status.',
      edocField: 'e_doc_number',
      statusField: 'deviation_approval_status',
      enteredBy: 'PIC',
      fetchStatus: false,
      manualStatus: true
    }
  }
}

// ── pp-9 · OT status (configuration only) ─────────────────────────────────────────────────────────────────────────────
// Everything below is the same JSON the Activity Builder edits; the engine (src/engine/rules.ts) knows no OT field.
const S1 = '1 · Tool Go-Ahead'
const S2 = '2 · Tool Cutting'
const S3 = '3 · Tool Assembly'
const S4 = '4 · Tool Trial'
const S5 = '5 · OT status'
const S5N = '5 · Non-OT reason and target date (PIC review)'
const S6 = '6 · PIC verification'
const S7V = '7 · Vendor action plan (PIC review)'
const S8 = '8 · Deviation'

const cutting = buildStage({ prefix: 'tool_cutting', label: 'Tool Cutting', kind: 'range', section: S2 })
const assembly = buildStage({ prefix: 'tool_assembly', label: 'Tool Assembly', kind: 'range', section: S3 })
const trial = buildStage({ prefix: 'tool_trial', label: 'Tool Trial', kind: 'single', section: S4 })

/** Stage-macro fields are FieldDefinitions; map them back to the config shape used by PP_FIELD_CONFIG. */
const toSpec = (f: ReturnType<typeof buildStage>['fields'][number]): PpFieldSpec => ({
  k: f.key, l: f.label, t: f.type, o: f.options, by: f.enteredBy, src: f.source, val: f.validatedBy === 'PIC', req: f.mandatory,
  vendor: f.visibleToVendor, frules: f.rules, calc: f.calc, notify: f.notifyOnChange, section: f.section
})

// The last date still counted as OT: MRD + the "ot_mrd_grace_days" setting (0 = on the MRD itself is OT).
const OT_LIMIT = OFFSET(MRD, { param: 'ot_mrd_grace_days' })
// The system-defined target date: MRD minus the "target_days" setting (default 14).
const TARGET = OFFSET(MRD, { param: 'target_days', negate: true })
const planOverMrd = gt(F('ot_planned_date'), OT_LIMIT)
const actualOverMrd = AND(filled(F('actual_ot_date')), gt(F('actual_ot_date'), OT_LIMIT))
const actualWithinMrd = AND(filled(F('actual_ot_date')), le(F('actual_ot_date'), OT_LIMIT))
const systemNonOt = eq(F('ot_status', 'systemValue'), K('Non-OT'))
// "Was overridden to Non-OT": the PIC's reasons and the vendor's action-plan loop follow this, never the system value.
const overriddenToNonOt = eq(F('ot_status', 'overrideValue'), K('Non-OT'))
// Delay ≠ Non-OT: the vendor slipped past their own plan (or the plan is past the system target date) but is still
// within MRD. Never shown together with Non-OT, so a delay and a deviation cannot both be asked for.
const needsDelayReason = AND(
  ne(F('ot_status'), K('Non-OT')),
  OR(
    AND(gt(F('ot_planned_date'), TARGET), le(F('ot_planned_date'), OT_LIMIT), OR(blank(F('actual_ot_date')), le(F('actual_ot_date'), OT_LIMIT))),
    AND(filled(F('actual_ot_date')), gt(F('actual_ot_date'), F('ot_planned_date')), le(F('actual_ot_date'), OT_LIMIT))
  )
)
const goAheadApplicable = eq(F('applicability_of_msil_tool_go_ahead'), K('Y'))
/** Reason rows: a reason from a master list and a remark per row; the user adds as many rows as there are reasons. */
const reasonRows = (listId: string, o: { reasonRequired: boolean; remarkBy?: 'PIC' | 'Vendor'; actionPlan?: boolean }): TableColumn[] => [
  { key: 'reason', label: 'Reason', type: 'dropdown', optionsFrom: listId, required: o.reasonRequired },
  { key: 'remark', label: 'Remark', type: 'longText', required: true, enteredBy: o.remarkBy },
  // OT: the vendor's action plan for each reason.
  ...(o.actionPlan ? [{ key: 'action_plan', label: 'Action plan', type: 'longText', required: true, enteredBy: 'Vendor' } as TableColumn] : [])
]

const PP9: PpFieldSpec[] = [
  // Stage 1 · MSIL tool go-ahead: from ENOVIA. The date and the vendor's optional remark only when it applies.
  { k: 'applicability_of_msil_tool_go_ahead', l: 'MSIL tool go-ahead applicability', t: 'yesNo', by: 'System', src: 'enovia', vendor: true, section: S1 },
  { k: 'msil_tool_go_ahead_date', l: 'MSIL tool go-ahead date', t: 'date', by: 'System', src: 'enovia', vendor: true, section: S1, frules: [{ when: goAheadApplicable, action: 'show' }] },
  { k: 'tool_go_ahead_remark', l: 'Tool go-ahead remark', t: 'longText', by: 'Vendor', val: true, section: S1, frules: [{ when: goAheadApplicable, action: 'show' }] },
  ...cutting.fields.map(toSpec),
  ...assembly.fields.map(toSpec),
  ...trial.fields.map(toSpec),
  // Stage 5 · OT: planned from ENOVIA (a change is notified to the PIC); actual by the vendor (the PIC can correct it).
  { k: 'ot_planned_date', l: 'OT planned date', t: 'date', by: 'System', src: 'enovia', vendor: true, section: S5, notify: { roles: ['PIC'] } },
  // A change of the actual date keeps the earlier one struck through (and tells the PIC).
  { k: 'actual_ot_date', l: 'Actual OT date', t: 'date', by: 'Vendor', alsoBy: ['PIC'], val: true, section: S5, notify: { roles: ['PIC'] } },
  {
    k: 'ot_status', l: 'OT status', t: 'dropdown', o: ['OT', 'Non-OT'], by: 'System', src: 'calculated', vendor: true, dash: true, list: true, section: S5,
    // The actual date decides once it is there (Non-OT beyond MRD, OT on or before it); before that a plan beyond MRD is
    // Non-OT. Blank until it can be decided. So a Non-OT on the plan can come back to OT with an actual within MRD.
    calc: {
      rules: [
        { when: actualOverMrd, value: val('Non-OT') },
        { when: actualWithinMrd, value: val('OT') },
        { when: planOverMrd, value: val('Non-OT') }
      ]
    },
    // The PIC sees the vendor-side (calculated) status and may only turn OT into Non-OT, once the actual date is filled.
    // That stays final (Non-OT) even if a later actual is within MRD; the vendor is told with the PIC's reasons.
    override: {
      role: 'PIC', when: filled(F('actual_ot_date')), fromValues: ['OT'], options: ['Non-OT'], sticky: true, allowRemoveDeviation: false,
      // Back to OT: once the vendor's action plan is accepted (the old actual date is cleared) and a NEW actual date is
      // within MRD, the PIC's Non-OT is dropped and the calculated OT counts. Beyond MRD it stays Non-OT (+ deviation).
      releaseWhen: AND(eq({ kind: 'groupStatus', groupId: 'pic-override-plan' }, K('accepted')), actualWithinMrd),
      systemLabel: 'OT status (Vendor)', label: 'OT status (PIC)',
      notify: { roles: ['Vendor'], includeFields: ['pic_non_ot_reasons'] }
    }
  },
  {
    k: 'ot_delay_reason', l: 'Delay reason, remark and action plan', t: 'table', by: 'Vendor', alsoBy: ['PIC'], val: true, section: S5, minRows: 1,
    cols: reasonRows('delay-reasons', { reasonRequired: true, actionPlan: true }),
    frules: [{ when: needsDelayReason, action: 'show' }, { when: needsDelayReason, action: 'makeMandatory' }]
  },
  // Stage 5 · Non-OT from the system: the vendor gives the reasons and a target OT date, the PIC accepts / rejects (loop).
  // A target beyond MRD needs the E-Doc deviation; one within MRD re-opens the Actual OT date once accepted.
  {
    k: 'non_ot_reason_system', l: 'Non-OT reason, remark and action plan', t: 'table', by: 'Vendor', alsoBy: ['PIC'], val: true, req: true, section: S5N, vendor: true, minRows: 1,
    cols: reasonRows('non-ot-reasons', { reasonRequired: true, actionPlan: true })
  },
  { k: 'non_ot_target_date', l: 'Target OT date', t: 'date', by: 'Vendor', val: true, req: true, section: S5N },
  // Stage 6 · PIC turns OT into Non-OT: one or more reasons (optional) with a remark each (mandatory). The vendor may
  // change a reason later (that change goes back to the PIC), never the PIC's remark.
  {
    k: 'pic_non_ot_reasons', l: 'Non-OT reason and remark (PIC)', t: 'table', by: 'PIC', alsoBy: ['Vendor'], section: S6, vendor: true, minRows: 1,
    cols: reasonRows('non-ot-reasons', { reasonRequired: false, remarkBy: 'PIC' }),
    // Stays visible (as a record) after the status came back to OT.
    frules: [{ when: OR(overriddenToNonOt, filled(F('pic_non_ot_reasons'))), action: 'show' }, { when: overriddenToNonOt, action: 'makeMandatory' }]
  },
  // Stage 7 · Vendor response to the PIC's Non-OT, reviewed by the PIC in a loop.
  { k: 'revised_planned_ot_date', l: 'Revised OT plan date', t: 'date', by: 'Vendor', val: true, section: S7V, req: true },
  { k: 'action_plan_remark', l: 'Action plan', t: 'longText', by: 'Vendor', alsoBy: ['PIC'], val: true, section: S7V, req: true },
  // Stage 8 · Deviation (Non-OT beyond MRD): E-Doc number (searchable) and its approval status (fetched or picked).
  // MSIL only: the vendor never sees the E-Doc number or the deviation approval status.
  { k: 'e_doc_number', l: 'E-Doc number', t: 'text', by: 'PIC', section: S8, search: true },
  { k: 'deviation_approval_status', l: 'Deviation approval status', t: 'dropdown', o: ['Approved', 'Pending', 'Rejected'], by: 'PIC', section: S8, dash: true }
]

export const PP9_CONFIG: PpActivityConfig = {
  fields: PP9,
  // OT status has its own Delay reason field, so the generic "Reason for delay" pop-up is off.
  delayPopup: false,
  parameters: [
    { key: 'target_days', label: 'System target date = MRD minus this many days', value: 14 },
    { key: 'ot_mrd_grace_days', label: 'Days after MRD still counted as OT (0 = an actual on the MRD is OT; −1 = it is Non-OT)', value: 0 }
  ],
  validationRules: [
    ...cutting.validationRules,
    ...assembly.validationRules,
    ...trial.validationRules,
    { id: 'ot-actual-future', scope: 'fields', left: [], right: [], op: '<=', type: 'notFuture', field: 'actual_ot_date', message: 'Actual OT date cannot be in the future' },
    { id: 'ot-revised-mrd', scope: 'fields', left: [], right: [], op: '<=', type: 'compare', field: 'revised_planned_ot_date', compareTo: MRD, message: 'Revised OT plan date must be on or before the MRD' }
  ],
  groupReviews: [
    {
      id: 'system-non-ot', label: 'Non-OT reason and target date (system Non-OT)', section: S5N, fillerRole: 'Vendor', reviewerRole: 'PIC',
      // The system says Non-OT and the PIC has not overridden (an override has its own loop below).
      opensWhen: AND(systemNonOt, blank(F('ot_status', 'overrideValue'))), lockOnAccept: true, rejectCommentRequired: true, escalateAfter: 3, escalateTo: 'SIC',
      // A later change of the target date or the reasons goes back to the PIC on its own (every round is logged).
      partialFields: ['non_ot_target_date', 'non_ot_reason_system'],
      // Accepted: the vendor enters the Actual OT date, and the status recalculates from it (Non-OT → OT is possible).
      onAccept: { reopenFields: ['actual_ot_date'] }
    },
    {
      id: 'pic-override-plan', label: 'Vendor action plan after PIC Non-OT', section: S7V, fillerRole: 'Vendor', reviewerRole: 'PIC',
      opensWhen: overriddenToNonOt, lockOnAccept: true, rejectCommentRequired: true, escalateAfter: 3, escalateTo: 'SIC',
      // The vendor may change the PIC's Non-OT reasons after acceptance; that change alone goes to the PIC (rejected = reverted).
      partialFields: ['pic_non_ot_reasons'],
      // After Accept the vendor enters a NEW Actual OT date (the old one is cleared, kept struck through); OT status and
      // the deviation rule recalculate from it.
      onAccept: { reopenFields: ['actual_ot_date'], clearFields: ['actual_ot_date'] }
    }
  ],
  deviation: {
    // Non-OT and a date beyond MRD (actual, the vendor's target, or a revised plan). Never with a delay (that is within MRD).
    when: AND(
      eq(F('ot_status'), K('Non-OT')),
      OR(gt(F('actual_ot_date'), OT_LIMIT), gt(F('non_ot_target_date'), OT_LIMIT), gt(F('revised_planned_ot_date'), OT_LIMIT))
    ),
    title: 'Deviation — Non-OT beyond MRD',
    message: 'The OT status is Non-OT and the target or actual OT date is beyond the MRD. Enter the E-Doc number of the deviation and its approval status.',
    edocField: 'e_doc_number',
    statusField: 'deviation_approval_status',
    enteredBy: 'PIC',
    // E-Doc number and approval status are both entered by the PIC (no E-Doc integration). No PIC → SIC → DPM chain for OT.
    fetchStatus: false,
    manualStatus: true,
    approvalChain: false
  },
  testScenarios: [
    {
      id: 'ts-1', name: '1 · On-plan OT', mrd: '2026-12-01', today: '2026-11-30', input: { ot_planned_date: '2026-11-10', actual_ot_date: '2026-10-10' },
      expect: { values: { ot_status: 'OT' }, deviation: false, hidden: ['ot_delay_reason', 'e_doc_number', 'pic_non_ot_reasons', 'non_ot_reason_system'] }
    },
    {
      id: 'ts-2', name: '2 · Delay within MRD (actual after plan, on or before MRD) — a delay, not Non-OT', mrd: '2026-12-01', today: '2026-11-30', input: { ot_planned_date: '2026-11-10', actual_ot_date: '2026-11-25' },
      expect: { values: { ot_status: 'OT' }, deviation: false, visible: ['ot_delay_reason'], mandatory: ['ot_delay_reason'], hidden: ['non_ot_reason_system', 'e_doc_number'] }
    },
    {
      id: 'ts-3', name: '3 · Plan beyond MRD: reasons + target beyond MRD, rejected once then accepted → E-Doc + status required', mrd: '2026-12-01', today: '2026-11-30',
      input: { ot_planned_date: '2026-12-10', non_ot_reason_system: [{ reason: 'Tool maturation delay', remark: 'Second trial needed' }, { reason: 'ECN case', remark: 'ECN-114 on rib height' }], non_ot_target_date: '2026-12-15' },
      rounds: [{ groupId: 'system-non-ot', decisions: ['Reject', 'Accept'] }],
      expect: { values: { ot_status: 'Non-OT' }, groups: { 'system-non-ot': 'accepted' }, deviation: true, visible: ['non_ot_reason_system', 'e_doc_number', 'deviation_approval_status'], mandatory: ['e_doc_number', 'deviation_approval_status'], hidden: ['ot_delay_reason'] }
    },
    {
      id: 'ts-3b', name: '3b · Plan beyond MRD, target within MRD accepted → no deviation; actual within MRD → back to OT', mrd: '2026-12-01', today: '2026-11-30',
      input: { ot_planned_date: '2026-12-10', non_ot_reason_system: [{ reason: 'Tool maker selection delay', remark: 'New tool maker from Oct' }], non_ot_target_date: '2026-11-25' },
      rounds: [{ groupId: 'system-non-ot', decisions: ['Accept'] }],
      afterInput: { actual_ot_date: '2026-11-24' },
      expect: { values: { ot_status: 'OT' }, groups: { 'system-non-ot': 'accepted' }, deviation: false, hidden: ['e_doc_number', 'ot_delay_reason'] }
    },
    {
      id: 'ts-4', name: '4 · Actual beyond MRD → Non-OT + deviation, no delay reason', mrd: '2026-12-01', today: '2026-12-31', input: { ot_planned_date: '2026-11-10', actual_ot_date: '2026-12-05' },
      expect: { values: { ot_status: 'Non-OT' }, deviation: true, visible: ['e_doc_number', 'non_ot_reason_system'], hidden: ['ot_delay_reason'] }
    },
    {
      id: 'ts-4b', name: '4b · Plan after the target date but actual beyond MRD → Non-OT only (never delay + deviation together)', mrd: '2026-12-01', today: '2026-12-31',
      input: { ot_planned_date: '2026-11-25', actual_ot_date: '2026-12-05' },
      expect: { values: { ot_status: 'Non-OT' }, deviation: true, hidden: ['ot_delay_reason'] }
    },
    {
      id: 'ts-5a', name: '5a · PIC turns OT into Non-OT (two reasons) → revised plan rejected once → accepted → new actual within MRD → back to OT', mrd: '2026-12-01', today: '2026-11-30',
      input: { ot_planned_date: '2026-11-10', actual_ot_date: '2026-11-20', ot_status__override: 'Non-OT', pic_non_ot_reasons: [{ reason: 'Tool maturation delay', remark: 'Tool not ready at audit' }, { remark: 'Gauge not calibrated' }], revised_planned_ot_date: '2026-11-28', action_plan_remark: 'Re-trial on 27 Nov' },
      rounds: [{ groupId: 'pic-override-plan', decisions: ['Reject', 'Accept'] }],
      afterInput: { actual_ot_date: '2026-11-26' },
      expect: { values: { ot_status: 'OT', ot_status__system: 'OT' }, groups: { 'pic-override-plan': 'accepted' }, deviation: false, visible: ['pic_non_ot_reasons'], hidden: ['non_ot_reason_system'] }
    },
    {
      id: 'ts-5b', name: '5b · …same, but the new actual is beyond MRD → E-Doc required; PIC reasons still shown', mrd: '2026-12-01', today: '2026-12-31',
      input: { ot_planned_date: '2026-11-10', actual_ot_date: '2026-11-20', ot_status__override: 'Non-OT', pic_non_ot_reasons: [{ remark: 'Tool not ready at audit' }], revised_planned_ot_date: '2026-11-28', action_plan_remark: 'Re-trial on 27 Nov' },
      rounds: [{ groupId: 'pic-override-plan', decisions: ['Reject', 'Accept'] }],
      afterInput: { actual_ot_date: '2026-12-05' },
      expect: { values: { ot_status: 'Non-OT', ot_status__system: 'Non-OT' }, groups: { 'pic-override-plan': 'accepted' }, deviation: true, visible: ['e_doc_number', 'pic_non_ot_reasons'], mandatory: ['e_doc_number'] }
    },
    {
      id: 'ts-6', name: '6 · Plan later than the system target date (MRD − 14) but within MRD → delay reason, status blank', mrd: '2026-12-01', today: '2026-11-01',
      input: { ot_planned_date: '2026-11-25' },
      expect: { values: { ot_status: '' }, deviation: false, visible: ['ot_delay_reason'], mandatory: ['ot_delay_reason'] }
    },
    {
      id: 'ts-7', name: '7 · Tool Cutting end before start → the save is blocked (status follows the actual dates only)', mrd: '2026-12-01', today: '2026-11-30',
      input: { tool_cutting_actual_start_date: '2026-10-10', tool_cutting_actual_end_date: '2026-10-05' },
      expect: { values: { tool_cutting_status: 'Completed' }, blocked: ['tool_cutting_actual_end_date'] }
    },
    {
      id: 'ts-8', name: '8 · Go-ahead not applicable → no go-ahead date or remark', mrd: '2026-12-01', today: '2026-11-30',
      input: { applicability_of_msil_tool_go_ahead: 'N' },
      expect: { hidden: ['msil_tool_go_ahead_date', 'tool_go_ahead_remark'] }
    }
  ] as TestScenario[]
}

// ── mpp-1 · OTOP status (same pattern as OT; configuration only) ──────────────────────────────────────────────────
// OTOP = on time, off tool AND off process. Vendor: OTOP planned / actual start and end dates (not from ENOVIA) and,
// last, the machine installation date. System: OTOP status — actual end beyond MRD = Non-OTOP, on or before = OTOP;
// before an actual, a planned end beyond MRD = Non-OTOP. The vendor sees that; the PIC may change it either way
// (OTOP ↔ Non-OTOP, a qualitative call). Non-OTOP → a reasons table (Due to ECN, breakup, tool & process breakup,
// detail, action plan, revised OTOP date) that the PIC accepts / rejects (loop, as OT). Delay ≠ Non-OTOP: a plan past the
// system target date (MRD − 14) or an actual past the plan, still within MRD → a delay reason (as OT). Non-OTOP beyond
// MRD → deviation pop-up (raised?, E-Doc number, approval status — PIC only), as OT.
const O1 = '1 · OTOP dates (Vendor)'
const O2 = '2 · OTOP status'
const O3 = '3 · Non-OTOP reasons (PIC review)'
const O4 = '4 · Deviation (Non-OTOP beyond MRD) — MSIL only'
const O5 = '5 · Machine installation'
const otopDates = buildStage({ prefix: 'otop', label: 'OTOP', kind: 'range', section: O1 })
const OTOP_PLAN = F('otop_planned_end_date')
const OTOP_ACTUAL = F('otop_actual_end_date')
const OTOP_LIMIT = OFFSET(MRD, { param: 'otop_mrd_grace_days' })
const OTOP_TARGET = OFFSET(MRD, { param: 'target_days', negate: true })
const otopOverMrd = AND(filled(OTOP_ACTUAL), gt(OTOP_ACTUAL, OTOP_LIMIT))
const otopWithinMrd = AND(filled(OTOP_ACTUAL), le(OTOP_ACTUAL, OTOP_LIMIT))
const isNonOtop = eq(F('otop_status'), K('Non-OTOP'))
const systemNonOtop = eq(F('otop_status', 'systemValue'), K('Non-OTOP'))
const overriddenToNonOtop = eq(F('otop_status', 'overrideValue'), K('Non-OTOP'))
// Delay (as OT): plan past the system target date, or actual past the plan — both still within MRD, never with Non-OTOP.
const otopNeedsDelay = AND(
  ne(F('otop_status'), K('Non-OTOP')),
  OR(
    AND(gt(OTOP_PLAN, OTOP_TARGET), le(OTOP_PLAN, OTOP_LIMIT), OR(blank(OTOP_ACTUAL), le(OTOP_ACTUAL, OTOP_LIMIT))),
    AND(filled(OTOP_ACTUAL), gt(OTOP_ACTUAL, OTOP_PLAN), le(OTOP_ACTUAL, OTOP_LIMIT))
  )
)
const TP_NOT_READY = 'Tool & Process Not Ready'
const MPP1: PpFieldSpec[] = [
  ...otopDates.fields.filter((f) => /_(planned|actual)_(start|end)_date$/.test(f.key)).map(toSpec),
  {
    k: 'otop_status', l: 'OTOP status', t: 'dropdown', o: ['OTOP', 'Non-OTOP'], by: 'System', src: 'calculated', vendor: true, dash: true, list: true, section: O2,
    calc: {
      rules: [
        { when: otopOverMrd, value: val('Non-OTOP') },
        { when: otopWithinMrd, value: val('OTOP') },
        { when: gt(OTOP_PLAN, OTOP_LIMIT), value: val('Non-OTOP') }
      ]
    },
    // The vendor sees the calculated status; the PIC may set either value (a qualitative call). A PIC Non-OTOP stays until
    // the vendor's reasons / action plan are accepted AND a new actual end is within MRD (as OT).
    override: {
      role: 'PIC', when: filled(F('otop_status', 'systemValue')), fromValues: ['OTOP', 'Non-OTOP'], options: ['OTOP', 'Non-OTOP'], sticky: true, allowRemoveDeviation: true,
      releaseWhen: AND(eq({ kind: 'groupStatus', groupId: 'otop-pic-plan' }, K('accepted')), otopWithinMrd),
      systemLabel: 'OTOP status (Vendor)', label: 'OTOP status (PIC)',
      notify: { roles: ['Vendor'], includeFields: ['non_otop_reasons'] }
    }
  },
  {
    k: 'otop_delay_reason', l: 'Delay reason and remark', t: 'table', by: 'Vendor', alsoBy: ['PIC'], val: true, section: O2, minRows: 1,
    cols: reasonRows('delay-reasons', { reasonRequired: true }),
    frules: [{ when: otopNeedsDelay, action: 'show' }, { when: otopNeedsDelay, action: 'makeMandatory' }]
  },
  {
    k: 'non_otop_reasons', l: 'Non-OTOP reasons', t: 'table', by: 'Vendor', alsoBy: ['PIC'], val: true, vendor: true, section: O3, minRows: 1,
    frules: [{ when: isNonOtop, action: 'show' }, { when: isNonOtop, action: 'makeMandatory' }],
    cols: [
      { key: 'due_to_ecn', label: 'Due to ECN', type: 'dropdown', options: ['Y', 'N'], enteredBy: 'Vendor', required: true },
      { key: 'breakup', label: 'Non-OTOP breakup', type: 'dropdown', options: ['Tool Not Ready', 'Process Not Ready', TP_NOT_READY], required: true },
      { key: 'tp_breakup', label: 'Tool & Process Not Ready breakup', type: 'dropdown', options: ['Process Maturation Delay', 'Software Readiness', 'Machine/Facility Delay', 'Source Selection Delay'], showRule: eq(F('breakup'), K(TP_NOT_READY)), requiredRule: eq(F('breakup'), K(TP_NOT_READY)) },
      { key: 'detail', label: 'Non-OTOP details', type: 'longText', required: true },
      { key: 'action_plan', label: 'Action plan', type: 'longText', enteredBy: 'Vendor', required: true },
      { key: 'revised_otop_date', label: 'Revised OTOP date', type: 'date', enteredBy: 'Vendor', required: true }
    ]
  },
  { k: 'deviation_raised', l: 'Deviation raised', t: 'yesNo', by: 'PIC', section: O4 },
  { k: 'e_doc_number', l: 'E-Doc number', t: 'text', by: 'PIC', section: O4, search: true },
  { k: 'deviation_approval_status', l: 'Deviation approval status', t: 'dropdown', o: ['Approved', 'Pending', 'Rejected'], by: 'PIC', section: O4, dash: true },
  { k: 'machine_installation_date', l: 'Machine installation date', t: 'date', by: 'Vendor', val: true, section: O5 }
]

export const MPP1_CONFIG: PpActivityConfig = {
  name: 'OTOP status',
  fields: MPP1,
  // The activity has its own delay reason.
  delayPopup: false,
  parameters: [
    { key: 'target_days', label: 'System target date = MRD minus this many days', value: 14 },
    { key: 'otop_mrd_grace_days', label: 'Days after MRD still counted as OTOP (0 = an actual on the MRD is OTOP)', value: 0 }
  ],
  validationRules: [
    ...otopDates.validationRules,
    { id: 'otop-actual-future', scope: 'fields', left: [], right: [], op: '<=', type: 'notFuture', field: 'otop_actual_end_date', message: 'OTOP actual end date cannot be in the future' }
  ],
  groupReviews: [
    {
      id: 'otop-system-non-otop', label: 'Non-OTOP reasons (system Non-OTOP)', section: O3, fillerRole: 'Vendor', reviewerRole: 'PIC',
      opensWhen: AND(systemNonOtop, blank(F('otop_status', 'overrideValue'))), lockOnAccept: true, rejectCommentRequired: true, escalateAfter: 3, escalateTo: 'SIC',
      partialFields: ['non_otop_reasons'],
      // Accepted: the vendor enters the actual OTOP end date and the status recalculates (Non-OTOP → OTOP is possible).
      onAccept: { reopenFields: ['otop_actual_end_date'] }
    },
    {
      id: 'otop-pic-plan', label: 'Non-OTOP reasons and action plan (PIC Non-OTOP)', section: O3, fillerRole: 'Vendor', reviewerRole: 'PIC',
      opensWhen: overriddenToNonOtop, lockOnAccept: true, rejectCommentRequired: true, escalateAfter: 3, escalateTo: 'SIC',
      partialFields: ['non_otop_reasons'],
      // Accepted: a NEW actual OTOP end date (the old one is cleared, kept struck through) decides OTOP / Non-OTOP again.
      onAccept: { reopenFields: ['otop_actual_end_date'], clearFields: ['otop_actual_end_date'] }
    }
  ],
  deviation: {
    // Non-OTOP and the actual (or the vendor's revised OTOP date) beyond MRD. Never together with a delay (within MRD).
    when: AND(isNonOtop, OR(otopOverMrd, gt(F('non_otop_reasons.revised_otop_date'), OTOP_LIMIT))),
    title: 'Deviation — Non-OTOP beyond MRD',
    message: 'The OTOP status is Non-OTOP and the actual (or revised) OTOP date is beyond the MRD. Was a deviation raised? Enter its E-Doc number and approval status.',
    raisedField: 'deviation_raised',
    edocField: 'e_doc_number',
    statusField: 'deviation_approval_status',
    enteredBy: 'PIC',
    fetchStatus: false,
    manualStatus: true,
    approvalChain: false
  },
  testScenarios: [
    {
      id: 'otop-1', name: '1 · Actual on or before plan → OTOP; nothing else asked', mrd: '2026-12-01', today: '2026-11-30',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-10', otop_actual_start_date: '2026-10-02', otop_actual_end_date: '2026-11-08' },
      expect: { values: { otop_status: 'OTOP' }, deviation: false, hidden: ['otop_delay_reason', 'non_otop_reasons', 'e_doc_number', 'deviation_raised'] }
    },
    {
      id: 'otop-2', name: '2 · Actual after plan but within MRD → OTOP with a delay reason (not Non-OTOP)', mrd: '2026-12-01', today: '2026-11-30',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-10', otop_actual_start_date: '2026-10-02', otop_actual_end_date: '2026-11-25' },
      expect: { values: { otop_status: 'OTOP' }, deviation: false, visible: ['otop_delay_reason'], mandatory: ['otop_delay_reason'], hidden: ['non_otop_reasons'] }
    },
    {
      id: 'otop-2b', name: '2b · Plan later than the system target date (MRD − 14) but within MRD → delay reason before any actual', mrd: '2026-12-01', today: '2026-11-01',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-25' },
      expect: { values: { otop_status: '' }, deviation: false, visible: ['otop_delay_reason'], mandatory: ['otop_delay_reason'] }
    },
    {
      id: 'otop-3', name: '3 · Plan beyond MRD → Non-OTOP; reasons rejected once, then accepted; actual within MRD → OTOP', mrd: '2026-12-01', today: '2026-11-30',
      input: { otop_planned_end_date: '2026-12-10', non_otop_reasons: [{ due_to_ecn: 'N', breakup: TP_NOT_READY, tp_breakup: 'Software Readiness', detail: 'PLC program late', action_plan: 'Vendor SW team on site', revised_otop_date: '2026-11-28' }] },
      rounds: [{ groupId: 'otop-system-non-otop', decisions: ['Reject', 'Accept'] }],
      afterInput: { otop_actual_end_date: '2026-11-27' },
      expect: { values: { otop_status: 'OTOP' }, groups: { 'otop-system-non-otop': 'accepted' }, deviation: false, hidden: ['otop_delay_reason', 'e_doc_number'] }
    },
    {
      id: 'otop-4', name: '4 · Actual beyond MRD → Non-OTOP + deviation pop-up (raised? first); never a delay at the same time', mrd: '2026-12-01', today: '2026-12-31',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-10', otop_actual_start_date: '2026-10-02', otop_actual_end_date: '2026-12-05' },
      expect: { values: { otop_status: 'Non-OTOP' }, deviation: true, visible: ['deviation_raised', 'non_otop_reasons'], mandatory: ['deviation_raised', 'non_otop_reasons'], hidden: ['otop_delay_reason', 'e_doc_number'] }
    },
    {
      id: 'otop-4b', name: '4b · …deviation raised = Y → E-Doc number and approval status required (PIC only)', mrd: '2026-12-01', today: '2026-12-31',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-10', otop_actual_start_date: '2026-10-02', otop_actual_end_date: '2026-12-05', deviation_raised: 'Y' },
      expect: { values: { otop_status: 'Non-OTOP' }, deviation: true, visible: ['e_doc_number', 'deviation_approval_status'], mandatory: ['e_doc_number', 'deviation_approval_status'] }
    },
    {
      id: 'otop-5', name: '5 · System OTOP, PIC turns it Non-OTOP → reasons + action plan accepted → new actual within MRD → back to OTOP', mrd: '2026-12-01', today: '2026-11-30',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-10', otop_actual_start_date: '2026-10-02', otop_actual_end_date: '2026-11-08', otop_status__override: 'Non-OTOP', non_otop_reasons: [{ due_to_ecn: 'N', breakup: TP_NOT_READY, tp_breakup: 'Software Readiness', detail: 'PLC program late', action_plan: 'Vendor SW team on site', revised_otop_date: '2026-11-28' }] },
      rounds: [{ groupId: 'otop-pic-plan', decisions: ['Reject', 'Accept'] }],
      afterInput: { otop_actual_end_date: '2026-11-27' },
      expect: { values: { otop_status: 'OTOP', otop_status__system: 'OTOP' }, groups: { 'otop-pic-plan': 'accepted' }, deviation: false }
    },
    {
      id: 'otop-5b', name: '5b · PIC turns OTOP into Non-OTOP → the reasons table opens for the vendor (action plan, revised date)', mrd: '2026-12-01', today: '2026-11-30',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-10', otop_actual_start_date: '2026-10-02', otop_actual_end_date: '2026-11-08', otop_status__override: 'Non-OTOP' },
      expect: { values: { otop_status: 'Non-OTOP', otop_status__system: 'OTOP' }, visible: ['non_otop_reasons'], mandatory: ['non_otop_reasons'], deviation: false }
    },
    {
      id: 'otop-5c', name: '5c · System Non-OTOP, PIC turns it OTOP (qualitative) → no reasons table, no deviation', mrd: '2026-12-01', today: '2026-12-31',
      input: { otop_planned_start_date: '2026-10-01', otop_planned_end_date: '2026-11-10', otop_actual_start_date: '2026-10-02', otop_actual_end_date: '2026-12-05', otop_status__override: 'OTOP', otop_status__override_remark: 'Machine running, paperwork late' },
      expect: { values: { otop_status: 'OTOP', otop_status__system: 'Non-OTOP' }, deviation: false, hidden: ['non_otop_reasons', 'e_doc_number', 'deviation_raised'] }
    },
    {
      id: 'otop-6', name: '6 · Actual end before start → blocked', mrd: '2026-12-01', today: '2026-11-30',
      input: { otop_actual_start_date: '2026-11-10', otop_actual_end_date: '2026-11-05' },
      expect: { blocked: ['otop_actual_end_date'] }
    }
  ] as TestScenario[]
}

