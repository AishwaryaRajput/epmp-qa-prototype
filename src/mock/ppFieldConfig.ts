/**
 * Hand-configured PP activities from "epmp-activity-fields-export.json" (`purposeBuilt`: PP01–PP05, PP10, PP11).
 * The other PP activities come from the JSON catalogue via ./ppCatalogueFields.ts (generated).
 *
 * Mapping from the JSON: control dropdown → dropdown/yesNo, readonly → System-entered (calculated / SAP /
 * ENOVIA), editableBy Vendor|PIC → `by`, visibleWhen → `rules` (hide when the controlling value is not met),
 * repeating groups → `table` fields.
 */
import type { ConditionNode, FieldDefinition, TestScenario, CalcSpec, ConditionalRule, DerivedRows, FieldOverride, FieldRule, NotifyOnChange, ReasonRemarkConfig, ActivityParameter, GroupReview, DeviationTrigger, PivotSummaryConfig, RowReview, ValidationRule, FieldSource, FieldType, TableColumn, TimelineTemplateEntry } from '../domain'
import type { PersonaId } from '../store/personaStore'
import { MPP1_CONFIG, PP9_CONFIG } from './ppRuleConfig'
import { EPMP_ACTIVITIES } from './epmpFields'
import { AND, MRD, OR, TODAY, anyRow, blank, eq, filled, gt, lt, F, K, ne, val } from '../domain/ruleDsl'

export interface PpFieldSpec {
  k: string
  l: string
  t?: FieldType
  o?: string[]
  cols?: TableColumn[]
  derived?: DerivedRows
  /** Each row of this table is decided by a chain of reviewers (see FieldDefinition.rowReview). */
  rowReview?: RowReview
  /** What one row is called in banners and empty states (e.g. "point"). */
  rowNoun?: string
  /** Table: at most this many rows (1 = a single row, ready to fill). */
  maxRows?: number
  /** Table: rows shown ready to type into (FieldDefinition.minRows). */
  minRows?: number
  pivotSummary?: PivotSummaryConfig
  by?: PersonaId | 'System'
  src?: FieldSource
  val?: boolean
  req?: boolean
  dash?: boolean
  list?: boolean
  /** Data-only: system-fed per part for dashboards, never on a form. */
  dataOnly?: boolean
  /** Calculated count of rows of a table of this activity (see FieldDefinition.countRows). */
  countRows?: { tableField: string; column: string; equals: string }
  /** Calculated total of a number column of a table of this activity (see FieldDefinition.sumRows). */
  sumRows?: { tableField: string; column: string }
  rules?: ConditionalRule[]
  /** C1 condition rules. */
  frules?: FieldRule[]
  /** C2 calculated value table. */
  calc?: CalcSpec
  notify?: NotifyOnChange
  override?: FieldOverride
  reasonRemark?: ReasonRemarkConfig
  section?: string
  alsoBy?: PersonaId[]
  optionsFrom?: string
  alwaysEditable?: boolean
  edocFrom?: string
  /** Vendor can see this field (read-only) even though they do not enter it. */
  vendor?: boolean
  /** Planned / hidden from form (FieldDefinition.hiddenFromForm). */
  hidden?: boolean
  /** Fetched from its source when the form opens (FieldDefinition.autoFetch). */
  autoFetch?: boolean
  /** Findable with the header search (FieldDefinition.searchable). */
  search?: boolean
  /** Table: a history per row (FieldDefinition.logRows). */
  logRows?: boolean
  /** Table: 'form' = each row as a card of labelled fields (FieldDefinition.layout). */
  layout?: 'table' | 'form'
  /** Hidden from roles while a condition holds (FieldDefinition.hiddenFrom). */
  hiddenFrom?: FieldDefinition['hiddenFrom']
  /** Table: only these roles add rows (FieldDefinition.addRowsBy). */
  addRowsBy?: FieldDefinition['addRowsBy']
  /** Comparison field (FieldDefinition.compare). */
  compare?: FieldDefinition['compare']
}

export interface PpActivityConfig {
  /** Display name, replacing the one from the EPMP field sheet. */
  name?: string
  /** Replace the activity's whole field list. */
  fields?: PpFieldSpec[]
  /** Sum-matching validation rules. */
  validationRules?: ValidationRule[]
  /** Allow the vendor to give a planned timeline for the activity. */
  vendorTimeline?: boolean
  /** PIC can mark a submission NG; resubmission rounds are tracked. */
  trackNgRounds?: boolean
  /** Show this part's NG / exceptions from other activities. */
  canReferenceOtherActivities?: boolean
  /** Sub-type-based timeline template (dates from the sub-type MRD per technical category). */
  timelineTemplate?: TimelineTemplateEntry[]
  parameters?: ActivityParameter[]
  groupReviews?: GroupReview[]
  deviation?: DeviationTrigger
  testScenarios?: TestScenario[]
  /** false = the generic "Reason for delay" pop-up is off (the activity has its own delay-reason field). */
  delayPopup?: boolean
  /** Applicability comes from the Applicability screen and is shown on the form (no applicability field). */
  showApplicability?: boolean
  /** The whole form is read-only once this holds (ActivityDefinition.lockWhen). */
  lockWhen?: ConditionNode
}

/** Hide the field unless `key` equals `value` (several of these combine as AND). */
const onlyWhen = (key: string, value: string): ConditionalRule => ({
  dependsOn: key,
  operator: 'notEquals',
  value,
  action: 'hide'
})

// ── PP01 · Parts drawing confirmation in IBOM (PIC edits everything; Vendor read-only) ──────────────
const YES = onlyWhen('drawing_applicability', 'Y')
const PP1: PpFieldSpec[] = [
  { k: 'drawing_applicability', l: 'Drawing applicability', t: 'yesNo', by: 'PIC' },
  { k: 'spec_drawing_availability', l: 'Spec drawing availability', t: 'dropdown', o: ['Available', 'Not Available'], by: 'PIC', src: 'mapping', dash: true, list: true, rules: [YES] },
  { k: 'final_drawing_availability', l: 'Final drawing availability', t: 'dropdown', o: ['Available', 'Not Available'], by: 'PIC', src: 'mapping', rules: [YES] },
  { k: 'part_classification', l: 'Part classification', t: 'dropdown', o: ['MSIL', 'Proprietary'], by: 'PIC', src: 'mapping', dash: true, list: true, rules: [YES] },
  { k: 'monitoring_required_reason', l: 'Monitoring required reason', t: 'dropdown', o: ['New Part', 'ECN Part'], by: 'PIC', src: 'sap', rules: [YES] },
  { k: 'target_date_msil_drawing', l: 'Target date – MSIL drawing', t: 'date', by: 'System', src: 'calculated', rules: [YES, onlyWhen('part_classification', 'MSIL')] },
  { k: 'target_date_proprietary_part', l: 'Target date – Proprietary part', t: 'date', by: 'System', src: 'enovia', rules: [YES, onlyWhen('part_classification', 'Proprietary')] }
]

// ── PP02 · Spec meeting confirmation (system feeds; the PIC enters only the planned finish date) ──────────────────
// Tech meeting status and Process meeting status come from ENOVIA. They decide the applicability, a status rather
// than a field of its own: both N → Not applicable, both blank → Data update pending, either Y → Applicable. The other
// fields show only while it is Applicable. One "Spec meeting status": the ENOVIA status when the part has one, else
// the SAP status, else "Data Pending Updating". All of it is a C2 calculation table plus C1 show rules (no code).
const ENOVIA_SPEC = 'enovia_spec_meeting_status'
const SAP_SPEC = 'sap_spec_meeting_status'
const fieldValue = (key: string) => ({ kind: 'operand' as const, operand: { kind: 'field' as const, key } })
const SPEC_APPLICABLE = eq(F('spec_meeting_applicability'), K('Applicable'))
const showWhen = (when: ReturnType<typeof AND> | ReturnType<typeof eq>): FieldRule[] => [{ when, action: 'show' }]
const PP2: PpFieldSpec[] = [
  { k: 'tech_meeting_status', l: 'Tech meeting status', t: 'yesNo', by: 'System', src: 'enovia', dash: true, list: true },
  { k: 'process_meeting', l: 'Process meeting status', t: 'yesNo', by: 'System', src: 'enovia', dash: true },
  {
    k: 'spec_meeting_applicability', l: 'Spec meeting applicability', t: 'dropdown', o: ['Applicable', 'Not applicable', 'Data update pending'],
    by: 'System', src: 'calculated', dash: true, list: true,
    calc: {
      rules: [
        { when: OR(eq(F('tech_meeting_status'), K('Y')), eq(F('process_meeting'), K('Y'))), value: val('Applicable') },
        { when: AND(eq(F('tech_meeting_status'), K('N')), eq(F('process_meeting'), K('N'))), value: val('Not applicable') }
      ],
      // Both blank, or one N with the other still blank: the data is not complete yet.
      else: val('Data update pending')
    }
  },
  {
    k: 'spec_meeting_status', l: 'Spec meeting status', t: 'dropdown',
    o: ['Not Initiated', 'Initiated', 'Pending', 'Pending For Approval', 'Approved', 'Data Pending Updating'],
    by: 'System', src: 'calculated', dash: true, list: true, frules: showWhen(SPEC_APPLICABLE),
    calc: { rules: [{ when: filled(F(ENOVIA_SPEC)), value: fieldValue(ENOVIA_SPEC) }, { when: filled(F(SAP_SPEC)), value: fieldValue(SAP_SPEC) }], else: { kind: 'const', value: 'Data Pending Updating' } }
  },
  // Data-only: the two system feeds behind the Spec meeting status above (blank = the part is not in that system).
  { k: SAP_SPEC, l: 'SAP spec meeting status', t: 'dropdown', o: ['Not Initiated', 'Initiated', 'Pending For Approval', 'Approved'], by: 'System', src: 'sap', dash: true, dataOnly: true },
  { k: ENOVIA_SPEC, l: 'Enovia spec meeting status', t: 'dropdown', o: ['Initiated', 'Pending', 'Approved'], by: 'System', src: 'enovia', dash: true, dataOnly: true },
  { k: 'planned_start_date', l: 'Planned start date', t: 'date', by: 'System', src: 'enovia', frules: showWhen(SPEC_APPLICABLE) },
  // MSIL PIC gives the target date to the vendor.
  { k: 'planned_finish_date', l: 'Planned finish date', t: 'date', by: 'PIC', frules: [...showWhen(SPEC_APPLICABLE), { when: SPEC_APPLICABLE, action: 'makeMandatory' }] },
  { k: 'actual_start_date', l: 'Actual start date', t: 'date', by: 'System', src: 'sap', frules: showWhen(SPEC_APPLICABLE) },
  { k: 'sap_actual_end_date', l: 'SAP actual end date', t: 'date', by: 'System', src: 'sap', frules: showWhen(SPEC_APPLICABLE) },
  { k: 'enovia_actual_end_date', l: 'Enovia actual end date', t: 'date', by: 'System', src: 'enovia', frules: showWhen(SPEC_APPLICABLE) },
  // Data-only: calculated from SAP for the dashboards; not on the input form.
  { k: 'spec_meeting_timeliness', l: 'Spec meeting timeliness (from SAP)', t: 'dropdown', o: ['On time', 'Delayed'], by: 'System', src: 'sap', dash: true, dataOnly: true }
]

// ── PP03 · SOR sharing (Vendor submits; every disagreed point is then decided by PIC → SIC → DPM) ──
// Each category's Disagree count generates that many point rows, so every disagreed point is captured separately.
// The review is configuration, not code: columns carry visibility / mandatory rules and `rowReview` lists the stages.
const SOR_CLASSIFICATIONS = ['Alt Control', 'Not Feasible', 'Denial', 'Cost Up']
const ACCEPT_REJECT = ['Accept', 'Reject']
const ACCEPT_SEND_BACK = ['Accept', 'Send back']
const PP3: PpFieldSpec[] = [
  {
    k: 'sor_categories', l: 'SOR categories', t: 'table', by: 'Vendor', val: true,
    cols: [
      { key: 'sor_category_name', label: 'SOR category', type: 'text', required: true },
      { key: 'total', label: 'Total', type: 'number', required: true },
      { key: 'agree', label: 'Agree', type: 'number', required: true },
      { key: 'disagree', label: 'Disagree', type: 'number', required: true },
      { key: 'not_applicable', label: 'Not applicable', type: 'number', required: true }
    ]
  },
  {
    k: 'disagreed_points', l: 'Disagreed points (one row per disagreed point)', t: 'table', by: 'Vendor', val: true,
    derived: { from: 'count', fieldKey: 'sor_categories', countColumn: 'disagree', labelColumn: 'sor_category_name', targetLabelColumn: 'category' },
    rowNoun: 'point',
    cols: [
      // 1. SOR Category
      { key: 'category', label: 'SOR category', type: 'text', enteredBy: 'System' },
      // 2. Disagreed Point (SOR Requirement)
      { key: 'requirement', label: 'Disagreed point', type: 'longText', required: true },
      // 3. Disagree Reason
      { key: 'reason', label: 'Disagree reason', type: 'longText', required: true },
      // 4. PIC Decision
      { key: 'pic_decision', label: 'PIC decision', type: 'dropdown', options: ACCEPT_SEND_BACK, enteredBy: 'PIC', required: true },
      // 5. Classification (Accept only; the Vendor never sees it)
      { key: 'classification', label: 'Classification', type: 'dropdown', options: SOR_CLASSIFICATIONS, enteredBy: 'PIC', hiddenFromVendor: true, showWhen: { column: 'pic_decision', equals: ['Accept'] }, requiredWhen: { column: 'pic_decision', equals: ['Accept'] } },
      // 6. PIC remark: mandatory for both choices. Accept: stays with the reviewers. Send back: the Vendor sees it with the point.
      { key: 'pic_remark', label: 'PIC remark', type: 'longText', enteredBy: 'PIC', hiddenFromVendor: true, showWhen: { column: 'pic_decision', equals: ['Accept', 'Send back'] }, requiredWhen: { column: 'pic_decision', equals: ['Accept', 'Send back'] }, mandatoryMode: 'when' },
      // 8. SIC Decision
      { key: 'sic_decision', label: 'SIC decision', type: 'dropdown', options: ACCEPT_REJECT, enteredBy: 'SIC', hiddenFromVendor: true, showWhen: { column: 'pic_decision', equals: ['Accept'] }, requiredWhen: { column: 'pic_decision', equals: ['Accept'] } },
      // 9. Send back to (Vendor / PIC)
      { key: 'sic_route', label: 'Send back to', type: 'dropdown', options: ['Send back to Vendor', 'Send back to PIC'], enteredBy: 'SIC', hiddenFromVendor: true, showWhen: { column: 'sic_decision', equals: ['Reject'] }, requiredWhen: { column: 'sic_decision', equals: ['Reject'] } },
      // 10. SIC Comment (Optional if Accept, mandatory if Reject. Vendor sees only when SIC rejects AND sends back to Vendor)
      { key: 'sic_comment', label: 'SIC comment', type: 'longText', enteredBy: 'SIC', hiddenFromVendor: true, showWhen: { column: 'pic_decision', equals: ['Accept'] }, requiredWhen: { column: 'sic_decision', equals: ['Reject'] } },
      // 11. DPM Decision
      { key: 'dpm_decision', label: 'DPM decision', type: 'dropdown', options: ACCEPT_REJECT, enteredBy: 'DPM', hiddenFromVendor: true, showWhen: { column: 'sic_decision', equals: ['Accept'] }, requiredWhen: { column: 'sic_decision', equals: ['Accept'] } },
      // 12. DPM Comment (Optional if Accept, mandatory if Reject)
      { key: 'dpm_comment', label: 'DPM comment', type: 'longText', enteredBy: 'DPM', hiddenFromVendor: true, showWhen: { column: 'sic_decision', equals: ['Accept'] }, requiredWhen: { column: 'dpm_decision', equals: ['Reject'] } }
    ],
    rowReview: {
      stages: [
        { role: 'PIC', decisionColumn: 'pic_decision', acceptValue: 'Accept', rejectValue: 'Send back', columns: ['classification', 'pic_remark'], commentColumn: 'pic_remark', rejectTo: [{ label: 'Send back to Vendor', to: 'Vendor' }] },
        { role: 'SIC', decisionColumn: 'sic_decision', acceptValue: 'Accept', rejectValue: 'Reject', columns: ['sic_comment', 'sic_route'], commentColumn: 'sic_comment', routeColumn: 'sic_route', rejectTo: [{ label: 'Send back to Vendor', to: 'Vendor' }, { label: 'Send back to PIC', to: 'PIC' }] },
        { role: 'DPM', decisionColumn: 'dpm_decision', acceptValue: 'Accept', rejectValue: 'Reject', columns: ['dpm_comment'], commentColumn: 'dpm_comment', rejectTo: [{ label: 'Send back to PIC', to: 'PIC' }] }
      ]
    }
  }
]

// ── PP04 · Tier-2 compilation: the Vendor enters only the planned BOM upload date ────────────────────
// The Tier-2 supplier list comes from SAP and is data-only (dashboards), so it is not on the input form. Any field can
// be put back on the form, or new ones added, in the Activity Builder (untick "Data-only").
const PP4: PpFieldSpec[] = [
  { k: 'planned_bom_upload_date', l: 'Planned BOM upload date', t: 'date', by: 'Vendor', val: true, req: true, dash: true, list: true },
  {
    k: 'tier_2_suppliers', l: 'Tier-2 suppliers', t: 'table', by: 'System', src: 'sap', dash: true, dataOnly: true,
    derived: { from: 'sap' },
    cols: [
      { key: 'code', label: 'Tier-2 supplier code', type: 'number', enteredBy: 'System' },
      { key: 'name', label: 'Tier-2 supplier name', type: 'text', enteredBy: 'System' },
      { key: 'rag', label: 'Tier-2 status (RYG; blank = Others)', type: 'dropdown', options: ['Red', 'Yellow', 'Green'], enteredBy: 'System' },
      { key: 'others_status', label: 'Others status (when Tier-2 status is blank)', type: 'dropdown', options: ['New (Unaudited)', 'Tier-1', 'Directed Tier-2', 'Overseas', 'Trader', 'RM', 'Catalogue Part', 'Consumables', 'Others'], enteredBy: 'System' },
      { key: 'special_process_approved', label: 'Special process approved', type: 'dropdown', options: ['Yes', 'No'], enteredBy: 'System' }
    ]
  },
  // Data-only counts for the dashboards: rows of the Tier-2 table by RYG status (blank = Others).
  ...(['Red', 'Yellow', 'Green', ''] as const).map((v): PpFieldSpec => ({
    k: `tier_2_${v ? v.toLowerCase() : 'others'}_count`,
    l: `Tier-2 ${v || 'Others'} count`,
    t: 'number', by: 'System', src: 'calculated', dash: true, dataOnly: true,
    countRows: { tableField: 'tier_2_suppliers', column: 'rag', equals: v }
  }))
]

// ── PP05 · New Tier-2 assessment: the PP04 rows whose Others status is "New (Unaudited)" ────────────
// No input form for now: the list is data-only (dashboards). Fields can be added to the form in the Activity Builder.
const PP5: PpFieldSpec[] = [
  {
    k: 'new_tier_2_vendors', l: 'New Tier-2 vendors', t: 'table', by: 'System', src: 'sap', dash: true, dataOnly: true,
    derived: { from: 'activity', activityId: 'pp-4', fieldKey: 'tier_2_suppliers', where: { column: 'others_status', equals: 'New (Unaudited)' } },
    cols: [
      { key: 'code', label: 'New Tier-2 vendor code', type: 'number', enteredBy: 'System' },
      { key: 'name', label: 'New Tier-2 vendor name', type: 'text', enteredBy: 'System' },
      { key: 'audit_status', label: 'Audit status', type: 'dropdown', options: ['Done', 'Not done'], enteredBy: 'System' }
    ]
  }
]

// ── PP10 · Sheet metal part accuracy (accuracy % = OK ÷ total × 100) ────────────────────────────────
const APPLIC = onlyWhen('sheet_metal_applicability', 'Y')
const PP10: PpFieldSpec[] = [
  { k: 'sheet_metal_applicability', l: 'Sheet metal applicability (only for Weld part)', t: 'yesNo', by: 'System', src: 'sap' },
  { k: 'total_parameters', l: 'Total parameters', t: 'number', by: 'System', src: 'sap', rules: [APPLIC] },
  { k: 'ok_parameters', l: 'OK parameters', t: 'number', by: 'Vendor', val: true, rules: [APPLIC] },
  { k: 'accuracy', l: 'Accuracy %', t: 'percent', by: 'System', src: 'calculated', dash: true, rules: [APPLIC] }
]

// ── PP11 · Part inspection with deviation status (the OT pattern; configuration only) ─────────────────────────────
// Vendor: applicability (Y / N). System (fetched as the form opens, never left blank): target date, actual date,
// completed, evidence, status OK / NG. Target date breached (actual after it, or none yet and today past it) → the
// vendor's delay reason (reason + remark, as OT). NG → one row per NG (category, observation — vendor or PIC — and
// correction timeline — vendor), reviewed by the PIC (accept / reject loop, as OT). A correction timeline beyond MRD →
// deviation pop-up: raised?, E-Doc number, approval status (fetched from E-Doc) — PIC only. Re-verification: separate.
const INSP_APPLIES = eq(F('inspection_applicability'), K('Y'))
const INSP = { when: INSP_APPLIES, action: 'show' as const }
const IS_NG = AND(INSP_APPLIES, eq(F('inspection_status'), K('NG')))
const NG_BEYOND_MRD = AND(IS_NG, anyRow('ng_rows', gt(F('date'), MRD)))
const TARGET_BREACHED = AND(INSP_APPLIES, filled(F('inspection_target_date')), OR(
  gt(F('inspection_actual_date'), F('inspection_target_date')),
  AND(blank(F('inspection_actual_date')), gt(TODAY, F('inspection_target_date')))
))
const PI_NG = 'NG details (PIC review)'
const PP11: PpFieldSpec[] = [
  { k: 'inspection_applicability', l: 'Inspection applicability (on basis of part applicable for PP trial)', t: 'yesNo', by: 'Vendor', val: true, req: true },
  { k: 'inspection_target_date', l: 'Inspection target date', t: 'date', by: 'System', src: 'enovia', autoFetch: true, frules: [INSP] },
  { k: 'inspection_actual_date', l: 'Inspection actual date', t: 'date', by: 'System', src: 'sap', autoFetch: true, frules: [INSP] },
  { k: 'inspection_completed', l: 'Inspection completed', t: 'yesNo', by: 'System', src: 'enovia', autoFetch: true, frules: [INSP] },
  { k: 'evidence_attachment', l: 'Evidence attachment', t: 'yesNo', by: 'System', src: 'sap', autoFetch: true, frules: [INSP] },
  { k: 'inspection_status', l: 'Inspection status', t: 'dropdown', o: ['OK', 'NG'], by: 'System', src: 'enovia', autoFetch: true, dash: true, list: true, frules: [INSP] },
  {
    k: 'delay_reason', l: 'Delay reason and remark (target date breached)', t: 'table', by: 'Vendor', val: true, minRows: 1,
    cols: [
      { key: 'reason', label: 'Reason', type: 'dropdown', optionsFrom: 'delay-reasons', required: true },
      { key: 'remark', label: 'Remark', type: 'longText', required: true }
    ],
    frules: [{ when: TARGET_BREACHED, action: 'show' }, { when: TARGET_BREACHED, action: 'makeMandatory' }]
  },
  {
    k: 'ng_rows', l: 'NG details', t: 'table', by: 'Vendor', alsoBy: ['PIC'], val: true, section: PI_NG, minRows: 1, rowNoun: 'NG',
    cols: [
      { key: 'cat', label: 'NG category', type: 'dropdown', options: ['Appearance', 'Dimension', 'Material', 'Performance', 'Regulation'], required: true },
      { key: 'obs', label: 'NG observation', type: 'longText', required: true },
      { key: 'date', label: 'Correction timeline', type: 'date', enteredBy: 'Vendor', required: true }
    ],
    frules: [{ when: IS_NG, action: 'show' }, { when: IS_NG, action: 'makeMandatory' }]
  },
  // Kept for Lessons learnt ("late when true"): a correction timeline beyond MRD.
  { k: 'correction_beyond_mrd', l: 'Correction beyond MRD', t: 'flag', by: 'System', src: 'calculated', hidden: true, calc: { rules: [{ when: NG_BEYOND_MRD, value: val(true) }], else: val(false) } },
  // Re-verification of the corrected NG (separate from the inspection above), by the PIC.
  { k: 'reverification_date', l: 'Re-verification date', t: 'date', by: 'PIC', section: 'Re-verification', frules: [{ when: IS_NG, action: 'show' }] },
  { k: 'reverification_status', l: 'Re-verification status', t: 'dropdown', o: ['OK', 'NG'], by: 'PIC', section: 'Re-verification', frules: [{ when: IS_NG, action: 'show' }] },
  // Deviation (correction beyond MRD): MSIL only — the pop-up asks "raised?", then the E-Doc number; the status is fetched.
  { k: 'deviation_raised', l: 'Deviation raised', t: 'yesNo', by: 'PIC', section: 'Deviation' },
  { k: 'e_doc_number', l: 'E-Doc number', t: 'text', by: 'PIC', section: 'Deviation', search: true },
  { k: 'deviation_approval_status', l: 'Deviation approval status', t: 'dropdown', o: ['Approved (OK with deviation)', 'Rejected (NG)', 'Pending', 'In progress'], by: 'System', src: 'edoc', edocFrom: 'e_doc_number', section: 'Deviation', dash: true }
]

// ── PP06 · Newness confirmation – Mizenboshi status (PIC enters everything) ─────────────────────────────────────
// Applicability is set on the Applicability screen (shown on the form; No hides the rest). Item status is one table row:
// Accepted | Rejected by Engineering | Pending reply from Engineering, which must add up to the count of points.
const MIZ_TABLE = 'mizenboshi_item_status'
const anyRejected = anyRow(MIZ_TABLE, gt(F('rejected'), K(0)))
const PP6: PpFieldSpec[] = [
  { k: 'newness_score', l: 'Newness score', t: 'dropdown', o: ['3', '4', '5', '3+4', '3+5', '4+5', '3+4+5'], by: 'PIC', src: 'dropdown', req: true, dash: true, list: true },
  { k: 'newness_type', l: 'Newness type', t: 'dropdown', o: ['New Technology/New Process', 'New Technology/New Design'], by: 'PIC', src: 'dropdown', req: true, dash: true },
  { k: 'remark', l: 'Newness detail', t: 'longText', by: 'PIC' },
  { k: 'count_of_mizenboshi_items', l: 'Count of Mizenboshi points', t: 'number', by: 'PIC', req: true, dash: true, list: true },
  {
    k: MIZ_TABLE, l: 'Mizenboshi item status', t: 'table', by: 'PIC', maxRows: 1,
    cols: [
      { key: 'accepted', label: 'Accepted', type: 'number', required: true },
      { key: 'rejected', label: 'Rejected by Engineering', type: 'number', required: true },
      { key: 'pending', label: 'Pending reply from Engineering', type: 'number', required: true }
    ]
  },
  // Totals of the item-status row for the dashboards (not on the form).
  { k: 'count_accepted', l: 'Count of points accepted', t: 'number', by: 'System', src: 'calculated', dash: true, hidden: true, sumRows: { tableField: MIZ_TABLE, column: 'accepted' } },
  { k: 'count_rejected', l: 'Count of points rejected by Engineering', t: 'number', by: 'System', src: 'calculated', dash: true, hidden: true, sumRows: { tableField: MIZ_TABLE, column: 'rejected' } },
  { k: 'count_pending', l: 'Count of points pending reply from Engineering', t: 'number', by: 'System', src: 'calculated', dash: true, hidden: true, sumRows: { tableField: MIZ_TABLE, column: 'pending' } },
  // Optional: shown only when something was rejected.
  { k: 'remark_reason_for_rejection', l: 'Remark – reason for rejection', t: 'longText', by: 'PIC', frules: [{ when: anyRejected, action: 'show' }] },
  { k: 'planned_start_date', l: 'Planned start date', t: 'date', by: 'PIC' },
  { k: 'planned_end_date', l: 'Planned end date', t: 'date', by: 'PIC' },
  { k: 'actual_start_date', l: 'Actual start date', t: 'date', by: 'PIC' },
  { k: 'actual_end_date', l: 'Actual end date', t: 'date', by: 'PIC' }
]

// ── MPP05 · Process audit status ─────────────────────────────────────────────────────────────────────────────────
// Applicability is set on the Applicability screen (shown on the form; No hides the rest). The PIC enters the audit
// dates and OK / NG in EPMP (ENOVIA is not relied on yet); Completed / Pending follows the actual date. On NG the Vendor
// adds one row per NG observation (action plan, target date, delay reason when the target is after the MRD); the PIC
// accepts or rejects each row (a rejection returns it to the Vendor); once accepted the Vendor enters the closure date.
// The PIC writes the NG observations (adds the rows); the Vendor answers each with an action plan and target date.
const MPP5: PpFieldSpec[] = [
  { k: 'audit_planned_date', l: 'Audit planned date', t: 'date', by: 'PIC', vendor: true },
  { k: 'audit_actual_date', l: 'Audit actual date', t: 'date', by: 'PIC', vendor: true },
  {
    k: 'audit_completed_pending', l: 'Audit completed / pending', t: 'dropdown', o: ['Completed', 'Pending'], by: 'System', src: 'calculated', vendor: true, dash: true, list: true,
    calc: { rules: [{ when: filled(F('audit_actual_date')), value: val('Completed') }], else: val('Pending') }
  },
  { k: 'audit_status', l: 'Audit status', t: 'dropdown', o: ['OK', 'NG'], by: 'PIC', vendor: true, dash: true, list: true },
  {
    k: 'ng_observations', l: 'NG observations (one row per observation)', t: 'table', by: 'Vendor', val: true, addRowsBy: ['PIC'],
    frules: [{ when: eq(F('audit_status'), K('NG')), action: 'show' }],
    rowNoun: 'observation',
    cols: [
      { key: 'observation', label: 'NG observation', type: 'longText', required: true, enteredBy: 'PIC' },
      { key: 'action_plan', label: 'Action plan', type: 'longText', required: true },
      { key: 'target_date', label: 'Target date', type: 'date', required: true },
      // Only when the target date is after the (OTOP) MRD.
      { key: 'delay_reason', label: 'Delay reason (target date after MRD)', type: 'longText', showRule: gt(F('target_date'), MRD), requiredRule: gt(F('target_date'), MRD) },
      { key: 'actual_closure_date', label: 'Actual closure date', type: 'date', fillAfterAccept: true },
      { key: 'pic_decision', label: 'PIC decision', type: 'dropdown', options: ACCEPT_REJECT, enteredBy: 'PIC', required: true },
      { key: 'pic_remark', label: 'PIC remark', type: 'longText', enteredBy: 'PIC', showWhen: { column: 'pic_decision', equals: ['Accept', 'Reject'] }, requiredWhen: { column: 'pic_decision', equals: ['Reject'] } }
    ],
    rowReview: {
      stages: [
        { role: 'PIC', decisionColumn: 'pic_decision', acceptValue: 'Accept', rejectValue: 'Reject', columns: ['pic_remark'], commentColumn: 'pic_remark', rejectTo: [{ label: 'Send back to Vendor', to: 'Vendor' }] }
      ]
    }
  }
]

// ── MPP07 / Pilot · Homologation marking confirmation (a flow; camera status as a table, one row per cycle) ─────────
// PIC fields: Homologation applicable → Regulatory marking applicable → Camera available.
// Camera status table (Vendor, the PIC verifies), one row per update / verification cycle, columns appear as they apply:
//   Camera already considered? No → target date (to consider) + remarks.
//   Camera type (OCR / Image) only when the camera is available (PIC) and considered; then Camera implemented?
//   Implemented No → implementation target date. MSIL verification (PIC) once "implemented" is answered.
//   A target date passed without the camera being implemented, or verification "Not implemented" → reason for delay,
//   action plan and revised target date (the loop: the next row records the next attempt). Every row keeps a history
//   of who changed what, so earlier statuses stay visible.
// E-Doc deviation — a pop-up only (PIC; never shown to the vendor): on the latest row, not considered and no target
//   date by the MRD (OTOP), or not implemented and verification Not implemented, or still not implemented after the MRD.
const HOMOLOG_APPLICABLE = eq(F('homologation_applicable'), K('Y'))
const REG_MARKING = AND(HOMOLOG_APPLICABLE, eq(F('regulatory_marking_applicable'), K('Y')))
const CAM = 'camera_status'
const YES_NO = ['Yes', 'No']
const rConsideredNo = eq(F('considered'), K('No'))
const rTypeShown = AND(eq(F('considered'), K('Yes')), eq(F('camera_available'), K('Y')))
const rImplNo = eq(F('implemented'), K('No'))
const rDelayed = OR(
  eq(F('msil_verification'), K('Not implemented')),
  AND(rImplNo, filled(F('impl_target_date')), lt(F('impl_target_date'), TODAY)),
  AND(rConsideredNo, filled(F('consider_target_date')), lt(F('consider_target_date'), TODAY))
)
const last = (col: string) => F(`${CAM}.${col}`)
export const HOMOLOG_DEVIATION_WHEN = AND(
  REG_MARKING,
  OR(
    AND(eq(last('considered'), K('No')), OR(blank(last('consider_target_date')), gt(last('consider_target_date'), MRD))),
    AND(eq(last('implemented'), K('No')), eq(last('msil_verification'), K('Not implemented'))),
    // The MRD (OTOP) has passed and the camera is still not verified as implemented.
    AND(filled(F(CAM)), gt(TODAY, MRD), ne(last('msil_verification'), K('Implemented')))
  )
)
const homShow = (when: ConditionNode): FieldRule[] => [{ when, action: 'show' }, { when, action: 'makeMandatory' }]
const HOMOLOG: PpFieldSpec[] = [
  { k: 'homologation_applicable', l: 'Homologation applicable', t: 'yesNo', by: 'PIC', req: true, vendor: true, dash: true, list: true },
  { k: 'regulatory_marking_applicable', l: 'Regulatory marking applicable', t: 'yesNo', by: 'PIC', vendor: true, frules: homShow(HOMOLOG_APPLICABLE) },
  { k: 'camera_available', l: 'Camera available', t: 'yesNo', by: 'PIC', vendor: true, frules: homShow(REG_MARKING) },
  {
    k: CAM, l: 'Camera status (one row per update / verification cycle)', t: 'table', by: 'Vendor', val: true, minRows: 1, addRowsBy: ['Vendor', 'PIC'], logRows: true,
    // The vendor keeps updating rows after submission (each change is logged per row).
    frules: [...homShow(REG_MARKING), { when: REG_MARKING, action: 'makeEditable' }],
    cols: [
      { key: 'considered', label: 'Camera already considered', type: 'dropdown', options: YES_NO, required: true },
      { key: 'consider_target_date', label: 'Target date (to consider the camera)', type: 'date', showRule: rConsideredNo, requiredRule: rConsideredNo },
      { key: 'consider_remarks', label: 'Remarks', type: 'text', showRule: rConsideredNo },
      { key: 'camera_type', label: 'Camera type', type: 'dropdown', options: ['OCR', 'Image'], showRule: rTypeShown, requiredRule: rTypeShown },
      { key: 'implemented', label: 'Camera implemented', type: 'dropdown', options: YES_NO, showRule: filled(F('camera_type')), requiredRule: filled(F('camera_type')) },
      { key: 'impl_target_date', label: 'Target date (implementation)', type: 'date', showRule: rImplNo, requiredRule: rImplNo },
      { key: 'msil_verification', label: 'MSIL verification', type: 'dropdown', options: ['Implemented', 'Not implemented'], enteredBy: 'PIC', showRule: filled(F('implemented')) },
      { key: 'reason_for_delay', label: 'Reason for delay', type: 'text', showRule: rDelayed, requiredRule: rDelayed },
      { key: 'action_plan', label: 'Action plan', type: 'text', showRule: rDelayed, requiredRule: rDelayed },
      { key: 'revised_target_date', label: 'Revised target date', type: 'date', showRule: rDelayed, requiredRule: rDelayed }
    ]
  },
  // Latest verification, for lists and dashboards.
  { k: 'msil_verification_latest', l: 'MSIL verification (latest)', t: 'dropdown', o: ['Implemented', 'Not implemented'], by: 'System', src: 'calculated', vendor: true, dash: true, list: true, hidden: true, calc: { rules: [], else: { kind: 'operand', operand: last('msil_verification') } } },
  // Deviation answers: PIC only, entered in the pop-up (DeviationTrigger.popupOnly) and never shown to the vendor.
  { k: 'deviation_raised', l: 'Deviation raised', t: 'yesNo', by: 'PIC' },
  { k: 'e_doc_number', l: 'E-Doc number', t: 'text', by: 'PIC', search: true },
  { k: 'e_doc_approval_status', l: 'E-Doc approval status', t: 'dropdown', o: ['Approved', 'Under approval', 'Rejected'], by: 'PIC', src: 'edoc', edocFrom: 'e_doc_number', dash: true }
]
const HOMOLOG_CONFIG: PpActivityConfig = {
  fields: HOMOLOG,
  // The camera table carries its own reason for delay.
  delayPopup: false,
  deviation: {
    when: HOMOLOG_DEVIATION_WHEN,
    title: 'Deviation — homologation camera',
    message: 'The camera is not considered with a target date by the MRD, or it is not implemented and MSIL verification says Not implemented, or it is still not implemented after the MRD. Was a deviation raised? If Yes, enter the E-Doc number and its approval status.',
    edocField: 'e_doc_number',
    statusField: 'e_doc_approval_status',
    raisedField: 'deviation_raised',
    manualStatus: true,
    fetchStatus: true,
    popupOnly: true,
    approvalChain: false,
    enteredBy: 'PIC'
  }
}

// ── SOP15 · PPVT confirmation (the whole PPVT flow; SOP16 "Vendor PPVT details" is folded into it) ─────────────────
// PPVT happens once: "PPVT details — Vendor" is the Vendor's single self-PPVT record; for MSIL-scope parts "PPVT
// details — MSIL verification" is the PIC's own single check in the same fields (the PIC fills volume, OK / NG, NG
// type, issues, capacity observed and rejection %; the Vendor fills the target dates and action plans). Both show as a
// clean form: only the fields that apply (Quality NG → quality fields only). Shortage / day = Volume − Capacity
// observed is calculated. Only when that PPVT is NG do re-verification cycles open (one card per cycle, PIC
// requirement / status / categories / Open-Closed, Vendor dates); a Closed cycle locks the form.
const P1 = '1 · Part setup'
const P2 = '2 · PPVT details — Vendor (self PPVT)'
const P5 = '3 · PPVT details — MSIL verification (MSIL scope only)'
const P6 = '4 · Re-verification and closure'
const NG_TYPES = ['Quality', 'Capacity', 'Both']
const MSIL_SCOPE = eq(F('msil_scope'), K('MSIL scope'))
const PIC_DONE = eq(F('pic_verification_done'), K('Y'))
const SELF = 'ppvt_self'
const MSIL = 'ppvt_msil'
// Row conditions (a field operand reads the row's own cell first).
const rNg = eq(F('result'), K('NG'))
const rCap = AND(rNg, OR(eq(F('ng_type'), K('Capacity')), eq(F('ng_type'), K('Both'))))
const rQual = AND(rNg, OR(eq(F('ng_type'), K('Quality')), eq(F('ng_type'), K('Both'))))
// The PIC's observation is final for MSIL-scope parts once entered; otherwise the Vendor's. "table.column" = latest row.
const PIC_FINAL = AND(MSIL_SCOPE, filled(F(`${MSIL}.result`)))
const finalOf = (col: string): CalcSpec => ({
  rules: [{ when: PIC_FINAL, value: { kind: 'operand', operand: F(`${MSIL}.${col}`) } }],
  else: { kind: 'operand', operand: F(`${SELF}.${col}`) }
})
const fNg = eq(F('final_ppvt_result'), K('NG'))
const fCap = AND(fNg, OR(eq(F('final_ng_type'), K('Capacity')), eq(F('final_ng_type'), K('Both'))))
const fQual = AND(fNg, OR(eq(F('final_ng_type'), K('Quality')), eq(F('final_ng_type'), K('Both'))))
const CYCLES = 'reverification_cycles'
const CASE_CLOSED = anyRow(CYCLES, eq(F('case_status'), K('Closed')))
// A cycle with an action to carry out (Re-PPVT or Countermeasure verification) — not "OK as it is" — asks for dates.
const ACTING = OR(eq(F('requirement'), K('Re-PPVT')), eq(F('requirement'), K('Countermeasure Verification')))
const show = (when: ConditionNode): FieldRule[] => [{ when, action: 'show' }]
// The PPVT columns, shared by both tables; `pic` = the columns the PIC fills in the MSIL-verification table.
const ppvtCols = (pic: boolean): TableColumn[] => {
  const by = (picCol: boolean) => (pic ? (picCol ? 'PIC' : 'Vendor') : undefined) as PersonaId | undefined
  // In the MSIL table the Vendor's columns (target dates, action plans) open once the PIC has completed the check.
  const vendorCol = (rule: ConditionNode | undefined): ConditionNode | undefined => (pic ? (rule ? AND(PIC_DONE, rule) : PIC_DONE) : rule)
  return [
    { key: 'volume', label: 'PPVT volume / day', type: 'number', enteredBy: by(true), required: true },
    { key: 'target_date', label: 'PPVT target date', type: 'date', enteredBy: by(false), required: !pic, showRule: vendorCol(undefined) },
    { key: 'result', label: 'PPVT OK / NG', type: 'dropdown', options: ['OK', 'NG'], enteredBy: by(true), required: true },
    { key: 'ng_type', label: 'If NG: Quality or Capacity NG', type: 'dropdown', options: NG_TYPES, enteredBy: by(true), showRule: rNg, requiredRule: rNg },
    { key: 'capacity_issue', label: 'Capacity NG issue', type: 'text', enteredBy: by(true), showRule: rCap, requiredRule: rCap },
    { key: 'capacity_observed', label: 'Capacity observed / day (actual volume / 16 hrs at 80% efficiency)', type: 'number', enteredBy: by(true), showRule: rCap, requiredRule: rCap },
    {
      key: 'shortage', label: 'Shortage / day', type: 'text', enteredBy: 'System', showRule: rCap,
      calc: { rules: [{ when: gt(F('volume'), F('capacity_observed')), value: { kind: 'math', op: '-', left: F('volume'), right: F('capacity_observed') } }, { when: AND(filled(F('volume')), filled(F('capacity_observed'))), value: val('No shortage') }] }
    },
    { key: 'capacity_action_plan', label: 'Capacity action plan', type: 'text', enteredBy: by(false), showRule: vendorCol(rCap), requiredRule: pic ? undefined : rCap },
    { key: 'capacity_target_date', label: 'Capacity target date', type: 'date', enteredBy: by(false), showRule: vendorCol(rCap), requiredRule: pic ? undefined : rCap },
    { key: 'quality_issue', label: 'Quality issue', type: 'text', enteredBy: by(true), showRule: rQual, requiredRule: rQual },
    { key: 'quality_action_plan', label: 'Quality action plan', type: 'text', enteredBy: by(false), showRule: vendorCol(rQual), requiredRule: pic ? undefined : rQual },
    { key: 'rejection_pct', label: 'Rejection %', type: 'number', enteredBy: by(true), showRule: rQual, requiredRule: rQual },
    { key: 'quality_target_date', label: 'Quality target date', type: 'date', enteredBy: by(false), showRule: vendorCol(rQual), requiredRule: pic ? undefined : rQual }
  ]
}
const PPVT: PpFieldSpec[] = [
  // 1 · Part setup: QA department and SC from the part master (PIC, part no., part name and vendor head the form).
  { k: 'qa_department', l: 'QA department', t: 'text', by: 'System', src: 'calculated', vendor: true, section: P1, calc: { rules: [], else: { kind: 'operand', operand: { kind: 'part', attr: 'section' } } } },
  { k: 'sc', l: 'SC (supply chain)', t: 'text', by: 'System', src: 'calculated', vendor: true, section: P1, calc: { rules: [], else: { kind: 'operand', operand: { kind: 'part', attr: 'attrs.supply_chain_dept' } } } },
  { k: 'msil_scope', l: 'MSIL scope or Vendor scope', t: 'dropdown', o: ['Vendor scope', 'MSIL scope'], by: 'PIC', section: P1, dash: true, list: true },
  // 2 · The Vendor's self PPVT: one record (no rows to add). Hidden from the PIC while the PIC checks blind.
  {
    k: SELF, l: 'PPVT details — Vendor (self PPVT)', t: 'table', by: 'Vendor', val: true, section: P2, maxRows: 1, logRows: true, layout: 'form',
    hiddenFrom: { roles: ['PIC'], when: AND(MSIL_SCOPE, ne(F('pic_verification_done'), K('Y'))) },
    cols: ppvtCols(false)
  },
  {
    k: 'ppvt_status', l: 'PPVT status', t: 'dropdown', o: ['Not Done', 'Done'], by: 'System', src: 'calculated', vendor: true, dash: true, list: true, section: P2,
    calc: { rules: [{ when: filled(F('final_ppvt_result')), value: val('Done') }], else: val('Not Done') }
  },
  // 3 · MSIL verification (MSIL scope only): the PIC's own row(s) in the same columns; the Vendor sees the table only
  // after the PIC completes the check, and then fills its target dates and action plans.
  {
    k: MSIL, l: 'PPVT details — MSIL verification (PIC)', t: 'table', by: 'PIC', alsoBy: ['Vendor'], vendor: true, section: P5, maxRows: 1, logRows: true, layout: 'form',
    hiddenFrom: { roles: ['Vendor'], when: ne(F('pic_verification_done'), K('Y')) },
    frules: [...show(MSIL_SCOPE), { when: AND(MSIL_SCOPE, PIC_DONE), action: 'makeMandatory' }, { when: AND(MSIL_SCOPE, PIC_DONE), action: 'makeEditable' }],
    cols: ppvtCols(true)
  },
  { k: 'pic_verification_done', l: 'PIC verification complete (show the comparison with the Vendor’s values)', t: 'yesNo', by: 'PIC', section: P5, frules: show(MSIL_SCOPE) },
  {
    k: 'vendor_vs_pic', l: 'Vendor vs PIC (latest cycle)', t: 'comparison', by: 'System', section: P5, hiddenFrom: { roles: ['Vendor'] }, frules: show(AND(MSIL_SCOPE, PIC_DONE)),
    compare: {
      leftLabel: 'Vendor', rightLabel: 'PIC (final)',
      pairs: [
        { label: 'PPVT volume / day', left: `${SELF}.volume`, right: `${MSIL}.volume` },
        { label: 'PPVT OK / NG', left: `${SELF}.result`, right: `${MSIL}.result` },
        { label: 'NG type', left: `${SELF}.ng_type`, right: `${MSIL}.ng_type` },
        { label: 'Capacity NG issue', left: `${SELF}.capacity_issue`, right: `${MSIL}.capacity_issue` },
        { label: 'Capacity observed / day', left: `${SELF}.capacity_observed`, right: `${MSIL}.capacity_observed` },
        { label: 'Shortage / day', left: `${SELF}.shortage`, right: `${MSIL}.shortage` },
        { label: 'Quality issue', left: `${SELF}.quality_issue`, right: `${MSIL}.quality_issue` },
        { label: 'Rejection %', left: `${SELF}.rejection_pct`, right: `${MSIL}.rejection_pct` }
      ]
    }
  },
  {
    k: 'vendor_accuracy', l: 'Vendor accuracy %', t: 'percent', by: 'System', src: 'calculated', dash: true, section: P5, hiddenFrom: { roles: ['Vendor'] }, frules: show(AND(MSIL_SCOPE, PIC_DONE)),
    calc: { rules: [{ when: AND(MSIL_SCOPE, PIC_DONE), value: { kind: 'matchPct', pairs: (['volume', 'result', 'ng_type', 'capacity_issue', 'capacity_observed', 'shortage', 'quality_issue', 'rejection_pct'] as const).map((c) => [`${SELF}.${c}`, `${MSIL}.${c}`] as [string, string]) } }] }
  },
  // Final values: the PIC's for MSIL-scope parts (once entered), else the Vendor's; latest cycle. Not shown to the Vendor.
  { k: 'final_ppvt_result', l: 'Final PPVT result', t: 'dropdown', o: ['OK', 'NG'], by: 'System', src: 'calculated', dash: true, list: true, section: P5, hiddenFrom: { roles: ['Vendor'] }, calc: finalOf('result') },
  { k: 'final_ng_type', l: 'Final NG type', t: 'dropdown', o: NG_TYPES, by: 'System', src: 'calculated', dash: true, section: P5, hiddenFrom: { roles: ['Vendor'] }, calc: finalOf('ng_type'), frules: show(fNg) },
  { k: 'final_shortage_per_day', l: 'Final shortage / day', t: 'text', by: 'System', src: 'calculated', dash: true, section: P5, hiddenFrom: { roles: ['Vendor'] }, calc: finalOf('shortage'), frules: show(fCap) },
  // 4 · Re-verification — only when the PPVT is NG: one card per cycle, filled by the PIC and the Vendor together.
  // An NG PPVT takes one of three actions: Re-PPVT, Countermeasure verification, or OK as it is (NG accepted).
  // "OK as it is" needs no dates; the other two ask for the target / implementation / closure dates. PIC: requirement, status, categories, Open / Closed;
  // Vendor: implementation dates, target date (if pending), final date for closure. Every row keeps its history.
  {
    k: CYCLES, l: 'Re-verification cycles (PPVT NG)', t: 'table', by: 'PIC', alsoBy: ['Vendor'], vendor: true, section: P6, logRows: true, addRowsBy: ['PIC', 'Vendor'], layout: 'form', rowNoun: 'cycle', minRows: 1,
    frules: [...show(fNg), { when: fNg, action: 'makeEditable' }],
    cols: [
      // Shared by the PIC and the Vendor (no column owner = the table's roles: PIC and Vendor).
      { key: 'requirement', label: 'Action on PPVT NG', type: 'dropdown', options: ['Re-PPVT', 'Countermeasure Verification', 'OK As It Is'], required: true },
      { key: 'current_status', label: 'Current status (description)', type: 'longText' },
      { key: 'target_date_if_pending', label: 'Target date (if pending)', type: 'date', enteredBy: 'Vendor', showRule: ACTING },
      { key: 'case_status', label: 'Current status for PPVT NG case (Open / Closed)', type: 'dropdown', options: ['Open', 'Closed'], enteredBy: 'PIC', required: true },
      { key: 'capacity_cm_category', label: 'Capacity NG c/m category', type: 'dropdown', options: ['Additional facility installed', 'Additional working hours (not 3 shifts)', 'Three-shift working'], enteredBy: 'PIC', showRule: AND(fCap, ACTING) },
      { key: 'capacity_impl_date', label: 'Implementation date for capacity NG c/m', type: 'date', enteredBy: 'Vendor', showRule: AND(fCap, ACTING) },
      { key: 'quality_concern_category', label: 'Quality NG concern category', type: 'dropdown', options: ['Part correction', 'Process correction', 'Both'], enteredBy: 'PIC', showRule: AND(fQual, ACTING) },
      { key: 'quality_impl_date', label: 'Implementation date for quality NG c/m', type: 'date', enteredBy: 'Vendor', showRule: AND(fQual, ACTING) },
      { key: 'final_closure_date', label: 'Final date for closure', type: 'date', enteredBy: 'Vendor', showRule: ACTING }
    ]
  },
  // Closure.
  {
    k: 'ppvt_case_status', l: 'PPVT case status', t: 'dropdown', o: ['Not done', 'Open', 'Closed'], by: 'System', src: 'calculated', vendor: true, dash: true, list: true, section: P6,
    calc: {
      rules: [
        { when: blank(F('final_ppvt_result')), value: val('Not done') },
        { when: CASE_CLOSED, value: val('Closed') },
        // OK closes the case — for an MSIL-scope part only once the PIC's verification is in.
        { when: AND(eq(F('final_ppvt_result'), K('OK')), OR(ne(F('msil_scope'), K('MSIL scope')), PIC_DONE)), value: val('Closed') }
      ],
      else: val('Open')
    }
  }
]
const PPVT_CONFIG: PpActivityConfig = {
  name: 'PPVT confirmation',
  fields: PPVT,
  // A cycle marked Closed completes the case: the whole form becomes read-only.
  lockWhen: CASE_CLOSED,
  testScenarios: [
    {
      id: 'pv-1', name: '1 · Vendor scope, PPVT OK → Done and closed; no NG columns', mrd: '2027-01-15', today: '2026-11-30',
      input: { msil_scope: 'Vendor scope', ppvt_self: [{ volume: 675, target_date: '2026-11-20', result: 'OK' }] },
      expect: { values: { ppvt_status: 'Done', ppvt_case_status: 'Closed', final_ppvt_result: 'OK' }, hidden: ['reverification_cycles', 'ppvt_msil'] }
    },
    {
      id: 'pv-2', name: '2 · NG Both: shortage 675 − 600 = 75 in the row; re-verification opens', mrd: '2027-01-15', today: '2026-11-30',
      input: { ppvt_self: [{ volume: 675, result: 'NG', ng_type: 'Both', capacity_observed: 600 }] },
      expect: { values: { 'ppvt_self.shortage': 75, ppvt_status: 'Done', ppvt_case_status: 'Open', final_ng_type: 'Both' }, visible: ['reverification_cycles'] }
    },
    {
      id: 'pv-3', name: '3 · Capacity observed ≥ volume → "No shortage"', mrd: '2027-01-15', today: '2026-11-30',
      input: { ppvt_self: [{ volume: 600, result: 'NG', ng_type: 'Capacity', capacity_observed: 650 }] },
      expect: { values: { 'ppvt_self.shortage': 'No shortage' } }
    },
    {
      id: 'pv-4', name: '4 · MSIL scope: Vendor says OK, PIC finds Capacity NG → PIC is final; comparison and accuracy', mrd: '2027-01-15', today: '2026-11-30',
      input: { msil_scope: 'MSIL scope', ppvt_self: [{ volume: 675, result: 'OK' }], ppvt_msil: [{ volume: 675, result: 'NG', ng_type: 'Capacity', capacity_issue: 'One press', capacity_observed: 540 }], pic_verification_done: 'Y' },
      expect: { values: { final_ppvt_result: 'NG', final_ng_type: 'Capacity', 'ppvt_msil.shortage': 135, final_shortage_per_day: 135, vendor_accuracy: 17, ppvt_case_status: 'Open' }, visible: ['vendor_vs_pic', 'reverification_cycles'] }
    },
    {
      id: 'pv-5', name: '5 · A cycle marked Closed closes the case', mrd: '2027-01-15', today: '2026-11-30',
      input: { ppvt_self: [{ volume: 675, result: 'NG', ng_type: 'Quality' }], reverification_cycles: [{ requirement: 'Countermeasure Verification', current_status: 'Verified and OK', quality_concern_category: 'Process correction', case_status: 'Closed' }] },
      expect: { values: { ppvt_case_status: 'Closed' } }
    }
  ] as TestScenario[]
}

/**
 * Takes an activity's fields off the input form but keeps them as data-only (system-fed, for the dashboards), so the
 * activity has no input screen. The Admin can put any of them back on the form, or add new ones, in the Builder.
 */
const asDataOnly = (specs: PpFieldSpec[]): PpFieldSpec[] =>
  specs.map((s) => ({ ...s, by: 'System', src: !s.src || s.src === 'manual' ? 'sap' : s.src, val: false, req: false, dash: true, dataOnly: true }))
const sheetFields = (id: string) => EPMP_ACTIVITIES.find((a) => a.id === id)?.fields ?? []

/** Mark which of the activity's fields the vendor can see ('all' or a list of keys); vendor-entered fields are always visible. */
const vendorSees = (specs: PpFieldSpec[], keys: string[] | 'all'): PpFieldSpec[] =>
  specs.map((s) => (keys === 'all' || keys.includes(s.k) ? { ...s, vendor: true } : s))

export const PP_FIELD_CONFIG: Record<string, PpActivityConfig> = {
  'pp-9': PP9_CONFIG,
  // OTOP status: the OT pattern (vendor dates, system status, PIC may turn it Non-OTOP, reasons table, E-Doc).
  'mpp-1': MPP1_CONFIG,
  'pp-1': { fields: vendorSees(PP1, 'all') },
  'pp-2': { name: 'Spec meeting confirmation', fields: PP2, vendorTimeline: true },
  // Agree + Disagree + Not applicable must equal Total for every SOR category.
  'pp-3': { fields: vendorSees(PP3, []), validationRules: [{ id: 'pp3-sum', scope: { tableField: 'sor_categories' }, left: ['agree', 'disagree', 'not_applicable'], op: '=', right: ['total'] }] },
  'pp-4': { fields: PP4 },
  'pp-5': { fields: vendorSees(PP5, 'all') },
  // Mizenboshi: Accepted + Rejected + Pending (the item-status row) must add up to the count of points.
  'pp-6': {
    fields: PP6,
    showApplicability: true,
    validationRules: [{
      // The message is generated with the numbers, e.g. "Accepted + Rejected by Engineering + Pending reply from Engineering (13) must equal Count of Mizenboshi points (14)".
      id: 'pp6-sum', scope: 'fields', left: [`${MIZ_TABLE}.accepted`, `${MIZ_TABLE}.rejected`, `${MIZ_TABLE}.pending`], op: '=', right: ['count_of_mizenboshi_items']
    }]
  },
  // Parts list with deviations & special parts list: no input screen (data-only for now), PP and MPP.
  'pp-16': { fields: asDataOnly(sheetFields('pp-16')) },
  'mpp-11': { fields: asDataOnly(sheetFields('mpp-11')) },
  'mpp-5': { fields: MPP5, showApplicability: true },
  // Homologation marking confirmation: same configuration under MPP and under Pilot / SOP (camera inspection).
  'mpp-7': HOMOLOG_CONFIG,
  'sop-9': HOMOLOG_CONFIG,
  // PPVT: the whole flow lives in SOP15; SOP16 ("Vendor PPVT details") is folded into it, so it has no input form.
  'sop-15': PPVT_CONFIG,
  'sop-16': { fields: asDataOnly(sheetFields('sop-16')) },
  // OK parameters cannot exceed the total.
  'pp-10': { fields: vendorSees(PP10, 'all'), validationRules: [{ id: 'pp10-ok', scope: 'fields', left: ['ok_parameters'], op: '<=', right: ['total_parameters'] }] },
  'pp-11': {
    fields: vendorSees(PP11, ['inspection_target_date', 'inspection_actual_date', 'inspection_completed', 'evidence_attachment', 'inspection_status', 'ng_rows']),
    trackNgRounds: true,
    // Its own delay reason: the generic pop-up is off.
    delayPopup: false,
    groupReviews: [
      {
        id: 'ng-correction', label: 'NG details and correction timeline', section: PI_NG, fillerRole: 'Vendor', reviewerRole: 'PIC',
        opensWhen: IS_NG, lockOnAccept: true, rejectCommentRequired: true, escalateAfter: 3, escalateTo: 'SIC', partialFields: ['ng_rows'],
        // Re-verification opens once the PIC accepts the NG rows; NG again → a new cycle: fresh NG details, review, re-verification.
        onAccept: { showFields: ['reverification_date', 'reverification_status'] },
        repeat: { when: eq(F('reverification_status'), K('NG')), clearFields: ['reverification_date', 'reverification_status'] }
      }
    ],
    deviation: {
      when: NG_BEYOND_MRD,
      title: 'Deviation — NG correction beyond MRD',
      message: 'A correction timeline is beyond the MRD. Was a deviation raised? Enter its E-Doc number; the approval status comes from E-Doc.',
      raisedField: 'deviation_raised',
      edocField: 'e_doc_number',
      statusField: 'deviation_approval_status',
      enteredBy: 'PIC',
      fetchStatus: true,
      approvalChain: false
    },
    testScenarios: [
      { id: 'pi-1', name: '1 · Not applicable → nothing else shown', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'N' }, expect: { hidden: ['inspection_target_date', 'inspection_status', 'ng_rows', 'delay_reason'] } },
      { id: 'pi-2', name: '2 · OK on time → no delay, no NG table', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_target_date: '2026-11-10', inspection_actual_date: '2026-11-08', inspection_status: 'OK' }, expect: { hidden: ['delay_reason', 'ng_rows', 'reverification_status'], deviation: false } },
      { id: 'pi-3', name: '3 · Actual after the target date → delay reason (vendor)', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_target_date: '2026-11-10', inspection_actual_date: '2026-11-12', inspection_status: 'OK' }, expect: { visible: ['delay_reason'], mandatory: ['delay_reason'] } },
      { id: 'pi-3b', name: '3b · No actual yet and today past the target date → delay reason', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_target_date: '2026-11-10' }, expect: { visible: ['delay_reason'] } },
      { id: 'pi-4', name: '4 · NG, corrections within MRD → NG table + re-verification, no deviation', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_target_date: '2026-11-10', inspection_actual_date: '2026-11-08', inspection_status: 'NG', ng_rows: [{ cat: 'Dimension', obs: 'Hole offset 0.3', date: '2026-11-25' }] }, rounds: [{ groupId: 'ng-correction', decisions: ['Accept'] }], expect: { visible: ['ng_rows', 'reverification_status'], mandatory: ['ng_rows'], deviation: false, hidden: ['deviation_raised', 'e_doc_number'] } },
      { id: 'pi-4b', name: '4b · …NG rows not yet accepted → re-verification not shown yet', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_status: 'NG', ng_rows: [{ cat: 'Dimension', obs: 'Hole offset 0.3', date: '2026-11-25' }] }, expect: { visible: ['ng_rows'], hidden: ['reverification_date', 'reverification_status'] } },
      { id: 'pi-4c', name: '4c · …re-verification NG → cycle 2: NG details empty and required again, re-verification hidden until accepted', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_status: 'NG', ng_rows: [{ cat: 'Dimension', obs: 'Hole offset 0.3', date: '2026-11-25' }] }, rounds: [{ groupId: 'ng-correction', decisions: ['Accept'] }], afterInput: { reverification_date: '2026-11-26', reverification_status: 'NG' }, expect: { groups: { 'ng-correction': 'filling' }, visible: ['ng_rows'], mandatory: ['ng_rows'], hidden: ['reverification_status'], values: { ng_rows: '', reverification_status: '' } } },
      { id: 'pi-4d', name: '4d · …re-verification OK → loop stays accepted, no new cycle', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_status: 'NG', ng_rows: [{ cat: 'Dimension', obs: 'Hole offset 0.3', date: '2026-11-25' }] }, rounds: [{ groupId: 'ng-correction', decisions: ['Accept'] }], afterInput: { reverification_date: '2026-11-26', reverification_status: 'OK' }, expect: { groups: { 'ng-correction': 'accepted' }, values: { reverification_status: 'OK' } } },
      { id: 'pi-5', name: '5 · NG, one correction beyond MRD → deviation pop-up (raised? first); rows rejected once then accepted', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_target_date: '2026-11-10', inspection_actual_date: '2026-11-08', inspection_status: 'NG', ng_rows: [{ cat: 'Dimension', obs: 'Hole offset', date: '2026-11-25' }, { cat: 'Material', obs: 'Grade change', date: '2026-12-10' }] }, rounds: [{ groupId: 'ng-correction', decisions: ['Reject', 'Accept'] }], expect: { groups: { 'ng-correction': 'accepted' }, deviation: true, visible: ['deviation_raised'], mandatory: ['deviation_raised'], hidden: ['e_doc_number'], values: { correction_beyond_mrd: true } } },
      { id: 'pi-5b', name: '5b · …deviation raised = Y → E-Doc number and approval status required', mrd: '2026-12-01', today: '2026-11-20', input: { inspection_applicability: 'Y', inspection_status: 'NG', ng_rows: [{ cat: 'Material', obs: 'Grade change', date: '2026-12-10' }], deviation_raised: 'Y' }, expect: { deviation: true, visible: ['e_doc_number', 'deviation_approval_status'], mandatory: ['e_doc_number', 'deviation_approval_status'] } }
    ] as TestScenario[],
    canReferenceOtherActivities: true,
    // Demo: part inspection is timed off the sub-type MRD — once under PP and again under MPP — so it splits into a
    // PP instance and an MPP instance per part (Weld parts off the Weld MRD, Engine off Engine, others off Assembly).
    timelineTemplate: [
      { category: 'Weld', offsets: [{ milestoneId: 'PP', subType: 'Weld', minusDays: 10, endMinusDays: 0 }, { milestoneId: 'MPP', subType: 'Weld', minusDays: 8, endMinusDays: 0 }] },
      { category: 'Engine', offsets: [{ milestoneId: 'PP', subType: 'Engine', minusDays: 10, endMinusDays: 0 }, { milestoneId: 'MPP', subType: 'Engine', minusDays: 8, endMinusDays: 0 }] },
      { category: 'PlasticAssy', offsets: [{ milestoneId: 'PP', subType: 'Assembly', minusDays: 10, endMinusDays: 0 }, { milestoneId: 'MPP', subType: 'Assembly', minusDays: 8, endMinusDays: 0 }] },
      { category: 'RubberAssy', offsets: [{ milestoneId: 'PP', subType: 'Assembly', minusDays: 10, endMinusDays: 0 }, { milestoneId: 'MPP', subType: 'Assembly', minusDays: 8, endMinusDays: 0 }] },
      { category: 'OtherAssy', offsets: [{ milestoneId: 'PP', subType: 'Assembly', minusDays: 10, endMinusDays: 0 }, { milestoneId: 'MPP', subType: 'Assembly', minusDays: 8, endMinusDays: 0 }] }
    ]
  }
}

