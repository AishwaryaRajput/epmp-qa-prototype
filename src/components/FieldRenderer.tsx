import { Icon as FbIcon } from './Icon'
/**
 * Field Renderer Registry
 *
 * Keyed by FieldType. Each entry provides a read-only preview renderer
 * and (for Sub-task 4) a full editable renderer.
 *
 * Sub-task 4 (Workspace) should:
 *   1. Import `fieldRendererRegistry`
 *   2. Look up `fieldRendererRegistry[field.type]`
 *   3. Render `.editor(props)` when the field is editable by the current persona
 *      or `.preview(props)` for read-only display.
 *
 * API:
 *   fieldRendererRegistry[fieldType].preview({ field, value })
 *   fieldRendererRegistry[fieldType].editor({ field, value, onChange, disabled })
 */

import type { ReactElement } from 'react'
import type { FieldDefinition } from '../domain'
import { ReviewTable, usesTableRules } from './ReviewTable'
import { normalizeReasonRemark } from '../engine/rules'
import type { RowRule } from '../engine/rowReview'
import { CellWarn, ComparisonView, FormRows, RowLog, TableHead } from './FieldExtras'
import { columnVisible } from '../engine/rowReview'

export interface FieldRendererProps {
  field: FieldDefinition
  value: any
  onChange?: (val: any) => void
  disabled?: boolean
  className?: string
  /** Current persona — used by the `table` field so a column can be owned by a different role. */
  currentPersona?: string
  /** The entry's validation state — used by tables with a row review chain. */
  entryState?: string
  /** Tables with a row review chain: the current persona decides row `rowIndex`. Returns an error message, or nothing on success. */
  onDecideRow?: (rowIndex: number) => string | undefined
  /** All values of the entry, for pivot summaries. */
  allValues?: Record<string, any>
  /** Tables: evaluates the columns' row rules (show / mandatory per row, see TableColumn.showRule). */
  rowRule?: RowRule
  /** Counted review tables: add a row to a group (raises the count it is derived from). */
  onAddToGroup?: (groupName: string) => void
}

export type FieldRendererFn = (props: FieldRendererProps) => ReactElement

export interface FieldRendererEntry {
  /** Read-only display (used in preview panel) */
  preview: FieldRendererFn
  /** Editable control (Sub-task 4 workspace) */
  editor: FieldRendererFn
}

// ── Helper atoms ──────────────────────────────────────────────────────────────

function PreviewValue({ value, fallback = '—' }: { value: any; fallback?: string }) {
  const display = value === null || value === undefined || value === '' ? fallback : String(value)
  return <span className="text-[var(--color-text)] text-sm">{display}</span>
}

function FieldWrapper({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">{label}</label>
      <div>{children}</div>
    </div>
  )
}

function inputClass(disabled?: boolean) {
  return `w-full border border-[var(--color-border)] rounded px-2.5 py-1.5 text-sm max-md:text-base bg-white text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${disabled ? 'opacity-60 cursor-not-allowed bg-[var(--color-surface)]' : ''}`
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const fieldRendererRegistry: Record<string, FieldRendererEntry> = {
  text: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <PreviewValue value={value} />
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          className={inputClass(disabled)}
        />
      </FieldWrapper>
    ),
  },

  longText: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <PreviewValue value={value} />
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          rows={3}
          className={`${inputClass(disabled)} resize-y`}
        />
      </FieldWrapper>
    ),
  },

  number: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <PreviewValue value={value} />
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.valueAsNumber)}
          disabled={disabled}
          className={inputClass(disabled)}
        />
      </FieldWrapper>
    ),
  },

  percent: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <PreviewValue value={value !== null && value !== undefined ? `${value}%` : null} />
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.valueAsNumber)}
            disabled={disabled}
            className={`${inputClass(disabled)} w-24`}
          />
          <span className="text-sm text-[var(--color-muted)]">%</span>
        </div>
      </FieldWrapper>
    ),
  },

  date: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <PreviewValue value={value} />
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <input
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          className={inputClass(disabled)}
        />
      </FieldWrapper>
    ),
  },

  yesNo: {
    preview: ({ field, value }) => {
      const display = value === 'Y' ? 'Yes' : value === 'N' ? 'No' : value ?? '—'
      const color = value === 'Y' ? '#15803d' : value === 'N' ? '#b91c1c' : '#57606a'
      return (
        <FieldWrapper label={field.label}>
          <span className="text-sm font-medium" style={{ color }}>{display}</span>
        </FieldWrapper>
      )
    },
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <select
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          className={inputClass(disabled)}
        >
          <option value="">— Select —</option>
          <option value="Y">Yes</option>
          <option value="N">No</option>
        </select>
      </FieldWrapper>
    ),
  },

  dropdown: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <PreviewValue value={value} />
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <select
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          className={inputClass(disabled)}
        >
          <option value="">— Select —</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </FieldWrapper>
    ),
  },

  multiSelect: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <PreviewValue value={Array.isArray(value) ? value.join(', ') : value} />
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => {
      const selected: string[] = Array.isArray(value) ? value : []
      function toggle(opt: string) {
        if (disabled) return
        const next = selected.includes(opt)
          ? selected.filter((s) => s !== opt)
          : [...selected, opt]
        onChange?.(next)
      }
      return (
        <FieldWrapper label={field.label}>
          <div className="flex flex-wrap gap-1.5">
            {field.options?.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                disabled={disabled}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${selected.includes(opt) ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'bg-white text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-accent)]'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {opt}
              </button>
            ))}
          </div>
        </FieldWrapper>
      )
    },
  },

  file: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        {value ? (
          <span className="text-xs text-primary underline">{value}</span>
        ) : (
          <span className="text-xs text-[var(--color-muted)]">No file uploaded</span>
        )}
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(`mock-upload-${field.key}-${Date.now()}.pdf`)}
            className={`px-3 py-1.5 text-xs border border-[var(--color-border)] rounded bg-white text-[var(--color-text)] hover:bg-[var(--color-surface)] ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            Upload file
          </button>
          {value && <span className="text-xs text-[var(--color-muted)]">{value}</span>}
        </div>
      </FieldWrapper>
    ),
  },

  flag: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <span className={`text-sm font-medium ${value ? 'text-destructive' : 'text-[var(--color-muted)]'}`}>
          {value ? 'Flagged' : 'Clear'}
        </span>
      </FieldWrapper>
    ),
    editor: ({ field, value, onChange, disabled }) => (
      <FieldWrapper label={field.label}>
        <button
          type="button"
          onClick={() => onChange?.(!value)}
          disabled={disabled}
          className={`px-3 py-1.5 text-xs rounded border transition-colors ${value ? 'bg-[#fef2f2] border-[#fca5a5] text-destructive' : 'bg-white border-[var(--color-border)] text-[var(--color-muted)]'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {value ? <>Flagged <FbIcon name="close" size={12} className="ml-1" /></> : 'Flag'}
        </button>
      </FieldWrapper>
    ),
  },

  button: {
    preview: ({ field }) => (
      <FieldWrapper label={field.label}>
        <button type="button" disabled className="px-3 py-1 text-xs border border-[var(--color-border)] rounded text-[var(--color-muted)] bg-[var(--color-surface)]">
          {field.label}
        </button>
      </FieldWrapper>
    ),
    editor: ({ field, onChange }) => (
      <FieldWrapper label={field.label}>
        <button
          type="button"
          onClick={() => onChange?.(true)}
          className="px-3 py-1 text-xs bg-[var(--color-accent)] text-white rounded hover:opacity-90"
        >
          {field.label}
        </button>
      </FieldWrapper>
    ),
  },

  comparison: {
    preview: (p) => <ComparisonView {...p} />,
    editor: (p) => <ComparisonView {...p} />,
  },

  pivotSummary: {
    preview: () => <></>,
    editor: () => <></>,
  },

  table: {
    preview: ({ field, value, currentPersona, entryState, allValues, rowRule }) => {
      if (field.pivotSummary) return <></>
      if (usesTableRules(field)) {
        return (
          <FieldWrapper label={field.label}>
            <ReviewTable field={field} value={value} currentPersona={currentPersona} entryState={entryState} allValues={allValues} rowRule={rowRule} readOnly />
          </FieldWrapper>
        )
      }
      const rows: Record<string, any>[] = Array.isArray(value) ? value : []
      // Columns this role sees (hidden-from-Vendor, role lists); a column that applies to no row is left out.
      const cols = (field.columns ?? []).filter((c) => (rows.length ? rows : [{}]).some((r) => columnVisible(field, c, r, currentPersona ?? '', rowRule)))
      if (field.layout === 'form') return <FieldWrapper label={field.label}><FormRows field={field} rows={rows} rowRule={rowRule} /></FieldWrapper>
      return (
        <FieldWrapper label={field.label}>
          {rows.length === 0 ? (
            <span className="text-xs text-[var(--color-muted)]">No rows</span>
          ) : (
            <div className="overflow-x-auto rounded border border-[var(--color-border)]">
              <table className="w-full text-xs">
                <TableHead cols={cols} history={field.logRows} />
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-[var(--color-border)]">
                      <td className="px-2 py-1 text-[var(--color-muted)] whitespace-nowrap">{r._sl ?? i + 1}</td>
                      {cols.map((c) => (
                        <td key={c.key} className="px-2 py-1 text-[var(--color-text)]">
                          {c.showRule && rowRule && !rowRule(c.showRule, r) ? '—' : r[c.key] ?? '—'}
                          {c.warn && rowRule?.(c.warn.when, r) && <CellWarn message={c.warn.message} />}
                        </td>
                      ))}
                      {field.logRows && <td className="px-2 py-1 align-top"><RowLog row={r} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FieldWrapper>
      )
    },
    editor: ({ field, value, onChange, disabled, currentPersona, entryState, onDecideRow, allValues, rowRule, onAddToGroup }) => {
      if (field.pivotSummary) return <></>
      if (usesTableRules(field)) {
        return (
          <FieldWrapper label={field.label}>
            <ReviewTable field={field} value={value} onChange={onChange} disabled={disabled} currentPersona={currentPersona} entryState={entryState} onDecideRow={onDecideRow} allValues={allValues} rowRule={rowRule} onAddToGroup={onAddToGroup} />
          </FieldWrapper>
        )
      }
      const allCols = field.columns ?? []
      const stored: Record<string, any>[] = Array.isArray(value) ? value : []
      const fieldOwner = field.enteredBy
      // A column is editable when its owner (its own enteredBy, else the field's) matches the current persona,
      // and the field itself isn't disabled by the workflow.
      const colEditable = (c: typeof allCols[number]) => {
        if (disabled) return false
        const owner = c.enteredBy ?? fieldOwner
        // A column without its own owner follows the field, including the field's "also editable by" roles.
        return !currentPersona || owner === currentPersona || owner === undefined || (!c.enteredBy && (field.alsoEditableBy ?? []).includes(currentPersona as never))
      }
      // The current persona may add/remove rows only if it owns at least one non-System column.
      const ownsRows = !disabled && !field.derivedRows && allCols.some((c) => colEditable(c) && (c.enteredBy ?? fieldOwner) !== 'System') && (!field.addRowsBy || field.addRowsBy.includes(currentPersona as never))
      // A single-row table (maxRows 1) shows its row ready to fill; no Add / Remove row.
      const ready = ownsRows ? Math.max(field.maxRows === 1 ? 1 : 0, field.minRows ?? 0) : 0
      const rows: Record<string, any>[] = stored.length < ready ? [...stored, ...Array.from({ length: ready - stored.length }, () => ({}))] : stored
      const canAddRows = ownsRows && field.maxRows !== 1 && (!field.maxRows || rows.length < field.maxRows)
      // Columns this role sees (hidden-from-Vendor, role lists); a column that applies to no row is left out.
      const cols = allCols.filter((c) => (rows.length ? rows : [{}]).some((r) => columnVisible(field, c, r, currentPersona ?? '', rowRule)))

      const update = (next: Record<string, any>[]) => onChange?.(next)
      const addRow = () => update([...rows, Object.fromEntries(allCols.map((c) => [c.key, '']))])
      const removeRow = (i: number) => update(rows.filter((_, idx) => idx !== i))
      const setCell = (i: number, key: string, v: any) =>
        update(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)))

      const addButton = canAddRows && (
        <button type="button" onClick={addRow} className="mt-1.5 rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface)]">
          + Add {field.rowNoun ?? 'row'}
        </button>
      )
      if (field.layout === 'form') {
        return (
          <FieldWrapper label={field.label}>
            <FormRows field={field} rows={rows} rowRule={rowRule} colEditable={colEditable} setCell={setCell} removeRow={canAddRows && rows.length > Math.max(field.minRows ?? 0, 1) ? removeRow : undefined} />
            {addButton}
          </FieldWrapper>
        )
      }
      return (
        <FieldWrapper label={field.label}>
          <div className="overflow-x-auto rounded border border-[var(--color-border)]">
            <table className="w-full text-xs">
              <TableHead cols={cols} history={field.logRows} action />
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={cols.length + 2} className="px-2 py-3 text-center text-[var(--color-muted)]">{field.derivedRows ? (field.derivedRows.from === 'sap' ? 'No rows yet. They come from SAP: use Fetch.' : field.derivedRows.from === 'count' ? 'No rows yet. One row appears for each item counted above.' : 'No rows. Rows come from the matching rows of the earlier activity.') : 'No rows yet.'}</td></tr>
                )}
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 text-[var(--color-muted)] whitespace-nowrap">{r._sl ?? i + 1}</td>
                    {cols.map((c) => {
                      // Row rules: a cell whose "show on a row when" does not hold reads "—" and cannot be typed into.
                      if (c.showRule && rowRule && !rowRule(c.showRule, r)) return <td key={c.key} className="px-2 py-1 text-[var(--color-muted)]">—</td>
                      const editable = colEditable(c)
                      return (
                        <td key={c.key} className="px-1 py-1 max-md:min-w-[128px]">
                          {c.type === 'dropdown' ? (
                            <select
                              value={r[c.key] ?? ''}
                              aria-label={`${field.label} · ${c.group ? `${c.group} ` : ''}${c.label} ${i + 1}`}
                              disabled={!editable}
                              onChange={(e) => setCell(i, c.key, e.target.value)}
                              className="w-full rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs disabled:bg-[var(--color-surface)] disabled:opacity-70"
                            >
                              <option value="">—</option>
                              {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <span className="flex items-center">
                              <input
                                type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                                value={r[c.key] ?? ''}
                                aria-label={`${field.label} · ${c.group ? `${c.group} ` : ''}${c.label} ${i + 1}`}
                                placeholder={editable && (c.required || (c.requiredRule && rowRule?.(c.requiredRule, r))) ? `${c.label} *` : undefined}
                                disabled={!editable}
                                onChange={(e) => setCell(i, c.key, e.target.value)}
                                className="w-full rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs disabled:bg-[var(--color-surface)] disabled:opacity-70"
                              />
                              {c.warn && rowRule?.(c.warn.when, r) && <CellWarn message={c.warn.message} />}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    {field.logRows && <td className="px-2 py-1 align-top"><RowLog row={r} /></td>}
                    <td className="px-1 py-1 text-center">
                      {canAddRows && (
                        <button type="button" onClick={() => removeRow(i)} className="text-[var(--color-destructive)] hover:underline text-xs" title="Remove row" aria-label="Remove row"><FbIcon name="close" size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {addButton}
        </FieldWrapper>
      )
    },
  },

  reasonRemark: {
    preview: ({ field, value }) => {
      // Older saves stored plain text; read it safely as { reason, remark }.
      const v = normalizeReasonRemark(value, field.options)
      return (
        <FieldWrapper label={field.label}>
          <PreviewValue value={v.reason ? (v.remark ? `${v.reason} — ${v.remark}` : v.reason) : ''} />
        </FieldWrapper>
      )
    },
    editor: ({ field, value, onChange, disabled }) => {
      // Never spread a plain-text value into an object (that stored one key per character).
      const v = normalizeReasonRemark(value, field.options)
      const others = field.reasonRemark?.othersValue ?? 'Others'
      const remarkNeeded = field.reasonRemark?.remark === 'always' || (field.reasonRemark?.remark === 'whenOthers' && v.reason === others)
      return (
        <FieldWrapper label={field.label}>
          <div className="space-y-1.5">
            <select
              aria-label={`${field.label} reason`}
              value={v.reason ?? ''}
              onChange={(e) => onChange?.({ ...v, reason: e.target.value })}
              disabled={disabled}
              className={inputClass(disabled)}
            >
              <option value="">— Select reason —</option>
              {field.options?.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {field.reasonRemark?.remark !== 'never' && (
              <textarea
                aria-label={`${field.label} remark`}
                value={v.remark ?? ''}
                onChange={(e) => onChange?.({ ...v, remark: e.target.value })}
                disabled={disabled}
                rows={2}
                placeholder={remarkNeeded ? 'Remark (required)' : 'Remark'}
                className={inputClass(disabled)}
              />
            )}
          </div>
        </FieldWrapper>
      )
    },
  },

  derived: {
    preview: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <div className="flex items-center gap-1.5">
          <PreviewValue value={value} />
          <span className="text-xs text-[var(--color-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">calculated</span>
        </div>
      </FieldWrapper>
    ),
    editor: ({ field, value }) => (
      <FieldWrapper label={field.label}>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-[var(--color-text)]">{value ?? '—'}</span>
          <span className="text-xs text-[var(--color-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">calculated</span>
        </div>
      </FieldWrapper>
    ),
  },
}

/** Convenience: get renderer entry, falling back to text if unknown */
export function getFieldRenderer(type: string): FieldRendererEntry {
  return fieldRendererRegistry[type] ?? fieldRendererRegistry['text']
}
