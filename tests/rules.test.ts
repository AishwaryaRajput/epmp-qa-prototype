/**
 * Rule-engine regression + scenario tests. Run: npm run test:rules
 * (bundles with rolldown, runs with node). No test framework needed.
 */
import assert from 'node:assert/strict'
import { PP_ACTIVITIES } from '../src/mock/ppActivities'
import {
  evaluateCalculatedFields, evaluateConditionalRules, evaluateValidationRules, evaluateAll, ruleExtra, legacyToRules,
  groupSubmit, groupDecide, canDecideGroup, deviationRequired, detectNotifyChanges, fieldMissing, describeCondition, withMasterLists,
  overrideAllowed, overrideOptions, overrideEvents, overrideNotices, canEditField, openLoopMessage, runScenario, normalizeReasonRemark,
  rowRuleFor, columnVisible, isRequired, cellEditable, fillAfterAcceptOpen, entryCellsOpen, deviationMissing, loopsSentWithForm
} from '../src/engine'
import { migrateStore, STORE_VERSION } from '../src/store/migrate'
import { buildDemoData } from '../src/mock/demoParts'
import { SEED_ACTIVITIES, SEED_TEMPLATE_ROWS, SEED_MODELS } from '../src/mock'
import { APP_TODAY } from '../src/domain/today'
import { SEED_MASTER_LISTS } from '../src/mock/ppRuleConfig'
import { buildStage } from '../src/domain/stageMacro'
import type { ActivityDefinition } from '../src/domain'
import { buildVendorScores } from '../src/features/lessons/insights'
import { SOR_ADHERENCE } from '../src/mock/sorAdherence'
import { pulledTableRows, rowsFromCount as rowsFromCount2, evaluateValidationRules as evalRules2, evaluateAll as evalAll2, rowRuleFor as rowRule2, ruleExtra as ruleExtra2, columnVisible as colVis2 } from '../src/engine'

let pass = 0
let fail = 0
// Tests are queued and run in order; async tests are awaited (an un-awaited async test used to pass without running).
const queue: { name: string; fn: () => void | Promise<void> }[] = []
function t(name: string, fn: () => void | Promise<void>) {
  queue.push({ name, fn })
}
const section = (title: string) => queue.push({ name: `\n${title}`, fn: () => undefined })
const act = (id: string) => PP_ACTIVITIES.find((a) => a.id === id) as ActivityDefinition
const part: any = { department: 'A', partNo: 'X' }
const calc = (id: string, v: Record<string, any>, mrd?: string) => evaluateCalculatedFields(act(id), v, part, mrd, undefined, ruleExtra(act(id), undefined, { mrd, part }))

section('Regression: calculations moved from engine code to config')
t('pp-1 target date = MRD, cleared while MRD blank', () => {
  assert.equal(calc('pp-1', {}, '2026-12-01').target_date_msil_drawing, '2026-12-01')
  assert.equal('target_date_msil_drawing' in calc('pp-1', { target_date_msil_drawing: '2026-01-01' }, undefined), false)
})
t('pp-2 applicability from Tech / Process meeting status', () => {
  assert.equal(calc('pp-2', { tech_meeting_status: 'N', process_meeting: 'N' }).spec_meeting_applicability, 'Not applicable')
  assert.equal(calc('pp-2', { tech_meeting_status: 'Y', process_meeting: 'N' }).spec_meeting_applicability, 'Applicable')
  assert.equal(calc('pp-2', { process_meeting: 'Y' }).spec_meeting_applicability, 'Applicable')
  assert.equal(calc('pp-2', {}).spec_meeting_applicability, 'Data update pending')
  assert.equal(calc('pp-2', { tech_meeting_status: 'N' }).spec_meeting_applicability, 'Data update pending')
})
t('pp-10 accuracy', () => {
  assert.equal(calc('pp-10', { total_parameters: 12, ok_parameters: 11 }).accuracy, 91.7)
  assert.equal('accuracy' in calc('pp-10', { total_parameters: 0, ok_parameters: 0 }), false)
  assert.equal('accuracy' in calc('pp-10', { total_parameters: 10 }), false)
  assert.equal(calc('pp-10', { total_parameters: 10, ok_parameters: 0 }).accuracy, 0)
})
t('pp-11 correction beyond MRD', () => {
  const rows = [{ date: '2026-12-05' }]
  assert.equal(calc('pp-11', { ng_rows: rows }, '2026-12-01').correction_beyond_mrd, true)
  assert.equal(calc('pp-11', { ng_rows: rows }, undefined).correction_beyond_mrd, false)
  assert.equal(calc('pp-11', { ng_rows: [{ date: '2026-11-01' }] }, '2026-12-01').correction_beyond_mrd, false)
})
t('mpp-1 OTOP status: actual beyond MRD Non-OTOP, within MRD OTOP, plan beyond MRD Non-OTOP, else blank', () => {
  assert.equal(calc('mpp-1', {}, '2026-12-01').otop_status, undefined)
  assert.equal(calc('mpp-1', { otop_actual_end_date: '2026-11-01' }, '2026-12-01').otop_status, 'OTOP')
  assert.equal(calc('mpp-1', { otop_actual_end_date: '2026-12-09' }, '2026-12-01').otop_status, 'Non-OTOP')
  assert.equal(calc('mpp-1', { otop_planned_end_date: '2026-12-09' }, '2026-12-01').otop_status, 'Non-OTOP')
  assert.equal(calc('mpp-1', { otop_planned_end_date: '2026-12-09', otop_actual_end_date: '2026-11-20' }, '2026-12-01').otop_status, 'OTOP')
})
t('legacy ConditionalRule still hides / shows (pp-1 YES rule)', () => {
  const st = evaluateConditionalRules(act('pp-1').fields, { drawing_applicability: 'N' })
  assert.equal(st.spec_drawing_availability.visible, false)
  assert.equal(evaluateConditionalRules(act('pp-1').fields, { drawing_applicability: 'Y' }).spec_drawing_availability.visible, true)
  assert.equal(legacyToRules(act('pp-1').fields[1]).length, 1)
})
t('old sum validation rules unchanged (pp-10)', () => {
  const v = evaluateValidationRules(act('pp-10'), { total_parameters: 5, ok_parameters: 7 })
  assert.equal(v.length, 1)
})
t('no activity id / pp-9 field key hard-coded in engine, components, features or store', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []))
  const files = ['src/engine', 'src/components', 'src/features', 'src/store'].flatMap(walk).filter((f) => !f.replace(/\\/g, '/').endsWith('src/store/migrate.ts'))
  assert.ok(files.length > 50, `scanned only ${files.length} files`)
  const keys = pp9.fields.map((f) => f.key)
  const idPattern = /['"`](pp|mpp|sop)-\d+['"`]/
  const bad: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    if (idPattern.test(src)) bad.push(`${f}: activity id`)
    for (const k of keys) if (new RegExp(`['"\`.]${k}\\b`).test(src)) bad.push(`${f}: ${k}`)
  }
  assert.deepEqual(bad, [])
})

section('pp-9 OT status (configuration only)')
const pp9 = act('pp-9')
const MRD = '2026-12-01'
const run = (v: Record<string, any>, today = '2026-11-30', groupState?: any, def: ActivityDefinition = pp9) =>
  evaluateAll(def, v, { mrd: MRD, today, part, groupState })
const base = { ot_planned_date: '2026-11-10' }
const fieldOf = (k: string) => pp9.fields.find((f) => f.key === k)!

t('stage status words: Pending / Started / Completed and Pending / Done', () => {
  assert.equal(run({}).values.tool_cutting_status, 'Pending')
  assert.equal(run({ tool_cutting_actual_start_date: '2026-10-01' }).values.tool_cutting_status, 'Started')
  assert.equal(run({ tool_cutting_actual_start_date: '2026-10-01', tool_cutting_actual_end_date: '2026-10-05' }).values.tool_cutting_status, 'Completed')
  assert.equal(run({}).values.tool_assembly_status, 'Pending')
  assert.equal(run({}).values.tool_trial_status, 'Pending')
  assert.equal(run({ tool_trial_actual_date: '2026-10-01' }).values.tool_trial_status, 'Done')
  assert.ok(!pp9.fields.some((f) => (f.options ?? []).includes('Not Started')))
})
t('stage status follows the actual dates only: start = Started, start + end = Completed, else Pending', () => {
  const st = (v: Record<string, any>) => run(v).values.tool_cutting_status
  assert.equal(st({ tool_cutting_actual_end_date: '2026-10-05' }), 'Pending') // end without start
  assert.equal(st({ tool_cutting_planned_start_date: '2026-10-10', tool_cutting_planned_end_date: '2026-10-01', tool_cutting_actual_start_date: '2026-10-02' }), 'Started') // planned dates never change it
  assert.equal(run({ tool_assembly_actual_start_date: '2026-10-01' }).values.tool_assembly_status, 'Started')
  assert.equal(run({ tool_assembly_actual_start_date: '2026-10-01', tool_assembly_actual_end_date: '2026-10-04' }).values.tool_assembly_status, 'Completed')
  assert.equal(run({ tool_trial_actual_date: '2026-10-03' }).values.tool_trial_status, 'Done')
  assert.equal(run({}).values.tool_trial_status, 'Pending')
  // a future actual is still blocked by the checks
  assert.ok(run({ tool_assembly_actual_start_date: '2026-12-20' }).violations.some((v) => v.message.includes('future')))
})
t('plan / actual validations (end ≥ start, end needs start, no future)', () => {
  assert.ok(run({ tool_cutting_planned_start_date: '2026-10-05', tool_cutting_planned_end_date: '2026-10-01' }).violations.length > 0)
  assert.ok(run({ tool_cutting_actual_end_date: '2026-10-01' }).violations.some((v) => v.message.includes('before')))
  assert.ok(run({ tool_cutting_actual_start_date: '2026-12-20' }).violations.some((v) => v.message.includes('future')))
})
t('stage delay remark: visible + mandatory when actual > planned', () => {
  const late = run({ tool_trial_planned_date: '2026-09-01', tool_trial_actual_date: '2026-10-01' })
  assert.equal(late.states.tool_trial_delay_remark.visible, true)
  assert.equal(late.states.tool_trial_delay_remark.mandatory, true)
  assert.equal(run({ tool_trial_planned_date: '2026-10-01', tool_trial_actual_date: '2026-10-01' }).states.tool_trial_delay_remark.visible, false)
  const cutLate = run({ tool_cutting_planned_start_date: '2026-09-01', tool_cutting_planned_end_date: '2026-09-10', tool_cutting_actual_start_date: '2026-09-01', tool_cutting_actual_end_date: '2026-09-12' })
  assert.equal(cutLate.states.tool_cutting_delay_remark.mandatory, true)
})
t('label: Tool Assembly Planned End Date', () => {
  assert.equal(fieldOf('tool_assembly_planned_end_date').label, 'Tool Assembly Planned End Date')
})
t('OT status: OT / Non-OT only, blank until it can be decided', () => {
  assert.deepEqual(fieldOf('ot_status').options, ['OT', 'Non-OT'])
  assert.equal('ot_status' in run(base).values, false) // plan within MRD, no actual yet
  assert.equal(run({ ot_planned_date: '2026-12-10' }).values.ot_status, 'Non-OT')
  assert.equal(run({ ...base, actual_ot_date: '2026-11-20' }).values.ot_status, 'OT')
  assert.equal(run({ ...base, actual_ot_date: '2026-12-05' }, '2026-12-31').values.ot_status, 'Non-OT')
})
t('MRD boundary is a setting: 0 = an actual on the MRD is OT, −1 = Non-OT', () => {
  assert.equal(run({ ...base, actual_ot_date: MRD }, '2026-12-31').values.ot_status, 'OT')
  const strict = { ...pp9, parameters: pp9.parameters!.map((p) => (p.key === 'ot_mrd_grace_days' ? { ...p, value: -1 } : p)) }
  assert.equal(evaluateAll(strict, { ...base, actual_ot_date: MRD }, { mrd: MRD, today: '2026-12-31', part }).values.ot_status, 'Non-OT')
})
t('delay reason: shown + mandatory for a slip within MRD (actual > plan, or plan > MRD − 14), not for Non-OT', () => {
  const a = run({ ...base, actual_ot_date: '2026-11-25' })
  assert.equal(a.states.ot_delay_reason.visible, true)
  assert.equal(a.states.ot_delay_reason.mandatory, true)
  const b = run({ ot_planned_date: '2026-11-25' })
  assert.equal(b.states.ot_delay_reason.visible, true)
  assert.equal(run({ ot_planned_date: '2026-12-10' }).states.ot_delay_reason.visible, false)
  assert.equal(run({ ...base, actual_ot_date: '2026-11-05' }).states.ot_delay_reason.visible, false)
})
t('delay reasons: rows of reason + remark (both required per row); editable by Vendor and PIC', () => {
  const f = fieldOf('ot_delay_reason')
  assert.equal(f.type, 'table')
  assert.ok(fieldMissing(f, []))
  assert.ok(fieldMissing(f, [{ reason: 'ECN case' }])!.includes('Remark'))
  assert.ok(fieldMissing(f, [{ remark: 'x' }])!.includes('Reason'))
  assert.equal(fieldMissing(f, [{ reason: 'ECN case', remark: 'ECN 123 changed the tool' }, { reason: 'Tool maturation delay', remark: 'Second trial' }]), null)
  assert.equal(f.columns!.find((c) => c.key === 'reason')!.optionsFrom, 'delay-reasons')
  for (const k of ['ot_delay_reason', 'non_ot_reason_system', 'action_plan_remark']) {
    const g = fieldOf(k)
    assert.ok(g.enteredBy === 'Vendor' && (g.alsoEditableBy ?? []).includes('PIC'), k)
  }
})
t('system Non-OT: reason rows + target OT date shown and mandatory (the loop cannot be sent empty)', () => {
  const r = run({ ot_planned_date: '2026-12-10' })
  for (const k of ['non_ot_reason_system', 'non_ot_target_date']) {
    assert.equal(r.states[k].visible, true, k)
    assert.equal(r.states[k].mandatory, true, k)
  }
  const f = fieldOf('non_ot_reason_system')
  assert.ok(fieldMissing(f, undefined))
  assert.ok(fieldMissing(f, [{ reason: 'Tool maturation delay' }])!.includes('Remark'))
  assert.equal(fieldMissing(f, [{ reason: 'Tool maturation delay', remark: 'Re-trial' }]), null)
  assert.equal(run(base).states.non_ot_reason_system.visible, false)
})
t('Non-OT target date decides the deviation: within MRD no E-Doc, beyond MRD E-Doc + status', () => {
  assert.equal(run({ ot_planned_date: '2026-12-10' }).deviation, false) // no target yet
  assert.equal(run({ ot_planned_date: '2026-12-10', non_ot_target_date: '2026-11-25' }).deviation, false)
  const beyond = run({ ot_planned_date: '2026-12-10', non_ot_target_date: '2026-12-15' })
  assert.equal(beyond.deviation, true)
  assert.equal(beyond.states.deviation_approval_status.visible && beyond.states.deviation_approval_status.mandatory, true)
})
t('Non-OT on the plan comes back to OT with an actual within MRD; actual decides over plan', () => {
  assert.equal(run({ ot_planned_date: '2026-12-10', actual_ot_date: '2026-11-24' }).values.ot_status, 'OT')
  assert.equal(run({ ot_planned_date: '2026-12-10', actual_ot_date: '2026-12-05' }, '2026-12-31').values.ot_status, 'Non-OT')
})
t('delay and Non-OT never together: no delay reason once the status is Non-OT', () => {
  const r = run({ ot_planned_date: '2026-11-25', actual_ot_date: '2026-12-05' }, '2026-12-31')
  assert.equal(r.values.ot_status, 'Non-OT')
  assert.equal(r.states.ot_delay_reason.visible, false)
  const o = run({ ...base, actual_ot_date: '2026-11-25', ot_status__override: 'Non-OT' })
  assert.equal(o.states.ot_delay_reason.visible, false)
})
t('override direction: PIC may set OT → Non-OT only, only once the actual date is filled', () => {
  const ot = { ...base, actual_ot_date: '2026-11-20' }
  const sys = run(ot).values
  assert.equal(overrideAllowed(fieldOf('ot_status'), sys, { mrd: MRD, today: '2026-11-30', def: pp9 }), true)
  assert.deepEqual(overrideOptions(fieldOf('ot_status')), ['Non-OT'])
  // no actual date → no override
  assert.equal(overrideAllowed(fieldOf('ot_status'), run(base).values, { mrd: MRD, today: '2026-11-30', def: pp9 }), false)
  // system already Non-OT → no override (and never Non-OT → OT)
  assert.equal(overrideAllowed(fieldOf('ot_status'), run({ ...base, actual_ot_date: '2026-12-05' }, '2026-12-31').values, { mrd: MRD, today: '2026-12-31', def: pp9 }), false)
  const toOt = run({ ...base, actual_ot_date: '2026-12-05', ot_status__override: 'OT' }, '2026-12-31')
  assert.equal(toOt.values.ot_status, 'Non-OT')
  assert.equal('ot_status__override' in toOt.values, false)
  const r = run({ ...ot, ot_status__override: 'Non-OT' })
  assert.equal(r.values.ot_status, 'Non-OT')
  assert.equal(r.values.ot_status__system, 'OT')
})
t('override stays (final Non-OT) after the system recalculates, and cannot then be changed', () => {
  const v = { ...base, actual_ot_date: '2026-11-26', ot_status__override: 'Non-OT' }
  assert.equal(run(v).values.ot_status, 'Non-OT') // new actual within MRD: still Non-OT
  const beyond = run({ ...v, actual_ot_date: '2026-12-05' }, '2026-12-31')
  assert.equal(beyond.values.ot_status__override, 'Non-OT')
  assert.equal(overrideAllowed(fieldOf('ot_status'), run(v).values, { mrd: MRD, today: '2026-11-30', def: pp9 }), false)
  // the generic capability is still there for other activities (sticky off → cleared when no longer allowed)
  const loose = { ...pp9, fields: pp9.fields.map((f) => (f.key === 'ot_status' ? { ...f, override: { ...f.override!, sticky: false } } : f)) }
  assert.equal('ot_status__override' in run({ ...v, actual_ot_date: '2026-12-05' }, '2026-12-31', undefined, loose).values, false)
})
t('override notifies the Vendor with the PIC reason and remark', () => {
  const before = run({ ...base, actual_ot_date: '2026-11-20' }).values
  const after = run({ ...before, ot_status__override: 'Non-OT', pic_non_ot_reasons: [{ reason: 'Tool maturation delay', remark: 'Tool not ready at audit' }, { remark: 'Gauge not calibrated' }] }).values
  const ev = overrideEvents(pp9, before, after, ['ot_status__override'])
  const n = overrideNotices(pp9, ev, after, 'PIC')
  assert.equal(n.length, 1)
  assert.deepEqual(n[0].roles, ['Vendor'])
  assert.ok(n[0].detail.includes('Tool not ready at audit') && n[0].detail.includes('Tool maturation delay') && n[0].detail.includes('Gauge not calibrated'))
  assert.ok(!n[0].detail.includes('[object'))
  // a rule clearing it (not a person) does not notify
  assert.equal(overrideNotices(pp9, overrideEvents(pp9, after, before, []), before, 'System').length, 0)
})
t('PIC reason rows stay visible after the system flips to Non-OT (based on "was overridden"); reason optional, remark required', () => {
  const v = { ...base, actual_ot_date: '2026-12-05', ot_status__override: 'Non-OT', pic_non_ot_reasons: [{ remark: 'x' }] }
  const r = run(v, '2026-12-31')
  assert.equal(r.values.ot_status__system, 'Non-OT')
  assert.equal(r.states.pic_non_ot_reasons.visible, true)
  assert.equal(r.states.pic_non_ot_reasons.mandatory, true)
  assert.equal(run({ ...base, actual_ot_date: '2026-11-20' }).states.pic_non_ot_reasons.visible, false)
  const f = fieldOf('pic_non_ot_reasons')
  assert.equal(fieldMissing(f, [{ remark: 'Tool not ready' }]), null)
  assert.ok(fieldMissing(f, [{ reason: 'ECN case' }])!.includes('Remark'))
  // the vendor may change a reason (field-level), never the PIC's remark (column owned by the PIC)
  assert.ok((f.alsoEditableBy ?? []).includes('Vendor'))
  assert.equal(f.columns!.find((c) => c.key === 'remark')!.enteredBy, 'PIC')
  assert.equal(fieldOf('ot_status').override!.label, 'OT status (PIC)')
  assert.equal(fieldOf('ot_status').override!.systemLabel, 'OT status (Vendor)')
})
t('MSIL tool go-ahead: applicability shown; date and optional remark only when Yes', () => {
  const f = fieldOf('applicability_of_msil_tool_go_ahead')
  assert.equal(f.label, 'MSIL tool go-ahead applicability')
  assert.ok(!f.hiddenFromForm)
  const no = run({ applicability_of_msil_tool_go_ahead: 'N' }).states
  assert.equal(no.applicability_of_msil_tool_go_ahead.visible, true)
  assert.equal(no.msil_tool_go_ahead_date.visible || no.tool_go_ahead_remark.visible, false)
  const yes = run({ applicability_of_msil_tool_go_ahead: 'Y' }).states
  assert.equal(yes.msil_tool_go_ahead_date.visible && yes.tool_go_ahead_remark.visible, true)
  assert.equal(yes.tool_go_ahead_remark.mandatory, false)
  assert.equal(canEditField(fieldOf('tool_go_ahead_remark'), 'Vendor', undefined, yes.tool_go_ahead_remark), true)
})
t('Actual OT date: entered by the Vendor, the PIC can correct it', () => {
  const f = fieldOf('actual_ot_date')
  assert.equal(f.enteredBy, 'Vendor')
  assert.ok((f.alsoEditableBy ?? []).includes('PIC'))
})
t('Submit / Approve are blocked while a review loop is open (not started, in review or rejected)', () => {
  const v = run({ ot_planned_date: '2026-12-10' }).values // the form and the store pass calculated values
  const extra = (gs?: any) => ({ mrd: MRD, today: '2026-11-30', part, groupReviews: pp9.groupReviews, groupState: gs })
  assert.ok(openLoopMessage(pp9, v, extra())!.includes('Non-OT reason and target date'))
  const g = pp9.groupReviews!.find((x) => x.id === 'system-non-ot')!
  let s = groupSubmit(undefined, {}, 'Vendor', 't1')
  assert.ok(openLoopMessage(pp9, v, extra({ 'system-non-ot': s }))!.includes('waiting for the reviewer'))
  const rej = groupDecide(g, s, 'Reject', 'PIC', 't2', 'no').state
  assert.ok(openLoopMessage(pp9, v, extra({ 'system-non-ot': rej }))!.includes('rejected'))
  s = groupDecide(g, groupSubmit(rej, {}, 'Vendor', 't3'), 'Accept', 'PIC', 't4').state
  assert.equal(openLoopMessage(pp9, v, extra({ 'system-non-ot': s })), null)
  assert.equal(openLoopMessage(pp9, base, extra()), null) // no loop open on an OT part
  // the override loop opens after a PIC override
  assert.ok(openLoopMessage(pp9, run({ ...base, actual_ot_date: '2026-11-20', ot_status__override: 'Non-OT' }).values, extra())!.includes('Vendor action plan'))
})
t('override loop: revised plan ≤ MRD, rejected once, accepted, actual re-opened for the Vendor; escalation after 3', () => {
  const g = pp9.groupReviews!.find((x) => x.id === 'pic-override-plan')!
  const v: Record<string, any> = { ...base, actual_ot_date: '2026-11-20', ot_status__override: 'Non-OT', revised_planned_ot_date: '2026-12-20' }
  assert.ok(run(v).violations.some((x) => x.field === 'revised_planned_ot_date'))
  assert.equal(run(v).states.revised_planned_ot_date.mandatory, true)
  assert.equal(run(v).states.action_plan_remark.mandatory, true)
  let s = groupSubmit(undefined, {}, 'Vendor', 't1')
  assert.equal(canDecideGroup(g, s, 'PIC'), true)
  assert.equal(canDecideGroup(g, s, 'Vendor'), false)
  s = groupDecide(g, s, 'Reject', 'PIC', 't2', 'Too late').state
  assert.equal(run(v, '2026-11-30', { 'pic-override-plan': s }).states.revised_planned_ot_date.readOnly, false)
  s = groupDecide(g, groupSubmit(s, {}, 'Vendor', 't3'), 'Accept', 'PIC', 't4').state
  assert.equal(s.rounds.length, 2)
  const r = run(v, '2026-11-30', { 'pic-override-plan': s })
  assert.equal(r.states.actual_ot_date.reopened, true)
  assert.equal(r.states.revised_planned_ot_date.readOnly, true)
  let e = groupSubmit(undefined, {}, 'Vendor', 't')
  for (let i = 0; i < 3; i++) { e = groupDecide(g, e, 'Reject', 'PIC', 't', 'x').state; e = groupSubmit(e, {}, 'Vendor', 't') }
  assert.equal(canDecideGroup(g, e, 'SIC'), true)
})
t('partial review: the Vendor changing the PIC reasons goes to the PIC alone; a rejected change is reverted', () => {
  const g = pp9.groupReviews!.find((x) => x.id === 'pic-override-plan')!
  assert.ok(g.partialFields!.includes('pic_non_ot_reasons'))
  assert.notEqual(fieldOf('pic_non_ot_reasons').section, g.section) // a field from another section
  let s = groupDecide(g, groupSubmit(undefined, {}, 'Vendor', 't1'), 'Accept', 'PIC', 't2').state
  const before = [{ reason: 'Tool maturation delay', remark: 'x' }]
  s = groupSubmit(s, { pic_non_ot_reasons: [{ reason: 'Others', remark: 'x' }] }, 'Vendor', 't3', ['pic_non_ot_reasons'], { pic_non_ot_reasons: before })
  const d = groupDecide(g, s, 'Reject', 'PIC', 't4', 'No')
  assert.deepEqual(d.restore, { pic_non_ot_reasons: before })
  assert.equal(d.state.status, 'accepted')
})
t('deviation: E-Doc + approval status (fetched or picked) only for Non-OT beyond MRD; no approval chain for pp-9', () => {
  assert.equal(run({ ...base, actual_ot_date: '2026-11-20' }).deviation, false)
  const r = run({ ...base, actual_ot_date: '2026-12-05' }, '2026-12-31')
  assert.equal(r.deviation, true)
  assert.equal(r.states.e_doc_number.visible, true)
  assert.equal(r.states.e_doc_number.mandatory, true)
  assert.equal(r.states.deviation_approval_status.visible, true)
  assert.deepEqual(fieldOf('deviation_approval_status').options, ['Approved', 'Pending', 'Rejected'])
  assert.equal(pp9.deviation!.fetchStatus, true)
  assert.equal(pp9.deviation!.manualStatus, true)
  assert.equal(pp9.deviation!.approvalChain, false)
  assert.equal(pp9.deviation!.enteredBy, 'PIC')
  assert.equal(fieldOf('e_doc_number').searchable, true)
  // sop-1 keeps the status lookup (default on)
  const sop = act('sop-1')
  const st = evaluateAll(sop, { actual_otop_date: '2026-12-09' }, { mrd: MRD, today: '2026-12-31', part }).states
  assert.equal(st[sop.deviation!.statusField!]?.visible, true)
})
t('generic "Reason for delay" pop-up is off only where the activity has its own delay-reason field', () => {
  assert.equal(pp9.delayPopup, false)
  assert.equal(PP_ACTIVITIES.filter((a) => a.delayPopup === false).map((a) => a.id).sort().join(), 'mpp-1,mpp-7,pp-11,pp-9,sop-9')
})
t('master lists: Delay reasons (7) and Non-OT reasons (8) as in the field sheet', () => {
  const d = SEED_MASTER_LISTS.find((l) => l.id === 'delay-reasons')!
  const n = SEED_MASTER_LISTS.find((l) => l.id === 'non-ot-reasons')!
  assert.equal(d.items.length, 7)
  assert.ok(!d.items.includes('OT plan date > system defined target date'))
  assert.equal(n.items.length, 8)
  assert.ok(n.items.includes('OT plan date > system defined target date'))
  assert.ok(d.items.every((x) => n.items.includes(x)))
  assert.ok(!n.placeholder)
})
t('every saved scenario passes (the Builder runs the same runner)', () => {
  assert.ok((pp9.testScenarios ?? []).length >= 8)
  for (const sc of pp9.testScenarios!) {
    const r = runScenario(pp9, sc, { part })
    assert.ok(r.pass, `${sc.name}: ${r.failures.join('; ')}`)
  }
})
t('an Admin-built copy of the flow (other id, nothing else) behaves the same: no id dependency', () => {
  const copy = JSON.parse(JSON.stringify({ ...pp9, id: 'admin-built-ot' })) as ActivityDefinition
  for (const sc of copy.testScenarios!) assert.ok(runScenario(copy, sc, { part }).pass, sc.name)
})

section('Data, migration and sample data')
t('plain text reason + remark is read safely (never one key per character)', () => {
  const items = SEED_MASTER_LISTS.find((l) => l.id === 'delay-reasons')!.items
  assert.deepEqual(normalizeReasonRemark('Tool maturation delay', items), { reason: 'Tool maturation delay' })
  assert.deepEqual(normalizeReasonRemark('Supplier late', items), { remark: 'Supplier late' })
  assert.deepEqual(normalizeReasonRemark({ 0: 'L', 1: 'a', 2: 't', 3: 'e' }, items), { remark: 'Late' })
  assert.deepEqual(normalizeReasonRemark({ reason: 'ECN case', remark: 'x' }), { reason: 'ECN case', remark: 'x' })
  assert.ok(fieldMissing({ ...fieldOf('ot_delay_reason'), type: 'reasonRemark', reasonRemark: { listId: 'delay-reasons', remark: 'always' } }, 'Supplier late')!.includes('reason'))
})
t('STORE_VERSION migration: new pp-9 definition, strings → reason+remark, old status words, lists replaced', () => {
  assert.equal(STORE_VERSION, 63)
  const oldPp9 = { ...pp9, delayPopup: undefined, fields: pp9.fields.map((f) => (f.key === 'tool_cutting_status' ? { ...f, options: ['Not Started', 'Started', 'Completed'] } : f)) }
  const persisted = {
    activities: [oldPp9],
    entries: [{ id: 'e1', templateRowId: 'r', activityId: 'pp-9', partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'Vendor',
      values: { ot_delay_reason: 'Supplier late', non_ot_reason_system: { 0: 'O', 1: 'k' }, tool_cutting_status: 'Not Started', ot_status: 'Pending', ot_status__override: 'OT' } },
      { id: 'e2', templateRowId: 'r', activityId: 'pp-9', partNo: 'Y', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'PIC',
      values: { ot_delay_reason: { reason: 'ECN case', remark: 'ECN 9' }, pic_non_ot_reason: 'Tool maturation delay', pic_non_ot_remark: 'Not ready', ot_status__override: 'Non-OT' } }],
    masterLists: [
      { id: 'delay-reasons', name: 'Delay reasons', items: ['ECN case', 'Tool maker selection delay', 'Tool go-ahead delay (MSIL)', 'Tool go-ahead delay (Vendor)', 'Design finalization delay (Vendor internal)', 'Tool maturation delay', 'OT plan date > system defined target date', 'Others'] },
      { id: 'non-ot-reasons', name: 'Non-OT reasons', items: ['Tool not ready', 'Process not ready', 'Design change (ECN)', 'Tool go-ahead delay (MSIL)', 'Tool maker delay', 'Others'], placeholder: true },
      { id: 'custom', name: 'Admin list', items: ['A'] }
    ]
  }
  const out = migrateStore(persisted, 48, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  const a = out.activities.find((x: any) => x.id === 'pp-9')
  assert.equal(a.delayPopup, false) // the seed definition replaced the stored one
  const v = out.entries[0].values
  assert.deepEqual(v.ot_delay_reason, [{ remark: 'Supplier late' }])
  assert.deepEqual(v.non_ot_reason_system, [{ remark: 'Ok' }])
  assert.equal(v.tool_cutting_status, 'Pending')
  const v2 = out.entries[1].values
  assert.deepEqual(v2.ot_delay_reason, [{ reason: 'ECN case', remark: 'ECN 9' }])
  assert.deepEqual(v2.pic_non_ot_reasons, [{ reason: 'Tool maturation delay', remark: 'Not ready' }])
  assert.equal('pic_non_ot_reason' in v2 || 'pic_non_ot_remark' in v2, false)
  // running it again changes nothing more
  assert.deepEqual(migrateStore(out, 51, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS }).entries.map((e: any) => e.values), out.entries.map((e: any) => e.values))
  assert.equal('ot_status' in v, false)
  assert.equal('ot_status__override' in v, false)
  assert.equal(out.masterLists.find((l: any) => l.id === 'delay-reasons').items.length, 7)
  assert.equal(out.masterLists.find((l: any) => l.id === 'non-ot-reasons').items.length, 8)
  assert.deepEqual(out.masterLists.find((l: any) => l.id === 'custom').items, ['A'])
  // an Admin-edited list is kept
  const edited = migrateStore({ ...persisted, masterLists: [{ id: 'delay-reasons', name: 'Delay reasons', items: ['Mine'] }] }, 48, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.deepEqual(edited.masterLists.find((l: any) => l.id === 'delay-reasons').items, ['Mine'])
})
t('sample data is consistent: no actual end without start, no future actuals, planned end ≥ planned start', () => {
  const d = buildDemoData(SEED_ACTIVITIES, SEED_TEMPLATE_ROWS, SEED_MODELS)
  const ots = d.entries.filter((e) => e.activityId === 'pp-9')
  assert.ok(ots.length > 0)
  for (const e of ots) {
    const v = e.values
    for (const s of ['tool_cutting', 'tool_assembly']) {
      if (v[`${s}_actual_end_date`]) assert.ok(v[`${s}_actual_start_date`], `${e.partNo} ${s} end without start`)
      if (v[`${s}_actual_end_date`] && v[`${s}_actual_start_date`]) assert.ok(v[`${s}_actual_end_date`] >= v[`${s}_actual_start_date`])
      if (v[`${s}_planned_end_date`] && v[`${s}_planned_start_date`]) assert.ok(v[`${s}_planned_end_date`] >= v[`${s}_planned_start_date`])
      for (const k of [`${s}_actual_start_date`, `${s}_actual_end_date`]) if (v[k]) assert.ok(v[k] <= APP_TODAY, `${e.partNo} ${k} in the future`)
    }
    for (const k of ['tool_trial_actual_date', 'actual_ot_date']) if (v[k]) assert.ok(v[k] <= APP_TODAY, `${e.partNo} ${k} in the future`)
    for (const k of ['ot_delay_reason', 'non_ot_reason_system']) if (v[k] !== undefined) assert.equal(typeof v[k], 'object')
    assert.ok(!['Not Started', 'Pending'].includes(v.ot_status))
  }
})

t('notify on change: planned dates, first save does not count', () => {
  assert.equal(detectNotifyChanges(pp9, undefined, { ot_planned_date: '2026-11-10' }).length, 0)
  assert.equal(detectNotifyChanges(pp9, { ot_planned_date: '' }, { ot_planned_date: '2026-11-10' }).length, 0)
  const ev = detectNotifyChanges(pp9, { ot_planned_date: '2026-11-10' }, { ot_planned_date: '2026-11-20' })
  assert.equal(ev.length, 1)
  assert.deepEqual(ev[0].roles, ['PIC'])
})
t('master lists feed the dropdown; changing the list changes options', () => {
  const lists = SEED_MASTER_LISTS.map((l) => (l.id === 'delay-reasons' ? { ...l, items: ['A', 'B'] } : l))
  const col = (ls: typeof lists) => withMasterLists(pp9.fields, ls).find((f) => f.key === 'ot_delay_reason')!.columns!.find((c) => c.key === 'reason')!.options
  assert.deepEqual(col(lists), ['A', 'B'])
  assert.equal(col(SEED_MASTER_LISTS)!.length, 7)
})
t('plain-English sentence for a condition', () => {
  const s = describeCondition(pp9.deviation!.when, (k) => pp9.fields.find((f) => f.key === k)?.label ?? k)
  assert.ok(s.includes('OT status') && s.includes('the MRD') && s.includes(' OR '))
})
t('sop-1 deviation trigger comes from config', () => {
  const a = act('sop-1')
  assert.equal(deviationRequired(a, { actual_otop_date: '2026-12-09' }, ruleExtra(a, undefined, { mrd: MRD })), true)
  assert.equal(deviationRequired(a, { actual_otop_date: '2026-11-09' }, ruleExtra(a, undefined, { mrd: MRD })), false)
})
t('C9 macro builds ordinary fields + rules for a brand-new activity', () => {
  const s = buildStage({ prefix: 'paint', label: 'Paint', kind: 'range' })
  assert.equal(s.fields.length, 6)
  const def = { id: 'new-1', name: 'New', scope: 'Both', fields: s.fields, validationRules: s.validationRules, flow: { steps: [] }, ownerPersona: 'PIC' } as unknown as ActivityDefinition
  const r = evaluateAll(def, { paint_actual_start_date: '2026-10-01' }, { today: '2026-10-15' })
  assert.equal(r.values.paint_status, 'Started')
})

section('Client field sheet (Nov 20): Mizenboshi, Spec meeting, Process audit, Homologation')
const states = (id: string, v: Record<string, any>, mrd?: string) => evaluateAll(act(id), v, { mrd, part })
t('Mizenboshi: applicability comes from the Applicability screen, not a field', () => {
  const a = act('pp-6')
  assert.equal(a.showApplicability, true)
  assert.ok(!a.fields.some((f) => /applicab/i.test(f.key)))
  assert.deepEqual(a.fields.find((f) => f.key === 'newness_score')!.options, ['3', '4', '5', '3+4', '3+5', '4+5', '3+4+5'])
  assert.deepEqual(a.fields.find((f) => f.key === 'newness_type')!.options, ['New Technology/New Process', 'New Technology/New Design'])
  assert.equal(a.fields.find((f) => f.key === 'remark')!.label, 'Newness detail')
  for (const k of ['planned_start_date', 'planned_end_date', 'actual_start_date', 'actual_end_date']) assert.equal(a.fields.find((f) => f.key === k)!.type, 'date')
})
t('Mizenboshi: Accepted + Rejected + Pending must equal the count of points', () => {
  const a = act('pp-6')
  const row = (x: number, y: number, z: number) => ({ count_of_mizenboshi_items: 10, mizenboshi_item_status: [{ accepted: x, rejected: y, pending: z }] })
  assert.equal(evaluateValidationRules(a, row(6, 2, 2)).length, 0)
  assert.equal(evaluateValidationRules(a, row(6, 2, 1)).length, 1)
  const v = calc('pp-6', row(6, 2, 2))
  assert.equal(v.count_accepted, 6)
  assert.equal(v.count_rejected, 2)
  assert.equal(v.count_pending, 2)
  assert.equal(a.fields.find((f) => f.key === 'mizenboshi_item_status')!.maxRows, 1)
})
t('Mizenboshi: reason for rejection shows only when something was rejected, and is optional', () => {
  const s0 = states('pp-6', { mizenboshi_item_status: [{ accepted: 3, rejected: 0, pending: 0 }] }).states.remark_reason_for_rejection
  assert.equal(s0.visible, false)
  const s1 = states('pp-6', { mizenboshi_item_status: [{ accepted: 3, rejected: 1, pending: 0 }] }).states.remark_reason_for_rejection
  assert.equal(s1.visible, true)
  assert.equal(s1.mandatory, false)
  // the add-up message carries the numbers
  const m = evaluateValidationRules(act('pp-6'), { count_of_mizenboshi_items: 14, mizenboshi_item_status: [{ accepted: 7, rejected: 3, pending: 3 }] })[0].message
  assert.ok(m.includes('13') && m.includes('14') && m.includes('Count of Mizenboshi points'), m)
})
t('Process audit: the PIC writes the NG observations; the Vendor answers with action plan and target date', () => {
  const f = act('mpp-5').fields.find((x) => x.key === 'ng_observations')!
  assert.deepEqual(f.addRowsBy, ['PIC'])
  const col = (k: string) => f.columns!.find((c) => c.key === k)!
  assert.equal(col('observation').enteredBy, 'PIC')
  const row = { observation: 'x' }
  assert.equal(cellEditable(f, col('observation'), row, 'PIC', 'Draft'), true)
  assert.equal(cellEditable(f, col('observation'), row, 'Vendor', 'Draft'), false)
  assert.equal(cellEditable(f, col('action_plan'), row, 'Vendor', 'Draft'), true)
  assert.equal(cellEditable(f, col('action_plan'), row, 'PIC', 'Draft'), false)
  assert.equal(entryCellsOpen(act('mpp-5'), { ng_observations: [row] }, 'PIC', 'Draft'), true)
})
t('Spec meeting: the rest shows only while Applicable; one status Enovia → SAP → Data Pending Updating', () => {
  const na = states('pp-2', { tech_meeting_status: 'N', process_meeting: 'N' }).states
  for (const k of ['spec_meeting_status', 'planned_start_date', 'planned_finish_date', 'actual_start_date', 'sap_actual_end_date', 'enovia_actual_end_date']) assert.equal(na[k].visible, false, k)
  assert.equal(na.tech_meeting_status.visible && na.process_meeting.visible && na.spec_meeting_applicability.visible, true)
  const ok = states('pp-2', { tech_meeting_status: 'Y', enovia_spec_meeting_status: 'Approved', sap_spec_meeting_status: 'Initiated' })
  assert.equal(ok.states.planned_finish_date.visible, true)
  assert.equal(ok.states.planned_finish_date.mandatory, true)
  assert.equal(ok.values.spec_meeting_status, 'Approved')
  assert.equal(states('pp-2', { tech_meeting_status: 'Y', sap_spec_meeting_status: 'Initiated' }).values.spec_meeting_status, 'Initiated')
  assert.equal(states('pp-2', { tech_meeting_status: 'Y' }).values.spec_meeting_status, 'Data Pending Updating')
  const a = act('pp-2')
  assert.equal(a.fields.find((f) => f.key === 'planned_finish_date')!.enteredBy, 'PIC')
  assert.equal(a.fields.find((f) => f.key === 'planned_start_date')!.source, 'enovia')
  assert.ok(!a.fields.some((f) => f.key === 'spec_meeting_not_applicable' || f.key === 'data_update_pending'))
})
t('Process audit: dates by hand; Completed / Pending from the actual date; NG table only on NG', () => {
  const a = act('mpp-5')
  assert.equal(a.showApplicability, true)
  assert.equal(a.fields.find((f) => f.key === 'audit_planned_date')!.source, 'manual')
  assert.equal(calc('mpp-5', {}).audit_completed_pending, 'Pending')
  assert.equal(calc('mpp-5', { audit_actual_date: '2026-10-01' }).audit_completed_pending, 'Completed')
  assert.equal(states('mpp-5', { audit_status: 'OK' }).states.ng_observations.visible, false)
  assert.equal(states('mpp-5', { audit_status: 'NG' }).states.ng_observations.visible, true)
})
t('Process audit: delay reason per row only when the target date is after the MRD (row rule)', () => {
  const a = act('mpp-5')
  const f = a.fields.find((x) => x.key === 'ng_observations')!
  const col = f.columns!.find((c) => c.key === 'delay_reason')!
  const rule = rowRuleFor(a, {}, { mrd: '2026-12-01' })
  const late = { observation: 'x', action_plan: 'y', target_date: '2026-12-10' }
  const early = { ...late, target_date: '2026-11-20' }
  assert.equal(columnVisible(f, col, late, 'Vendor', rule), true)
  assert.equal(isRequired(col, late, rule), true)
  assert.equal(columnVisible(f, col, early, 'Vendor', rule), false)
  assert.equal(isRequired(col, early, rule), false)
})
t('Process audit: the Vendor enters the closure date only after the PIC accepted the row', () => {
  const a = act('mpp-5')
  const f = a.fields.find((x) => x.key === 'ng_observations')!
  const col = f.columns!.find((c) => c.key === 'actual_closure_date')!
  const withVendor = { observation: 'x', _stage: -1 }
  const inReview = { observation: 'x', _stage: 0 }
  const accepted = { observation: 'x', _stage: 1, _outcome: 'Accepted', pic_decision: 'Accept' }
  assert.equal(cellEditable(f, col, withVendor, 'Vendor', 'Draft'), false)
  assert.equal(cellEditable(f, col, inReview, 'Vendor', 'Submitted'), false)
  assert.equal(cellEditable(f, col, accepted, 'Vendor', 'Approved'), true)
  assert.equal(cellEditable(f, col, accepted, 'PIC', 'Approved'), false)
  assert.equal(fillAfterAcceptOpen(a, { ng_observations: [accepted] }, 'Vendor'), true)
  assert.equal(fillAfterAcceptOpen(a, { ng_observations: [inReview] }, 'Vendor'), false)
})
for (const id of ['mpp-7', 'sop-9']) {
  const H = (v: Record<string, any>, mrd = '2026-12-01', today = '2026-11-20') => evaluateAll(act(id), v, { mrd, today, part })
  const REG = { homologation_applicable: 'Y', regulatory_marking_applicable: 'Y', camera_available: 'Y' }
  const cam = () => act(id).fields.find((f) => f.key === 'camera_status')!
  const shown = (v: Record<string, any>, row: Record<string, any>, today = '2026-11-20') => {
    const vals = { ...REG, ...v, camera_status: [row] }
    const rule = rowRuleFor(act(id), vals, { mrd: '2026-12-01', today })
    return cam().columns!.filter((c) => columnVisible(cam(), c, row, 'Vendor', rule)).map((c) => c.key)
  }
  t(`Homologation (${id}): PIC fields first, then the camera-status table (one row per cycle, history kept)`, () => {
    assert.equal(H({}).states.regulatory_marking_applicable.visible, false)
    assert.equal(H({ homologation_applicable: 'Y' }).states.camera_status.visible, false)
    const s = H(REG).states
    assert.equal(s.camera_available.visible && s.camera_status.visible && s.camera_status.mandatory, true)
    assert.equal(cam().logRows, true)
    assert.equal(cam().minRows, 1)
    assert.equal(s.camera_status.reopened, true) // the vendor keeps updating rows after submit
  })
  t(`Homologation (${id}): columns appear as they apply`, () => {
    assert.deepEqual(shown({}, { considered: 'No' }), ['considered', 'consider_target_date', 'consider_remarks'])
    assert.deepEqual(shown({}, { considered: 'Yes' }), ['considered', 'camera_type'])
    assert.deepEqual(shown({ camera_available: 'N' }, { considered: 'Yes' }), ['considered']) // type only when the camera is available
    assert.deepEqual(shown({}, { considered: 'Yes', camera_type: 'OCR', implemented: 'No' }), ['considered', 'camera_type', 'implemented', 'impl_target_date', 'msil_verification'])
    // verification Not implemented, or a passed target → reason for delay, action plan, revised target date
    assert.ok(shown({}, { considered: 'Yes', camera_type: 'OCR', implemented: 'Yes', msil_verification: 'Not implemented' }).includes('revised_target_date'))
    assert.ok(shown({}, { considered: 'Yes', camera_type: 'OCR', implemented: 'No', impl_target_date: '2026-11-10' }).includes('reason_for_delay'))
    assert.ok(!shown({}, { considered: 'Yes', camera_type: 'OCR', implemented: 'No', impl_target_date: '2026-11-30' }).includes('reason_for_delay'))
  })
  t(`Homologation (${id}): E-Doc pop-up (latest row) — not considered without a target by MRD, not implemented + Not implemented, or past MRD unverified`, () => {
    const d = (row: Record<string, any>, today = '2026-11-20') => H({ ...REG, camera_status: [row] }, '2026-12-01', today).deviation
    assert.equal(d({ considered: 'No' }), true)
    assert.equal(d({ considered: 'No', consider_target_date: '2026-12-20' }), true)
    assert.equal(d({ considered: 'No', consider_target_date: '2026-11-25' }), false)
    assert.equal(d({ considered: 'Yes', camera_type: 'OCR', implemented: 'No', msil_verification: 'Not implemented' }), true)
    assert.equal(d({ considered: 'Yes', camera_type: 'OCR', implemented: 'No', impl_target_date: '2026-11-28' }), false)
    assert.equal(d({ considered: 'Yes', camera_type: 'OCR', implemented: 'No', impl_target_date: '2026-11-28' }, '2026-12-05'), true) // past MRD
    assert.equal(d({ considered: 'Yes', camera_type: 'OCR', implemented: 'Yes', msil_verification: 'Implemented' }, '2026-12-05'), false)
    // the latest row counts
    assert.equal(H({ ...REG, camera_status: [{ considered: 'No' }, { considered: 'Yes', camera_type: 'OCR', implemented: 'Yes', msil_verification: 'Implemented' }] }).deviation, false)
  })
  t(`Homologation (${id}): deviation answers are PIC-only pop-up values (never form fields, never shown to the vendor)`, () => {
    const a = act(id)
    assert.equal(a.deviation!.popupOnly, true)
    for (const k of ['deviation_raised', 'e_doc_number', 'e_doc_approval_status']) assert.ok(!a.fields.find((f) => f.key === k)!.visibleToVendor, k)
    const v = { ...REG, camera_status: [{ considered: 'No' }] }
    const x = { mrd: '2026-12-01', today: '2026-11-20', part }
    assert.ok(deviationMissing(a, v, x)!.includes('Deviation raised'))
    assert.equal(deviationMissing(a, { ...v, deviation_raised: 'Y', e_doc_number: 'E1', e_doc_approval_status: 'Approved' }, x), null)
  })
}
t('v54 migration: the homologation answers become the first camera-status row', () => {
  const e = { id: 'h', templateRowId: 'r', activityId: 'mpp-7', partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'PIC',
    values: { homologation_applicable: 'Y', camera_already_considered: 'Y', camera_type: 'OCR', camera_implemented: 'N', target_date: '2026-11-28', msil_verification: 'Not implemented', reason_for_delay: { reason: 'SC approval pending', remark: 'PO late' }, revised_target_date: '2026-12-05' } }
  const out = migrateStore({ activities: PP_ACTIVITIES, entries: [e], masterLists: SEED_MASTER_LISTS }, 53, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.deepEqual(out.entries[0].values, { homologation_applicable: 'Y', camera_status: [{ considered: 'Yes', camera_type: 'OCR', implemented: 'No', impl_target_date: '2026-11-28', msil_verification: 'Not implemented', reason_for_delay: 'SC approval pending — PO late', revised_target_date: '2026-12-05' }] })
})
t('v50 migration: Mizenboshi, Process audit and Homologation values move to the new fields', () => {
  const e = (activityId: string, values: Record<string, any>) => ({ id: activityId, templateRowId: 'r', activityId, partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'PIC', values })
  const out = migrateStore({
    activities: PP_ACTIVITIES,
    entries: [
      e('pp-6', { applicability: 'N', count_accepted: 4, count_rejected: 1, rejected_items: [{ item: 'Weld bead', reason: 'Not feasible' }], newness_type: 'New Tech. / New Design' }),
      e('mpp-5', { applicability_part_wise: 'Y', delay_reason: 'Tooling', ng_observations: [{ observation: 'a' }] }),
      e('mpp-7', { verification_completed: 'N', deviation_raised_pop_up: 'Y' }),
      e('sop-9', { target_date_remarks: '2026-12-02' })
    ],
    masterLists: SEED_MASTER_LISTS
  }, 49, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  const [m, pa, h, h2] = out.entries
  assert.deepEqual(m.values.mizenboshi_item_status, [{ accepted: 4, rejected: 1, pending: '' }])
  assert.equal(m.values.remark_reason_for_rejection, 'Weld bead: Not feasible')
  assert.equal('rejected_items' in m.values, false)
  assert.equal(m.values.newness_type, 'New Technology/New Design')
  assert.equal(m.notApplicable?.byRole, 'Admin')
  assert.equal(pa.notApplicable, undefined)
  assert.equal(pa.values.ng_observations[0].delay_reason, 'Tooling')
  assert.equal('delay_reason' in pa.values, false)
  assert.deepEqual(h.values.camera_status, [{ msil_verification: 'Not implemented' }])
  assert.equal(h.values.deviation_raised, 'Y')
  assert.deepEqual(h2.values.camera_status, [{ impl_target_date: '2026-12-02' }])
  // Running it again changes nothing more.
  const again = migrateStore(out, 50, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.deepEqual(again.entries.map((x: any) => x.values), out.entries.map((x: any) => x.values))
  assert.ok(out.masterLists.some((l: any) => l.id === 'homologation-delay-reasons'))
})

section('PPVT (sop-15): the whole flow as configuration')
const ppvt = act('sop-15')
const pv = (v: Record<string, any>, extra: Record<string, any> = {}) => evaluateAll(ppvt, v, { mrd: '2027-01-15', today: '2026-11-30', part: { ...part, section: 'NP2', attrs: { supply_chain_dept: 'SC-Lighting' } }, ...extra })
t('every saved PPVT scenario passes', () => {
  assert.ok((ppvt.testScenarios ?? []).length >= 5)
  for (const sc of ppvt.testScenarios!) {
    const r = runScenario(ppvt, sc, { part })
    assert.ok(r.pass, `${sc.name}: ${r.failures.join('; ')}`)
  }
})
t('Stage 1: QA department and SC come from the part; MSIL scope is the PIC\'s', () => {
  const r = pv({})
  assert.equal(r.values.qa_department, 'NP2')
  assert.equal(r.values.sc, 'SC-Lighting')
  assert.equal(ppvt.fields.find((f) => f.key === 'msil_scope')!.enteredBy, 'PIC')
})
t('Stage 2: the Vendor\'s self PPVT is ONE record shown as a form (no rows to add); status Not Done / Done; NG opens the NG fields', () => {
  const f = ppvt.fields.find((x) => x.key === 'ppvt_self')!
  assert.equal(f.type, 'table')
  assert.equal(f.maxRows, 1)
  assert.equal(f.layout, 'form')
  assert.equal(ppvt.fields.find((x) => x.key === 'ppvt_msil')!.maxRows, 1)
  const v = pv({ ppvt_self: [{ volume: 675 }] }).values
  assert.equal(v.ppvt_status, 'Not Done')
  const ng = pv({ ppvt_self: [{ volume: 675, result: 'NG', ng_type: 'Capacity', capacity_observed: 600 }] }).values
  assert.equal(ng.ppvt_status, 'Done')
  assert.equal(ng.ppvt_self[0].shortage, 75)
  const rule = rowRuleFor(ppvt, ng, {})
  const col = (k: string) => f.columns!.find((c) => c.key === k)!
  assert.equal(rule(col('capacity_issue').showRule!, ng.ppvt_self[0]), true)
  assert.equal(rule(col('quality_issue').showRule!, ng.ppvt_self[0]), false)
  assert.ok(!ppvt.fields.some((x) => x.key === 'ppvt_ng_category'))
  assert.ok(!ppvt.fields.find((x) => x.key === 'reverification_cycles')!.columns!.some((c) => c.key === 'quality_cm_category'))
})
t('Stage 5: blind check — the Vendor table is hidden from the PIC until the PIC completes; the MSIL table from the Vendor until then', () => {
  const during = pv({ msil_scope: 'MSIL scope', ppvt_self: [{ volume: 675, result: 'OK' }] }).states
  assert.deepEqual(during.ppvt_self.hiddenFor, ['PIC'])
  assert.deepEqual(during.ppvt_msil.hiddenFor, ['Vendor'])
  assert.equal(during.vendor_vs_pic.visible, false)
  const after = pv({ msil_scope: 'MSIL scope', ppvt_self: [{ volume: 675, result: 'OK' }], ppvt_msil: [{ volume: 675, result: 'OK' }], pic_verification_done: 'Y' }).states
  assert.equal(after.ppvt_self.hiddenFor, undefined)
  assert.equal(after.ppvt_msil.hiddenFor, undefined)
  assert.equal(after.vendor_vs_pic.visible, true)
  assert.equal(pv({ msil_scope: 'Vendor scope', ppvt_self: [{ volume: 675 }] }).states.ppvt_self.hiddenFor, undefined)
  for (const k of ['vendor_vs_pic', 'vendor_accuracy', 'final_ppvt_result']) assert.deepEqual(ppvt.fields.find((f) => f.key === k)!.hiddenFrom!.roles, ['Vendor'], k)
  // MSIL table: the PIC fills the check columns, the Vendor the target dates and action plans (after the check)
  const m = ppvt.fields.find((x) => x.key === 'ppvt_msil')!
  const by = Object.fromEntries(m.columns!.map((c) => [c.key, c.enteredBy]))
  assert.equal(by.volume, 'PIC'); assert.equal(by.result, 'PIC'); assert.equal(by.rejection_pct, 'PIC')
  assert.equal(by.target_date, 'Vendor'); assert.equal(by.capacity_action_plan, 'Vendor'); assert.equal(by.quality_target_date, 'Vendor')
})
t('Stage 6: re-verification columns follow the final NG type (row rules); vendor dates editable after submit', () => {
  const f = ppvt.fields.find((x) => x.key === 'reverification_cycles')!
  const cap = f.columns!.find((c) => c.key === 'capacity_cm_category')!
  const qual = f.columns!.find((c) => c.key === 'quality_concern_category')!
  const v = pv({ ppvt_self: [{ result: 'NG', ng_type: 'Capacity' }] }).values
  const rule = rowRuleFor(ppvt, v, { mrd: '2027-01-15' })
  assert.equal(rule(cap.showRule!, { requirement: 'Countermeasure Verification' }), true)
  assert.equal(rule(qual.showRule!, { requirement: 'Countermeasure Verification' }), false)
  // NG takes one of three actions; "OK As It Is" (NG accepted) asks for no categories or dates
  const col = (k: string) => f.columns!.find((c) => c.key === k)!
  assert.deepEqual(col('requirement').options, ['Re-PPVT', 'Countermeasure Verification', 'OK As It Is'])
  for (const k of ['capacity_cm_category', 'capacity_impl_date', 'target_date_if_pending', 'final_closure_date']) assert.equal(rule(col(k).showRule!, { requirement: 'OK As It Is' }), false, k)
  assert.equal(rule(col('target_date_if_pending').showRule!, { requirement: 'Re-PPVT' }), true)
  // shared by PIC and Vendor: both pick the action, write the status and add a cycle
  assert.equal(col('requirement').enteredBy, undefined)
  assert.deepEqual(f.addRowsBy, ['PIC', 'Vendor'])
  assert.deepEqual(f.alsoEditableBy, ['Vendor'])
  const s = pv({ ppvt_self: [{ result: 'NG', ng_type: 'Capacity' }] }).states.reverification_cycles
  assert.equal(s.reopened, true)
  assert.equal(canEditField(f, 'Vendor', { validationState: 'Submitted' } as any, s), true)
  assert.equal(f.logRows, true)
})
t('Stage 6: re-verification cycles open only when the PPVT is NG; Quality NG shows only the quality columns', () => {
  assert.equal(pv({ ppvt_self: [{ volume: 675, result: 'OK' }] }).states.reverification_cycles.visible, false)
  assert.equal(pv({ ppvt_self: [{ volume: 675 }] }).states.reverification_cycles.visible, false)
  const ng = pv({ ppvt_self: [{ result: 'NG', ng_type: 'Quality' }], reverification_cycles: [{ requirement: 'Re-PPVT', case_status: 'Open' }] })
  assert.equal(ng.states.reverification_cycles.visible, true)
  // a Re-PPVT does not re-open the first PPVT record: it is recorded in the cycle
  assert.notEqual(ng.states.ppvt_self.reopened, true)
  const cyc = ppvt.fields.find((x) => x.key === 'reverification_cycles')!
  const rule = rowRuleFor(ppvt, ng.values, {})
  const shows = (k: string) => rule(cyc.columns!.find((c) => c.key === k)!.showRule!, ng.values.reverification_cycles[0])
  assert.equal(shows('quality_concern_category'), true)
  assert.equal(shows('capacity_cm_category'), false)
  const self = ppvt.fields.find((x) => x.key === 'ppvt_self')!
  const srule = (k: string) => rule(self.columns!.find((c) => c.key === k)!.showRule!, ng.values.ppvt_self[0])
  assert.equal(srule('quality_issue'), true)
  assert.equal(srule('capacity_observed'), false)
})
t('v56 migration: a PPVT table keeps its first record; later rows go into the history', () => {
  const e = { id: 'p', templateRowId: 'r', activityId: 'sop-15', partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'PIC',
    values: { msil_scope: 'Vendor scope', ppvt_self: [{ volume: 675, result: 'NG' }, { volume: 700, result: 'OK' }] } }
  const out = migrateStore({ activities: PP_ACTIVITIES, entries: [e], masterLists: SEED_MASTER_LISTS }, 55, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.deepEqual(out.entries[0].values.ppvt_self, [{ volume: 675, result: 'NG' }])
  assert.match(out.entries[0].history.at(-1).action, /volume: 700, result: OK/)
  const again = migrateStore(out, 56, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.equal(again.entries[0].history.length, 1)
})
t('Stage 7: a Closed cycle locks the whole form', () => {
  const s = pv({ ppvt_self: [{ result: 'NG', ng_type: 'Quality' }], reverification_cycles: [{ requirement: 'OK As It Is', case_status: 'Closed' }] }).states
  assert.ok(Object.values(s).every((x) => x.readOnly && !x.mandatory && !x.reopened))
  assert.equal(canEditField(ppvt.fields.find((f) => f.key === 'msil_scope')!, 'PIC', undefined, s.msil_scope), false)
})
t('SOP16 is folded into SOP15 (no input form)', () => {
  assert.ok(act('sop-16').fields.every((f) => f.dataOnly))
  assert.equal(ppvt.name, 'PPVT confirmation')
})
t('v52 + v54 migration: old PPVT values move into the new tables', () => {
  const e = { id: 'p', templateRowId: 'r', activityId: 'sop-15', partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'PIC',
    values: { ppvt_msil_scope: 'Y', ppvt_volume: 675, ppvt_result: 'NG', capacity_observed: 500, ppvt_msil_scope_status: 'NG', ppvt_ng_category: 'Red' } }
  const out = migrateStore({ activities: PP_ACTIVITIES, entries: [e], masterLists: SEED_MASTER_LISTS }, 51, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  const v = out.entries[0].values
  assert.equal(v.msil_scope, 'MSIL scope')
  assert.deepEqual(v.ppvt_self, [{ volume: 675, result: 'NG', capacity_observed: 500 }])
  assert.deepEqual(v.ppvt_msil, [{ result: 'NG' }])
  assert.equal('ppvt_ng_category' in v || 'ppvt_volume' in v, false)
})
section('OTOP status (mpp-1): the OT pattern as configuration')
const otop = act('mpp-1')
t('every saved OTOP scenario passes', () => {
  assert.ok((otop.testScenarios ?? []).length >= 6)
  for (const sc of otop.testScenarios!) {
    const r = runScenario(otop, sc, { part })
    assert.ok(r.pass, `${sc.name}: ${r.failures.join('; ')}`)
  }
})
t('OTOP: the vendor enters the dates; status is system-calculated; the PIC may set OTOP or Non-OTOP; machine installation date last', () => {
  for (const k of ['otop_planned_start_date', 'otop_planned_end_date', 'otop_actual_start_date', 'otop_actual_end_date', 'machine_installation_date']) assert.equal(otop.fields.find((f) => f.key === k)!.enteredBy, 'Vendor', k)
  const st = otop.fields.find((f) => f.key === 'otop_status')!
  assert.equal(st.enteredBy, 'System')
  assert.equal(st.override!.role, 'PIC')
  assert.deepEqual(st.override!.options, ['OTOP', 'Non-OTOP'])
  assert.deepEqual(st.override!.fromValues, ['OTOP', 'Non-OTOP'])
  assert.equal(st.override!.label, 'OTOP status (PIC)')
  // Field order per the sheet: dates, status, reasons, deviation (raised, E-Doc, status), machine installation date last.
  const keys = otop.fields.map((f) => f.key)
  assert.equal(keys[keys.length - 1], 'machine_installation_date')
  assert.ok(keys.indexOf('deviation_raised') < keys.indexOf('e_doc_number'))
  assert.deepEqual(otop.groupReviews!.map((g) => g.id), ['otop-system-non-otop', 'otop-pic-plan'])
  assert.equal(otop.deviation!.raisedField, 'deviation_raised')
})
t('OTOP: the reasons table — both roles; action plan and revised OTOP date by the vendor only; breakup detail only for "Tool & process not ready"', () => {
  const f = otop.fields.find((x) => x.key === 'non_otop_reasons')!
  assert.deepEqual(f.columns!.map((c) => c.key), ['due_to_ecn', 'breakup', 'tp_breakup', 'detail', 'action_plan', 'revised_otop_date'])
  assert.ok((f.alsoEditableBy ?? []).includes('PIC'))
  assert.equal(f.columns!.find((c) => c.key === 'action_plan')!.enteredBy, 'Vendor')
  assert.equal(f.columns!.find((c) => c.key === 'revised_otop_date')!.enteredBy, 'Vendor')
  const rule = rowRuleFor(otop, {}, {})
  const tp = f.columns!.find((c) => c.key === 'tp_breakup')!
  assert.equal(rule(tp.showRule!, { breakup: 'Tool & Process Not Ready' }), true)
  assert.equal(rule(tp.showRule!, { breakup: 'Tool Not Ready' }), false)
  assert.equal(f.columns!.find((c) => c.key === 'due_to_ecn')!.enteredBy, 'Vendor')
  // a shared table: each role answers only for its own required columns
  const row = [{ due_to_ecn: 'N', breakup: 'Tool Not Ready', detail: 'x' }]
  assert.equal(fieldMissing(f, row, 'PIC'), null)
  assert.ok(fieldMissing(f, row, 'Vendor')!.includes('Action plan'))
})
t('OTOP: E-Doc number and deviation status are MSIL-only', () => {
  for (const k of ['e_doc_number', 'deviation_approval_status']) assert.ok(!otop.fields.find((f) => f.key === k)!.visibleToVendor, k)
})
t('v55 migration: the single Non-OTOP answers become the first reasons row', () => {
  const e = { id: 'o', templateRowId: 'r', activityId: 'mpp-1', partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'PIC',
    values: { otop_actual_end_date: '2026-11-08', non_otop_breakup: 'Tool & Process Not  Ready', due_to_ecn: 'Y', tool_process_not_ready_breakup: 'Machine', remarks: 'Press late', actual_date_beyond_mrd: 'N', e_doc_number: 123 } }
  const out = migrateStore({ activities: PP_ACTIVITIES, entries: [e], masterLists: SEED_MASTER_LISTS }, 54, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  const v = out.entries[0].values
  // (v60 then puts the answers in the client's wording)
  assert.deepEqual(v.non_otop_reasons, [{ due_to_ecn: 'Y', breakup: 'Tool & Process Not Ready', tp_breakup: 'Machine/Facility Delay', detail: 'Press late' }])
  assert.equal(v.e_doc_number, '123')
  assert.equal('actual_date_beyond_mrd' in v || 'non_otop_breakup' in v, false)
})

section('Generic engine pieces added for PPVT')
t('math and match % calculations; part attribute paths', () => {
  const def = { id: 'g', name: 'g', scope: 'Both', flow: { steps: [] }, ownerPersona: 'PIC', fields: [
    { key: 'a', label: 'A', type: 'number', mandatory: false, enteredBy: 'PIC', source: 'manual', validatedBy: null, showOnDashboard: false },
    { key: 'b', label: 'B', type: 'number', mandatory: false, enteredBy: 'PIC', source: 'manual', validatedBy: null, showOnDashboard: false },
    { key: 'd', label: 'D', type: 'number', mandatory: false, enteredBy: 'System', source: 'calculated', validatedBy: null, showOnDashboard: false, calc: { rules: [], else: { kind: 'math', op: '/', left: { kind: 'field', key: 'a' }, right: { kind: 'field', key: 'b' }, decimals: 1 } } },
    { key: 'm', label: 'M', type: 'percent', mandatory: false, enteredBy: 'System', source: 'calculated', validatedBy: null, showOnDashboard: false, calc: { rules: [], else: { kind: 'matchPct', pairs: [['a', 'b'], ['x', 'y']] } } }
  ] } as unknown as ActivityDefinition
  assert.equal(evaluateAll(def, { a: 10, b: 4 }).values.d, 2.5)
  assert.equal('d' in evaluateAll(def, { a: 10, b: 0 }).values, false)
  assert.equal(evaluateAll(def, { a: 3, b: 3 }).values.m, 100)
  assert.equal(evaluateAll(def, { a: 3, b: 4, x: 'p', y: 'P' }).values.m, 50)
})

t('OT: the system Non-OT loop goes with the vendor\'s form Submit (no extra click); one reason row is enough', () => {
  const pp9 = PP_ACTIVITIES.find((a) => a.id === 'pp-9')!
  const extra = ruleExtra(pp9, undefined, { mrd: '2026-12-01', today: '2026-11-30' })
  const v = { ot_planned_date: '2026-12-10', non_ot_reason_system: [{ reason: 'Tool maturation delay', remark: 'b' }, {}], non_ot_target_date: '2026-12-15' }
  const vals = evaluateAll(pp9, v, extra).values
  assert.deepEqual(loopsSentWithForm(pp9, vals, extra, 'Vendor').map((g) => g.id), ['system-non-ot'])
  assert.equal(loopsSentWithForm(pp9, vals, extra, 'PIC').length, 0)
  assert.equal(openLoopMessage(pp9, vals, extra, 'Vendor', true), null, 'vendor Submit not held up by its own loop')
  assert.ok(openLoopMessage(pp9, vals, extra), 'Approve still waits for the loop')
  const f = pp9.fields.find((x) => x.key === 'non_ot_reason_system')!
  assert.equal(fieldMissing(f, v.non_ot_reason_system), null, 'a blank 2nd row is ignored')
  assert.ok(fieldMissing(f, [{}]), 'the first row is still required')
  assert.ok(fieldMissing(f, [{ reason: 'x' }, { reason: 'y' }]), 'a started 2nd row must be completed')
})

t('Lessons learnt reads fields only through their config (FieldDefinition.insight), never by key', () => {
  const act = { id: 'x-1', name: 'X', fields: [
    { key: 'any_result', label: 'R', type: 'dropdown', options: ['Pass', 'Fail'], insight: { kind: 'result', ngValue: 'Fail' } },
    { key: 'any_ontime', label: 'T', type: 'dropdown', insight: { kind: 'onTime', onValue: 'Yes', missValue: 'No' } },
    { key: 'any_rows', label: 'Rows', type: 'table', columns: [{ key: 'k', label: 'K', type: 'text' }], insight: { kind: 'ngCategory', column: 'k' } },
    { key: 'inspection_status', label: 'Not flagged', type: 'dropdown' }
  ] } as any
  const parts = [{ partNo: 'P', vendorName: 'V' }] as any
  const rows = [{ id: 'r', activityId: 'x-1' }] as any
  const e = (vals: any) => ({ id: Math.random().toString(), templateRowId: 'r', activityId: 'x-1', partNo: 'P', values: vals, validationState: 'Draft', history: [], currentStepIndex: 0 }) as any
  const [s] = buildVendorScores({ entries: [e({ any_result: 'Fail', any_ontime: 'No', any_rows: [{ k: 'Burr' }, { k: 'Burr' }] }), e({ any_result: 'Pass', any_ontime: 'Yes', inspection_status: 'NG' })], parts, activities: [act], templateRows: rows })
  assert.equal(s.inspections, 2)
  assert.equal(s.ngCount, 1)
  assert.equal(s.otop, 1)
  assert.equal(s.nonOtop, 1)
  assert.equal(s.topNgCategory, 'Burr')
})

t('SOR Adherence: categories + Agreed / Disagreed totals pulled from the PP SOR (column map), read-only', () => {
  const sum = SOR_ADHERENCE.fields.find((f) => f.key === 'adherence_summary')!
  const pp = [{ sor_category_name: 'Plastic', total: 25, agree: 20, disagree: 5, not_applicable: 0 }, { sor_category_name: 'Sheet Metal', total: 12, agree: 10, disagree: 2, not_applicable: 0 }]
  const { rows, key } = pulledTableRows(sum, SEED_ACTIVITIES, pp)
  assert.deepEqual(rows, [{ sor_category: 'Plastic', agreed_total: 20, disagreed_total: 5 }, { sor_category: 'Sheet Metal', agreed_total: 10, disagreed_total: 2 }])
  assert.equal(key, 'sor_category')
  for (const k of ['sor_category', 'agreed_total', 'disagreed_total']) assert.equal(sum.columns!.find((c) => c.key === k)!.enteredBy, 'System')
  assert.deepEqual(sum.columns!.map((c) => c.group ?? ''), ['', 'Agreed at PP', 'Agreed at PP', 'Agreed at PP', 'Disagreed at PP', 'Disagreed at PP', 'Disagreed at PP', 'Disagreed at PP'])
})
const soraSummary = (pa: number[], sa: number[]) => [
  { sor_category: 'Plastic', agreed_total: 20, agreed_impl: pa[0], agreed_under: pa[1], disagreed_total: 5, disagreed_impl: pa[2], disagreed_under: pa[3], disagreed_not_impl: pa[4] },
  { sor_category: 'Sheet Metal', agreed_total: 10, agreed_impl: sa[0], agreed_under: sa[1], disagreed_total: 2, disagreed_impl: sa[2], disagreed_under: sa[3], disagreed_not_impl: sa[4] }
]
t('SOR Adherence check a: Plastic 15/5 and 3/1/1 → 5 / 1 / 3 point rows; check b: Under impl. 6 → split error', () => {
  const summary = soraSummary([15, 5, 3, 1, 1], [10, 0, 2, 0, 0])
  const f = (k: string) => SOR_ADHERENCE.fields.find((x) => x.key === k)!.derivedRows as any
  const plastic = (rows: any[]) => rows.filter((r) => r.sor_category === 'Plastic').length
  assert.equal(plastic(rowsFromCount2(summary, f('agreed_under_points'))), 5)
  assert.equal(plastic(rowsFromCount2(summary, f('disagreed_under_points'))), 1)
  assert.equal(plastic(rowsFromCount2(summary, f('disagreed_impl_points'))), 3)
  assert.deepEqual(evalRules2(SOR_ADHERENCE, { adherence_summary: summary }), [])
  const bad = evalRules2(SOR_ADHERENCE, { adherence_summary: soraSummary([15, 6, 3, 1, 1], [10, 0, 2, 0, 0]) })
  assert.equal(bad.length, 1)
  assert.equal(bad[0].message, 'Plastic: Agreed: Implemented + Under impl. (21) must equal Total (20)')
  // Nothing entered on a row yet: not flagged.
  assert.deepEqual(evalRules2(SOR_ADHERENCE, { adherence_summary: [{ sor_category: 'Plastic', agreed_total: 20, disagreed_total: 5 }] }), [])
})
t('SOR Adherence check c/d: target date after MRD flags a red "!"; Classification is hidden from the Vendor', () => {
  const pts = SOR_ADHERENCE.fields.find((f) => f.key === 'agreed_under_points')!
  const tgt = pts.columns!.find((c) => c.key === 'target_date')!
  const rule = rowRule2(SOR_ADHERENCE, {}, ruleExtra2(SOR_ADHERENCE, undefined, { mrd: '2026-12-15' }))
  assert.equal(rule(tgt.warn!.when, { target_date: '2027-01-10' }), true)
  assert.equal(rule(tgt.warn!.when, { target_date: '2026-12-15' }), false)
  assert.equal(tgt.warn!.message, 'Target date is after MRD')
  for (const k of ['disagreed_under_points', 'disagreed_impl_points']) {
    const t2 = SOR_ADHERENCE.fields.find((f) => f.key === k)!
    const cls = t2.columns!.find((c) => c.key === 'classification')!
    assert.equal(colVis2(t2, cls, {}, 'Vendor'), false)
    assert.equal(colVis2(t2, cls, {}, 'PIC'), true)
  }
  for (const f of SOR_ADHERENCE.fields.filter((x) => x.tile)) assert.equal(f.visibleToVendor, false)
})
t('SOR Adherence check e: snapshot tiles — conversion count + %, split by classification, under impl., after MRD', () => {
  const v = {
    adherence_summary: soraSummary([15, 5, 3, 1, 1], [10, 0, 2, 0, 0]),
    agreed_under_points: [{ target_date: '2027-01-10' }, { target_date: '2026-12-01' }],
    disagreed_under_points: [{ target_date: '2027-02-01', classification: 'Cost Up' }],
    disagreed_impl_points: [{ classification: 'Alt Control' }, { classification: 'Alt Control' }, { classification: 'Denial' }, { classification: 'Cost Up' }, { classification: 'Denial' }]
  }
  const out = evalAll2(SOR_ADHERENCE, v, ruleExtra2(SOR_ADHERENCE, undefined, { mrd: '2026-12-15' })).values
  assert.equal(out.converted_points, 6) // 3 + 1 (Plastic) + 2 (Sheet Metal)
  assert.equal(out.disagreed_total_all, 7)
  assert.equal(out.conversion_pct, 86)
  assert.equal(out.converted_by_classification, 'Cost Up 2 · Alt Control 2 · Denial 2')
  assert.equal(out.points_under_impl, 6) // agreed 5 + 0, disagreed 1 + 0
  assert.equal(out.points_after_mrd, 2)
  for (const k of ['converted_points', 'conversion_pct', 'points_under_impl', 'points_after_mrd']) assert.equal(SOR_ADHERENCE.fields.find((f) => f.key === k)!.showOnDashboard, true, k)
})
t('v59 migration adds SOR Adherence with its MPP template row and archetype object, once', () => {
  const tpl = SEED_TEMPLATE_ROWS.filter((r) => r.activityId === 'mpp-12')
  assert.equal(tpl.length, 1)
  assert.equal(tpl[0].milestoneId, 'MPP')
  const old = { activities: SEED_ACTIVITIES.filter((a) => a.id !== 'mpp-12'), entries: [], masterLists: SEED_MASTER_LISTS, templateRows: SEED_TEMPLATE_ROWS.filter((r) => r.activityId !== 'mpp-12'), archetypes: [{ id: 'ARC-001', wbs: [] }] }
  const seeds = { activities: SEED_ACTIVITIES, masterLists: SEED_MASTER_LISTS, templateRows: SEED_TEMPLATE_ROWS, archetypes: [{ id: 'ARC-001', wbs: [{ id: 'w', activityId: 'mpp-12' }] }] }
  const out = migrateStore(old, 58, seeds)
  assert.ok(out.activities.some((a: any) => a.id === 'mpp-12'))
  assert.ok(out.templateRows.some((r: any) => r.activityId === 'mpp-12'))
  assert.equal(out.archetypes[0].wbs.length, 1)
  // From v59 on (the Admin deleted it): not brought back.
  const later = migrateStore({ ...old }, 59, seeds)
  assert.ok(!later.activities.some((a: any) => a.id === 'mpp-12'))
})

t('v60 migration: OTOP reasons take the client wording; the text delay reason becomes the first delay row', () => {
  const e = { id: 'o', templateRowId: 'r', activityId: 'mpp-1', partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'Vendor',
    values: { otop_delay_reason: 'Trial slipped', non_otop_reasons: [{ due_to_ecn: 'Yes', breakup: 'Tool & process not ready', tp_breakup: 'Machine & facility delay', detail: 'x' }] } }
  const out = migrateStore({ activities: PP_ACTIVITIES, entries: [e], masterLists: SEED_MASTER_LISTS }, 59, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.deepEqual(out.entries[0].values.otop_delay_reason, [{ remark: 'Trial slipped' }])
  assert.deepEqual(out.entries[0].values.non_otop_reasons, [{ due_to_ecn: 'Y', breakup: 'Tool & Process Not Ready', tp_breakup: 'Machine/Facility Delay', detail: 'x' }])
  const again = migrateStore(out, 60, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.deepEqual(again.entries[0].values, out.entries[0].values)
})

t('Part inspection: system fields fetched on open; v61 turns the text delay reason into the first delay row', () => {
  const pi = PP_ACTIVITIES.find((a) => a.id === 'pp-11')!
  for (const k of ['inspection_target_date', 'inspection_actual_date', 'inspection_completed', 'evidence_attachment', 'inspection_status']) {
    const f = pi.fields.find((x) => x.key === k)!
    assert.equal(f.autoFetch, true, k)
    assert.equal(f.enteredBy, 'System', k)
  }
  assert.equal(pi.fields.find((x) => x.key === 'inspection_applicability')!.enteredBy, 'Vendor')
  assert.equal(pi.deviation!.raisedField, 'deviation_raised')
  const e = { id: 'p', templateRowId: 'r', activityId: 'pp-11', partNo: 'X', validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '', updatedBy: 'Vendor', values: { delay_reason: 'Fixture late' } }
  const out = migrateStore({ activities: PP_ACTIVITIES, entries: [e], masterLists: SEED_MASTER_LISTS }, 60, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.deepEqual(out.entries[0].values.delay_reason, [{ remark: 'Fixture late' }])
})

t('Part inspection: re-verification NG repeats the NG loop as a new cycle; the closed cycle is kept', async () => {
  const { groupsToRepeat, groupRepeat } = await import('../src/engine')
  const pi = PP_ACTIVITIES.find((a) => a.id === 'pp-11')!
  const g = pi.groupReviews!.find((x) => x.id === 'ng-correction')!
  const rows = [{ cat: 'Dimension', obs: 'Hole offset', date: '2026-11-25' }]
  const accepted = { status: 'accepted' as const, rounds: [{ round: 1, submittedBy: 'Vendor', submittedAt: 'a', snapshot: {}, decision: 'Accept' as const }] }
  const base = { inspection_applicability: 'Y', inspection_status: 'NG', ng_rows: rows }
  const extra = { ...ruleExtra2(pi, { groupReviews: { 'ng-correction': accepted } }), mrd: '2026-12-01' }
  assert.equal(groupsToRepeat(pi, { ...base, reverification_status: 'OK' }, extra).length, 0)
  const rep = groupsToRepeat(pi, { ...base, reverification_date: '2026-11-26', reverification_status: 'NG' }, extra)
  assert.deepEqual(rep.map((x) => x.id), ['ng-correction'])
  const r = groupRepeat(pi, g, accepted, { ...base, reverification_date: '2026-11-26', reverification_status: 'NG' }, 'PIC', 'now')
  assert.equal(r.state.status, 'filling')
  assert.equal(r.state.cycles!.length, 1)
  assert.deepEqual(r.state.cycles![0].values.ng_rows, rows)
  assert.equal(r.state.cycles![0].values.reverification_status, 'NG')
  assert.equal(r.values.ng_rows, undefined)
  assert.equal(r.values.reverification_status, undefined)
  assert.equal(r.values.inspection_status, 'NG')
  // The new cycle needs NG details again; a second NG closes cycle 2.
  const again = groupRepeat(pi, g, { ...r.state, status: 'accepted' }, { ...r.values, ng_rows: rows, reverification_status: 'NG' }, 'PIC', 'later')
  assert.deepEqual(again.state.cycles!.map((c) => c.cycle), [1, 2])
})

t('Send back: a whole SOR form sent back returns its open points to the vendor; closed points stay closed', async () => {
  const { returnOpenRows, cellEditable, reviewFields } = await import('../src/engine')
  const sor = PP_ACTIVITIES.find((a) => a.id === 'pp-3')!
  const f = reviewFields(sor)[0]
  const values = { disagreed_points: [{ _sl: '1.1', requirement: 'a', reason: 'b', _stage: 0 }, { _sl: '1.2', requirement: 'c', reason: 'd', _stage: 3, _outcome: 'Accepted' }] }
  const out = returnOpenRows(sor, values, 'PIC', 'Counts are wrong')
  assert.equal(out.disagreed_points[0]._stage, -1)
  assert.deepEqual(out.disagreed_points[0]._note, { by: 'PIC', text: 'Counts are wrong' })
  assert.equal(out.disagreed_points[1]._stage, 3)
  const col = f.columns!.find((c) => c.key === 'requirement')!
  assert.equal(cellEditable(f, col, out.disagreed_points[0], 'Vendor', 'Sent back'), true)
  assert.equal(cellEditable(f, col, out.disagreed_points[1], 'Vendor', 'Sent back'), false)
})

t('Send back: after any send-back, every field of the role it went back to is editable (all activities)', async () => {
  const { canEditField, evaluateFieldStates, groupFieldKeys } = await import('../src/engine')
  for (const a of SEED_ACTIVITIES) {
    const states = evaluateFieldStates(a.fields, {}, { ...ruleExtra2(a, undefined), def: a })
    for (const role of ['Vendor', 'PIC']) {
      const own = a.fields.filter((f) => f.enteredBy === role && !f.calc && !f.pullFrom && !f.hiddenFromForm && f.source !== 'calculated' && states[f.key]?.visible !== false)
      for (const f of own) assert.ok(canEditField(f, role, { validationState: 'Sent back' }, states[f.key], (a.groupReviews ?? []).some((g) => groupFieldKeys(a, g).includes(f.key))), `${a.id} ${f.key} (${role})`)
    }
  }
})

t('Count-generated tables: a count of 0 means nothing to fill (SOR Adherence under implementation = 0)', async () => {
  const { fieldMissing } = await import('../src/engine')
  const f = SOR_ADHERENCE.fields.find((x) => x.key === 'agreed_under_points')!
  assert.equal(fieldMissing(f, []), null)
  assert.ok(fieldMissing(f, [{ _sl: '1.1', sor_category: 'Plastic' }]))
})

t('Sample data: an activity that reads another one follows it (no data before the source is approved, then the same rows)', async () => {
  const { pulledTableRows } = await import('../src/engine')
  const d = buildDemoData(SEED_ACTIVITIES, SEED_TEMPLATE_ROWS, SEED_MODELS)
  for (const def of SEED_ACTIVITIES) {
    const pulls = def.fields.filter((f) => f.derivedRows?.from === 'activity')
    for (const e of d.entries.filter((x) => x.activityId === def.id)) {
      for (const f of pulls) {
        const src = d.entries.find((x) => x.activityId === f.derivedRows!.activityId && x.partNo === e.partNo)
        assert.equal(src?.validationState, 'Approved', `${def.id} ${e.partNo}: source not approved`)
        if (!e.values[f.key]) continue
        const want = pulledTableRows(f, SEED_ACTIVITIES, src!.values[f.derivedRows!.fieldKey]).rows
        assert.equal(e.values[f.key].length, want.length, `${def.id} ${e.partNo}`)
      }
    }
  }
})

t('v63 migration: an old stored SOR definition is replaced; old point columns mapped; stuck submitted points go to the PIC', () => {
  const seedSor = PP_ACTIVITIES.find((a) => a.id === 'pp-3')!
  const old = { ...seedSor, fields: seedSor.fields.map((f) => (f.key === 'disagreed_points' ? { ...f, rowNoun: undefined, label: 'old' } : f)) }
  const rows = [{ _sl: '1.1', requirement: 'A', reason: 'A', _stage: -1 }, { _sl: '1.2', requirement: 'B', reason: 'B', pic_decision: 'Reject', pic_reject_remark: 'fix', _stage: -1, _note: { by: 'PIC', text: 'fix' } }]
  const e = { id: 'p', templateRowId: 'r', activityId: 'pp-3', partNo: 'X', validationState: 'Submitted', history: [], currentStepIndex: 1, updatedAt: '', updatedBy: 'Vendor', values: { disagreed_points: rows } }
  const out = migrateStore({ activities: [old], entries: [e], masterLists: SEED_MASTER_LISTS }, 62, { activities: PP_ACTIVITIES, masterLists: SEED_MASTER_LISTS })
  assert.equal(out.activities.find((a: any) => a.id === 'pp-3').fields.find((f: any) => f.key === 'disagreed_points').rowNoun, 'point')
  const p = out.entries[0].values.disagreed_points
  assert.equal(p[0]._stage, 0)
  assert.equal(p[1]._stage, -1)
  assert.equal(p[1].pic_decision, 'Send back')
  assert.equal(p[1].pic_remark, 'fix')
  assert.equal('pic_reject_remark' in p[1], false)
})

async function main() {
  for (const q of queue) {
    if (q.name.startsWith('\n')) { console.log(q.name.slice(1)); continue }
    try {
      await q.fn()
      pass++
      console.log('  ok  ', q.name)
    } catch (e: any) {
      fail++
      console.log('  FAIL', q.name, '\n       ', String(e?.message ?? e).split('\n')[0])
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
void main()

