/**
 * Demo presets applied by the sample-data loader ("Load sample parts"), so a client demo starts from the same
 * state in any browser. Seed configuration only — the engine and screens never read this file.
 *
 * OT status demo: every model shares PP MRD 31 Oct 2026 (target date = MRD − 14 = 17 Oct), and the eight OT forms
 * start as blank drafts whose OT planned date (from ENOVIA) is one of three kinds:
 *   A = before the target date (10 Oct) · B = between target and MRD (24 Oct) · C = after MRD (10 Nov).
 * The Minda parts (the Vendor login) carry one of each, so every plan × actual case can be shown as the Vendor.
 */
export const DEMO_MILESTONE_MRDS: Record<string, string> = { PP: '2026-10-31' }
/** Milestone MRDs for one model (after the shared ones): SOR Adherence demo part 35520-M68P00 is a Baleno. */
export const DEMO_MODEL_MRDS: Record<string, Record<string, string>> = { Baleno: { MPP: '2026-12-15' } }

export interface DemoEntryPreset {
  activityId: string
  partNo: string
  /** The form starts as a blank draft holding only these values. */
  values: Record<string, unknown>
  /** Workflow state (default Draft), e.g. an approved PP activity another activity pulls from. */
  state?: 'Draft' | 'Submitted' | 'Approved'
}
const sorRow = (name: string, agree: number, disagree: number) => ({ sor_category_name: name, total: agree + disagree, agree, disagree, not_applicable: 0 })

const otPlan = (partNo: string, plan: string, goAhead: 'Y' | 'N' = 'Y'): DemoEntryPreset => ({
  activityId: 'pp-9',
  partNo,
  values: { applicability_of_msil_tool_go_ahead: goAhead, ...(goAhead === 'Y' ? { msil_tool_go_ahead_date: '2026-08-01' } : {}), ot_planned_date: plan }
})

export const DEMO_ENTRY_PRESETS: DemoEntryPreset[] = [
  otPlan('31100-M74LD0', '2026-10-10'), // A · Vendor
  otPlan('31100-M74LD1', '2026-10-24'), // B · Vendor
  otPlan('35520-M68P00', '2026-11-10'), // C · Vendor
  otPlan('71811-M82P00', '2026-10-10'), // A · PIC
  otPlan('84701-M55R10', '2026-10-10'), // A · PIC (actual after MRD → E-Doc)
  otPlan('71811-M82P01', '2026-10-24'), // B · PIC
  otPlan('95100-M82P10', '2026-11-10'), // C · PIC
  otPlan('39100-M74F00', '2026-10-10', 'N'), // go-ahead not applicable
  // OTOP status demo: the Vendor enters every OTOP date itself, so its forms simply start blank (MPP MRD per model).
  ...['31100-M74LD0', '31100-M74LD1', '35520-M68P00'].map((partNo) => ({ activityId: 'mpp-1', partNo, values: {} })),
  // SOR Adherence demo (35520-M68P00, MPP MRD 15 Dec): the PP SOR agreed Plastic 20 / 5 and Sheet Metal 10 / 2.
  { activityId: 'pp-3', partNo: '35520-M68P00', state: 'Approved', values: { sor_categories: [sorRow('Plastic', 20, 5), sorRow('Sheet Metal', 10, 2)] } },
  { activityId: 'mpp-12', partNo: '35520-M68P00', values: {} }
]
