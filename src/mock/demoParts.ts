/**
 * TEMPORARY authoring aid: builds sample parts + sample entries from the CURRENT activity definitions, so the
 * owner can keep editing activity fields and re-populate parts that show the updated fields.
 * Used by the "Load sample parts" button (AppLayout). Remove together with that button.
 */
import { makeEntryId } from '../domain'
import { deriveTechnicalCategory } from '../domain/timelineCatalog'
import type {
  Action,
  ActivityDefinition,
  ActivityEntry,
  DelayReason,
  Deviation,
  FieldDefinition,
  HistoryLog,
  ModelRecord,
  NgRound,
  PartAck,
  PartRecord,
  PartRelease,
  TemplateRow
} from '../domain'
import { rowRuleFor } from '../engine/rules'
import { addDays, ruleExtra, getFilteredData, evaluateCalculatedFields, evaluateConditionalRules, getMilestoneMrd, pulledTableRows, rowsFromCount, evaluateFieldChecks, buildRuleCtx, resolveOperand, resolveFieldOptions } from '../engine'
import { SEED_MASTER_LISTS } from './ppRuleConfig'
import { subTypeMrdKey } from '../domain/timelineCatalog'
import { sapTier2Rows } from './index'
import { sampleIntakeAttrs } from './partIntakeFields'
import { seedReviewRows } from '../engine/rowReview'
import { APP_TODAY } from '../domain/today'
import { DEMO_ENTRY_PRESETS, DEMO_MILESTONE_MRDS, DEMO_MODEL_MRDS } from './demoPresets'

const NOW = '2026-10-15T09:00:00Z'

interface DemoPartSeed {
  partNo: string
  partName: string
  model: string
  vendorName: string
  vendorCode: string
  department: string
  pic: string
  type: 'NewPart' | 'ECN'
  /** 'ack' = released + acknowledged, 'wait' = released, awaiting acknowledgement, 'none' = not released. */
  release: 'ack' | 'wait' | 'none'
}

const DEMO_PARTS: DemoPartSeed[] = [
  { partNo: '31100-M74LD0', partName: 'Headlamp Assy LH', model: 'Swift', vendorName: 'Minda Industries', vendorCode: 'V1001', department: 'Lighting', pic: 'Rahul Verma', type: 'NewPart', release: 'ack' },
  { partNo: '31100-M74LD1', partName: 'Headlamp Assy RH', model: 'Swift', vendorName: 'Minda Industries', vendorCode: 'V1001', department: 'Lighting', pic: 'Rahul Verma', type: 'ECN', release: 'ack' },
  { partNo: '71811-M82P00', partName: 'Front Bumper Panel', model: 'Brezza', vendorName: 'Subros Limited', vendorCode: 'V1004', department: 'Body', pic: 'Anita Desai', type: 'NewPart', release: 'ack' },
  { partNo: '71811-M82P01', partName: 'Rear Bumper Panel', model: 'Brezza', vendorName: 'Subros Limited', vendorCode: 'V1004', department: 'Body', pic: 'Anita Desai', type: 'NewPart', release: 'wait' },
  { partNo: '35520-M68P00', partName: 'Door Wiring Harness', model: 'Baleno', vendorName: 'Minda Industries', vendorCode: 'V1001', department: 'Electrical', pic: 'Suresh Nair', type: 'NewPart', release: 'ack' },
  { partNo: '84701-M55R10', partName: 'Piston Pin', model: 'Dzire', vendorName: 'Bosch India', vendorCode: 'V1003', department: 'Engine', pic: 'Suresh Nair', type: 'NewPart', release: 'ack' },
  { partNo: '95100-M82P10', partName: 'Instrument Cluster Trim', model: 'Fronx', vendorName: 'Denso India', vendorCode: 'V1002', department: 'Interior', pic: 'Anita Desai', type: 'ECN', release: 'ack' },
  { partNo: '39100-M74F00', partName: 'Door Weatherstrip', model: 'Grand Vitara', vendorName: 'Sanden Vikas', vendorCode: 'V1005', department: 'Body', pic: 'Rahul Verma', type: 'NewPart', release: 'none' }
]

/** A plausible value for one field. `n` varies the pick between parts/fields so the lists look mixed. */
function sampleValue(field: FieldDefinition, n: number, mrd: string, partNo: string): any {
  const opts = field.options ?? []
  switch (field.type) {
    case 'yesNo':
      return n % 7 === 3 ? 'N' : 'Y'
    case 'dropdown':
      return opts.length ? opts[n % opts.length] : ''
    case 'multiSelect':
      return opts.length ? [opts[n % opts.length]] : []
    case 'number':
      return 5 + (n % 20)
    case 'percent':
      return 80 + (n % 21)
    case 'date':
      return addDays(mrd, -12 + (n % 15))
    case 'longText':
      return `Sample note for ${partNo}`
    case 'file':
      return `evidence_${partNo}.pdf`
    case 'flag':
      return n % 5 === 0
    case 'table': {
      const cols = field.columns ?? []
      // One row (or the table's minimum): a single reason / point is enough unless the table asks for more.
      return Array.from({ length: Math.min(Math.max(field.minRows ?? 1, 1), field.maxRows ?? 99) }, (_, r) => r).map((r) =>
        Object.fromEntries(
          cols.map((c, ci) => {
            const k = n + r + ci
            const o = (c.optionsFrom ? SEED_MASTER_LISTS.find((l) => l.id === c.optionsFrom)?.items : undefined) ?? c.options ?? []
            const v =
              c.type === 'dropdown' ? (o.length ? o[k % o.length] : '')
              : c.type === 'number' ? 2 + (k % 8)
              : c.type === 'date' ? addDays(mrd, -8 + (k % 10))
              : c.key === 'requirement' ? `Point requirement specification ${r + 1}`
              : c.key === 'reason' ? `Tooling / manufacturing process constraint ${r + 1}`
              : `${c.label} ${r + 1}`
            return [c.key, v]
          })
        )
      )
    }
    case 'reasonRemark': {
      const reasons = resolveFieldOptions(field, SEED_MASTER_LISTS) ?? []
      return { reason: reasons.length ? reasons[n % reasons.length] : '', remark: `Sample remark for ${partNo}` }
    }
    default:
      return `${field.label} – sample ${1 + (n % 3)}`
  }
}

/**
 * Makes sample values pass the activity's own field checks, so no sample part opens with data a user could never
 * have saved: a value that needs another field first is dropped, a future date is dropped, and a value that must be
 * on / after (before) another is set equal to it. Generic: it reads only the activity's validation rules.
 */
export function fixSampleChecks(def: ActivityDefinition, values: Record<string, any>, extra: Parameters<typeof evaluateFieldChecks>[2]): Record<string, any> {
  for (let pass = 0; pass < 6; pass++) {
    const failed = evaluateFieldChecks(def, values, extra).filter((x) => x.severity === 'block')
    if (failed.length === 0) break
    for (const v of failed) {
      const r = def.validationRules?.find((x) => x.id === v.ruleId)
      if (!r?.field) continue
      if (r.type === 'compare' && r.compareTo) {
        const rhs = resolveOperand(r.compareTo, buildRuleCtx(def, values, extra))
        if (rhs === undefined || rhs === null || rhs === '') delete values[r.field]
        else values[r.field] = rhs
      } else {
        delete values[r.field]
      }
    }
  }
  return values
}

export interface DemoData {
  parts: PartRecord[]
  entries: ActivityEntry[]
  partReleases: PartRelease[]
  partAcks: PartAck[]
  delayReasons: DelayReason[]
  /** Models with sample-adjusted dates (so some activities are late). Replace the store's models on load. */
  models: ModelRecord[]
}

/**
 * Sample numbers of a table that satisfy its "A + B + … = Total" rules: the counts that generate rows (`countCols`,
 * "table.column") are kept to 1–2 and within the total; the last other part takes what remains. A row with no total
 * yet gets a small one (when the total is not pulled from elsewhere).
 */
function fixSampleSums(def: ActivityDefinition, values: Record<string, any>, countCols: Set<string>) {
  for (const rule of def.validationRules ?? []) {
    if (typeof rule.scope !== 'object' || rule.op !== '=' || rule.right.length !== 1 || !rule.left.length) continue
    const tk = rule.scope.tableField
    const rows: Record<string, any>[] = Array.isArray(values[tk]) ? values[tk] : []
    const totalCol = def.fields.find((f) => f.key === tk)?.columns?.find((c) => c.key === rule.right[0])
    rows.forEach((r, i) => {
      if (!(Number(r[rule.right[0]]) >= 0) || r[rule.right[0]] === undefined || r[rule.right[0]] === '') {
        if (totalCol?.enteredBy === 'System') return
        r[rule.right[0]] = 5
      }
      let remaining = Number(r[rule.right[0]]) || 0
      const prot = rule.left.filter((k) => countCols.has(`${tk}.${k}`))
      const rest = rule.left.filter((k) => !countCols.has(`${tk}.${k}`))
      prot.forEach((k, j) => {
        r[k] = Math.min(((i + j) % 2) + 1, remaining)
        remaining -= r[k]
      })
      rest.forEach((k, j) => {
        r[k] = j === rest.length - 1 ? remaining : Math.min(Number(r[k]) || 0, remaining)
        remaining -= r[k]
      })
      if (!rest.length && prot.length) r[prot[prot.length - 1]] += remaining
    })
  }
}

export function buildDemoData(
  activities: ActivityDefinition[],
  templateRows: TemplateRow[],
  baseModels: ModelRecord[]
): DemoData {
  // Swift is already well into PP in the sample, so its PP sub-type dates have passed and its activities run late.
  const models: ModelRecord[] = baseModels
    .map((m) =>
      m.name === 'Swift' && (m.mrds.PP ?? '') >= '2026-10-20' // only once: skip if already shifted by an earlier load
        ? { ...m, mrds: Object.fromEntries(Object.entries(m.mrds).map(([k, v]) => [k, k === 'PP' || k.startsWith('PP:') ? addDays(v, -14) : v])) }
        : m
    )
    // Demo presets: milestone MRDs shared by every model (e.g. the OT demo's PP MRD).
    .map((m) => ({ ...m, mrds: { ...m.mrds, ...DEMO_MILESTONE_MRDS, ...(DEMO_MODEL_MRDS[m.name] ?? {}) } }))
  const parts: PartRecord[] = DEMO_PARTS.map((p, idx) => {
    const rec: PartRecord = {
      partNo: p.partNo,
      partName: p.partName,
      model: p.model,
      vendorCode: p.vendorCode,
      vendorName: p.vendorName,
      department: p.department,
      section: 'NP1',
      pic: p.pic,
      type: p.type,
      // Part numbers come from ENOVIA; some arrive through the SAP feed, so the sample mixes both.
      origin: idx % 3 === 0 ? 'SAP' : 'ENOVIA',
      attrs: sampleIntakeAttrs(p.partNo, idx)
    }
    return { ...rec, technicalCategory: deriveTechnicalCategory(rec) }
  })
  const partReleases: PartRelease[] = []
  const partAcks: PartAck[] = []
  DEMO_PARTS.forEach((p) => {
    if (p.release === 'none') return
    partReleases.push({ id: `rel-${p.partNo}`, partNo: p.partNo, released: true, by: p.pic, byRole: 'PIC', at: '2026-10-04T10:00:00Z' })
    if (p.release === 'ack') {
      partAcks.push({ id: `ack-${p.partNo}`, partNo: p.partNo, status: 'Acknowledged', by: p.vendorName, byRole: 'Vendor', at: '2026-10-05T09:00:00Z' })
    }
  })

  const entries: ActivityEntry[] = []
  const actById = new Map(activities.map((a) => [a.id, a]))
  parts.forEach((part, pi) => {
    const model = models.find((m) => m.name === part.model)
    templateRows
      .filter((r) => r.section === part.section)
      .forEach((row, ri) => {
        const def = actById.get(row.activityId)
        if (!def) return
        // Scenario cycles so every part shows a mix of states.
        // Headlamp Assy RH (pp-3 SOR) is always shown as submitted by the Vendor and waiting for the PIC.
        const scenario = def.id === 'pp-3' && part.partNo === '31100-M74LD1' ? 1 : (pi + ri) % 5 // 0 approved, 1 submitted, 2 sent back, 3 draft, 4 untouched
        if (scenario === 4) return
        const mrd = getMilestoneMrd(model, row.subType ? subTypeMrdKey(row.milestoneId, row.subType) : row.milestoneId) ?? '2026-10-24'
        const vendorFlow = def.flow.steps.length > 1
        let values: Record<string, any> = {}
        def.fields.forEach((f, fi) => {
          if (f.dataOnly) {
            // Data-only feeds (SAP / ENOVIA …) that other fields calculate from are stored on the part's entry. A part is
            // missing from a given system now and then (blank), so calculations such as "ENOVIA, else SAP, else Data
            // Pending Updating" show every case. Tables and counts stay with the dashboard feed (see ./feed).
            if (f.type === 'table' || f.countRows || f.source === 'calculated') return
            // Parts cycle through: in both systems / ENOVIA only / SAP only / in neither (fields fetched on open always have one).
            const k = pi % 4
            const inSystem = f.autoFetch ? true : f.source === 'enovia' ? k < 2 : f.source === 'sap' ? k === 0 || k === 2 : true
            values[f.key] = inSystem ? sampleValue(f, pi * 3 + ri + fi, mrd, part.partNo) : ''
            return
          }
          if (scenario === 3 && fi % 2 === 1) return // draft = half filled
          // A number that sets how many rows another table gets (e.g. items rejected) stays small: 1–3.
          const drivesRows = f.type === 'number' && def.fields.some((t) => t.derivedRows?.from === 'count' && t.derivedRows.fieldKey === f.key)
          values[f.key] = drivesRows ? 1 + ((pi + ri + fi) % 3) : sampleValue(f, pi * 3 + ri + fi, mrd, part.partNo)
        })
        // Derived tables: SAP rows and rows pulled from an earlier activity first; then the sum rules (with the counts
        // that generate rows kept small and within their totals); then the rows generated from those counts.
        const countCols = new Set(def.fields.flatMap((f) => (f.derivedRows?.from === 'count' ? [`${f.derivedRows.fieldKey}.${f.derivedRows.countColumn}`] : [])))
        const derivedOrder = [...def.fields.filter((f) => f.derivedRows?.from !== 'count'), ...def.fields.filter((f) => f.derivedRows?.from === 'count')]
        let sumsFixed = false
        for (const f of derivedOrder) {
          const d = f.derivedRows
          if (d?.from === 'count' && !sumsFixed) { fixSampleSums(def, values, countCols); sumsFixed = true }
          if (!d || !(f.key in values)) continue
          // Derived columns replace the generated sample cells; the other columns keep their sample values.
          const sample: Record<string, any>[] = Array.isArray(values[f.key]) ? values[f.key] : []
          let incoming: Record<string, any>[]
          if (d.from === 'sap') {
            incoming = sapTier2Rows(part.partNo)
          } else if (d.from === 'count' && !Array.isArray(values[d.fieldKey])) {
            // Count taken from a number field: that many rows.
            incoming = rowsFromCount(values[d.fieldKey], d)
          } else if (d.from === 'count') {
            // The counts were kept small and within their totals above (fixSampleSums).
            const srcRows: Record<string, any>[] = Array.isArray(values[d.fieldKey]) ? values[d.fieldKey] : []
            incoming = rowsFromCount(srcRows, d)
          } else {
            const src = entries.find((e) => e.activityId === d.activityId && e.partNo === part.partNo)?.values[d.fieldKey]
            incoming = pulledTableRows(f, activities, src).rows
          }
          values[f.key] = incoming.map((r, i) => ({ ...(sample[i % Math.max(sample.length, 1)] ?? {}), ...r }))
        }

        // Tables reviewed row by row: spread the rows over the review journey to match the entry's state.
        for (const f of def.fields) {
          if (!f.rowReview || !Array.isArray(values[f.key])) continue
          const state = scenario === 0 ? 'Approved' : scenario === 1 && vendorFlow ? 'Submitted' : scenario === 2 && vendorFlow ? 'Sent back' : 'Draft'
          values[f.key] = seedReviewRows(f, values[f.key], state, pi + ri)
        }

        // Specific valid test scenarios for PP-03 (SOR sharing)
        if (def.id === 'pp-3') {
          values.sor_categories = [
            { sor_category_name: 'Plastic', total: 10, agree: 8, disagree: 2, not_applicable: 0 },
            { sor_category_name: 'Sheet Metal', total: 12, agree: 9, disagree: 3, not_applicable: 0 }
          ]
          // Decision, classification and remark stay empty: the PIC fills them. Submitted points wait with the PIC (stage 0).
          const stage = scenario === 1 ? 0 : -1
          values.disagreed_points = [
            { _sl: '1.1', category: 'Plastic', requirement: 'Wall thickness variance > 0.2mm', reason: 'Tooling limitation', _stage: stage },
            { _sl: '1.2', category: 'Plastic', requirement: 'Rib radius reduction from 1.5mm to 1.0mm', reason: 'Sink mark prevention', _stage: stage },
            { _sl: '2.1', category: 'Sheet Metal', requirement: 'Burr height allowance 0.08mm vs 0.05mm', reason: 'Die wear during high-volume stamping', _stage: stage },
            { _sl: '2.2', category: 'Sheet Metal', requirement: 'Flange width tolerance +/-0.5mm vs +/-0.3mm', reason: 'Press brake repeatability', _stage: stage },
            { _sl: '2.3', category: 'Sheet Metal', requirement: 'Hole position tolerance 0.1mm vs 0.05mm', reason: 'Progressive die wear', _stage: stage }
          ]
        }
        if (!sumsFixed) fixSampleSums(def, values, countCols)
        // Make the random sample numbers satisfy the activity's sum rules so sample parts open without warnings.
        for (const rule of def.validationRules ?? []) {
          if (typeof rule.scope === 'object') continue // table rules: fixSampleSums
          if (rule.scope === 'fields') {
            // A part may be a field or a table column ("table.column" = that column summed over the rows).
            const partOf = (k: string) => {
              const [fk, col] = k.split('.')
              if (!col) return Number(values[fk]) || 0
              const rws: Record<string, any>[] = Array.isArray(values[fk]) ? values[fk] : []
              return rws.reduce((t, r) => t + (Number(r?.[col]) || 0), 0)
            }
            if (rule.op === '=' && rule.right.length === 1 && !rule.right[0].includes('.') && rule.left.some((k) => k.split('.')[0] in values)) {
              // A = B + C … : make the total the sum of its parts.
              values[rule.right[0]] = rule.left.reduce((t, k) => t + partOf(k), 0)
            }
            if (rule.op === '<=' && rule.left.length === 1 && rule.right.length === 1 && !rule.left[0].includes('.') && !rule.right[0].includes('.')) {
              const cap = Number(values[rule.right[0]])
              if (Number.isFinite(cap) && Number(values[rule.left[0]]) > cap) values[rule.left[0]] = cap
            }
          }
        }
        // Stages happen in form order: the sample's planned dates (and, separately, its actual dates) rise down the form,
        // so a later stage never starts before an earlier one (e.g. Tool trial after Tool assembly after Tool cutting).
        for (const kind of ['planned', 'actual']) {
          const keys = def.fields.filter((f) => f.type === 'date' && f.key.includes(kind) && typeof values[f.key] === 'string').map((f) => f.key)
          const sorted = keys.map((k) => values[k] as string).sort()
          keys.forEach((k, i) => { values[k] = sorted[i] })
        }
        values = fixSampleChecks(def, values, ruleExtra(def, undefined, { mrd, part, today: SAMPLE_TODAY }))
        values = evaluateCalculatedFields(def, values, part, mrd, SAMPLE_TODAY, ruleExtra(def, undefined, { mrd, part, today: SAMPLE_TODAY }))
        // Table cells whose column is hidden for that row (column showRule, e.g. a breakup that only applies to one choice)
        // are dropped, so no sample row holds a cell the form would never show.
        {
          const rowRule = rowRuleFor(def, values, ruleExtra(def, undefined, { mrd, part, today: SAMPLE_TODAY }))
          for (const f of def.fields) {
            if (f.type !== 'table' || !Array.isArray(values[f.key])) continue
            const ruled = (f.columns ?? []).filter((c) => c.showRule)
            if (!ruled.length) continue
            values[f.key] = values[f.key].map((r: Record<string, any>) => {
              const out = { ...r }
              for (const c of ruled) if (!rowRule(c.showRule!, out)) delete out[c.key]
              return out
            })
          }
        }
        // Drop values of hidden fields; repeat because hiding one field can hide fields that depend on it.
        for (let pass = 0; pass < 4; pass++) {
          const cond = evaluateConditionalRules(def.fields, values, { ...ruleExtra(def, undefined, { mrd, part }), def })
          const hidden = def.fields.filter((f) => cond[f.key] && !cond[f.key].visible && f.key in values)
          if (hidden.length === 0) break
          for (const f of hidden) delete values[f.key]
        }

        const history: HistoryLog[] = []
        let validationState: ActivityEntry['validationState'] = 'Draft'
        let step = 0
        if (scenario === 0) {
          validationState = 'Approved'
          step = def.flow.steps.length - 1
          if (vendorFlow) history.push({ timestamp: '2026-10-08T10:00:00Z', persona: 'Vendor', action: 'Submitted' })
          history.push({ timestamp: '2026-10-09T10:00:00Z', persona: 'PIC', actorName: part.pic, action: 'Approved' })
        } else if (scenario === 1 && vendorFlow) {
          validationState = 'Submitted'
          step = 1
          history.push({ timestamp: '2026-10-13T10:00:00Z', persona: 'Vendor', action: 'Submitted' })
        } else if (scenario === 2 && vendorFlow) {
          validationState = 'Sent back'
          history.push({ timestamp: '2026-10-12T10:00:00Z', persona: 'Vendor', action: 'Submitted' })
          history.push({ timestamp: '2026-10-13T10:00:00Z', persona: 'PIC', actorName: part.pic, action: 'Sent back', comment: 'Please re-check the values and resubmit.' })
        } else if (scenario === 1 || scenario === 2) {
          // PIC-only activity: show it as approved so the list stays varied
          validationState = 'Approved'
          step = 0
          history.push({ timestamp: '2026-10-09T10:00:00Z', persona: 'PIC', actorName: part.pic, action: 'Approved' })
        }
        entries.push({
          id: makeEntryId(row.id, part.partNo),
          templateRowId: row.id,
          activityId: row.activityId,
          partNo: part.partNo,
          values,
          validationState,
          history,
          currentStepIndex: step,
          updatedAt: NOW,
          updatedBy: validationState === 'Submitted' || validationState === 'Draft' ? (vendorFlow ? 'Vendor' : 'PIC') : 'PIC'
        })
      })
  })

  const delayReasons = seedExceptions(entries, parts)
  delayReasons.push(...seedVendorDelays(entries, parts, activities, templateRows, models, partReleases, partAcks, delayReasons))
  // Activities that read another activity's data (a pulled table or field, e.g. SOR Adherence ← SOR) follow it, so a
  // part's journey reads in order: no data until the source is approved, and then the same rows as the source.
  for (const def of activities) {
    const pulls = def.fields.filter((f) => f.derivedRows?.from === 'activity' || f.pullFrom)
    if (!pulls.length) continue
    const srcIds = [...new Set(pulls.map((f) => (f.pullFrom ? f.pullFrom.activityId : f.derivedRows!.activityId!)))]
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.activityId !== def.id) continue
      const srcs = entries.filter((x) => srcIds.includes(x.activityId) && x.partNo === e.partNo)
      const ready = srcIds.every((id) => srcs.some((x) => x.activityId === id && x.validationState === 'Approved'))
      const consistent = pulls.every((f) => {
        const src = srcs.find((x) => x.activityId === (f.pullFrom ? f.pullFrom.activityId : f.derivedRows!.activityId))?.values
        if (f.pullFrom) return JSON.stringify(src?.[f.pullFrom.fieldKey] ?? null) === JSON.stringify(e.values[f.key] ?? null)
        const want = pulledTableRows(f, activities, src?.[f.derivedRows!.fieldKey]).rows
        const have: Record<string, any>[] = Array.isArray(e.values[f.key]) ? e.values[f.key] : []
        return want.length === have.length && want.every((w, j) => Object.entries(w).every(([k, v]) => String(have[j]?.[k] ?? '') === String(v ?? '')))
      })
      if (!ready) entries.splice(i, 1)
      else if (!consistent) entries[i] = { ...e, values: {}, validationState: 'Draft', currentStepIndex: 0, history: [], groupReviews: undefined }
    }
  }

  const kept = new Set(entries.map((e) => e.id))
  for (let i = delayReasons.length - 1; i >= 0; i--) if (!kept.has(delayReasons[i].entryId)) delayReasons.splice(i, 1)
  // Demo presets: these forms start as blank drafts holding only the preset values (and no late-activity reasons).
  const presetIds = new Set<string>()
  for (const p of DEMO_ENTRY_PRESETS) {
    const row = templateRows.find((r) => r.activityId === p.activityId)
    if (!row || !parts.some((x) => x.partNo === p.partNo)) continue
    const id = makeEntryId(row.id, p.partNo)
    presetIds.add(id)
    const state = p.state ?? 'Draft'
    const fresh: ActivityEntry = { id, templateRowId: row.id, activityId: p.activityId, partNo: p.partNo, values: { ...p.values }, validationState: state, history: [], currentStepIndex: state === 'Draft' ? 0 : 1, updatedAt: NOW, updatedBy: 'PIC' }
    const i = entries.findIndex((e) => e.id === id)
    if (i >= 0) entries[i] = fresh
    else entries.push(fresh)
  }
  return { parts, entries, partReleases, partAcks, delayReasons: delayReasons.filter((d) => !presetIds.has(d.entryId)), models }
}

const SAMPLE_TODAY = APP_TODAY

/**
 * Create 10 late activities that wait on the vendor for a delay reason. Picks activities whose planned end has
 * passed, on acknowledged parts, where the vendor enters first. Their entry goes back to Draft (or is dropped), so
 * the vendor owes a reason. Two of them already had a reason sent back by the PIC. Spread across parts.
 */
function seedVendorDelays(
  entries: ActivityEntry[],
  parts: PartRecord[],
  activities: ActivityDefinition[],
  templateRows: TemplateRow[],
  models: ModelRecord[],
  releases: PartRelease[],
  acks: PartAck[],
  existing: DelayReason[]
): DelayReason[] {
  const taken = new Set(existing.map((r) => r.entryId))
  const acked = new Set(acks.filter((a) => a.status === 'Acknowledged').map((a) => a.partNo))
  const released = new Set(releases.filter((r) => r.released).map((r) => r.partNo))
  const insts = getFilteredData(
    entries, activities, parts, templateRows, models,
    { milestone: 'All', section: 'All', model: 'All', vendor: 'All', type: 'All' }, 'overview', SAMPLE_TODAY
  ).filter((i) => {
    const a = i.activity
    return (
      acked.has(i.part.partNo) && released.has(i.part.partNo) && !i.notApplicable &&
      i.dates.status === 'resolved' && i.dates.end < SAMPLE_TODAY &&
      a.flow.steps[0]?.role === 'Vendor' && a.fields.some((f) => f.enteredBy === 'Vendor' && f.source !== 'calculated') &&
      !taken.has(makeEntryId(i.row.id, i.part.partNo))
    )
  })
  // Only the 10 chosen below should wait on the vendor. Any other late item the vendor holds is shown as already submitted.
  const settle = (i: (typeof insts)[number]) => {
    const id = makeEntryId(i.row.id, i.part.partNo)
    const e = entries.find((x) => x.id === id)
    if (e) {
      if (e.validationState === 'Draft' || e.validationState === 'Sent back') {
        e.validationState = 'Submitted'
        e.currentStepIndex = 1
        e.history = [{ timestamp: '2026-10-13T10:00:00Z', persona: 'Vendor', action: 'Submitted' }]
      }
    } else {
      entries.push({
        id, templateRowId: i.row.id, activityId: i.activity.id, partNo: i.part.partNo, values: {}, validationState: 'Submitted',
        history: [{ timestamp: '2026-10-13T10:00:00Z', persona: 'Vendor', action: 'Submitted' }], currentStepIndex: 1,
        updatedAt: NOW, updatedBy: 'Vendor'
      })
    }
  }
  // Round-robin across parts so the delays are not all on one part.
  const byPart = new Map<string, typeof insts>()
  // The vendor persona is Minda Industries, so the delays to respond to are on Minda's parts.
  // (The Headlamp Assy RH SOR entry stays submitted: it is the PIC decision demo.)
  for (const i of insts.filter((x) => x.part.vendorName === 'Minda Industries' && !(x.activity.id === 'pp-3' && x.part.partNo === '31100-M74LD1'))) byPart.set(i.part.partNo, [...(byPart.get(i.part.partNo) ?? []), i])
  const picked: typeof insts = []
  for (let round = 0; picked.length < 10; round++) {
    let added = false
    for (const list of byPart.values()) {
      if (list[round] && picked.length < 10) { picked.push(list[round]); added = true }
    }
    if (!added) break
  }
  for (const i of insts) if (!picked.includes(i)) settle(i)
  const out: DelayReason[] = []
  picked.forEach((i, n) => {
    const id = makeEntryId(i.row.id, i.part.partNo)
    const e = entries.find((x) => x.id === id)
    if (e) {
      e.validationState = n % 3 === 2 ? 'Sent back' : 'Draft'
      e.currentStepIndex = 0
      e.history = e.validationState === 'Sent back'
        ? [{ timestamp: '2026-10-10T10:00:00Z', persona: 'PIC', actorName: i.part.pic, action: 'Sent back', comment: 'Incomplete, please redo.' }]
        : []
    }
    // Two reasons the PIC already sent back: the vendor must give a new one.
    if (n === 4 || n === 7) {
      out.push({
        id: `delay-sample-sb-${n}`, entryId: id, rowId: i.row.id, partNo: i.part.partNo, activityId: i.activity.id,
        category: 'Others', remark: 'Will complete soon.', revisedDate: undefined, by: i.part.vendorName, byRole: 'Vendor',
        at: '2026-10-12T08:00:00Z', plannedEnd: i.dates.status === 'resolved' ? i.dates.end : SAMPLE_TODAY, status: 'SentBack',
        decidedBy: i.part.pic, decidedAt: '2026-10-13T09:00:00Z', decisionComment: 'Give a firm revised date and the root cause.'
      })
    }
  })
  return out
}

const DEV_FLOW = ['PIC', 'SIC', 'DPM'] as const

/**
 * Attach a varied set of deviations, actions and NG rounds to a handful of existing entries, and build a few
 * delay-reason records, so all four Exception Management tabs (and the "needs your attention" list) show content
 * for the PIC, SIC and Vendor personas. Only touches entries that were actually created above.
 */
function seedExceptions(entries: ActivityEntry[], parts: PartRecord[]): DelayReason[] {
  const vendorByPart = new Map(parts.map((p) => [p.partNo, p.vendorName]))
  const picByPart = new Map(parts.map((p) => [p.partNo, p.pic]))
  /** First entry for a part whose activity id matches, else any entry for the part. */
  const find = (partNo: string, activityId?: string): ActivityEntry | undefined =>
    (activityId ? entries.find((e) => e.partNo === partNo && e.activityId === activityId) : undefined) ??
    entries.find((e) => e.partNo === partNo)

  // ── Deviations (PIC → SIC → DPM) in a mix of stages ──
  const dev = (
    e: ActivityEntry | undefined,
    seq: number,
    title: string,
    currentStep: number,
    status: Deviation['status'],
    targetDate: string,
    description: string,
    edocNumber: string
  ) => {
    if (!e) return
    const pic = picByPart.get(e.partNo) ?? 'Rahul Verma'
    const history: Deviation['history'] = [
      { at: '2026-10-09T09:30:00Z', by: pic, byRole: 'PIC', action: 'Raised', comment: description }
    ]
    if (status === 'Approved') {
      history.push({ at: '2026-10-10T11:00:00Z', by: pic, byRole: 'PIC', action: 'Approved at PIC' })
      history.push({ at: '2026-10-11T12:00:00Z', by: 'SIC', byRole: 'SIC', action: 'Approved at SIC' })
      history.push({ at: '2026-10-12T14:00:00Z', by: 'DPM', byRole: 'DPM', action: 'Approved at DPM' })
    } else if (status === 'Sent back') {
      history.push({ at: '2026-10-10T11:00:00Z', by: 'SIC', byRole: 'SIC', action: 'Sent back', comment: 'Attach the measurement report before resubmitting.' })
    } else if (currentStep >= 1) {
      history.push({ at: '2026-10-10T11:00:00Z', by: pic, byRole: 'PIC', action: 'Approved at PIC' })
    }
    const d: Deviation = {
      id: `dev-sample-${seq}`,
      title,
      description,
      edocNumber,
      targetDate,
      flow: [...DEV_FLOW],
      currentStep,
      status,
      raisedBy: pic,
      raisedByRole: 'PIC',
      raisedAt: '2026-10-09T09:30:00Z',
      decidedAt: status === 'Approved' || status === 'Rejected' ? '2026-10-12T14:00:00Z' : undefined,
      history
    }
    e.deviations = [...(e.deviations ?? []), d]
  }

  // In progress, awaiting SIC (step 1) — shows in SIC's "needs attention".
  dev(find('31100-M74LD0', 'pp-2'), 1, 'Dimensional deviation on mounting boss', 1, 'In progress', '2026-10-28', 'Boss height 0.4 mm above drawing; requesting temporary acceptance for PP lot.', 'EDOC-2026-0411')
  // In progress, awaiting PIC (step 0) — shows in PIC's "needs attention".
  dev(find('71811-M82P00', 'pp-3'), 2, 'Material grade substitution', 0, 'In progress', '2026-11-02', 'Vendor proposes equivalent PP-TD20 in place of specified grade pending approval.', 'EDOC-2026-0417')
  // Sent back — back at PIC (step 0).
  dev(find('35520-M68P00', 'pp-4'), 3, 'Connector keying mismatch', 0, 'Sent back', '2026-10-30', 'Keying orientation differs from master sample; deviation raised for pilot build.', 'EDOC-2026-0421')
  // Approved — closed, shows in the register.
  dev(find('84701-M55R10', 'pp-5'), 4, 'Surface finish Ra out of band', 2, 'Approved', '2026-10-20', 'Pin surface Ra 0.9 vs 0.8 max; accepted with monitoring.', 'EDOC-2026-0402')

  // ── Actions (recommendations), a mix of assignees and statuses ──
  const act = (
    e: ActivityEntry | undefined,
    seq: number,
    title: string,
    assignedTo: Action['assignedTo'],
    status: Action['status'],
    targetDate: string | undefined,
    description: string,
    createdByRole: Action['createdByRole'],
    createdBy: string
  ) => {
    if (!e) return
    const assignedToName = assignedTo === 'Vendor' ? vendorByPart.get(e.partNo) : undefined
    const log: Action['history'] = [{ at: '2026-10-09T10:00:00Z', by: createdBy, byRole: createdByRole, action: 'Raised', comment: description }]
    if (status === 'In progress') log.push({ at: '2026-10-11T10:00:00Z', by: assignedToName ?? assignedTo, byRole: assignedTo, action: 'In progress' })
    if (status === 'Done') {
      log.push({ at: '2026-10-11T10:00:00Z', by: assignedToName ?? assignedTo, byRole: assignedTo, action: 'In progress' })
      log.push({ at: '2026-10-13T10:00:00Z', by: assignedToName ?? assignedTo, byRole: assignedTo, action: 'Marked done' })
    }
    const a: Action = {
      id: `act-sample-${seq}`,
      title,
      description,
      assignedTo,
      assignedToName,
      targetDate,
      status,
      createdBy,
      createdByRole,
      createdAt: '2026-10-09T10:00:00Z',
      completedAt: status === 'Done' ? '2026-10-13T10:00:00Z' : undefined,
      history: log
    }
    e.actions = [...(e.actions ?? []), a]
  }

  // Open action on the vendor, overdue — PIC sees it as overdue, vendor sees it as theirs.
  act(find('31100-M74LD0', 'pp-1'), 1, 'Submit revised PPAP dimensional report', 'Vendor', 'Open', '2026-10-12', 'Dimensions on cols 4–6 missing from the last upload.', 'PIC', 'Rahul Verma')
  // In progress on the vendor, future date.
  act(find('71811-M82P00', 'pp-2'), 2, 'Re-run weld destructive test on 3 coupons', 'Vendor', 'In progress', '2026-10-26', 'Previous coupons failed shear; repeat with corrected fixture.', 'PIC', 'Anita Desai')
  // Open action assigned to the PIC themselves (follow-up).
  act(find('35520-M68P00', 'pp-3'), 3, 'Schedule joint audit with SIC', 'PIC', 'Open', '2026-10-24', 'Align on pilot readiness before the next milestone.', 'SIC', 'SIC')
  // Done action — history/register.
  act(find('84701-M55R10', 'pp-1'), 4, 'Update control plan with new Ra limit', 'Vendor', 'Done', '2026-10-13', 'Reflect the approved deviation in the control plan.', 'PIC', 'Suresh Nair')
  // Open action assigned to SIC — SIC "needs attention".
  act(find('95100-M82P10', 'pp-2'), 5, 'Approve ECN transfer of trim history', 'SIC', 'Open', '2026-10-23', 'Review and approve the pending history transfer.', 'PIC', 'Anita Desai')

  // ── NG (no-go) rounds on the NG-tracked activity (pp-11) ──
  const ngEntry = find('31100-M74LD0', 'pp-11') ?? find('71811-M82P00', 'pp-11')
  if (ngEntry) {
    const openRound: NgRound = {
      round: 1,
      reason: 'Leak test failed at joint 2 — resubmit after rework.',
      by: 'PIC',
      byName: picByPart.get(ngEntry.partNo) ?? 'Rahul Verma',
      at: '2026-10-12T10:00:00Z',
      targetDate: '2026-10-22'
    }
    ngEntry.ngRounds = [...(ngEntry.ngRounds ?? []), openRound]
  }
  const ngEntry2 = find('35520-M68P00', 'pp-11')
  if (ngEntry2 && ngEntry2 !== ngEntry) {
    ngEntry2.ngRounds = [
      { round: 1, reason: 'Crimp height out of spec.', by: 'PIC', byName: picByPart.get(ngEntry2.partNo) ?? 'Suresh Nair', at: '2026-10-08T10:00:00Z', targetDate: '2026-10-14', resolvedAt: '2026-10-13T10:00:00Z' },
      { round: 2, reason: 'Pull-out force still below minimum — resubmit.', by: 'PIC', byName: picByPart.get(ngEntry2.partNo) ?? 'Suresh Nair', at: '2026-10-13T10:00:00Z', targetDate: '2026-10-25' }
    ]
  }

  // ── Delay reasons: one awaiting PIC review, one accepted, one sent back ──
  const delayReasons: DelayReason[] = []
  const delay = (
    partNo: string,
    activityId: string,
    seq: number,
    category: string,
    status: DelayReason['status'],
    plannedEnd: string,
    remark: string,
    revisedDate: string,
    decisionComment?: string
  ) => {
    const e = find(partNo, activityId)
    if (!e) return
    delayReasons.push({
      id: `delay-sample-${seq}`,
      entryId: e.id,
      rowId: e.templateRowId,
      partNo,
      activityId: e.activityId,
      category,
      remark,
      revisedDate,
      by: vendorByPart.get(partNo) ?? 'Vendor',
      byRole: 'Vendor',
      at: '2026-10-13T08:00:00Z',
      plannedEnd,
      status,
      decidedBy: status === 'Accepted' || status === 'SentBack' ? (picByPart.get(partNo) ?? 'PIC') : undefined,
      decidedAt: status === 'Accepted' || status === 'SentBack' ? '2026-10-14T09:00:00Z' : undefined,
      decisionComment
    })
  }
  delay('31100-M74LD0', 'pp-2', 1, 'Material shortage', 'Submitted', '2026-10-10', 'Resin lot delayed at port; expedited shipment booked.', '2026-10-24')
  delay('71811-M82P00', 'pp-3', 2, 'Tooling rework', 'Accepted', '2026-10-09', 'Mould cavity polishing took longer than planned.', '2026-10-20')
  delay('84701-M55R10', 'pp-4', 3, 'Manpower', 'Accepted', '2026-10-08', 'Shift shortage over the festival week.', '2026-10-18')

  return delayReasons
}


