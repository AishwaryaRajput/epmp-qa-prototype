/**
 * ReviewTable: the editor / viewer of a table whose rows are decided stage by stage (FieldDefinition.rowReview).
 * Everything it shows comes from the field's configuration: the columns, who owns each column, when a column shows or
 * is mandatory, and the review stages. It knows no activity id and no column key.
 *   - Rows are grouped under a banner when the table is derived from a count (derivedRows.targetLabelColumn).
 *   - Each persona sees the columns that are visible to them (engine/rowReview.columnVisible).
 *   - A reviewer picks a decision per row; nothing moves until they press "Submit decisions" in the drawer footer.
 */
import { Fragment, useMemo } from 'react'
import { showDate } from './showDate'
import type { FieldDefinition, TableColumn } from '../domain'
import { cellEditable, columnStage, columnVisible, isRequired, matches, rowStage, type Row, type RowRule } from '../engine/rowReview'

export function usesTableRules(field: FieldDefinition): boolean {
  return !!field.rowReview
}

interface Props {
  field: FieldDefinition
  value: any
  onChange?: (val: any) => void
  disabled?: boolean
  currentPersona?: string
  entryState?: string
  onDecideRow?: (rowIndex: number) => string | undefined
  readOnly?: boolean
  allValues?: Record<string, any>
  /** Evaluates the columns' row rules (show / mandatory per row). */
  rowRule?: RowRule
  /** Rows counted from another table (e.g. one row per disagreed point): add one more row to a group (raises its count). */
  onAddToGroup?: (groupName: string) => void
}

const PILL = 'inline-block px-2 py-0.5 rounded text-[11px] font-semibold'
const INPUT = 'w-full h-8 text-xs px-2.5 rounded border border-slate-300 bg-white focus:ring-1 focus:ring-blue-500'
const DASH = <span className="text-slate-400 font-mono">—</span>

export function ReviewTable({ field, value, onChange, disabled, currentPersona = 'PIC', entryState, readOnly, rowRule, onAddToGroup }: Props) {
  const persona = currentPersona
  const rows: Row[] = Array.isArray(value) ? value : []
  const rv = field.rowReview
  const cols = field.columns ?? []
  const groupColumn = field.derivedRows?.from === 'count' ? field.derivedRows.targetLabelColumn : undefined
  const noun = field.rowNoun ?? 'row'
  const locked = !!disabled || !!readOnly

  const colOf = (k: string) => cols.find((c) => c.key === k)
  // Typed-in review tables (not derived): the owner of the entry columns (e.g. the Vendor) adds a row per item while
  // the entry is open to them. A row can be removed only before it was ever submitted (no review trail yet).
  const ownsEntryColumn = !!rv && cols.some((c) => columnStage(rv, c.key) < 0 && (c.enteredBy ?? field.enteredBy) === persona)
  // Counted rows: the entry-column owner adds one more row to a group (its count goes up by one).
  const canAddToGroup = !locked && !!onAddToGroup && ownsEntryColumn && (entryState === undefined || entryState === 'Draft' || entryState === 'Sent back')
  // MSIL roles see each row's decision trail (every round of the loop); the Vendor sees only what was sent back to them.
  const showTrail = !!rv && persona !== 'Vendor' && rows.some((r) => Array.isArray(r._log) && r._log.length > 0)
  const canAddRows = !locked && !field.derivedRows && !!onChange && ownsEntryColumn && (entryState === undefined || entryState === 'Draft' || entryState === 'Sent back') && (!field.maxRows || rows.length < field.maxRows) && (!field.addRowsBy || field.addRowsBy.includes(persona as never))
  const canRemoveRow = (r: Row) => canAddRows && rowStage(r, rv!) < 0 && !(Array.isArray(r._log) && r._log.length > 0)
  const addRow = () => onChange?.([...rows, {}])
  const removeRow = (i: number) => onChange?.(rows.filter((_, idx) => idx !== i))
  const setRowCell = (rowIndex: number, key: string, v: any) => {
    if (!onChange || locked) return
    const next: Row = { ...rows[rowIndex], [key]: v }
    // Choosing a decision clears what the earlier choice had asked for (e.g. a classification typed before switching to Send back).
    const si = rv ? columnStage(rv, key) : -1
    if (rv && si >= 0 && rv.stages[si].decisionColumn === key) {
      for (const k of [rv.stages[si].routeColumn, ...rv.stages[si].columns]) {
        const c = k ? colOf(k) : undefined
        if (k && c?.showWhen && !matches(c.showWhen, next)) delete next[k]
      }
    }
    onChange(rows.map((r, i) => (i === rowIndex ? next : r)))
  }

  // A reviewer sees the rows that have reached their stage (and not rows closed before it); everyone else sees all.
  const visibleItems = useMemo(() => {
    const idx = rv ? rv.stages.findIndex((s) => s.role === persona) : -1
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        if (!rv || idx <= 0) return true // the Vendor, Admin and the first stage see every row
        const s = rowStage(row, rv)
        return s === idx || (s > idx && String(row[rv.stages[idx].decisionColumn] ?? '') !== '')
      })
  }, [rows, rv, persona])

  // Columns for this persona: those visible on some row, plus the columns of the stage they decide at while rows await them.
  const shown: TableColumn[] = useMemo(() => {
    return cols.filter((c) => {
      if (c.key === groupColumn) return false
      // No rows yet: show the entry columns so the table reads as a form to fill.
      if (visibleItems.length === 0) return (!rv || columnStage(rv, c.key) < 0) && !c.showWhen && !c.showRule && !c.fillAfterAccept
      if (visibleItems.some(({ row }) => columnVisible(field, c, row, persona, rowRule))) return true
      const si = rv ? columnStage(rv, c.key) : -1
      return si >= 0 && rv!.stages[si].role === persona && visibleItems.some(({ row }) => rowStage(row, rv!) === si)
    })
  }, [cols, groupColumn, visibleItems, field, persona, rv, rowRule])

  const groups = useMemo(() => {
    const map = new Map<string, Array<{ row: Row; index: number }>>()
    for (const it of visibleItems) {
      const key = groupColumn ? String(it.row[groupColumn] ?? 'Uncategorized').trim() : ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    return Array.from(map.entries())
  }, [visibleItems, groupColumn])

  const colSpan = shown.length + 1 + (canAddRows ? 1 : 0) + (showTrail ? 1 : 0)

  function renderCell(c: TableColumn, r: Row, i: number) {
    const si = rv ? columnStage(rv, c.key) : -1
    const st = si >= 0 ? rv!.stages[si] : undefined
    const isDecision = !!st && st.decisionColumn === c.key
    const editable = !locked && columnVisible(field, c, r, persona, rowRule) && cellEditable(field, c, r, persona, entryState, rowRule)
    const v = r[c.key]
    const empty = v === undefined || v === null || v === ''
    if (!editable && !columnVisible(field, c, r, persona, rowRule)) return DASH

    if (editable && isDecision && c.options?.length) {
      return (
        <div className="inline-flex rounded-md p-0.5 bg-slate-100 border border-slate-200" role="group" aria-label={c.label}>
          {c.options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setRowCell(i, c.key, o)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-all ${v === o ? (o === st!.acceptValue ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white') : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'}`}
            >
              {o}
            </button>
          ))}
        </div>
      )
    }
    if (editable && c.type === 'dropdown') {
      return (
        <select value={v ?? ''} onChange={(e) => setRowCell(i, c.key, e.target.value)} aria-label={c.label} className="w-full h-8 text-xs px-2 rounded border border-slate-300 bg-white font-medium focus:ring-1 focus:ring-blue-500">
          <option value="">Select…</option>
          {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (editable) {
      return (
        <input
          type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
          value={v ?? ''}
          onChange={(e) => setRowCell(i, c.key, e.target.value)}
          aria-label={c.label}
          placeholder={`${c.label}${isRequired(c, r, rowRule) ? ' *' : ''}`}
          className={INPUT}
        />
      )
    }
    if (isDecision && !empty) {
      const s = rowStage(r, rv!)
      if (s >= rv!.stages.length && st!.role === 'DPM') {
        return <span className={`${PILL} ${r._outcome === 'Rejected' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{r._outcome === 'Rejected' ? 'Closed – Rejected' : 'Closed – Accepted'}</span>
      }
      return <span className={`${PILL} ${v === st!.acceptValue ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{String(v)}</span>
    }
    if (isDecision) {
      const s = rowStage(r, rv!)
      if (s >= rv!.stages.length) {
        return <span className={`${PILL} ${r._outcome === 'Rejected' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{r._outcome === 'Rejected' ? 'Closed – Rejected' : 'Closed – Accepted'}</span>
      }
      // Only a row that was actually returned shows "Sent back" (a new row with the Vendor is just being filled).
      if (s < 0 && r._note && (r._note.by === st!.role || persona === 'Vendor')) return <span className={`${PILL} bg-amber-100 text-amber-800`}>Sent back</span>
      if (s === si && persona !== 'Vendor') return <span className={`${PILL} bg-slate-100 text-slate-500`}>Pending</span>
      return DASH
    }
    if (empty) return DASH
    if (c.type === 'dropdown') return <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium text-[11px]">{String(v)}</span>
    if (c.type === 'date') return <span>{showDate(v)}</span>
    return <span>{String(v)}</span>
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white shadow-sm overflow-hidden text-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[var(--color-surface)] text-[var(--color-muted)] font-medium border-b border-[var(--color-border)]">
              <th className="px-2.5 py-2 text-center w-12">Sl</th>
              {shown.map((c) => (
                <th key={c.key} className={`px-3 py-2 text-left ${c.type === 'longText' ? 'min-w-[200px]' : 'min-w-[120px]'}`}>{c.label}</th>
              ))}
              {showTrail && <th className="px-3 py-2 text-left min-w-[180px]">History</th>}
              {canAddRows && <th className="w-8" aria-label="Remove row" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {groups.map(([groupName, items]) => (
              <Fragment key={groupName || 'all'}>
                {groupColumn && (
                  <tr className="bg-slate-100/90 text-slate-800 font-semibold border-y border-[var(--color-border)]">
                    <td colSpan={colSpan} className="px-3.5 py-1.5 text-xs font-semibold text-slate-900">
                      {groupName} – {items.length} {items.length === 1 ? noun : `${noun}s`}
                      {canAddToGroup && (
                        <button type="button" onClick={() => onAddToGroup!(groupName)} className="ml-3 text-[11px] font-semibold text-[var(--color-accent)] hover:underline" aria-label={`Add ${noun} to ${groupName}`}>
                          + Add {noun}
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {items.map(({ row: r, index: i }) => {
                  const s = rv ? rowStage(r, rv) : -1
                  const noteForReviewer = rv && s >= 0 && s < rv.stages.length && r._note && persona !== 'Vendor'
                  return (
                    <tr key={i} className="hover:bg-slate-50/70 transition-colors align-top">
                      <td className="px-2.5 py-2 text-center font-mono font-medium text-slate-600">{r._sl || i + 1}</td>
                      {shown.map((c, ci) => (
                        <td key={c.key} className="px-3 py-2 text-slate-800">
                          {renderCell(c, r, i)}
                          {ci === 0 && noteForReviewer && (
                            <div className="mt-1 text-[11px] text-amber-700">Returned by {r._note.by}: {r._note.text}</div>
                          )}
                        </td>
                      ))}
                      {showTrail && (
                        <td className="px-3 py-2 align-top">
                          {Array.isArray(r._log) && r._log.length > 0 ? (
                            <ol className="space-y-0.5 text-[11px] text-slate-600" data-testid="row-trail">
                              {r._log.map((l: string, k: number) => <li key={k}><span className="font-mono text-slate-400">{k + 1}.</span> {l}</li>)}
                            </ol>
                          ) : DASH}
                        </td>
                      )}
                      {canAddRows && (
                        <td className="px-2 py-2 text-center">
                          {canRemoveRow(r) && (
                            <button type="button" onClick={() => removeRow(i)} className="text-[var(--color-destructive)] hover:underline text-xs" title={`Remove ${noun}`} aria-label={`Remove ${noun}`}>✕</button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </Fragment>
            ))}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-slate-400">No {noun}s to display for {persona}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canAddRows && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <button type="button" onClick={addRow} className="text-xs font-medium text-[var(--color-primary)] hover:underline">+ Add {noun}</button>
        </div>
      )}
    </div>
  )
}
