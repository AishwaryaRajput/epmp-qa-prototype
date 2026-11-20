/** Extra read-only pieces used by FieldRenderer: a table row's history and the side-by-side comparison field. */
import type { FieldRendererProps } from './FieldRenderer'
import type { FieldDefinition } from '../domain'
import type { RowRule } from '../engine/rowReview'
import type { ReactNode } from 'react'

/** Same look as FieldRenderer's field label wrapper. */
function FieldWrapper({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">{label}</label>
      <div>{children}</div>
    </div>
  )
}

/** A row's history (FieldDefinition.logRows): who changed which cells, when. */
export function RowLog({ row }: { row: Record<string, any> }) {
  const log: { at: string; by: string; cells: string[] }[] = Array.isArray(row?._log) ? row._log : []
  if (!log.length) return <span className="text-[var(--color-muted)]">—</span>
  return (
    <ul className="space-y-0.5 text-[10px] text-[var(--color-muted)]">
      {log.map((l, i) => <li key={i}>{l.at.slice(0, 10)} · <strong>{l.by}</strong>: {l.cells.join(', ')}</li>)}
    </ul>
  )
}

/** Read-only side-by-side comparison (FieldDefinition.compare): mismatching rows highlighted, match % below. */
export function ComparisonView({ field, allValues }: FieldRendererProps) {
  const cfg = field.compare
  if (!cfg) return <></>
  const all = allValues ?? {}
  // "table.column" reads the table's latest row.
  const v = new Proxy(all, { get: (o, k: string) => (k in o || !k.includes('.') ? o[k] : (Array.isArray(o[k.split('.')[0]]) ? o[k.split('.')[0]].at(-1)?.[k.split('.')[1]] : undefined)) }) as Record<string, any>
  const blank = (x: unknown) => x === undefined || x === null || x === ''
  const show = (x: unknown) => (blank(x) ? '—' : String(x))
  const same = (a: unknown, b: unknown) => {
    if (blank(a) || blank(b)) return false
    const na = Number(a)
    const nb = Number(b)
    return Number.isFinite(na) && Number.isFinite(nb) ? na === nb : String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
  }
  const rows = cfg.pairs.filter((p) => !(blank(v[p.left]) && blank(v[p.right])))
  const matches = rows.filter((p) => same(v[p.left], v[p.right])).length
  return (
    <FieldWrapper label={field.label}>
      <div className="overflow-x-auto rounded border border-[var(--color-border)]" data-testid={`compare-${field.key}`}>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--color-surface)] text-[var(--color-muted)]">
              <th className="px-2 py-1 text-left font-medium"> </th>
              <th className="px-2 py-1 text-left font-medium">{cfg.leftLabel}</th>
              <th className="px-2 py-1 text-left font-medium">{cfg.rightLabel}</th>
              <th className="px-2 py-1 text-left font-medium">Match</th>
            </tr>
          </thead>
          <tbody>
            {/* A row neither side filled (e.g. capacity rows on a Quality NG) is left out: only what applies is shown. */}
            {cfg.pairs.filter((p) => !(blank(v[p.left]) && blank(v[p.right]))).map((p) => {
              const a = v[p.left]
              const b = v[p.right]
              const compared = true
              const ok = same(a, b)
              return (
                <tr key={p.label} className={`border-t border-[var(--color-border)] ${compared && !ok ? 'bg-[#fef2f2]' : ''}`}>
                  <td className="px-2 py-1 font-medium">{p.label}</td>
                  <td className="px-2 py-1">{show(a)}</td>
                  <td className="px-2 py-1">{show(b)}</td>
                  <td className={`px-2 py-1 font-semibold ${!compared ? 'text-[var(--color-muted)]' : ok ? 'text-[#047857]' : 'text-[#b91c1c]'}`}>{!compared ? '—' : ok ? 'Match' : 'Mismatch'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        {rows.length ? <>{matches} of {rows.length} match · <strong className="text-[var(--color-text)]">{Math.round((matches / rows.length) * 100)}%</strong></> : 'Nothing to compare yet.'}
      </p>
    </FieldWrapper>
  )
}


type Col = NonNullable<FieldDefinition['columns']>[number]
interface FormRowsProps {
  field: FieldDefinition
  rows: Record<string, any>[]
  /** Row rule evaluator (column showRule / requiredRule); absent = every column shows. */
  rowRule?: RowRule
  /** Editable cells; absent = read-only. */
  colEditable?: (c: Col) => boolean
  setCell?: (i: number, key: string, v: any) => void
  removeRow?: (i: number) => void
}

/**
 * A table in the 'form' layout (FieldDefinition.layout): every row is a card of labelled fields, and only the columns
 * that apply to that row are shown (a column whose row rule does not hold is left out, not shown as "—"). Calculated
 * (System) columns read as values. Same aria-labels as the grid, so either layout is filled the same way.
 */
export function FormRows({ field, rows, rowRule, colEditable, setCell, removeRow }: FormRowsProps) {
  const cols = field.columns ?? []
  const noun = field.rowNoun ? field.rowNoun[0].toUpperCase() + field.rowNoun.slice(1) : 'Row'
  const many = field.maxRows !== 1
  const inputCls = 'w-full rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-sm disabled:bg-[var(--color-surface)] disabled:text-[var(--color-text)]'
  if (rows.length === 0) return <p className="text-xs text-[var(--color-muted)]">Nothing entered yet.</p>
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const shown = cols.filter((c) => !(c.showRule && rowRule && !rowRule(c.showRule, r)))
        const log: unknown[] = Array.isArray(r?._log) ? r._log : []
        return (
          <div key={i} className="rounded-xl border border-[var(--color-border)] bg-white p-3">
            {(many || removeRow) && (
              <div className="mb-2 flex items-center justify-between">
                {many && <span className="text-xs font-semibold text-[var(--color-text)]">{noun} {r._sl ?? i + 1}</span>}
                {removeRow && <button type="button" onClick={() => removeRow(i)} className="text-xs text-[var(--color-destructive)] hover:underline" aria-label="Remove row">Remove</button>}
              </div>
            )}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {shown.map((c) => {
                const label = `${field.label} · ${c.label} ${i + 1}`
                const owner = c.enteredBy ?? field.enteredBy
                const system = owner === 'System' || !!c.calc
                const editable = !system && !!colEditable?.(c) && !!setCell
                const required = c.required || (c.requiredRule && rowRule?.(c.requiredRule, r))
                const v = r[c.key]
                return (
                  <div key={c.key} className={c.type === 'longText' ? 'sm:col-span-2' : ''}>
                    <div className="mb-1 text-xs font-medium text-[var(--color-muted)]">
                      {c.label}{required && editable ? <span className="text-rose-600"> *</span> : null}
                    </div>
                    {system || !editable ? (
                      <div className={`min-h-[34px] rounded-lg px-2.5 py-1.5 text-sm ${system ? 'bg-[var(--color-surface)] font-medium' : 'bg-[var(--color-surface)]'} text-[var(--color-text)]`} aria-label={label}>
                        {v === undefined || v === null || v === '' ? <span className="text-[var(--color-muted)]">—</span> : String(v)}
                      </div>
                    ) : c.type === 'dropdown' ? (
                      <select value={v ?? ''} aria-label={label} onChange={(e) => setCell!(i, c.key, e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : c.type === 'longText' ? (
                      <textarea value={v ?? ''} aria-label={label} rows={2} onChange={(e) => setCell!(i, c.key, e.target.value)} className={inputCls} />
                    ) : (
                      <input type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'} value={v ?? ''} aria-label={label} onChange={(e) => setCell!(i, c.key, e.target.value)} className={inputCls} />
                    )}
                  </div>
                )
              })}
            </div>
            {field.logRows && log.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-[var(--color-muted)]">History ({log.length})</summary>
                <div className="mt-1"><RowLog row={r} /></div>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Header of a plain table: one row of column labels, or — when columns carry a `group` — two rows, where adjacent
 * columns of the same group share a group header above their own labels (e.g. "Agreed at PP": Total, Implemented …).
 */
export function TableHead({ cols, history, action }: { cols: Col[]; history?: boolean; action?: boolean }) {
  const th = 'px-2 py-1 text-left font-medium text-[var(--color-muted)]'
  const grouped = cols.some((c) => c.group)
  if (!grouped) {
    return (
      <thead>
        <tr className="bg-[var(--color-surface)]">
          <th className={`${th} w-12`}>Sl.</th>
          {cols.map((c) => <th key={c.key} className={`${th} max-md:min-w-[128px]`}>{c.label}</th>)}
          {history && <th className={th}>History</th>}
          {action && <th className="w-8" />}
        </tr>
      </thead>
    )
  }
  const runs: { group?: string; cols: Col[] }[] = []
  for (const c of cols) {
    const last = runs[runs.length - 1]
    if (last && c.group && last.group === c.group) last.cols.push(c)
    else runs.push({ group: c.group, cols: [c] })
  }
  return (
    <thead>
      <tr className="bg-[var(--color-surface)]">
        <th rowSpan={2} className={`${th} w-12 align-bottom`}>Sl.</th>
        {runs.map((r, i) =>
          r.group ? (
            <th key={i} colSpan={r.cols.length} className={`${th} border-b border-l border-[var(--color-border)] text-center font-semibold text-[var(--color-text)]`}>{r.group}</th>
          ) : (
            <th key={i} rowSpan={2} className={`${th} align-bottom max-md:min-w-[128px]`}>{r.cols[0].label}</th>
          )
        )}
        {history && <th rowSpan={2} className={`${th} align-bottom`}>History</th>}
        {action && <th rowSpan={2} className="w-8" />}
      </tr>
      <tr className="bg-[var(--color-surface)]">
        {runs.filter((r) => r.group).flatMap((r) => r.cols.map((c, j) => <th key={c.key} className={`${th} ${j === 0 ? 'border-l border-[var(--color-border)]' : ''} max-md:min-w-[96px]`}>{c.label}</th>))}
      </tr>
    </thead>
  )
}

/** The red "!" beside a cell whose column warning holds on this row (TableColumn.warn). */
export function CellWarn({ message }: { message: string }) {
  return (
    <span role="img" aria-label={message} title={message} className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-destructive)] text-[10px] font-bold text-white">!</span>
  )
}
