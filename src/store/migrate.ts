/**
 * Persisted-store migration. It replaces the old "drop everything" behaviour: entries, parts, audit and the Admin's
 * own (custom) activities are KEPT; old rules are converted; renamed keys are mapped. Pure, so tests can run it.
 *  v47 (this version):
 *   - ConditionalRule → FieldRule (same meaning),
 *   - pp-9: ot_status_pic_input → ot_status__override ("Non OT" → "Non-OT"); ot_status_vendor_input dropped with a history note;
 *     actual_ot_date_revised → actual_ot_date,
 *   - activities whose rule configuration moved into data (see RULE_CONFIG_IDS) take the new seed definition,
 *   - missing master lists are added; existing ones (possibly edited by the Admin) are kept.
 */
import type { ActivityDefinition, ActivityEntry, MasterList } from '../domain'
import { legacyToRules, normalizeReasonRemark } from '../engine/rules'

// v49: OT status (pp-9) corrections — new pp-9 definition (taken from the seed via RULE_CONFIG_IDS), plain-text reason +
// remark values turned into { reason, remark } (any activity), old pp-9 status words cleared, the Delay / Non-OT reason
// lists replaced unless an Admin had edited them.
export const STORE_VERSION = 63
// v63: SOR sharing (pp-3) and SOR Adherence (mpp-12) take the current seed definition on upgrade (an older stored pp-3
// had other review columns, so the PIC saw no Accept / Send back). Old point columns are mapped (PIC "Reject" → "Send
// back", PIC remarks → PIC remark), and points of a submitted form that never entered the review start at the PIC.
// v62: Part inspection (pp-11) — NG details repeat as cycles: re-verification NG opens a new round of NG details (review
// loop setting "Run the loop again when"); re-verification opens once the PIC accepts the NG rows. New pp-11 from the seed.
// v61: Part inspection (pp-11) on the OT pattern — system fields fetched on open, delay reason table, NG rows reviewed by
// the PIC, deviation pop-up (raised? / E-Doc / fetched status), re-verification fields.
// v60: OTOP (mpp-1) aligned with OT — PIC review loops on the Non-OTOP reasons, PIC may set OTOP or Non-OTOP, delay
// reason as a table (plan past the target date too), "Deviation raised" in the pop-up; the client's option wording.
// v59: new seed activities (SOR Adherence, MPP) are added to stored data with their template row and archetype QA
// object — only those listed in ADDED_ACTIVITY_IDS, so an activity the Admin deleted is not brought back later.
// v58: what a field counts as in Lessons learnt is configuration (FieldDefinition.insight) — stored activities take it
// from the seed field with the same key, unless the Admin already set one.
// v57: PPVT re-verification cycles shared by the PIC and the Vendor (action on NG: Re-PPVT / Countermeasure
// verification / OK as it is; dates only for the first two) — new sop-15 definition from the seed.
// v56: PPVT happens once — the Vendor / MSIL-verification PPVT tables keep one record (the first); any later rows
// are written into the entry's history. Tables can show as a form (FieldDefinition.layout).
// v55: OTOP status (mpp-1) on the OT pattern — the single Non-OTOP answers become the first row of the reasons table.
// v54: SOR loop (+ Add point, row history), OT E-Doc hidden from the vendor, PPVT in the client's table layout (one row
// per cycle: Vendor self PPVT, MSIL verification), Homologation as a table of camera status rows (one row per cycle).
// v53: client review of Nov 20 — Mizenboshi remark optional, Process audit observations by the PIC, Homologation as a flow
// (E-Doc in the pop-up only), OT stage status on actual dates only, ready reason rows, back to OT after a new actual.
// v52: PPVT — the whole flow in sop-15 (sop-16 folded into it, data-only); old sop-15 values mapped to the new fields.
// v51: OT status (pp-9) per the client's walk-through — reason + remark fields become reason rows (several reasons, one
// remark each): ot_delay_reason, non_ot_reason_system, and pic_non_ot_reason + pic_non_ot_remark → pic_non_ot_reasons.
// v50: Mizenboshi (pp-6), Spec meeting (pp-2), Process audit (mpp-5) and Homologation (mpp-7, sop-9) per the client's
// field sheet — new definitions from the seed; saved values mapped onto the new fields (see migrateEntryValues)./** Seeded activities whose calculations / rules / loops now live in config; their stored copy is replaced by the seed. */
// v48: client corrections of Nov 2026 — pp-2 (one Spec meeting status), pp-4 / pp-5 / pp-16 / mpp-11 (input form trimmed),
// pp-6 (Mizenboshi counts + rejection rows), mpp-5 (NG observation rows reviewed by the PIC).
export const RULE_CONFIG_IDS = ['pp-1', 'pp-2', 'pp-3', 'mpp-12', 'pp-4', 'pp-5', 'pp-6', 'pp-9', 'pp-10', 'pp-11', 'pp-16', 'mpp-1', 'mpp-5', 'mpp-7', 'mpp-11', 'sop-1', 'sop-9', 'sop-15', 'sop-16']

export interface MigrationSeeds {
  activities: ActivityDefinition[]
  masterLists: MasterList[]
  templateRows?: { id: string; activityId: string }[]
  archetypes?: { id: string; wbs: { activityId?: string }[] }[]
}
/** Seed activities added after release (by store version): added once, with their template row and WBS object. */
export const ADDED_ACTIVITY_IDS: Record<number, string[]> = { 59: ['mpp-12'] }

const note = (action: string) => ({ timestamp: new Date().toISOString(), persona: 'Admin' as any, action })

/** The Delay / Non-OT reason lists as shipped before v49: replaced by the new seed lists unless an Admin changed them. */
const OLD_SEED_LISTS: Record<string, string[]> = {
  'delay-reasons': ['ECN case', 'Tool maker selection delay', 'Tool go-ahead delay (MSIL)', 'Tool go-ahead delay (Vendor)', 'Design finalization delay (Vendor internal)', 'Tool maturation delay', 'OT plan date > system defined target date', 'Others'],
  'non-ot-reasons': ['Tool not ready', 'Process not ready', 'Design change (ECN)', 'Tool go-ahead delay (MSIL)', 'Tool maker delay', 'Others']
}

/**
 * Generic: every reason + remark field of the entry's activity holds { reason, remark }. Plain text saved by older
 * versions (and objects already corrupted into one key per character) are converted; nothing else is touched.
 */
export function migrateReasonRemarks(entry: ActivityEntry, def: ActivityDefinition | undefined, lists: MasterList[]): ActivityEntry {
  if (!def) return entry
  let changed = false
  const v = { ...entry.values }
  for (const f of def.fields) {
    if (f.type !== 'reasonRemark' || !(f.key in v)) continue
    const raw = v[f.key]
    if (raw === undefined || raw === null || raw === '') continue
    const items = lists.find((l) => l.id === (f.reasonRemark?.listId ?? f.optionsFrom))?.items ?? f.options
    const norm = normalizeReasonRemark(raw, items)
    if (JSON.stringify(norm) !== JSON.stringify(raw)) {
      v[f.key] = norm
      changed = true
    }
  }
  return changed ? { ...entry, values: v } : entry
}

/** v50: an applicability field answered N on the old form becomes the Applicability-screen mark (the field is gone). */
function applicabilityToMark(entry: ActivityEntry, v: Record<string, any>, key: string, history: ActivityEntry['history']): ActivityEntry['notApplicable'] {
  if (!(key in v)) return entry.notApplicable
  const old = v[key]
  delete v[key]
  if (old !== 'N' || entry.notApplicable) return entry.notApplicable
  history.push(note('Migration: the applicability field (N) moved to the Applicability screen — marked Not applicable'))
  return { by: 'Migration', byRole: 'Admin' as any, at: new Date().toISOString(), reason: 'Applicability was N on the earlier form' }
}

/** v50: field changes of Mizenboshi, Process audit and Homologation. Idempotent: running it twice changes nothing more. */
function migrateV50(activityId: string, entry: ActivityEntry): ActivityEntry {
  const v = { ...entry.values }
  const history = [...entry.history]
  let notApplicable = entry.notApplicable
  if (activityId === 'pp-6') {
    notApplicable = applicabilityToMark(entry, v, 'applicability', history)
    // Accepted / Rejected counts → the single item-status row (Pending is new, left blank).
    if (!Array.isArray(v.mizenboshi_item_status) && (v.count_accepted !== undefined || v.count_rejected !== undefined)) {
      v.mizenboshi_item_status = [{ accepted: v.count_accepted ?? '', rejected: v.count_rejected ?? '', pending: '' }]
    }
    // One row per rejected item → the "Remark – reason for rejection" text.
    if (Array.isArray(v.rejected_items)) {
      const lines = v.rejected_items.filter((r: any) => r && (r.item || r.reason)).map((r: any) => `${r.item ?? ''}: ${r.reason ?? ''}`.trim())
      if (lines.length && !v.remark_reason_for_rejection) v.remark_reason_for_rejection = lines.join('\n')
      delete v.rejected_items
    }
    const types: Record<string, string> = { 'New Tech. / New Design': 'New Technology/New Design', 'New Process': 'New Technology/New Process' }
    if (types[v.newness_type]) v.newness_type = types[v.newness_type]
  }
  if (activityId === 'mpp-5') {
    notApplicable = applicabilityToMark(entry, v, 'applicability_part_wise', history)
    // The single delay reason now lives on the NG observation rows.
    if (typeof v.delay_reason === 'string') {
      const rows = Array.isArray(v.ng_observations) ? v.ng_observations : []
      const i = rows.findIndex((r: any) => !r?.delay_reason)
      if (v.delay_reason && i >= 0) v.ng_observations = rows.map((r: any, j: number) => (j === i ? { ...r, delay_reason: v.delay_reason } : r))
      else if (v.delay_reason) history.push(note(`Migration: removed the activity-level delay reason "${v.delay_reason}" — delay reasons are now per NG observation`))
      delete v.delay_reason
    }
  }
  if (activityId === 'mpp-7' || activityId === 'sop-9') {
    if ('verification_completed' in v) {
      if (!v.msil_verification && v.verification_completed) v.msil_verification = v.verification_completed === 'Y' ? 'Implemented' : 'Not implemented'
      delete v.verification_completed
    }
    if ('deviation_raised_pop_up' in v) {
      if (!v.deviation_raised) v.deviation_raised = v.deviation_raised_pop_up
      delete v.deviation_raised_pop_up
    }
    if ('target_date_remarks' in v) {
      if (!v.target_date) v.target_date = v.target_date_remarks
      delete v.target_date_remarks
    }
    // v54: the camera answers → the first row of the camera-status table (one row per cycle).
    const yn = (x: unknown) => (x === 'Y' ? 'Yes' : x === 'N' ? 'No' : undefined)
    const camKeys = ['camera_already_considered', 'target_date', 'remarks', 'camera_type', 'camera_implemented', 'msil_verification', 'reason_for_delay', 'revised_action_plan', 'revised_target_date']
    if (camKeys.some((k) => k in v) && !Array.isArray(v.camera_status)) {
      const notConsidered = v.camera_already_considered === 'N'
      const rd = v.reason_for_delay
      const reason = rd && typeof rd === 'object' ? [rd.reason, rd.remark].filter(Boolean).join(' — ') : rd
      const row: Record<string, any> = {
        considered: yn(v.camera_already_considered),
        consider_target_date: notConsidered ? v.target_date : undefined,
        consider_remarks: notConsidered ? v.remarks : undefined,
        camera_type: v.camera_type,
        implemented: yn(v.camera_implemented),
        impl_target_date: notConsidered ? undefined : v.target_date,
        msil_verification: v.msil_verification,
        reason_for_delay: reason || undefined,
        action_plan: v.revised_action_plan ?? (notConsidered ? undefined : v.remarks),
        revised_target_date: v.revised_target_date
      }
      const clean = Object.fromEntries(Object.entries(row).filter(([, x]) => x !== undefined && x !== ''))
      if (Object.keys(clean).length) v.camera_status = [clean]
    }
    for (const k of camKeys) delete v[k]
  }
  if (activityId === 'sop-15') {
    // v52: the old PPVT form's fields → the new flow's fields (nothing is dropped that has a new home).
    const moves: Record<string, string> = { ppvt_msil_scope: 'msil_scope', ppvt_ng_reason: 'ppvt_ng_remark', ppvt_msil_scope_volume: 'pic_ppvt_volume', ppvt_msil_scope_status: 'pic_ppvt_result' }
    for (const [from, to] of Object.entries(moves)) {
      if (!(from in v)) continue
      if (v[to] === undefined && v[from] !== '' && v[from] !== undefined) v[to] = v[from]
      delete v[from]
    }
  }
  if (activityId === 'pp-11') {
    // v61: the free-text delay reason becomes the first row of the delay table (reason + remark, as OT).
    if (typeof v.delay_reason === 'string') {
      if (v.delay_reason.trim()) v.delay_reason = [{ remark: v.delay_reason }]
      else delete v.delay_reason
    }
  }
  if (activityId === 'mpp-1') {
    // v55: Due to ECN / breakup / tool & process breakup / remarks → the first Non-OTOP reasons row.
    const keys = ['due_to_ecn', 'non_otop_breakup', 'tool_process_not_ready_breakup', 'remarks', 'due_to_ecn_2', 'remarks_2']
    if (keys.some((k) => k in v) && !Array.isArray(v.non_otop_reasons)) {
      const breakup: Record<string, string> = { 'Tool Not Ready': 'Tool not ready', 'Process Not ready': 'Process not ready', 'Tool & Process Not  Ready': 'Tool & process not ready' }
      const tp: Record<string, string> = { 'Process Maturation Delay': 'Process maturation delay', 'Software Readiness': 'Software readiness', Machine: 'Machine & facility delay', 'Facility Delay': 'Machine & facility delay', 'Source Selection Delay': 'Source selection delay' }
      const ecn = v.due_to_ecn ?? v.due_to_ecn_2
      const row: Record<string, any> = {
        due_to_ecn: ecn === 'Y' ? 'Yes' : ecn === 'N' ? 'No' : undefined,
        breakup: breakup[v.non_otop_breakup] ?? v.non_otop_breakup,
        tp_breakup: tp[v.tool_process_not_ready_breakup] ?? v.tool_process_not_ready_breakup,
        detail: [v.remarks, v.remarks_2].filter(Boolean).join(' / ') || undefined
      }
      const clean = Object.fromEntries(Object.entries(row).filter(([, x]) => x !== undefined && x !== ''))
      if (Object.keys(clean).length) v.non_otop_reasons = [clean]
    }
    for (const k of [...keys, 'actual_date_beyond_mrd', 'deviation_raised_pop_up']) delete v[k]
    if (typeof v.e_doc_number === 'number') v.e_doc_number = String(v.e_doc_number)
    // v60: the client's wording for the reasons table (Y / N, "Tool & Process Not Ready" …); the free-text delay reason
    // becomes the first row of the delay table (reason + remark, as OT).
    if (Array.isArray(v.non_otop_reasons)) {
      const ecn: Record<string, string> = { Yes: 'Y', No: 'N' }
      const br: Record<string, string> = { 'Tool not ready': 'Tool Not Ready', 'Process not ready': 'Process Not Ready', 'Tool & process not ready': 'Tool & Process Not Ready' }
      const tp: Record<string, string> = { 'Process maturation delay': 'Process Maturation Delay', 'Software readiness': 'Software Readiness', 'Machine & facility delay': 'Machine/Facility Delay', 'Source selection delay': 'Source Selection Delay' }
      v.non_otop_reasons = v.non_otop_reasons.map((r: Record<string, any>) => ({
        ...r,
        ...(r?.due_to_ecn in ecn ? { due_to_ecn: ecn[r.due_to_ecn] } : {}),
        ...(r?.breakup in br ? { breakup: br[r.breakup] } : {}),
        ...(r?.tp_breakup in tp ? { tp_breakup: tp[r.tp_breakup] } : {})
      }))
    }
    if (typeof v.otop_delay_reason === 'string') v.otop_delay_reason = v.otop_delay_reason.trim() ? [{ remark: v.otop_delay_reason }] : undefined
    if (v.otop_delay_reason === undefined) delete v.otop_delay_reason
  }
  if (activityId === 'sop-15') {
    // v54: scope as a dropdown, and the single PPVT values → the first row of the Vendor / MSIL-verification tables.
    if (v.msil_scope === 'Y') v.msil_scope = 'MSIL scope'
    else if (v.msil_scope === 'N') v.msil_scope = 'Vendor scope'
    const toRow = (map: Record<string, string>) => {
      const r: Record<string, any> = {}
      for (const [from, to] of Object.entries(map)) {
        if (v[from] !== undefined && v[from] !== '') r[to] = v[from]
        delete v[from]
      }
      return r
    }
    const self = toRow({ ppvt_volume: 'volume', ppvt_target_date: 'target_date', ppvt_result: 'result', ppvt_ng_type: 'ng_type', capacity_ng_issue: 'capacity_issue', capacity_observed: 'capacity_observed', capacity_action_plan: 'capacity_action_plan', capacity_target_date: 'capacity_target_date', quality_issue: 'quality_issue', quality_action_plan: 'quality_action_plan', rejection_pct: 'rejection_pct', quality_target_date: 'quality_target_date' })
    if (Object.keys(self).length && !Array.isArray(v.ppvt_self)) v.ppvt_self = [self]
    const pic = toRow({ pic_ppvt_volume: 'volume', pic_ppvt_result: 'result', pic_ng_type: 'ng_type', pic_capacity_observed: 'capacity_observed', pic_quality_issue: 'quality_issue', pic_rejection_pct: 'rejection_pct' })
    if (Object.keys(pic).length && !Array.isArray(v.ppvt_msil)) v.ppvt_msil = [pic]
    for (const k of ['ppvt_ng_remark', 'ppvt_ng_category', 'shortage_per_day', 'pic_shortage_per_day', 'pic_capacity_issue']) delete v[k]
    // v56: one PPVT record per table — the first stays; later rows (from the old "one row per cycle") go into the history.
    for (const k of ['ppvt_self', 'ppvt_msil']) {
      if (!Array.isArray(v[k]) || v[k].length <= 1) continue
      const extra = v[k].slice(1).map((r: Record<string, any>) => Object.entries(r).filter(([c, x]) => !c.startsWith('_') && x !== '' && x !== undefined).map(([c, x]) => `${c}: ${x}`).join(', '))
      history.push(note(`Migration: PPVT happens once — kept the first ${k === 'ppvt_self' ? 'Vendor' : 'MSIL verification'} PPVT record; later rows moved here: ${extra.map((x: string, i: number) => `[${i + 2}] ${x}`).join(' · ')}`))
      v[k] = [v[k][0]]
    }
  }
  if (JSON.stringify(v) === JSON.stringify(entry.values) && notApplicable === entry.notApplicable) return entry
  return { ...entry, values: v, history, notApplicable }
}

/** v63: SOR points under the current review columns; a submitted form's points that never entered the review go to the PIC. */
function migrateSorPoints(entry: ActivityEntry): ActivityEntry {
  const rows = entry.values?.disagreed_points
  if (!Array.isArray(rows)) return entry
  const submitted = entry.validationState === 'Submitted'
  const next = rows.map((r0: Record<string, any>) => {
    const r = { ...r0 }
    if (r.pic_decision === 'Reject') r.pic_decision = 'Send back'
    const remark = [r.pic_reject_remark, r.classification_remark].filter((x) => typeof x === 'string' && x.trim()).join(' · ')
    if (remark && !r.pic_remark) r.pic_remark = remark
    delete r.pic_reject_remark
    delete r.classification_remark
    if (submitted && !(typeof r._stage === 'number' && r._stage >= 0) && !r._note) r._stage = 0
    return r
  })
  return { ...entry, values: { ...entry.values, disagreed_points: next } }
}

export function migrateEntryValues(activityId: string, entry0: ActivityEntry): ActivityEntry {
  const entry0b = activityId === 'pp-3' ? migrateSorPoints(entry0) : entry0
  const entry = migrateV50(activityId, entry0b)
  if (activityId !== 'pp-9') return entry
  const v = { ...entry.values }
  const history = [...entry.history]
  // v51: one reason + remark → rows of { reason, remark } (plain text and per-character objects are read safely first).
  const toRows = (raw: unknown) => {
    if (Array.isArray(raw)) return raw
    if (raw === undefined || raw === null || raw === '') return undefined
    const r = normalizeReasonRemark(raw) as { reason?: string; remark?: string }
    return r.reason || r.remark ? [r] : undefined
  }
  for (const k of ['ot_delay_reason', 'non_ot_reason_system']) {
    if (!(k in v)) continue
    const rows = toRows(v[k])
    if (rows) v[k] = rows
    else delete v[k]
  }
  if ('pic_non_ot_reason' in v || 'pic_non_ot_remark' in v) {
    const reason = v.pic_non_ot_reason
    const remark = v.pic_non_ot_remark
    if (!v.pic_non_ot_reasons && (reason || remark)) v.pic_non_ot_reasons = [{ ...(reason ? { reason } : {}), ...(remark ? { remark } : {}) }]
    delete v.pic_non_ot_reason
    delete v.pic_non_ot_remark
  }
  // v49: status words. Stage status "Not Started" is now "Pending"; the OT status has no "Pending" (blank until decided).
  for (const k of ['tool_cutting_status', 'tool_assembly_status', 'tool_cutting_status__system', 'tool_assembly_status__system']) if (v[k] === 'Not Started') v[k] = 'Pending'
  for (const k of ['ot_status', 'ot_status__system']) if (v[k] === 'Pending') delete v[k]
  // v49: the PIC may no longer override Non-OT → OT; such an override is dropped (kept in the entry history).
  if (v.ot_status__override === 'OT') {
    history.push(note('Migration: removed the PIC override "OT" — only OT → Non-OT is allowed now'))
    delete v.ot_status__override
  }
  if ('ot_status_pic_input' in v) {
    const pic = v.ot_status_pic_input
    if (pic) v.ot_status__override = pic === 'Non OT' ? 'Non-OT' : pic
    delete v.ot_status_pic_input
  }
  if ('ot_status_vendor_input' in v) {
    history.push(note(`Migration: removed "OT status (vendor input)" (value "${String(v.ot_status_vendor_input ?? '')}") — the status is now calculated from the Actual OT date`))
    delete v.ot_status_vendor_input
  }
  if ('actual_ot_date_revised' in v) {
    if (!v.actual_ot_date && v.actual_ot_date_revised) v.actual_ot_date = v.actual_ot_date_revised
    delete v.actual_ot_date_revised
  }
  return { ...entry, values: v, history }
}

export function migrateActivity(a: ActivityDefinition): ActivityDefinition {
  return {
    ...a,
    fields: a.fields.map((f) => {
      if (!f.conditionalRules?.length) return f
      const { conditionalRules: _legacy, ...rest } = f
      void _legacy
      return { ...rest, rules: [...legacyToRules(f), ...(f.rules ?? [])] }
    })
  }
}

/** v58: a stored field without an `insight` takes the seed field's (same key); the Admin's own setting is kept. */
function withSeedInsights(a: ActivityDefinition, seed: ActivityDefinition | undefined): ActivityDefinition {
  if (!seed) return a
  let changed = false
  const fields = a.fields.map((f) => {
    const s = seed.fields.find((x) => x.key === f.key)
    if (f.insight || !s?.insight) return f
    changed = true
    return { ...f, insight: s.insight }
  })
  return changed ? { ...a, fields } : a
}

export function migrateStore(persisted: unknown, _from: number, seeds: MigrationSeeds): Record<string, any> {
  const s = (persisted ?? {}) as Record<string, any>
  const stored: ActivityDefinition[] = Array.isArray(s.activities) ? s.activities : []
  const seedById = new Map(seeds.activities.map((a) => [a.id, a]))
  const activities: ActivityDefinition[] = stored.map((a) => (RULE_CONFIG_IDS.includes(a.id) && seedById.has(a.id) ? seedById.get(a.id)! : withSeedInsights(migrateActivity(a), seedById.get(a.id))))
  for (const seed of seeds.activities) if (!activities.some((a) => a.id === seed.id) && !stored.length) activities.push(seed)
  // Activities added in a later version: into stored data once (when upgrading from before that version).
  const added = Object.entries(ADDED_ACTIVITY_IDS).filter(([v]) => _from < Number(v)).flatMap(([, ids]) => ids)
  let templateRows = Array.isArray(s.templateRows) ? s.templateRows : undefined
  let archetypes = Array.isArray(s.archetypes) ? s.archetypes : undefined
  for (const id of added) {
    const seed = seedById.get(id)
    if (!seed || !stored.length) continue
    if (!activities.some((a) => a.id === id)) activities.push(seed)
    const rows = (seeds.templateRows ?? []).filter((r) => r.activityId === id)
    if (templateRows) templateRows = [...templateRows, ...rows.filter((r) => !templateRows!.some((x: { id: string }) => x.id === r.id))]
    if (archetypes) {
      archetypes = archetypes.map((arc: any) => {
        const seedArc = (seeds.archetypes ?? []).find((x) => x.id === arc.id)
        const obj = seedArc?.wbs.find((o) => o.activityId === id)
        return obj && !(arc.wbs ?? []).some((o: any) => o.activityId === id) ? { ...arc, wbs: [...(arc.wbs ?? []), obj] } : arc
      })
    }
  }
  const lists0: MasterList[] = Array.isArray(s.masterLists) ? s.masterLists : []
  // Shipped lists the Admin never edited (still the old seed, or flagged as a placeholder) take the new seed items.
  const lists = lists0.map((l) => {
    const seed = seeds.masterLists.find((m) => m.id === l.id)
    const old = OLD_SEED_LISTS[l.id]
    if (!seed || !(l.placeholder || (old && JSON.stringify(l.items) === JSON.stringify(old)))) return l
    return { ...l, items: seed.items, placeholder: seed.placeholder }
  })
  const masterLists = [...lists, ...seeds.masterLists.filter((m) => !lists.some((l) => l.id === m.id))]
  const defOf = (id: string) => activities.find((a) => a.id === id) ?? seedById.get(id)
  const entries: ActivityEntry[] = (Array.isArray(s.entries) ? s.entries : []).map((e: ActivityEntry) =>
    migrateReasonRemarks(migrateEntryValues(e.activityId, e), defOf(e.activityId), masterLists)
  )
  // Nothing stored (fresh browser or very old shape): let the store start from its seeds.
  if (!stored.length && !entries.length) return {}
  return { ...s, activities: stored.length ? activities : s.activities, entries, masterLists, ...(templateRows ? { templateRows } : {}), ...(archetypes ? { archetypes } : {}) }
}
