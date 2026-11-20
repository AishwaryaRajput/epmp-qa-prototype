/**
 * Builder controls for field / column / activity settings that are otherwise only reachable in config:
 * who else may edit, editable after submit, Lessons-learnt use, the E-Doc number field, totals of a table column,
 * the row noun, per-row review chains (stage by stage), column visibility by role and the deviation approval chain.
 * Every control writes the same domain setting the engine reads — nothing here knows an activity or a field key.
 */
import type { ActivityDefinition, FieldDefinition, FieldInsight, RowReview, RowReviewStage, TableColumn } from '../../../domain'
import type { PersonaId } from '../../../store/personaStore'
import { PERSONAS } from '../../../store/personaStore'
import { Button } from '../../../components'
import { RoleChips } from './ActivityRuleEditors'
import { useQAStore } from '../../../store/qaStore'

const sel = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'
const box = 'rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs space-y-1.5'
type Update = (u: Partial<FieldDefinition>) => void

/** Field-level settings: also editable by, editable after submit, Lessons-learnt use, E-Doc number source, row noun. */
export function MoreFieldSettings({ field, onUpdate, allFields }: { field: FieldDefinition; onUpdate: Update; allFields: FieldDefinition[] }) {
  const activities = useQAStore((s) => s.activities)
  const others = allFields.filter((f) => f.key !== field.key)
  const pullAct = activities.find((a) => a.id === field.pullFrom?.activityId)
  const ins = field.insight
  const setInsight = (kind: string) => {
    const next: FieldInsight | undefined =
      kind === 'result' ? { kind: 'result', ngValue: 'NG' }
      : kind === 'ngCategory' ? { kind: 'ngCategory', column: field.type === 'table' ? field.columns?.[0]?.key : undefined }
      : kind === 'onTime' ? { kind: 'onTime', onValue: field.options?.[0] ?? '', missValue: field.options?.[1] ?? '' }
      : undefined
    onUpdate({ insight: next })
  }
  const opts = field.options ?? []
  const valuePick = (value: string, onChange: (v: string) => void, label: string) =>
    opts.length ? (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={sel} aria-label={label}>
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`${sel} w-28`} aria-label={label} />
    )
  return (
    <div className={box}>
      <div className="font-medium text-[var(--color-text)]">More settings</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Also editable by</span>
        <RoleChips value={(field.alsoEditableBy ?? []) as PersonaId[]} onChange={(v) => onUpdate({ alsoEditableBy: v.length ? v : undefined })} />
      </div>
      {field.type !== 'table' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Pull value from another activity’s field</span>
          <select value={field.pullFrom?.activityId ?? ''} onChange={(e) => onUpdate({ pullFrom: e.target.value ? { activityId: e.target.value, fieldKey: '' } : undefined })} className={sel} aria-label="Pull value from activity">
            <option value="">— not pulled —</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {field.pullFrom && (
            <select value={field.pullFrom.fieldKey} onChange={(e) => onUpdate({ pullFrom: { activityId: field.pullFrom!.activityId, fieldKey: e.target.value } })} className={sel} aria-label="Pull value from field">
              <option value="">— field —</option>
              {(pullAct?.fields ?? []).filter((f) => f.type !== 'table').map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
            </select>
          )}
        </div>
      )}
      {field.source && !['manual', 'calculated', 'dropdown'].includes(field.source) && (
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={!!field.autoFetch} onChange={(e) => onUpdate({ autoFetch: e.target.checked || undefined })} aria-label="Fetch when the form opens" />
          Fetch from its system when the form opens (no Refresh click needed)
        </label>
      )}
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={!!field.alwaysEditable} onChange={(e) => onUpdate({ alwaysEditable: e.target.checked || undefined })} aria-label="Editable after submit" />
        Editable by its role even after the form is submitted / approved
      </label>
      {field.type !== 'table' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!field.tile} onChange={(e) => onUpdate({ tile: e.target.checked ? {} : undefined })} aria-label="Show as KPI tile" />
            Show as a KPI tile
          </label>
          {field.tile && (
            <>
              <span>with</span>
              <select value={field.tile.secondary ?? ''} onChange={(e) => onUpdate({ tile: { ...field.tile, secondary: e.target.value || undefined } })} className={sel} aria-label="Tile secondary value">
                <option value="">— nothing beside it —</option>
                {others.filter((f) => f.type !== 'table').map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
              <input value={field.tile.suffix ?? ''} onChange={(e) => onUpdate({ tile: { ...field.tile, suffix: e.target.value || undefined } })} placeholder="suffix, e.g. %" className={`${sel} w-20`} aria-label="Tile secondary suffix" />
            </>
          )}
        </div>
      )}
      {field.type === 'table' && (
        <label className="flex items-center gap-1.5">
          <span>One row is called</span>
          <input value={field.rowNoun ?? ''} onChange={(e) => onUpdate({ rowNoun: e.target.value || undefined })} placeholder="row" className={`${sel} w-28`} aria-label="Row noun" />
          <span className="text-[var(--color-muted)]">(e.g. point, cycle — used in “+ Add …” and headings)</span>
        </label>
      )}
      {(field.source === 'edoc' || field.edocFrom) && (
        <label className="flex flex-wrap items-center gap-1.5">
          <span>E-Doc number comes from</span>
          <select value={field.edocFrom ?? ''} onChange={(e) => onUpdate({ edocFrom: e.target.value || undefined })} className={sel} aria-label="E-Doc number field">
            <option value="">— pick field —</option>
            {others.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
          </select>
        </label>
      )}
      <div className="border-t border-[var(--color-border)] pt-1.5 font-medium text-[var(--color-text)]">Lessons learnt (vendor track record)</div>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={!!field.isDelayReason} onChange={(e) => onUpdate({ isDelayReason: e.target.checked || undefined })} aria-label="Holds a delay reason" />
        Holds a delay reason (grouped into “top delay reason”)
      </label>
      <label className="flex flex-wrap items-center gap-1.5">
        <span>Counts the part as late when the value is</span>
        <input value={field.lateWhen ?? ''} onChange={(e) => onUpdate({ lateWhen: e.target.value || undefined })} placeholder="(not used)" className={`${sel} w-28`} aria-label="Late when value" />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Counts as</span>
        <select value={ins?.kind ?? ''} onChange={(e) => setInsight(e.target.value)} className={sel} aria-label="Lessons learnt use">
          <option value="">— not used —</option>
          <option value="result">Inspection / audit result</option>
          <option value="ngCategory">NG category</option>
          <option value="onTime">On-time status</option>
        </select>
        {ins?.kind === 'result' && <>NG when {valuePick(ins.ngValue, (ngValue) => onUpdate({ insight: { ...ins, ngValue } }), 'NG value')}</>}
        {ins?.kind === 'onTime' && (
          <>
            on time when {valuePick(ins.onValue, (onValue) => onUpdate({ insight: { ...ins, onValue } }), 'On-time value')}
            missed when {valuePick(ins.missValue, (missValue) => onUpdate({ insight: { ...ins, missValue } }), 'Missed value')}
          </>
        )}
        {ins?.kind === 'ngCategory' && field.type === 'table' && (
          <>
            from column
            <select value={ins.column ?? ''} onChange={(e) => onUpdate({ insight: { ...ins, column: e.target.value || undefined } })} className={sel} aria-label="NG category column">
              {(field.columns ?? []).map((c) => <option key={c.key} value={c.key}>{c.label || c.key}</option>)}
            </select>
          </>
        )}
      </div>
    </div>
  )
}

/** "Calculated as: total of a number column" for a calculated number field (FieldDefinition.sumRows). */
export function SumRowsEditor({ field, onUpdate, allFields }: { field: FieldDefinition; onUpdate: Update; allFields: FieldDefinition[] }) {
  const s = field.sumRows
  const tables = allFields.filter((f) => f.type === 'table')
  const table = tables.find((t) => t.key === s?.tableField)
  return (
    <div className={box}>
      <div className="font-medium text-[var(--color-text)]">Calculated as: total of a table column</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Total of</span>
        <select value={s?.column ?? ''} onChange={(e) => onUpdate({ sumRows: e.target.value && s?.tableField ? { tableField: s.tableField, column: e.target.value } : undefined })} className={sel} aria-label="Column to total" disabled={!table}>
          <option value="">— column —</option>
          {(table?.columns ?? []).filter((c) => c.type === 'number').map((c) => <option key={c.key} value={c.key}>{c.label || c.key}</option>)}
        </select>
        <span>over the rows of</span>
        <select value={s?.tableField ?? ''} onChange={(e) => onUpdate({ sumRows: e.target.value ? { tableField: e.target.value, column: '' } : undefined })} className={sel} aria-label="Table to total">
          <option value="">— not used —</option>
          {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
    </div>
  )
}

/** Column visibility by role (TableColumn.visibleTo): empty = every role (the Vendor per its own switch). */
export function ColumnRolesEditor({ col, onUpdate }: { col: TableColumn; onUpdate: (u: Partial<TableColumn>) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="font-medium">Only these roles see the column</span>
      <RoleChips value={(col.visibleTo ?? []) as PersonaId[]} onChange={(v) => onUpdate({ visibleTo: v.length ? v : undefined })} />
      <span className="text-[var(--color-muted)]">(none picked = everyone)</span>
    </div>
  )
}

const newStage = (cols: TableColumn[]): RowReviewStage => ({
  role: 'PIC', decisionColumn: cols.find((c) => c.type === 'dropdown')?.key ?? '', acceptValue: 'Accept', rejectValue: 'Reject', columns: [], rejectTo: [{ label: 'Back to Vendor', to: 'Vendor' }]
})
const ROUTE_TARGETS: { value: string; label: string }[] = [{ value: 'Close', label: 'Close the row' }, { value: 'Vendor', label: 'The Vendor' }, ...PERSONAS.filter((p) => p.id !== 'Vendor' && p.id !== 'Admin').map((p) => ({ value: p.id, label: p.label }))]

/** Per-row review chain (FieldDefinition.rowReview): each row is decided stage by stage. */
export function RowReviewEditor({ field, onUpdate }: { field: FieldDefinition; onUpdate: Update }) {
  const cols = field.columns ?? []
  const rv = field.rowReview
  const set = (next: RowReview | undefined) => onUpdate({ rowReview: next })
  const upd = (i: number, u: Partial<RowReviewStage>) => rv && set({ stages: rv.stages.map((s, j) => (j === i ? { ...s, ...u } : s)) })
  const colPick = (value: string | undefined, onChange: (v: string | undefined) => void, label: string, blank = '— none —') => (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={sel} aria-label={label}>
      <option value="">{blank}</option>
      {cols.map((c) => <option key={c.key} value={c.key}>{c.label || c.key}</option>)}
    </select>
  )
  return (
    <div className={`${box} mb-2`}>
      <label className="flex items-center gap-1.5 font-medium text-[var(--color-text)]">
        <input type="checkbox" checked={!!rv} onChange={(e) => set(e.target.checked ? { stages: [newStage(cols)] } : undefined)} aria-label="Rows reviewed stage by stage" />
        Rows are reviewed stage by stage (each row accepted / rejected on its own)
      </label>
      {rv?.stages.map((st, i) => (
        <div key={i} className="rounded border border-[var(--color-border)] bg-white p-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong>Stage {i + 1}</strong>
            <select value={st.role} onChange={(e) => upd(i, { role: e.target.value as PersonaId })} className={sel} aria-label={`Stage ${i + 1} role`}>
              {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <span>decides in</span>
            {colPick(st.decisionColumn, (v) => upd(i, { decisionColumn: v ?? '' }), `Stage ${i + 1} decision column`, '— column —')}
            <span>accept =</span>
            <input value={st.acceptValue} onChange={(e) => upd(i, { acceptValue: e.target.value })} className={`${sel} w-24`} aria-label={`Stage ${i + 1} accept value`} />
            <span>reject =</span>
            <input value={st.rejectValue} onChange={(e) => upd(i, { rejectValue: e.target.value })} className={`${sel} w-24`} aria-label={`Stage ${i + 1} reject value`} />
            <button type="button" onClick={() => set(rv.stages.length > 1 ? { stages: rv.stages.filter((_, j) => j !== i) } : undefined)} className="ml-auto text-[var(--color-destructive)] hover:underline">remove stage</button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Columns this stage fills</span>
            {cols.map((c) => {
              const on = st.columns.includes(c.key)
              return (
                <button key={c.key} type="button" aria-pressed={on} onClick={() => upd(i, { columns: on ? st.columns.filter((k) => k !== c.key) : [...st.columns, c.key] })}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-muted)]'}`}>
                  {c.label || c.key}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Comment sent back with a reject</span>
            {colPick(st.commentColumn, (commentColumn) => upd(i, { commentColumn }), `Stage ${i + 1} comment column`)}
          </div>
          <div className="space-y-1">
            <span>On reject the row goes to</span>
            {st.rejectTo.map((r, k) => (
              <div key={k} className="flex flex-wrap items-center gap-1.5 pl-3">
                <input value={r.label} onChange={(e) => upd(i, { rejectTo: st.rejectTo.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} placeholder="Route label" className={`${sel} w-40`} aria-label={`Stage ${i + 1} route ${k + 1} label`} />
                <select value={r.to} onChange={(e) => upd(i, { rejectTo: st.rejectTo.map((x, j) => (j === k ? { ...x, to: e.target.value as RowReviewStage['rejectTo'][number]['to'] } : x)) })} className={sel} aria-label={`Stage ${i + 1} route ${k + 1} target`}>
                  {ROUTE_TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {st.rejectTo.length > 1 && <button type="button" onClick={() => upd(i, { rejectTo: st.rejectTo.filter((_, j) => j !== k) })} className="text-[var(--color-destructive)] hover:underline">remove</button>}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-1.5 pl-3">
              <Button variant="secondary" size="sm" onClick={() => upd(i, { rejectTo: [...st.rejectTo, { label: '', to: 'Vendor' }] })}>+ Add route</Button>
              {st.rejectTo.length > 1 && (
                <>
                  <span>the reviewer picks the route in</span>
                  {colPick(st.routeColumn, (routeColumn) => upd(i, { routeColumn }), `Stage ${i + 1} route column`, '— column —')}
                </>
              )}
            </div>
          </div>
        </div>
      ))}
      {rv && <Button variant="secondary" size="sm" onClick={() => set({ stages: [...rv.stages, newStage(cols)] })}>+ Add stage</Button>}
    </div>
  )
}

/** Deviation approval chain (ActivityDefinition.deviationFlow): the roles a deviation passes through, in order. */
export function DeviationFlowEditor({ flow, onChange }: { flow: ActivityDefinition['deviationFlow']; onChange: (f: PersonaId[] | undefined) => void }) {
  const chain = flow ?? []
  const move = (i: number, d: number) => {
    const next = [...chain]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    onChange(next)
  }
  return (
    <div className={box}>
      <div className="font-medium text-[var(--color-text)]">Deviation approval chain</div>
      <p className="text-[var(--color-muted)]">The roles a deviation on this activity passes through, in order. None picked = PIC → SIC → DPM.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {chain.map((r, i) => (
          <span key={`${r}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white px-2 py-0.5">
            {i + 1}. {PERSONAS.find((p) => p.id === r)?.label ?? r}
            {i > 0 && <button type="button" onClick={() => move(i, -1)} aria-label={`Move ${r} earlier`}>‹</button>}
            {i < chain.length - 1 && <button type="button" onClick={() => move(i, 1)} aria-label={`Move ${r} later`}>›</button>}
            <button type="button" onClick={() => onChange(chain.length > 1 ? chain.filter((_, j) => j !== i) : undefined)} className="text-[var(--color-destructive)]" aria-label={`Remove ${r}`}>×</button>
          </span>
        ))}
        <select value="" onChange={(e) => e.target.value && onChange([...chain, e.target.value as PersonaId])} className={sel} aria-label="Add approver">
          <option value="">+ add approver</option>
          {PERSONAS.filter((p) => p.id !== 'Vendor' && p.id !== 'Admin' && !chain.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
    </div>
  )
}
