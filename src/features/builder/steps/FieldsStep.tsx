import { Icon as FbIcon } from '../../../components/Icon'
/**
 * Step 2: Fields Designer
 *
 * Table-style field designer with:
 * - Add / remove / reorder (up/down) fields
 * - Group fields into sections
 * - Per field: label, type, options, mandatory, enteredBy, source, validatedBy,
 *   conditionalRule, showOnDashboard, kpiRole, showInPartList, showInDrillList
 * - For fetched sources: pick system + attribute from the mock catalogue
 * - Common part fields always shown (locked, greyed out)
 */

import { useState } from 'react'
import type { BuilderDraft, DerivedRows, ValidationRule, FieldDefinition, FieldType, FieldSource, KpiRole, TableColumn } from '../../../domain'
import { useQAStore } from '../../../store/qaStore'
import { rowsFromCount } from '../../../engine'
import type { PersonaId } from '../../../store/personaStore'
import { PERSONAS } from '../../../store/personaStore'
import { Button } from '../../../components'
import { ATTRIBUTE_CATALOGUE } from '../../../mock/attributeCatalogue'
import { canBeListColumn } from '../../listColumns'
import { legacyToRules } from '../../../engine'
import { CalcTableEditor, ConditionEditor, FieldRulesEditor } from './RuleEditors'
import { ColumnRolesEditor, DeviationFlowEditor, MoreFieldSettings, RowReviewEditor, SumRowsEditor } from './MoreFieldSettings'
import { DeviationEditor, FieldChecksEditor, GroupReviewsEditor, NotifyEditor, OverrideEditor, ParametersEditor, ReasonRemarkEditor, StageMacroButton } from './ActivityRuleEditors'

interface FieldsStepProps {
  draft: BuilderDraft
  onChange: (updates: Partial<BuilderDraft>) => void
}

// Common part fields always present (locked)
const COMMON_FIELDS: Array<{ key: string; label: string; type: FieldType }> = [
  { key: 'model', label: 'Model', type: 'text' },
  { key: 'part_no', label: 'Part No.', type: 'text' },
  { key: 'part_name', label: 'Part Name', type: 'text' },
  { key: 'vendor_code', label: 'Vendor Code', type: 'text' },
  { key: 'vendor_name', label: 'Vendor Name', type: 'text' },
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'mrd', label: 'MRD', type: 'date' },
]

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longText', label: 'Long Text' },
  { value: 'number', label: 'Number' },
  { value: 'percent', label: 'Percent' },
  { value: 'date', label: 'Date' },
  { value: 'yesNo', label: 'Yes / No' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'multiSelect', label: 'Multi-select' },
  { value: 'file', label: 'File upload' },
  { value: 'flag', label: 'Flag' },
  { value: 'button', label: 'Action button' },
  { value: 'derived', label: 'Derived (calculated)' },
  { value: 'table', label: 'Table (list of rows)' },
  { value: 'pivotSummary', label: 'Summary / Pivot table' },
  { value: 'comparison', label: 'Comparison (two sets of fields side by side)' },
  { value: 'reasonRemark', label: 'Reason + remark' },
]

const SOURCES: { value: FieldSource; label: string; fetched?: boolean }[] = [
  { value: 'manual', label: 'Manual entry' },
  { value: 'calculated', label: 'Calculated by system' },
  { value: 'upload', label: 'Upload' },
  { value: 'dropdown', label: 'Dropdown mapping' },
  { value: 'mapping', label: 'Mapping table' },
  { value: 'mail', label: 'Via email' },
  { value: 'enovia', label: 'ENOVIA (fetched)', fetched: true },
  { value: 'sap', label: 'SAP (fetched)', fetched: true },
  { value: 'edoc', label: 'E-Doc (fetched)', fetched: true },
  { value: 'regapp', label: 'Regulatory App (fetched)', fetched: true },
]

const FETCHED_SOURCES: FieldSource[] = ['enovia', 'sap', 'edoc', 'regapp']

const KPI_ROLES: { value: KpiRole; label: string }[] = [
  { value: null, label: '— none —' },
  { value: 'status', label: 'Status indicator' },
  { value: 'date', label: 'Date / Timeline' },
  { value: 'count', label: 'Count / Number' },
  { value: 'percentage', label: 'Percentage / Accuracy' },
  { value: 'category', label: 'Category grouping' },
]

function newField(index: number): FieldDefinition {
  return {
    key: `field_${Date.now()}_${index}`,
    label: '',
    type: 'text',
    mandatory: false,
    enteredBy: 'PIC',
    source: 'manual',
    validatedBy: null,
    showOnDashboard: false,
    kpiRole: null,
    options: [],
    conditionalRules: [],
  }
}

const thCls = 'px-2 py-2 text-left text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide bg-[var(--color-surface)] border-b border-[var(--color-border)]'
const tdCls = 'px-2 py-1.5 border-b border-[var(--color-border)] align-top'

const selectCls = 'border border-[var(--color-border)] rounded px-2 py-1 text-xs bg-white text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] w-full'
const inputCls  = 'border border-[var(--color-border)] rounded px-2 py-1 text-xs bg-white text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] w-full'

export function FieldsStep({ draft, onChange }: FieldsStepProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [optionsInput, setOptionsInput] = useState<Record<string, string>>({})

  const fields = draft.fields

  function setFields(next: FieldDefinition[]) {
    onChange({ fields: next })
  }

  function addField() {
    setFields([...fields, newField(fields.length)])
  }

  function removeField(key: string) {
    setFields(fields.filter((f) => f.key !== key))
    if (expandedKey === key) setExpandedKey(null)
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    const next = [...fields]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setFields(next)
  }

  function moveDown(idx: number) {
    if (idx === fields.length - 1) return
    const next = [...fields]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setFields(next)
  }

  function updateField(key: string, updates: Partial<FieldDefinition>) {
    setFields(fields.map((f) => (f.key === key ? { ...f, ...updates } : f)))
  }

  function parseOptions(key: string, raw: string) {
    setOptionsInput((prev) => ({ ...prev, [key]: raw }))
    const opts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    updateField(key, { options: opts })
  }

  return (
    <div className="space-y-4">
      {/* Common fields (locked) */}
      <div>
        <div className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1.5">
          Common Part Fields <span className="font-normal normal-case">(always included, locked)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {COMMON_FIELDS.map((cf) => (
            <span key={cf.key} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-muted)]">
              <FbIcon name="lock" size={12} className="mr-1" />{cf.label}
            </span>
          ))}
        </div>
      </div>

      {/* Activity fields */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">
            Activity Fields ({fields.length})
          </div>
          <div className="flex items-center gap-2">
            <StageMacroButton draft={draft} onChange={onChange} />
            <Button variant="secondary" size="sm" onClick={addField}>
              + Add Field
            </Button>
          </div>
        </div>

        {fields.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-muted)] border border-dashed border-[var(--color-border)] rounded text-sm">
            No fields yet. Click "+ Add Field" to start.
          </div>
        ) : (
          <div className="border border-[var(--color-border)] rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1000px]">
                <thead>
                  <tr>
                    <th className={`${thCls} w-6`}>#</th>
                    <th className={`${thCls} w-32`}>Source *</th>
                    <th className={`${thCls} w-48`}>Name / Attribute *</th>
                    <th className={`${thCls} w-28`}>Type</th>
                    <th className={`${thCls} w-24`}>Entered By</th>
                    <th className={`${thCls} w-24`}>Validated By</th>
                    <th className={`${thCls} w-14 text-center`}>Req.</th>
                    <th className={`${thCls} w-16 text-center`} title="Vendor can see this field (read-only). Vendors always see fields they enter; PIC sees all fields.">Vendor sees</th>
                    <th className={`${thCls} w-16 text-center`} title="Data only: fed by SAP / ENOVIA per part and used by dashboards; never shown on an input form.">Data only</th>
                    <th className={`${thCls} w-14 text-center`}>Dash.</th>
                    <th
                      className={`${thCls} w-16 text-center`}
                      title="Also show this field as a column in the Workspace part list"
                    >
                      Part list
                    </th>
                    <th
                      className={`${thCls} w-16 text-center`}
                      title="Also show this field as a column in the dashboard drill-down View parts list"
                    >
                      Drill-down
                    </th>
                    <th className={`${thCls} w-24`}>KPI Role</th>
                    <th className={`${thCls} w-16 text-center`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, idx) => (
                    <>
                      <tr
                        key={field.key}
                        className={expandedKey === field.key ? 'bg-secondary/70' : 'hover:bg-[var(--color-surface)]/60'}
                      >
                        {/* Row number + reorder */}
                        <td className={tdCls}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-xs text-[var(--color-muted)]">{idx + 1}</span>
                            <button
                              onClick={() => moveUp(idx)}
                              disabled={idx === 0}
                              className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 leading-none"
                              title="Move up"
                            ><FbIcon name="chevron-up" size={14} /></button>
                            <button
                              onClick={() => moveDown(idx)}
                              disabled={idx === fields.length - 1}
                              className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 leading-none"
                              title="Move down"
                            ><FbIcon name="chevron-down" size={14} /></button>
                          </div>
                        </td>

                        {/* Source — chosen first; it drives how the name is entered */}
                        <td className={tdCls}>
                          <select
                            value={field.source}
                            onChange={(e) => {
                              const nextSource = e.target.value as FieldSource
                              // Switching away from a fetched source drops the fetched attribute + label so
                              // the user re-enters a manual name; switching between fetched sources also resets it.
                              const wasFetched = FETCHED_SOURCES.includes(field.source)
                              const nowFetched = FETCHED_SOURCES.includes(nextSource)
                              updateField(field.key, {
                                source: nextSource,
                                ...(wasFetched || nowFetched
                                  ? { fetchedAttributeKey: undefined, label: '' } as any
                                  : {})
                              })
                            }}
                            className={selectCls}
                          >
                            {SOURCES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </td>

                        {/* Name / Attribute — a text label for manual sources, a catalogue dropdown for fetched ones */}
                        <td className={tdCls}>
                          {FETCHED_SOURCES.includes(field.source) ? (
                            (() => {
                              const cat = ATTRIBUTE_CATALOGUE.filter((a) => a.system === field.source)
                              const picked = (field as any).fetchedAttributeKey ?? ''
                              return (
                                <select
                                  value={picked}
                                  onChange={(e) => {
                                    const entry = cat.find((a) => a.key === e.target.value)
                                    updateField(field.key, {
                                      fetchedAttributeKey: e.target.value,
                                      ...(entry ? { type: entry.type, label: entry.label, ...(entry.options ? { options: entry.options } : {}) } : {})
                                    } as any)
                                  }}
                                  className={`${selectCls} ${!picked ? 'border-[#fca5a5]' : ''}`}
                                >
                                  <option value="">— pick field —</option>
                                  {cat.map((a) => (
                                    <option key={a.key} value={a.key}>{a.label}</option>
                                  ))}
                                </select>
                              )
                            })()
                          ) : (
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) => updateField(field.key, { label: e.target.value })}
                              placeholder="Field name"
                              className={`${inputCls} ${!field.label.trim() ? 'border-[#fca5a5]' : ''}`}
                            />
                          )}
                        </td>

                        {/* Type — auto-set for fetched fields (locked), chosen for manual ones */}
                        <td className={tdCls}>
                          <select
                            value={field.type}
                            onChange={(e) => updateField(field.key, { type: e.target.value as FieldType })}
                            className={selectCls}
                            disabled={FETCHED_SOURCES.includes(field.source)}
                            title={FETCHED_SOURCES.includes(field.source) ? 'Type comes from the selected attribute' : undefined}
                          >
                            {FIELD_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </td>

                        {/* Entered By */}
                        <td className={tdCls}>
                          <select
                            value={field.enteredBy}
                            onChange={(e) => updateField(field.key, { enteredBy: e.target.value as PersonaId | 'System' })}
                            className={selectCls}
                          >
                            <option value="System">System</option>
                            {PERSONAS.map((p) => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                        </td>

                        {/* Validated By */}
                        <td className={tdCls}>
                          <select
                            value={field.validatedBy ?? ''}
                            onChange={(e) => updateField(field.key, { validatedBy: (e.target.value || null) as PersonaId | null })}
                            className={selectCls}
                          >
                            <option value="">— none —</option>
                            {PERSONAS.map((p) => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                        </td>

                        {/* Mandatory */}
                        <td className={`${tdCls} text-center`}>
                          <input
                            type="checkbox"
                            checked={field.mandatory}
                            onChange={(e) => updateField(field.key, { mandatory: e.target.checked })}
                            className="w-4 h-4 accent-[var(--color-accent)]"
                          />
                        </td>

                        {/* Visible to vendor */}
                        <td className={`${tdCls} text-center`}>
                          <input
                            type="checkbox"
                            checked={field.enteredBy === 'Vendor' || field.visibleToVendor === true}
                            disabled={field.enteredBy === 'Vendor'}
                            onChange={(e) => updateField(field.key, { visibleToVendor: e.target.checked })}
                            className="w-4 h-4 accent-[var(--color-accent)]"
                            aria-label={`Vendor can see ${field.label || 'field'}`}
                            title={field.enteredBy === 'Vendor' ? 'Vendors always see the fields they enter' : 'Let the vendor see this field (read-only)'}
                          />
                        </td>
                        {/* Data only (system-fed, not on the form) */}
                        <td className={`${tdCls} text-center`}>
                          <input
                            type="checkbox"
                            checked={field.dataOnly === true}
                            onChange={(e) =>
                              updateField(
                                field.key,
                                e.target.checked
                                  ? { dataOnly: true, enteredBy: 'System', mandatory: false, validatedBy: null, visibleToVendor: false, showOnDashboard: true, source: field.source === 'manual' ? 'sap' : field.source }
                                  : { dataOnly: false }
                              )
                            }
                            className="w-4 h-4 accent-[var(--color-accent)]"
                            aria-label={`${field.label || 'Field'} is data only, not shown on the form`}
                            title="Fed by the system per part for dashboards; never shown on an input form"
                          />
                        </td>
                        {/* Show on dashboard */}
                        <td className={`${tdCls} text-center`}>
                          <input
                            type="checkbox"
                            checked={field.showOnDashboard}
                            onChange={(e) => updateField(field.key, { showOnDashboard: e.target.checked })}
                            className="w-4 h-4 accent-[var(--color-accent)]"
                          />
                        </td>

                        {/* Show as a column in the Workspace part list */}
                        <td className={`${tdCls} text-center`}>
                          <input
                            type="checkbox"
                            checked={canBeListColumn(field) && !field.dataOnly && field.showInPartList === true}
                            disabled={!canBeListColumn(field) || field.dataOnly === true}
                            onChange={(e) => updateField(field.key, { showInPartList: e.target.checked })}
                            className="w-4 h-4 accent-[var(--color-accent)]"
                            aria-label={`Show ${field.label || 'field'} in the part list`}
                            title={canBeListColumn(field) ? undefined : 'File and button fields cannot be list columns'}
                          />
                        </td>

                        {/* Show as a column in the dashboard drill-down list */}
                        <td className={`${tdCls} text-center`}>
                          <input
                            type="checkbox"
                            checked={canBeListColumn(field) && field.showInDrillList === true}
                            disabled={!canBeListColumn(field)}
                            onChange={(e) => updateField(field.key, { showInDrillList: e.target.checked })}
                            className="w-4 h-4 accent-[var(--color-accent)]"
                            aria-label={`Show ${field.label || 'field'} in the drill-down list`}
                            title={canBeListColumn(field) ? undefined : 'File and button fields cannot be list columns'}
                          />
                        </td>

                        {/* KPI Role */}
                        <td className={tdCls}>
                          <select
                            value={field.kpiRole ?? ''}
                            onChange={(e) => updateField(field.key, { kpiRole: (e.target.value || null) as KpiRole })}
                            className={selectCls}
                            disabled={!field.showOnDashboard}
                          >
                            {KPI_ROLES.map((r) => (
                              <option key={String(r.value)} value={r.value ?? ''}>{r.label}</option>
                            ))}
                          </select>
                        </td>

                        {/* Actions */}
                        <td className={`${tdCls} text-center`}>
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setExpandedKey(expandedKey === field.key ? null : field.key)}
                              className="text-xs text-[var(--color-accent)] hover:underline"
                              title="More options"
                            >
                              {expandedKey === field.key ? 'Less' : 'More'}
                            </button>
                            <button
                              onClick={() => removeField(field.key)}
                              className="text-xs text-destructive hover:text-destructive"
                              title="Remove field"
                            >
                              <FbIcon name="close" size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded row: options, fetched attribute, conditional rule */}
                      {expandedKey === field.key && (
                        <tr key={`${field.key}-expanded`} className="bg-secondary/50">
                          <td colSpan={12} className="px-4 py-3 border-b border-[var(--color-border)]">
                            <FieldExpandedOptions
                              field={field}
                              onUpdate={(u) => updateField(field.key, u)}
                              optionsRaw={optionsInput[field.key] ?? field.options?.join(', ') ?? ''}
                              onOptionsChange={(raw) => parseOptions(field.key, raw)}
                              allFields={fields}
                              params={draft.parameters ?? []}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <ValidationRulesEditor
        fields={fields}
        rules={draft.validationRules ?? []}
        onChange={(next) => onChange({ validationRules: [...next, ...(draft.validationRules ?? []).filter((r) => r.type && r.type !== 'sum')] })}
      />
      <FieldChecksEditor
        rules={(draft.validationRules ?? []).filter((r) => r.type && r.type !== 'sum')}
        onChange={(next) => onChange({ validationRules: [...(draft.validationRules ?? []).filter((r) => !r.type || r.type === 'sum'), ...next] })}
        env={{ fields, params: draft.parameters ?? [] }}
      />
      <ParametersEditor params={draft.parameters ?? []} onChange={(parameters) => onChange({ parameters })} />
      <GroupReviewsEditor groups={draft.groupReviews ?? []} onChange={(groupReviews) => onChange({ groupReviews })} env={{ fields, params: draft.parameters ?? [] }} />
      <DeviationEditor dev={draft.deviation} onChange={(deviation) => onChange({ deviation })} env={{ fields, params: draft.parameters ?? [] }} />
      <DeviationFlowEditor flow={draft.deviationFlow} onChange={(deviationFlow) => onChange({ deviationFlow })} />
    </div>
  )
}
/** Builder UI for sum-matching validation rules (e.g. Agree + Disagree = Total). */
function ValidationRulesEditor({ fields, rules: allRules, onChange }: { fields: FieldDefinition[]; rules: ValidationRule[]; onChange: (next: ValidationRule[]) => void }) {
  const rules = allRules.filter((r) => !r.type || r.type === 'sum')
  const tables = fields.filter((f) => f.type === 'table' && (f.columns ?? []).some((c) => c.type === 'number'))
  const numberFields = fields.filter((f) => f.type === 'number' || f.type === 'percent')
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<string>('fields') // 'fields' or a table field key
  const [left, setLeft] = useState<string[]>([])
  const [right, setRight] = useState<string[]>([])
  const [op, setOp] = useState<ValidationRule['op']>('=')
  const [message, setMessage] = useState('')
  const sel = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'

  // What can be picked as an operand in the chosen scope.
  const options: { key: string; label: string }[] =
    scope === 'fields'
      ? [
          ...numberFields.map((f) => ({ key: f.key, label: f.label || f.key })),
          ...tables.flatMap((t) =>
            (t.columns ?? []).filter((c) => c.type === 'number').map((c) => ({ key: `${t.key}.${c.key}`, label: `${t.label} › ${c.label} (total of all rows)` }))
          )
        ]
      : (tables.find((t) => t.key === scope)?.columns ?? []).filter((c) => c.type === 'number').map((c) => ({ key: c.key, label: c.label }))
  const labelOf = (k: string, sc: ValidationRule['scope']) => {
    if (sc === 'fields') {
      const [fk, col] = k.split('.')
      const f = fields.find((x) => x.key === fk)
      return col ? `${f?.label ?? fk} › ${f?.columns?.find((c) => c.key === col)?.label ?? col}` : f?.label ?? fk
    }
    const t = fields.find((x) => x.key === sc.tableField)
    return t?.columns?.find((c) => c.key === k)?.label ?? k
  }
  const sentence = (r: ValidationRule) =>
    `${r.left.map((k) => labelOf(k, r.scope)).join(' + ')} ${r.op === '=' ? '=' : r.op === '<=' ? '≤' : '≥'} ${r.right.map((k) => labelOf(k, r.scope)).join(' + ')}` +
    (r.scope === 'fields' ? '' : ` — checked on every row of “${fields.find((f) => f.key === (r.scope as { tableField: string }).tableField)?.label}”`)
  const reset = () => { setLeft([]); setRight([]); setOp('='); setMessage(''); setOpen(false) }
  const canAdd = left.length > 0 && right.length > 0
  const chips = (list: string[], set: (v: string[]) => void) => (
    <div className="flex flex-wrap items-center gap-1">
      {list.map((k, i) => (
        <span key={k} className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] ring-1 ring-[var(--color-border)]">
          {i > 0 && <span className="text-[var(--color-muted)]">+</span>}
          {options.find((o) => o.key === k)?.label ?? k}
          <button type="button" onClick={() => set(list.filter((x) => x !== k))} aria-label="Remove" className="text-[var(--color-destructive)]"><FbIcon name="close" size={14} /></button>
        </span>
      ))}
      <select value="" onChange={(e) => e.target.value && set([...list, e.target.value])} className={sel} aria-label="Add a field to this side">
        <option value="">+ add</option>
        {options.filter((o) => !list.includes(o.key)).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
  )
  return (
    <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-white p-3.5" data-tour="validation-rules">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Validation rules ({rules.length})</h3>
        {!open && <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>+ Add rule</Button>}
      </div>
      <p className="mb-2 text-[11px] text-[var(--color-muted)]">
        Make numbers add up, e.g. Agree + Disagree = Total. Users see the message while editing and cannot Save or Submit until it holds.
      </p>
      {rules.length === 0 && !open && <p className="text-xs italic text-[var(--color-muted)]">No rules yet.</p>}
      <ul className="space-y-1.5">
        {rules.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded bg-[var(--color-surface)] px-2.5 py-1.5 text-xs">
            <span><span className="mr-1.5 rounded bg-[#dbeafe] px-1.5 py-0.5 text-[10px] font-semibold text-[#1e40af]">SUM</span>{sentence(r)}{r.message && <em className="ml-2 text-[var(--color-muted)]">“{r.message}”</em>}</span>
            <button type="button" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} className="text-[var(--color-destructive)] hover:underline">Remove</button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="mt-2.5 space-y-2 rounded border border-dashed border-[var(--color-border)] p-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">Applies to</span>
            <select value={scope} onChange={(e) => { setScope(e.target.value); setLeft([]); setRight([]) }} className={sel} aria-label="Rule scope">
              <option value="fields">Fields of the activity (and column totals)</option>
              {tables.map((t) => <option key={t.key} value={t.key}>Each row of “{t.label}”</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">Sum of</span>
            {chips(left, setLeft)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">must be</span>
            <select value={op} onChange={(e) => setOp(e.target.value as ValidationRule['op'])} className={sel} aria-label="Comparison">
              <option value="=">equal to</option>
              <option value="<=">not more than</option>
              <option value=">=">at least</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">the sum of</span>
            {chips(right, setRight)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">Message</span>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional. Leave blank to show the sums, e.g. “Agree + Disagree (7) must equal Total (5)”" className={`${sel} min-w-[320px] flex-1`} />
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!canAdd}
              onClick={() => {
                onChange([...rules, { id: `rule-${Date.now().toString(36)}`, scope: scope === 'fields' ? 'fields' : { tableField: scope }, left, op, right, ...(message.trim() ? { message: message.trim() } : {}) }])
                reset()
              }}
            >
              Add rule
            </Button>
            <Button variant="secondary" size="sm" onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Expanded options row ──────────────────────────────────────────────────────

interface ExpandedProps {
  field: FieldDefinition
  onUpdate: (u: Partial<FieldDefinition>) => void
  optionsRaw: string
  onOptionsChange: (raw: string) => void
  allFields: FieldDefinition[]
  params?: import('../../../domain').ActivityParameter[]
}

/** "Hidden from <roles> while <condition>" (FieldDefinition.hiddenFrom), e.g. the Vendor's values from the PIC until the PIC has entered their own. */
function HiddenFromEditor({ field, onUpdate, env }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void; env: { fields: FieldDefinition[]; params: import('../../../domain').ActivityParameter[] } }) {
  const h = field.hiddenFrom
  return (
    <div className="space-y-1 text-xs">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={!!h} onChange={(e) => onUpdate({ hiddenFrom: e.target.checked ? { roles: ['Vendor'] } : undefined })} aria-label="Hide this field from some roles" />
        <span className="font-medium">Hide this field from some roles</span>
      </label>
      {h && (
        <div className="space-y-1 pl-5">
          <div className="flex flex-wrap gap-2">
            {PERSONAS.map((p) => (
              <label key={p.id} className="flex items-center gap-1">
                <input type="checkbox" checked={h.roles.includes(p.id)} onChange={(e) => onUpdate({ hiddenFrom: { ...h, roles: e.target.checked ? [...h.roles, p.id] : h.roles.filter((r) => r !== p.id) } })} aria-label={`Hidden from ${p.label}`} />
                {p.label}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!h.when} onChange={(e) => onUpdate({ hiddenFrom: { ...h, when: e.target.checked ? { op: 'AND', items: [] } : undefined } })} aria-label="Only while a condition holds" />
            Only while (otherwise always hidden):
          </label>
          {h.when && <ConditionEditor value={h.when} onChange={(when) => onUpdate({ hiddenFrom: { ...h, when } })} env={env} />}
        </div>
      )}
    </div>
  )
}

/** "Count rows of a table where a column equals a value", e.g. Tier-2 suppliers whose status is Red. */
function CountRowsEditor({ field, onUpdate, allFields }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void; allFields: FieldDefinition[] }) {
  const c = field.countRows
  const tables = allFields.filter((f) => f.type === 'table')
  const table = tables.find((t) => t.key === c?.tableField)
  const col = table?.columns?.find((x) => x.key === c?.column)
  const sel = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'
  const set = (next: Partial<NonNullable<FieldDefinition['countRows']>>) =>
    onUpdate({ countRows: { tableField: c?.tableField ?? '', column: c?.column ?? '', equals: c?.equals ?? '', ...next } })
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="mb-1 font-medium text-[var(--color-text)]">Calculated as: count of table rows</div>
      {tables.length === 0 ? (
        <p className="text-[var(--color-muted)]">Add a table field first.</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Rows of</span>
            <select value={c?.tableField ?? ''} onChange={(e) => set({ tableField: e.target.value, column: '', equals: '' })} className={sel} aria-label="Table to count">
              <option value="">— pick table —</option>
              {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span>where</span>
            <select value={c?.column ?? ''} onChange={(e) => set({ column: e.target.value, equals: '' })} className={sel} aria-label="Column to match">
              <option value="">— pick column —</option>
              {(table?.columns ?? []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <span>is</span>
            {col?.type === 'dropdown' ? (
              <select value={c?.equals ?? ''} onChange={(e) => set({ equals: e.target.value })} className={sel} aria-label="Value to match">
                <option value="">(blank)</option>
                {(col.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input value={c?.equals ?? ''} onChange={(e) => set({ equals: e.target.value })} placeholder="(blank)" className={`${sel} w-32`} aria-label="Value to match" />
            )}
          </div>
          {c?.tableField && c.column && (
            <p className="text-[11px] text-[var(--color-muted)]">
              Count of rows in “{table?.label}” where “{col?.label}” is {c.equals ? `“${c.equals}”` : 'blank'}. Updates itself as the table changes.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
function FieldExpandedOptions({ field, onUpdate, optionsRaw, onOptionsChange, allFields, params = [] }: ExpandedProps) {
  const env = { fields: allFields.filter((f) => f.key !== field.key), params }
  const allRules = [...legacyToRules(field), ...(field.rules ?? [])]
  const lists = useQAStore((s) => s.masterLists)
  const isFetched = FETCHED_SOURCES.includes(field.source)
  const needsOptions = ['dropdown', 'multiSelect'].includes(field.type)
  const catalogueForSource = ATTRIBUTE_CATALOGUE.filter((a) => a.system === field.source)

  // Field-level settings every field shares (tables and comparisons too): section, who it is hidden from, change
  // notifications and its show / mandatory / editable rules.
  const shared = (
    <div className="grid grid-cols-2 gap-4 text-xs">
      <div className="space-y-2">
        <div>
          <div className="font-medium text-[var(--color-text)] mb-1">Section / Group</div>
          <input type="text" value={field.section ?? ''} onChange={(e) => onUpdate({ section: e.target.value || undefined })} placeholder="e.g. Tool Cutting" className={inputCls} aria-label="Section" />
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={field.hiddenFromForm === true} onChange={(e) => onUpdate({ hiddenFromForm: e.target.checked || undefined })} aria-label="Planned: hidden from the form" />
          <span className="font-medium">Planned — hidden from the form</span>
        </label>
        <HiddenFromEditor field={field} onUpdate={onUpdate} env={env} />
        <NotifyEditor field={field} onUpdate={onUpdate} />
      </div>
      <div>
        <div className="font-medium text-[var(--color-text)] mb-1">Rules for this field</div>
        <FieldRulesEditor rules={allRules} onChange={(rules) => onUpdate({ rules, conditionalRules: [] })} env={env} />
      </div>
    </div>
  )

  if (field.type === 'table') {
    return (
      <div className="space-y-3">
        <TableColumnsEditor field={field} onUpdate={onUpdate} allFields={allFields} params={params} />
        {shared}
      </div>
    )
  }

  if (field.type === 'comparison') {
    const cmp = field.compare ?? { leftLabel: 'Vendor', rightLabel: 'PIC', pairs: [] }
    const set = (c: typeof cmp) => onUpdate({ compare: c, enteredBy: 'System' })
    const others = allFields.filter((f) => f.key !== field.key)
    return (
      <div className="space-y-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Columns</span>
          <input value={cmp.leftLabel} onChange={(e) => set({ ...cmp, leftLabel: e.target.value })} className={`${inputCls} w-32`} aria-label="Left column label" />
          <span>vs</span>
          <input value={cmp.rightLabel} onChange={(e) => set({ ...cmp, rightLabel: e.target.value })} className={`${inputCls} w-32`} aria-label="Right column label" />
        </div>
        {cmp.pairs.map((pr, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input value={pr.label} onChange={(e) => set({ ...cmp, pairs: cmp.pairs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Row label" className={`${inputCls} w-40`} aria-label="Pair label" />
            {(['left', 'right'] as const).map((side) => (
              <select key={side} value={pr[side]} onChange={(e) => set({ ...cmp, pairs: cmp.pairs.map((x, j) => (j === i ? { ...x, [side]: e.target.value } : x)) })} className={selectCls} aria-label={`${side} field`}>
                <option value="">— field —</option>
                {others.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
            ))}
            <button type="button" onClick={() => set({ ...cmp, pairs: cmp.pairs.filter((_, j) => j !== i) })} className="text-destructive hover:underline">remove</button>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => set({ ...cmp, pairs: [...cmp.pairs, { label: '', left: '', right: '' }] })}>+ Add pair</Button>
        <p className="text-[11px] text-[var(--color-muted)]">Read-only on the form: mismatching rows are highlighted and the match % is shown.</p>
        {shared}
      </div>
    )
  }

  if (field.type === 'pivotSummary' || field.pivotSummary) {
    return <PivotSummaryEditor field={field} onUpdate={onUpdate} allFields={allFields} />
  }

  return (
    <div className="grid grid-cols-2 gap-4 text-xs">
      {/* Column 1: Options / Fetched attribute */}
      <div className="space-y-2">
        {field.type === 'number' && field.source === 'calculated' && <CountRowsEditor field={field} onUpdate={onUpdate} allFields={allFields} />}
        {field.type === 'number' && field.source === 'calculated' && <SumRowsEditor field={field} onUpdate={onUpdate} allFields={allFields} />}
        {needsOptions && !isFetched && (
          <div>
            <div className="font-medium text-[var(--color-text)] mb-1">Options (comma-separated)</div>
            <input
              type="text"
              value={optionsRaw}
              onChange={(e) => onOptionsChange(e.target.value)}
              placeholder="e.g. Available, Not available"
              className={inputCls}
            />
            {field.options && field.options.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {field.options.map((opt) => (
                  <span key={opt} className="px-2 py-0.5 bg-white border border-[var(--color-border)] rounded text-[10px]">{opt}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {isFetched && (
          <div>
            <div className="font-medium text-[var(--color-text)] mb-1">Fetched Attribute</div>
            {catalogueForSource.length === 0 ? (
              <span className="text-[var(--color-muted)]">No attributes in catalogue for this source.</span>
            ) : (field as any).fetchedAttributeKey ? (
              <div className="text-[var(--color-muted)]">
                Pulling <strong className="text-[var(--color-text)]">{field.label || (field as any).fetchedAttributeKey}</strong> from{' '}
                {field.source.toUpperCase()} ({field.type}). Change it from the <strong>Name / Attribute</strong> dropdown in the row.
              </div>
            ) : (
              <span className="text-[var(--color-muted)]">Pick the field from the <strong>Name / Attribute</strong> dropdown in the row.</span>
            )}
          </div>
        )}

        {field.type === 'reasonRemark' && <ReasonRemarkEditor field={field} onUpdate={onUpdate} />}
        {(field.type === 'dropdown' || field.type === 'multiSelect') && !isFetched && lists.length > 0 && (
          <div>
            <div className="font-medium text-[var(--color-text)] mb-1">Take the options from a master list</div>
            <select value={field.optionsFrom ?? ''} onChange={(e) => onUpdate({ optionsFrom: e.target.value || undefined })} className={selectCls} aria-label="Master list">
              <option value="">— type the options myself —</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <div className="font-medium text-[var(--color-text)] mb-1">Section / Group</div>
          <input type="text" value={field.section ?? ''} onChange={(e) => onUpdate({ section: e.target.value || undefined })} placeholder="e.g. Tool Cutting" className={inputCls} />
          <div className="mt-0.5 text-[var(--color-muted)]">Fields with the same name are grouped together in the form. A review loop can be set on a group.</div>
        </div>
        <label className="flex items-center gap-1.5 text-xs" title="Keep the field in the configuration (e.g. planned for a later release) but do not show it on any form">
          <input type="checkbox" checked={field.hiddenFromForm === true} onChange={(e) => onUpdate({ hiddenFromForm: e.target.checked || undefined })} aria-label="Planned: hidden from the form" />
          <span className="font-medium">Planned — hidden from the form</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs" title="The header search finds parts by this field's value (e.g. an E-Doc number)">
          <input type="checkbox" checked={field.searchable === true} onChange={(e) => onUpdate({ searchable: e.target.checked || undefined })} aria-label="Searchable from the header" />
          <span className="font-medium">Searchable from the header search</span>
        </label>
        <HiddenFromEditor field={field} onUpdate={onUpdate} env={env} />
        <NotifyEditor field={field} onUpdate={onUpdate} />
        <OverrideEditor field={field} onUpdate={onUpdate} env={env} />
        <MoreFieldSettings field={field} onUpdate={onUpdate} allFields={allFields} />
      </div>

      {/* Column 2: rules (C1) and calculation (C2) */}
      <div className="space-y-3">
        <div>
          <div className="font-medium text-[var(--color-text)] mb-1">Rules for this field</div>
          <FieldRulesEditor rules={allRules} onChange={(rules) => onUpdate({ rules, conditionalRules: [] })} env={env} />
        </div>
        <div>
          <div className="font-medium text-[var(--color-text)] mb-1">Calculated value</div>
          <CalcTableEditor calc={field.calc} onChange={(calc) => onUpdate(calc ? { calc, source: 'calculated', enteredBy: 'System' } : { calc: undefined })} env={env} />
        </div>
      </div>
    </div>
  )
}

// ── Table columns editor (for a `table` field) ────────────────────────────────

const COL_TYPES: { value: TableColumn['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longText', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
]

const otherTableLabel = (all: FieldDefinition[], key: string) => all.find((f) => f.key === key)?.label ?? key
const otherColLabel = (all: FieldDefinition[], key: string, col: string) =>
  all.find((f) => f.key === key)?.columns?.find((c) => c.key === col)?.label ?? col
/** Builder UI for "where do this table's rows come from": typed in, or derived from SAP / a count / another activity. */
function DerivedRowsEditor({ field, onUpdate, allFields }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void; allFields: FieldDefinition[] }) {
  const activities = useQAStore((st) => st.activities)
  const d = field.derivedRows
  const otherTables = allFields.filter((f) => f.type === 'table' && f.key !== field.key)
  const numberFields = allFields.filter((f) => f.type === 'number' && f.key !== field.key)
  // A count taken from a plain number field (not a table) is its own mode in the editor.
  const countFromNumber = d?.from === 'count' && numberFields.some((f) => f.key === d.fieldKey)
  const mode = countFromNumber ? 'countField' : d?.from ?? 'typed'
  const set = (next: DerivedRows | undefined) => onUpdate({ derivedRows: next })
  const changeMode = (m: string) => {
    if (m === 'typed') set(undefined)
    else if (m === 'sap') onUpdate({ derivedRows: { from: 'sap' }, source: 'sap' })
    else if (m === 'countField') set({ from: 'count', fieldKey: numberFields[0]?.key ?? '', countColumn: '', labelColumn: '', targetLabelColumn: '' })
    else if (m === 'count') {
      const src = otherTables[0]
      set({ from: 'count', fieldKey: src?.key ?? '', countColumn: '', labelColumn: '', targetLabelColumn: '' })
    } else set({ from: 'activity', activityId: '', fieldKey: '', where: { column: '', equals: '' } })
  }
  const sel = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'
  const srcTable = d?.from === 'count' ? otherTables.find((t) => t.key === d.fieldKey) : undefined
  const srcCols = srcTable?.columns ?? []
  const otherAct = d?.from === 'activity' ? activities.find((a) => a.id === d.activityId) : undefined
  const otherActTables = (otherAct?.fields ?? []).filter((f) => f.type === 'table')
  const otherActCols = otherActTables.find((t) => t.key === (d?.from === 'activity' ? d.fieldKey : ''))?.columns ?? []
  const myCols = field.columns ?? []
  // Live proof for the "count" rule: sample counts 2 and 1 give 3 rows, numbered per category.
  const sample =
    d?.from === 'count' && !countFromNumber && d.countColumn && d.labelColumn && d.targetLabelColumn
      ? rowsFromCount(
          [{ [d.labelColumn]: 'Category A', [d.countColumn]: 2 }, { [d.labelColumn]: 'Category B', [d.countColumn]: 1 }],
          d
        )
      : []
  return (
    <div className="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-medium text-[var(--color-text)]">Rows come from</span>
        <select value={mode} onChange={(e) => changeMode(e.target.value)} className={sel} aria-label="Where the table rows come from">
          <option value="typed">Typed in by the user (Add row)</option>
          <option value="count" disabled={otherTables.length === 0}>One row per count in another table of this activity</option>
          <option value="countField" disabled={numberFields.length === 0}>One row per count in a number field of this activity</option>
          <option value="sap">Fetched from SAP</option>
          <option value="activity">Rows of another activity’s table</option>
        </select>
        {d && <span className="rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] font-semibold text-[#166534]">Derived rows on · no Add / Remove row</span>}
      </div>
      {d?.from === 'count' && countFromNumber && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 font-medium">One row for each</span>
          <select value={d.fieldKey} onChange={(e) => set({ ...d, fieldKey: e.target.value })} className={sel} aria-label="Number field that sets the row count">
            {numberFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <span className="text-[var(--color-muted)]">e.g. 5 in that field gives 5 rows, numbered 1–5.</span>
        </div>
      )}
      {d?.from === 'count' && !countFromNumber && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 font-medium">Count rows from</span>
            <select value={d.fieldKey} onChange={(e) => set({ ...d, fieldKey: e.target.value, countColumn: '', labelColumn: '' })} className={sel} aria-label="Source table">
              {otherTables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <span>using the number in</span>
            <select value={d.countColumn} onChange={(e) => set({ ...d, countColumn: e.target.value })} className={sel} aria-label="Count column">
              <option value="">— pick count column —</option>
              {srcCols.filter((c) => c.type === 'number').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 font-medium">Link to the row</span>
            <span>Copy</span>
            <select value={d.labelColumn} onChange={(e) => set({ ...d, labelColumn: e.target.value })} className={sel} aria-label="Source label column">
              <option value="">— pick source column —</option>
              {srcCols.filter((c) => c.type === 'text').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span>into</span>
            <select value={d.targetLabelColumn} onChange={(e) => set({ ...d, targetLabelColumn: e.target.value })} className={sel} aria-label="Column that receives the label">
              <option value="">— pick this table’s column —</option>
              {myCols.filter((c) => c.type === 'text' && true).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>
      )}
      {d?.from === 'sap' && <p className="text-[var(--color-muted)]">Rows are loaded with the field’s Fetch button (source set to SAP). Columns marked “System” are filled from SAP.</p>}
      {d?.from === 'activity' && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Activity</span>
          <select value={d.activityId} onChange={(e) => set({ ...d, activityId: e.target.value, fieldKey: '', where: undefined, columns: undefined })} className={sel} aria-label="Pull rows from activity">
            <option value="">— pick —</option>
            {activities.filter((a) => a.fields.some((f) => f.type === 'table')).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <span>Table</span>
          <select value={d.fieldKey} onChange={(e) => set({ ...d, fieldKey: e.target.value, where: undefined, columns: undefined })} className={sel} aria-label="Pull rows from table">
            <option value="">— pick —</option>
            {otherActTables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <span>Only rows where</span>
          <select value={d.where?.column ?? ''} onChange={(e) => set({ ...d, where: e.target.value ? { column: e.target.value, equals: d.where?.equals ?? '' } : undefined })} className={sel} aria-label="Pull only rows where">
            <option value="">— all rows —</option>
            {otherActCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {d.where?.column && (
            <>
              <span>=</span>
              <input value={d.where.equals} onChange={(e) => set({ ...d, where: { column: d.where!.column, equals: e.target.value } })} placeholder="value" className={`${sel} w-40`} aria-label="Pull only rows equal to" />
            </>
          )}
          {d.fieldKey && (
            <div className="w-full space-y-1 pt-1">
              <span className="font-medium">Values pulled into this table (read-only here)</span>
              {myCols.map((c) => (
                <div key={c.key} className="flex items-center gap-2 pl-3">
                  <span className="w-48">{c.label || c.key}</span>
                  <span>←</span>
                  <select
                    value={d.columns?.[c.key] ?? ''}
                    onChange={(e) => {
                      const next = { ...(d.columns ?? {}) }
                      if (e.target.value) next[c.key] = e.target.value
                      else delete next[c.key]
                      set({ ...d, columns: Object.keys(next).length ? next : undefined })
                    }}
                    className={sel}
                    aria-label={`Pull ${c.label || c.key} from`}
                  >
                    <option value="">— not pulled —</option>
                    {otherActCols.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {d?.from === 'count' && !countFromNumber && (
        <div className="mt-2">
          {sample.length > 0 ? (
            <>
              <div className="mb-1 text-[11px] text-[var(--color-muted)]">Check: if “{srcTable?.label}” has Category A = 2 and Category B = 1, this table gets {sample.length} rows —</div>
              <table className="text-[11px]">
                <thead>
                  <tr className="text-[var(--color-muted)]">
                    <th className="px-2 text-left">Sl.</th>
                    <th className="px-2 text-left">{myCols.find((c) => c.key === d.targetLabelColumn)?.label}</th>
                  </tr>
                </thead>
                <tbody>{sample.map((r, i) => <tr key={i}><td className="px-2">{r._sl}</td><td className="px-2">{r[d.targetLabelColumn]}</td></tr>)}</tbody>
              </table>
              <p className="mt-1 text-[11px] text-[var(--color-muted)]">Serial numbers (1.1, 1.2, 2.1…) are added by the system and follow the source rows. The linked column is read-only; the other columns are filled per row.</p>
            </>
          ) : (
            <p className="text-[11px] text-[#b45309]">Pick all four settings above to see how the rows will be generated.</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Comma-separated options for a dropdown column. It keeps what is being typed (including a trailing comma or space)
 * and only turns it into the options list as you type; re-joining the list on every keystroke would swallow the comma.
 */
function ColumnOptionsInput({ options, onCommit }: { options: string[]; onCommit: (options: string[]) => void }) {
  const [raw, setRaw] = useState(options.join(', '))
  return (
    <input
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value)
        onCommit(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))
      }}
      placeholder="e.g. Safety, Emission, Durability"
      className={inputCls}
      aria-label="Dropdown options, separated by commas"
    />
  )
}

/** Builder editor for Pivot / Summary tables (e.g. Classification Summary). */
function PivotSummaryEditor({ field, onUpdate, allFields }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void; allFields: FieldDefinition[] }) {
  const p = field.pivotSummary ?? {
    sourceTableField: '',
    categoryTableField: '',
    groupByColumn: '',
    categoryColumn: '',
    pivotColumn: '',
    pivotValues: ['Alt Control', 'Not Feasible', 'Denial', 'Cost Up'],
    rejectedLabel: 'pic_rejected',
    totalLabel: 'total_disagreed'
  }
  const tables = allFields.filter((f) => f.type === 'table' && f.key !== field.key)
  const srcTable = tables.find((t) => t.key === p.sourceTableField)
  const sel = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'

  const set = (next: Partial<typeof p>) => onUpdate({ pivotSummary: { ...p, ...next }, enteredBy: 'System', source: 'calculated', visibleToVendor: false })

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs space-y-2">
      <div className="font-medium text-[var(--color-text)]">Summary / Pivot Configuration</div>
      <p className="text-[11px] text-[var(--color-muted)]">
        Counts rows of a source table, grouped by category and split across classification columns.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-0.5">Source Table (rows to count)</label>
          <select value={p.sourceTableField} onChange={(e) => set({ sourceTableField: e.target.value, groupByColumn: '', pivotColumn: '' })} className={`${sel} w-full`}>
            <option value="">— pick source table —</option>
            {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-0.5">Categories Table (optional list)</label>
          <select value={p.categoryTableField ?? ''} onChange={(e) => set({ categoryTableField: e.target.value })} className={`${sel} w-full`}>
            <option value="">— from source table rows —</option>
            {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
      </div>
      {srcTable && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-0.5">Group-by Column</label>
            <select value={p.groupByColumn} onChange={(e) => set({ groupByColumn: e.target.value })} className={`${sel} w-full`}>
              <option value="">— pick column —</option>
              {(srcTable.columns ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-0.5">Pivot Column (split by)</label>
            <select value={p.pivotColumn} onChange={(e) => set({ pivotColumn: e.target.value })} className={`${sel} w-full`}>
              <option value="">— pick column —</option>
              {(srcTable.columns ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>
      )}
      <div>
        <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-0.5">Pivot Values (comma-separated)</label>
        <input
          value={p.pivotValues.join(', ')}
          onChange={(e) => set({ pivotValues: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
          placeholder="Alt Control, Not Feasible, Denial, Cost Up"
          className={inputCls}
        />
      </div>
    </div>
  )
}

function TableColumnsEditor({ field, onUpdate, allFields, params = [] }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void; allFields: FieldDefinition[]; params?: ExpandedProps['params'] }) {
  const [expandedCol, setExpandedCol] = useState<string | null>(null)
  const cols = field.columns ?? []
  const masterLists = useQAStore((s) => s.masterLists)
  // Row rules read this row's cells (listed first) and the activity's other fields; MRD / today / settings are operands too.
  const rowEnv = {
    fields: [
      ...cols.map((c) => ({ key: c.key, label: `Row › ${c.label || c.key}`, type: (c.type === 'dropdown' ? 'dropdown' : c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text') as FieldType, options: c.options, mandatory: false, enteredBy: 'PIC', source: 'manual', validatedBy: null, showOnDashboard: false } as FieldDefinition)),
      ...allFields.filter((f) => f.key !== field.key && f.type !== 'table')
    ],
    params: params ?? []
  }
  const d = field.derivedRows
  const setCols = (next: TableColumn[]) => onUpdate({ columns: next })

  const addCol = () => {
    const k = `col_${Date.now().toString(36)}`
    setCols([...cols, { key: k, label: '', type: 'text' }])
    setExpandedCol(k)
  }
  const removeCol = (key: string) => setCols(cols.filter((c) => c.key !== key))
  const updateCol = (key: string, u: Partial<TableColumn>) =>
    setCols(cols.map((c) => (c.key === key ? { ...c, ...u } : c)))

  const sel = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'

  return (
    <div className="text-xs">
      <DerivedRowsEditor field={field} onUpdate={onUpdate} allFields={allFields} />
      <RowReviewEditor field={field} onUpdate={onUpdate} />
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-medium text-[var(--color-text)]">Table columns</span>
        <Button variant="secondary" size="sm" onClick={addCol}>+ Add column</Button>
      </div>
      <p className="mb-2 text-[11px] text-[var(--color-muted)]">
        Configure columns, ownership, visibility rules, and conditions for each row.
      </p>
      <label className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="font-medium">Maximum rows</span>
        <input
          type="number"
          min={0}
          value={field.maxRows ?? ''}
          onChange={(e) => onUpdate({ maxRows: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
          placeholder="no limit"
          className={`${inputCls} w-24`}
          aria-label="Maximum rows"
        />
        <span className="text-[var(--color-muted)]">1 = a single row, shown ready to fill (no Add row)</span>
      </label>
      <label className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="font-medium">Rows ready to type into</span>
        <input
          type="number"
          min={0}
          value={field.minRows ?? ''}
          onChange={(e) => onUpdate({ minRows: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
          placeholder="0"
          className={`${inputCls} w-20`}
          aria-label="Rows ready to type into"
        />
        <span className="text-[var(--color-muted)]">shown without clicking + Add row; more can still be added</span>
      </label>
      <label className="mb-2 flex items-center gap-1.5 text-[11px]">
        <span className="font-medium">Layout</span>
        <select value={field.layout ?? 'table'} onChange={(e) => onUpdate({ layout: e.target.value === 'form' ? 'form' : undefined })} className={`${inputCls} w-auto`} aria-label="Table layout">
          <option value="table">Table (rows side by side)</option>
          <option value="form">Form (each row as a card; only the columns that apply)</option>
        </select>
      </label>
      <label className="mb-2 flex items-center gap-1.5 text-[11px]">
        <input type="checkbox" checked={!!field.logRows} onChange={(e) => onUpdate({ logRows: e.target.checked || undefined })} aria-label="Keep a history per row" />
        <span className="font-medium">Keep a history per row</span>
        <span className="text-[var(--color-muted)]">(who changed which cells, and when — e.g. one row per re-verification cycle)</span>
      </label>
      <label className="mb-2 flex items-center gap-1.5 text-[11px]">
        <input type="checkbox" checked={!!field.lockEarlierRows} onChange={(e) => onUpdate({ lockEarlierRows: e.target.checked || undefined })} aria-label="Only the latest row can be edited" />
        <span className="font-medium">Only the latest row can be edited</span>
        <span className="text-[var(--color-muted)]">(earlier rows stay as read-only history)</span>
      </label>
      <div className="mb-2 space-y-1 text-[11px]">
        <div className="font-medium">Start a new row when (checked on save; empty = never)</div>
        <ConditionEditor value={field.nextRow?.when} onChange={(when) => onUpdate({ nextRow: when ? { ...field.nextRow, when } : undefined })} env={{ fields: allFields, params }} />
        {field.nextRow && (
          <label className="flex items-center gap-1.5">
            <span>Send the form back with this comment</span>
            <input value={field.nextRow.sendBack ?? ''} onChange={(e) => onUpdate({ nextRow: { ...field.nextRow!, sendBack: e.target.value || undefined } })} placeholder="(do not send back)" className={`${inputCls} w-80`} aria-label="Send back comment for a new row" />
          </label>
        )}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-medium">Rows can be added by</span>
        {PERSONAS.map((p) => (
          <label key={p.id} className="flex items-center gap-1">
            <input type="checkbox" checked={field.addRowsBy?.includes(p.id) ?? false} onChange={(e) => {
              const next = e.target.checked ? [...(field.addRowsBy ?? []), p.id] : (field.addRowsBy ?? []).filter((x) => x !== p.id)
              onUpdate({ addRowsBy: next.length ? next : undefined })
            }} aria-label={`Rows added by ${p.label}`} />
            {p.label}
          </label>
        ))}
        <span className="text-[var(--color-muted)]">(none ticked = anyone who fills a column)</span>
      </div>
      {cols.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--color-border)] py-4 text-center text-[var(--color-muted)]">
          No columns yet. Click “+ Add column”.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--color-border)]">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--color-surface)] text-[var(--color-muted)]">
                <th className="px-2 py-1.5 text-left font-medium">Column label</th>
                <th className="px-2 py-1.5 text-left font-medium w-28">Type</th>
                <th className="px-2 py-1.5 text-left font-medium">Options (if dropdown)</th>
                <th className="px-2 py-1.5 text-left font-medium w-28">Filled by</th>
                <th className="px-2 py-1.5 text-center font-medium w-20">Rules</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {cols.map((c) => (
                <>
                  <tr key={c.key} className="border-t border-[var(--color-border)]">
                    <td className="px-1 py-1">
                      <input
                        value={c.label}
                        onChange={(e) => updateCol(c.key, { label: e.target.value })}
                        placeholder="e.g. SOR point"
                        className={`${inputCls} ${!c.label.trim() ? 'border-[#fca5a5]' : ''}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select value={c.type} onChange={(e) => updateCol(c.key, { type: e.target.value as TableColumn['type'] })} className={selectCls}>
                        {COL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      {c.type === 'dropdown' ? (
                        <div className="space-y-1">
                          <select value={c.optionsFrom ?? ''} onChange={(e) => updateCol(c.key, { optionsFrom: e.target.value || undefined })} className={selectCls} aria-label="Column options from master list">
                            <option value="">Options typed here</option>
                            {masterLists.map((l) => <option key={l.id} value={l.id}>From list: {l.name}</option>)}
                          </select>
                          {!c.optionsFrom && (
                            <ColumnOptionsInput
                              options={c.options ?? []}
                              onCommit={(options) => updateCol(c.key, { options })}
                            />
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      {d?.from === 'count' && c.key === d.targetLabelColumn ? (
                        <span className="inline-block rounded bg-[#dcfce7] px-1.5 py-1 text-[10px] font-medium text-[#166534]" title="Filled by the system">
                          <><FbIcon name="link" size={12} className="mr-1" />{`from ${otherTableLabel(allFields, d.fieldKey)} › ${otherColLabel(allFields, d.fieldKey, d.labelColumn)}`}</>
                        </span>
                      ) : (
                        <select
                          value={c.enteredBy ?? ''}
                          onChange={(e) => updateCol(c.key, { enteredBy: (e.target.value || undefined) as PersonaId | 'System' | undefined })}
                          className={selectCls}
                        >
                          <option value="">Same as field</option>
                          <option value="System">System</option>
                          {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => setExpandedCol(expandedCol === c.key ? null : c.key)}
                        className="text-xs text-[var(--color-accent)] hover:underline"
                      >
                        {expandedCol === c.key ? 'Less' : 'Rules'}
                      </button>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button type="button" onClick={() => removeCol(c.key)} className="text-destructive hover:underline" aria-label="Remove column"><FbIcon name="close" size={14} /></button>
                    </td>
                  </tr>
                  {expandedCol === c.key && (
                    <tr key={`${c.key}-expanded`} className="bg-secondary/40">
                      <td colSpan={6} className="px-3 py-2 border-t border-[var(--color-border)]">
                        <div className="grid grid-cols-3 gap-3 text-[11px]">
                          {/* Visibility */}
                          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-white p-2">
                            <span className="font-semibold text-[var(--color-text)]">Visibility</span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={!c.hiddenFromVendor}
                                onChange={(e) => updateCol(c.key, { hiddenFromVendor: !e.target.checked })}
                                className="w-3.5 h-3.5 accent-[var(--color-accent)]"
                              />
                              <span>Vendor sees this column</span>
                            </div>
                            <ColumnRolesEditor col={c} onUpdate={(u) => updateCol(c.key, u)} />
                            <div className="pt-1">
                              <span className="text-[var(--color-muted)] block mb-0.5">Vendor sees conditionally when:</span>
                              <div className="flex items-center gap-1">
                                <select
                                  value={c.visibleWhen?.column ?? ''}
                                  onChange={(e) => updateCol(c.key, { visibleWhen: e.target.value ? { column: e.target.value, equals: c.visibleWhen?.equals ?? [] } : undefined })}
                                  className={sel}
                                >
                                  <option value="">(no condition)</option>
                                  {cols.filter((x) => x.key !== c.key).map((x) => <option key={x.key} value={x.key}>{x.label || x.key}</option>)}
                                </select>
                                <span>=</span>
                                <input
                                  value={c.visibleWhen?.equals?.join(', ') ?? ''}
                                  onChange={(e) => updateCol(c.key, { visibleWhen: c.visibleWhen?.column ? { column: c.visibleWhen.column, equals: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } : undefined })}
                                  placeholder="value"
                                  className={`${inputCls} w-24`}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Show When */}
                          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-white p-2">
                            <span className="font-semibold text-[var(--color-text)]">Show When</span>
                            <div className="flex items-center gap-1">
                              <select
                                value={c.showWhen?.column ?? ''}
                                onChange={(e) => updateCol(c.key, { showWhen: e.target.value ? { column: e.target.value, equals: c.showWhen?.equals ?? [] } : undefined })}
                                className={sel}
                              >
                                <option value="">Always shown</option>
                                {cols.filter((x) => x.key !== c.key).map((x) => <option key={x.key} value={x.key}>{x.label || x.key}</option>)}
                              </select>
                              <span>=</span>
                              <input
                                value={c.showWhen?.equals?.join(', ') ?? ''}
                                onChange={(e) => updateCol(c.key, { showWhen: c.showWhen?.column ? { column: c.showWhen.column, equals: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } : undefined })}
                                placeholder="value (e.g. Accept)"
                                className={`${inputCls} w-24`}
                              />
                            </div>
                          </div>

                          {/* Mandatory Mode */}
                          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-white p-2">
                            <span className="font-semibold text-[var(--color-text)]">Mandatory</span>
                            <select
                              value={c.mandatoryMode ?? (c.required ? 'always' : c.requiredWhen ? 'when' : 'never')}
                              onChange={(e) => {
                                const mode = e.target.value as 'always' | 'never' | 'when'
                                updateCol(c.key, {
                                  mandatoryMode: mode,
                                  required: mode === 'always',
                                  requiredWhen: mode === 'when' ? c.requiredWhen : undefined
                                })
                              }}
                              className={sel}
                            >
                              <option value="never">Never (Optional)</option>
                              <option value="always">Always Mandatory</option>
                              <option value="when">When Condition</option>
                            </select>
                            {(c.mandatoryMode === 'when' || (!c.mandatoryMode && c.requiredWhen)) && (
                              <div className="flex items-center gap-1 pt-1">
                                <select
                                  value={c.requiredWhen?.column ?? ''}
                                  onChange={(e) => updateCol(c.key, { requiredWhen: e.target.value ? { column: e.target.value, equals: c.requiredWhen?.equals ?? [] } : undefined })}
                                  className={sel}
                                >
                                  <option value="">— pick column —</option>
                                  {cols.filter((x) => x.key !== c.key).map((x) => <option key={x.key} value={x.key}>{x.label || x.key}</option>)}
                                </select>
                                <span>=</span>
                                <input
                                  value={c.requiredWhen?.equals?.join(', ') ?? ''}
                                  onChange={(e) => updateCol(c.key, { requiredWhen: c.requiredWhen?.column ? { column: c.requiredWhen.column, equals: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } : undefined })}
                                  placeholder="value"
                                  className={`${inputCls} w-20`}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-white p-2">
                            <label className="flex items-center gap-1.5 font-semibold text-[var(--color-text)]">
                              <input type="checkbox" checked={!!c.showRule} onChange={(e) => updateCol(c.key, { showRule: e.target.checked ? { op: 'AND', items: [] } : undefined })} aria-label="Show on a row only when (rule)" />
                              Show on a row only when (rule)
                            </label>
                            {c.showRule && <ConditionEditor value={c.showRule} onChange={(showRule) => updateCol(c.key, { showRule })} env={rowEnv} />}
                          </div>
                          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-white p-2">
                            <label className="flex items-center gap-1.5 font-semibold text-[var(--color-text)]">
                              <input type="checkbox" checked={!!c.requiredRule} onChange={(e) => updateCol(c.key, { requiredRule: e.target.checked ? { op: 'AND', items: [] } : undefined })} aria-label="Mandatory on a row when (rule)" />
                              Mandatory on a row when (rule)
                            </label>
                            {c.requiredRule && <ConditionEditor value={c.requiredRule} onChange={(requiredRule) => updateCol(c.key, { requiredRule })} env={rowEnv} />}
                          </div>
                          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-white p-2">
                            <label className="flex items-center gap-1.5 font-semibold text-[var(--color-text)]">
                              <input type="checkbox" checked={!!c.warn} onChange={(e) => updateCol(c.key, { warn: e.target.checked ? { when: { op: 'AND', items: [] }, message: '' } : undefined })} aria-label="Red ! warning on a row when (rule)" />
                              Red “!” next to the cell when (rule)
                            </label>
                            {c.warn && (
                              <>
                                <ConditionEditor value={c.warn.when} onChange={(when) => updateCol(c.key, { warn: { ...c.warn!, when } })} env={rowEnv} />
                                <input value={c.warn.message} onChange={(e) => updateCol(c.key, { warn: { ...c.warn!, message: e.target.value } })} placeholder="Tooltip, e.g. Target date is after MRD" className={inputCls} aria-label="Warning tooltip" />
                              </>
                            )}
                          </div>
                          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-white p-2">
                            <span className="font-semibold text-[var(--color-text)]">Header group</span>
                            <input value={c.group ?? ''} onChange={(e) => updateCol(c.key, { group: e.target.value || undefined })} placeholder="e.g. Agreed at PP (adjacent columns share it)" className={inputCls} aria-label="Column header group" />
                          </div>
                        </div>
                        <div className="mt-2 rounded border border-[var(--color-border)] bg-white p-2 text-[11px]">
                          <div className="mb-1 font-semibold text-[var(--color-text)]">Calculated per row (read-only)</div>
                          <CalcTableEditor calc={c.calc} onChange={(calc) => updateCol(c.key, calc ? { calc, enteredBy: 'System' } : { calc: undefined })} env={rowEnv} />
                        </div>
                        {field.rowReview && (
                          <label className="mt-2 flex items-center gap-1.5 text-[11px]">
                            <input type="checkbox" checked={!!c.fillAfterAccept} onChange={(e) => updateCol(c.key, { fillAfterAccept: e.target.checked || undefined })} aria-label="Filled only after the row is accepted" />
                            Filled by its owner only after the row is accepted (e.g. the actual closure date)
                          </label>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2"><MoreFieldSettings field={field} onUpdate={onUpdate} allFields={allFields} /></div>
    </div>
  )
}
