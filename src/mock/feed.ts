/**
 * Mock of the system feed (SAP / ENOVIA / calculated) behind "data-only" fields: fields that never appear on an input
 * form but are stored per part for an activity so its dashboards can use them. Values are deterministic per part so the
 * charts stay stable between renders. A real build replaces this with the nightly SAP / ENOVIA extract.
 */
import { makeEntryId } from '../domain'
import type { ActivityDefinition, ActivityEntry, FieldDefinition, ModelRecord, PartRecord, TemplateRow } from '../domain'
import { addDays, getMilestoneMrd } from '../engine'
import { subTypeMrdKey } from '../domain/timelineCatalog'
import { sapTier2Rows } from './index'

/** Rows a data-only table gets from the system: SAP rows, or the matching rows of another activity's (SAP) table. */
function feedTableRows(f: FieldDefinition | undefined, partNo: string, activities: ActivityDefinition[], depth = 0): Record<string, any>[] {
  const d = f?.derivedRows
  if (!d || depth > 3) return []
  if (d.from === 'sap') return sapTier2Rows(partNo)
  if (d.from === 'activity') {
    const src = activities.find((a) => a.id === d.activityId)?.fields.find((t) => t.key === d.fieldKey)
    return feedTableRows(src, partNo, activities, depth + 1).filter((r) => !d.where?.column || r?.[d.where.column] === d.where.equals)
  }
  return []
}

const hash = (s: string) => Array.from(s).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)

function feedValue(f: FieldDefinition, part: PartRecord, mrd: string): any {
  const h = hash(`${part.partNo}|${f.key}`)
  const opts = f.options ?? []
  switch (f.type) {
    case 'yesNo': return h % 4 === 0 ? 'N' : 'Y'
    case 'dropdown': return opts.length ? opts[h % opts.length] : ''
    case 'number': return h % 30
    case 'percent': return 60 + (h % 41)
    case 'date': return addDays(mrd, -10 + (h % 15))
    default: return `${f.label} ${h % 5}`
  }
}

/**
 * Adds the data-only field values to the entries used for dashboards: merged into a part's existing entry (never over
 * a value someone entered), or as a "feed-only" entry when the part has no form entry yet. Feed-only entries do not
 * count as work started (see getFilteredData).
 */
export function overlayFeed(
  entries: ActivityEntry[],
  activities: ActivityDefinition[],
  parts: PartRecord[],
  templateRows: TemplateRow[],
  models: ModelRecord[]
): ActivityEntry[] {
  const withFeed = activities.filter((a) => a.fields.some((f) => f.dataOnly))
  if (withFeed.length === 0) return entries
  const byId = new Map(entries.map((e) => [e.id, e]))
  const out = new Map(byId)
  for (const act of withFeed) {
    const fields = act.fields.filter((f) => f.dataOnly)
    for (const row of templateRows.filter((r) => r.activityId === act.id)) {
      for (const p of parts) {
        if (p.section !== row.section || p.supersededBy) continue
        const mrd = getMilestoneMrd(models.find((m) => m.name === p.model), row.subType ? subTypeMrdKey(row.milestoneId, row.subType) : row.milestoneId) ?? '2026-10-24'
        const id = makeEntryId(row.id, p.partNo)
        const existing = out.get(id)
        // A "count rows" field counts the part's table: the entered rows if there are any, else the rows SAP supplies.
        const rowsOf = (tableKey: string): Record<string, any>[] => {
          const entered = existing?.values?.[tableKey]
          if (Array.isArray(entered) && entered.length > 0) return entered
          return feedTableRows(act.fields.find((t) => t.key === tableKey), p.partNo, activities)
        }
        const feed = Object.fromEntries(
          fields.map((f) => {
            const c = f.countRows
            if (c) return [f.key, rowsOf(c.tableField).filter((r) => String(r?.[c.column] ?? '') === c.equals).length]
            return [f.key, f.type === 'table' ? rowsOf(f.key) : feedValue(f, p, mrd)]
          })
        )
        if (existing) {
          // Counts always follow the table; any other fed value fills only what the entry does not hold already (a feed
          // value stored on the entry, even a blank "not in this system", is kept).
          const fill = Object.fromEntries(Object.entries(feed).filter(([k]) => fields.find((f) => f.key === k)?.countRows || !(k in existing.values)))
          out.set(id, { ...existing, values: { ...existing.values, ...fill } })
        } else {
          out.set(id, {
            id, templateRowId: row.id, activityId: act.id, partNo: p.partNo, values: feed, feedOnly: true,
            validationState: 'Draft', history: [], currentStepIndex: 0, updatedAt: '2026-10-15T00:00:00Z', updatedBy: 'System'
          })
        }
      }
    }
  }
  return [...out.values()]
}
