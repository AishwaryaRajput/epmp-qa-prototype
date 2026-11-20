/**
 * Builder editors for the remaining rule-engine capabilities: field validations (C3), notify-on-change (C4),
 * system value with role override (C5), field-group review (C6), reason + remark (C7), conditional deviation (C8),
 * activity settings (parameters) and the stage macro button (C9). Everything only edits config.
 */
import { useState } from 'react'
import type { ActivityParameter, BuilderDraft, FieldDefinition, GroupReview, ValidationRule, Operand, DeviationTrigger } from '../../../domain'
import { Button } from '../../../components'
import { buildStage } from '../../../domain/stageMacro'
import { PERSONAS } from '../../../store/personaStore'
import type { PersonaId } from '../../../store/personaStore'
import { useQAStore } from '../../../store/qaStore'
import { describeOperand } from '../../../engine'
import { ConditionEditor, OperandPicker, delBtn, inp, labelOfEnv, linkBtn, sel } from './RuleEditors'
import type { RuleEnv } from './RuleEditors'

const card = 'mt-5 rounded-lg border border-[var(--color-border)] bg-white p-3.5'
const h3 = 'text-[13px] font-semibold text-[var(--color-text)]'
const hint = 'mb-2 text-[11px] text-[var(--color-muted)]'
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`

const roleSelect = (value: PersonaId, onChange: (r: PersonaId) => void, label: string) => (
  <select value={value} onChange={(e) => onChange(e.target.value as PersonaId)} className={sel} aria-label={label}>
    {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
  </select>
)

export function RoleChips({ value, onChange }: { value: PersonaId[]; onChange: (v: PersonaId[]) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {PERSONAS.filter((p) => p.id !== 'Admin').map((p) => {
        const on = value.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-muted)]'}`}
          >
            {p.label}
          </button>
        )
      })}
    </span>
  )
}

/** Toggle chips over a list of values (e.g. the options an override may set). */
export function ValueChips({ options, value, onChange, labels }: { options: string[]; value: string[]; onChange: (v: string[]) => void; labels?: Record<string, string> }) {
  if (options.length === 0) return <span className="text-[11px] text-[var(--color-muted)]">No options to pick.</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-muted)]'}`}>
            {labels?.[o] ?? o}
          </button>
        )
      })}
    </span>
  )
}

// ── Activity settings (parameters) ──────────────────────────────────────────────

export function ParametersEditor({ params, onChange }: { params: ActivityParameter[]; onChange: (p: ActivityParameter[]) => void }) {
  return (
    <div className={card}>
      <h3 className={h3}>Activity settings ({params.length})</h3>
      <p className={hint}>Numbers that rules can use, for example “days before MRD for the system target date”. Change the number here and every rule follows.</p>
      <div className="space-y-1.5">
        {params.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
            <input value={p.label} onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={`${inp} w-64`} placeholder="Label, e.g. Target days before MRD" aria-label="Setting label" />
            <input type="number" value={p.value} onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} className={`${inp} w-20`} aria-label="Setting value" />
            <button type="button" className={delBtn} onClick={() => onChange(params.filter((_, j) => j !== i))}>remove</button>
          </div>
        ))}
      </div>
      <button type="button" className={`${linkBtn} mt-2`} onClick={() => onChange([...params, { key: uid('param'), label: '', value: 0 }])}>+ Add setting</button>
    </div>
  )
}

// ── C3: field validations ───────────────────────────────────────────────────────

const CHECK_TYPES = [
  { v: 'notFuture', l: 'Date must not be in the future' },
  { v: 'compare', l: 'Compare with another field / MRD / today' },
  { v: 'requires', l: 'Needs another field to be filled first' }
] as const
const CMP_OPS: { v: ValidationRule['op']; l: string }[] = [
  { v: '>=', l: 'on or after / at least' },
  { v: '<=', l: 'on or before / at most' },
  { v: '>', l: 'after / greater than' },
  { v: '<', l: 'before / less than' }
]

export function describeCheck(r: ValidationRule, env: RuleEnv): string {
  const L = labelOfEnv(env)
  if (r.type === 'notFuture') return `“${L(r.field ?? '')}” must not be in the future`
  if (r.type === 'requires') return `“${L(r.field ?? '')}” can only be filled after “${L(r.requiresField ?? '')}”`
  const opw = CMP_OPS.find((o) => o.v === r.op)?.l ?? r.op
  return `“${L(r.field ?? '')}” must be ${opw} ${describeOperand(r.compareTo, L)}`
}

export function FieldChecksEditor({ rules, onChange, env }: { rules: ValidationRule[]; onChange: (r: ValidationRule[]) => void; env: RuleEnv }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState<ValidationRule>({ id: '', scope: 'fields', left: [], right: [], op: '>=', type: 'notFuture', field: '', severity: 'block' })
  // Id of the check being edited (null = adding a new one).
  const [editing, setEditing] = useState<string | null>(null)
  const reset = () => { setOpen(false); setEditing(null); setD({ id: '', scope: 'fields', left: [], right: [], op: '>=', type: 'notFuture', field: '', severity: 'block' }) }
  const save = () => {
    const clean = { ...d, message: d.message?.trim() || undefined }
    onChange(editing ? rules.map((x) => (x.id === editing ? { ...clean, id: editing } : x)) : [...rules, { ...clean, id: uid('chk') }])
    reset()
  }
  const canAdd = !!d.field && (d.type !== 'compare' || !!d.compareTo) && (d.type !== 'requires' || !!d.requiresField)
  return (
    <div className={card}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className={h3}>Field checks ({rules.length})</h3>
        {!open && <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>+ Add check</Button>}
      </div>
      <p className={hint}>Date and order checks on a single field. Each can block Save / Submit or only warn, and can have its own message.</p>
      {rules.length === 0 && !open && <p className="text-xs italic text-[var(--color-muted)]">No checks yet.</p>}
      <ul className="space-y-1.5">
        {rules.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded bg-[var(--color-surface)] px-2.5 py-1.5 text-xs">
            <span>
              <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.severity === 'warn' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#fee2e2] text-[#991b1b]'}`}>{r.severity === 'warn' ? 'WARN' : 'BLOCK'}</span>
              {describeCheck(r, env)}
              {r.message && <em className="ml-2 text-[var(--color-muted)]">“{r.message}”</em>}
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={() => { setD({ severity: 'block', ...r }); setEditing(r.id); setOpen(true) }} className={linkBtn}>Edit</button>
              <button type="button" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} className={delBtn}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      {open && (
        <div className="mt-2.5 space-y-2 rounded border border-dashed border-[var(--color-border)] p-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">Check</span>
            <select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as ValidationRule['type'] })} className={sel} aria-label="Check type">
              {CHECK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">On field</span>
            <select value={d.field} onChange={(e) => setD({ ...d, field: e.target.value })} className={sel} aria-label="Field to check">
              <option value="">— field —</option>
              {env.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
            </select>
          </div>
          {d.type === 'compare' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 font-medium">Must be</span>
              <select value={d.op} onChange={(e) => setD({ ...d, op: e.target.value as ValidationRule['op'] })} className={sel} aria-label="Comparison">
                {CMP_OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
              <OperandPicker value={d.compareTo ?? { kind: 'today' }} onChange={(o: Operand) => setD({ ...d, compareTo: o })} env={env} label="Compare with" />
            </div>
          )}
          {d.type === 'requires' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 font-medium">Needs first</span>
              <select value={d.requiresField ?? ''} onChange={(e) => setD({ ...d, requiresField: e.target.value })} className={sel} aria-label="Field needed first">
                <option value="">— field —</option>
                {env.fields.filter((f) => f.key !== d.field).map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">If it fails</span>
            <select value={d.severity} onChange={(e) => setD({ ...d, severity: e.target.value as 'block' | 'warn' })} className={sel} aria-label="Block or warn">
              <option value="block">Block Save / Submit</option>
              <option value="warn">Only warn</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">Message</span>
            <input value={d.message ?? ''} onChange={(e) => setD({ ...d, message: e.target.value })} placeholder="Optional custom message" className={`${inp} min-w-[320px] flex-1`} />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={!canAdd} onClick={save}>{editing ? 'Save check' : 'Add check'}</Button>
            <Button variant="secondary" size="sm" onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── C4 / C5 / C7: per-field panels ──────────────────────────────────────────────

export function NotifyEditor({ field, onUpdate }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void }) {
  const n = field.notifyOnChange
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={!!n} onChange={(e) => onUpdate({ notifyOnChange: e.target.checked ? { roles: ['PIC'] } : undefined })} />
        <span className="font-medium">Notify when this changes after the first save</span>
      </label>
      {n && (
        <div className="space-y-1.5 pl-5">
          <div className="text-[11px] text-[var(--color-muted)]">Tell these roles (the old value stays visible, struck through, and the change is audited):</div>
          <RoleChips value={n.roles} onChange={(roles) => onUpdate({ notifyOnChange: { ...n, roles } })} />
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={!!n.requireReason} onChange={(e) => onUpdate({ notifyOnChange: { ...n, requireReason: e.target.checked } })} />
            Ask for a reason when it is changed
          </label>
        </div>
      )}
    </div>
  )
}

export function OverrideEditor({ field, onUpdate, env }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void; env: RuleEnv }) {
  const o = field.override
  const isCalc = !!field.calc
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" disabled={!isCalc} checked={!!o} onChange={(e) => onUpdate({ override: e.target.checked ? { role: 'PIC', options: field.options } : undefined })} />
        <span className="font-medium">Let a role override the calculated value</span>
      </label>
      {!isCalc && <div className="pl-5 text-[11px] text-[var(--color-muted)]">Turn this field into a calculated field first.</div>}
      {o && (
        <div className="space-y-1.5 pl-5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span>Role</span>
            {roleSelect(o.role, (role) => onUpdate({ override: { ...o, role } }), 'Override role')}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span>Show the calculated value as</span>
            <input value={o.systemLabel ?? ''} onChange={(e) => onUpdate({ override: { ...o, systemLabel: e.target.value || undefined } })} placeholder="System value" className={`${inp} w-48`} aria-label="Calculated value label" />
            <span>and the role's value as</span>
            <input value={o.label ?? ''} onChange={(e) => onUpdate({ override: { ...o, label: e.target.value || undefined } })} placeholder={`Override by ${o.role}`} className={`${inp} w-48`} aria-label="Override label" />
          </div>
          <div className="text-[11px]">Only allowed when (leave empty = always):</div>
          <ConditionEditor value={o.when} onChange={(when) => onUpdate({ override: { ...o, when } })} env={env} />
          <div className="text-[11px]">Direction — only while the system value is (none ticked = any):</div>
          <ValueChips options={field.options ?? []} value={o.fromValues ?? []} onChange={(fromValues) => onUpdate({ override: { ...o, fromValues: fromValues.length ? fromValues : undefined } })} />
          <div className="text-[11px]">The role may set it to:</div>
          <ValueChips options={field.options ?? []} value={o.options ?? []} onChange={(options) => onUpdate({ override: { ...o, options: options.length ? options : undefined } })} />
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={!!o.sticky} onChange={(e) => onUpdate({ override: { ...o, sticky: e.target.checked || undefined } })} />
            Stay overridden (keep the override, and its final value, even if the system value changes later)
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={!!o.releaseWhen} onChange={(e) => onUpdate({ override: { ...o, releaseWhen: e.target.checked ? { op: 'AND', items: [] } : undefined } })} />
            Drop the override again (the calculated value counts) when:
          </label>
          {o.releaseWhen && <ConditionEditor value={o.releaseWhen} onChange={(releaseWhen) => onUpdate({ override: { ...o, releaseWhen } })} env={env} />}
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={o.allowRemoveDeviation === false} onChange={(e) => onUpdate({ override: { ...o, allowRemoveDeviation: e.target.checked ? false : undefined } })} />
            Never allow an override that removes the deviation requirement
          </label>
          <div className="text-[11px]">Notify when overridden:</div>
          <RoleChips value={o.notify?.roles ?? []} onChange={(roles) => onUpdate({ override: { ...o, notify: roles.length ? { roles, includeFields: o.notify?.includeFields } : undefined } })} />
          {o.notify && (
            <>
              <div className="text-[11px]">…with the values of:</div>
              <ValueChips options={env.fields.filter((f) => f.key !== field.key).map((f) => f.key)} labels={Object.fromEntries(env.fields.map((f) => [f.key, f.label || f.key]))} value={o.notify.includeFields ?? []} onChange={(includeFields) => onUpdate({ override: { ...o, notify: { ...o.notify!, includeFields } } })} />
            </>
          )}
          <div className="text-[11px] text-[var(--color-muted)]">The system value and the override are both stored; reports and rules use the final value.</div>
        </div>
      )}
    </div>
  )
}

export function ReasonRemarkEditor({ field, onUpdate }: { field: FieldDefinition; onUpdate: (u: Partial<FieldDefinition>) => void }) {
  const lists = useQAStore((s) => s.masterLists)
  const c = field.reasonRemark ?? { listId: lists[0]?.id ?? '', remark: 'whenOthers' as const }
  const set = (u: Partial<NonNullable<FieldDefinition['reasonRemark']>>) => onUpdate({ reasonRemark: { ...c, ...u }, optionsFrom: u.listId ?? c.listId })
  return (
    <div className="space-y-1.5 text-xs">
      <div className="font-medium">Reason + remark</div>
      <div className="flex items-center gap-1.5">
        <span>Reasons come from</span>
        <select value={c.listId} onChange={(e) => set({ listId: e.target.value })} className={sel} aria-label="Reason list">
          <option value="">— master list —</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={c.reasonRequired !== false} onChange={(e) => set({ reasonRequired: e.target.checked })} aria-label="Reason is required" />
        <span>Reason is required when the field is mandatory</span>
      </label>
      <div className="flex items-center gap-1.5">
        <span>Remark is mandatory</span>
        <select value={c.remark} onChange={(e) => set({ remark: e.target.value as 'always' | 'whenOthers' | 'never' })} className={sel} aria-label="When remark is mandatory">
          <option value="always">always</option>
          <option value="whenOthers">only when the reason is “{c.othersValue ?? 'Others'}”</option>
          <option value="never">never</option>
        </select>
        {c.remark === 'whenOthers' && (
          <>
            <span>“Others” reason is</span>
            <input value={c.othersValue ?? ''} onChange={(e) => set({ othersValue: e.target.value || undefined })} placeholder="Others" className={`${sel} w-28`} aria-label="Others reason value" />
          </>
        )}
      </div>
      <div className="text-[11px] text-[var(--color-muted)]">Admins edit the list under Governance → Master lists.</div>
    </div>
  )
}

// ── C6: field-group review ──────────────────────────────────────────────────────

export function GroupReviewsEditor({ groups, onChange, env }: { groups: GroupReview[]; onChange: (g: GroupReview[]) => void; env: RuleEnv }) {
  const sections = Array.from(new Set(env.fields.map((f) => f.section).filter(Boolean))) as string[]
  const upd = (i: number, u: Partial<GroupReview>) => onChange(groups.map((g, j) => (j === i ? { ...g, ...u } : g)))
  return (
    <div className={card}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className={h3}>Review loops ({groups.length})</h3>
        <Button variant="secondary" size="sm" onClick={() => onChange([...groups, { id: uid('review'), label: 'New review', section: sections[0] ?? '', fillerRole: 'Vendor', reviewerRole: 'PIC', lockOnAccept: true, rejectCommentRequired: true }])}>+ Add review loop</Button>
      </div>
      <p className={hint}>A group of fields (everything with the same Section / Group name) that one role fills and another accepts or rejects. A rejection unlocks the group and needs a comment. It can repeat without limit and every round is kept.</p>
      {groups.length === 0 && <p className="text-xs italic text-[var(--color-muted)]">No review loops yet.</p>}
      <div className="space-y-3">
        {groups.map((g, i) => {
          const fieldsInSection = env.fields.filter((f) => f.section === g.section)
          return (
            <div key={g.id} className="space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <input value={g.label} onChange={(e) => upd(i, { label: e.target.value })} className={`${inp} w-64`} placeholder="Name of this review" aria-label="Review name" />
                <button type="button" className={delBtn} onClick={() => onChange(groups.filter((_, j) => j !== i))}>remove</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 font-medium">Fields in group</span>
                <select value={g.section} onChange={(e) => upd(i, { section: e.target.value })} className={sel} aria-label="Section / Group">
                  <option value="">— Section / Group —</option>
                  {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className="text-[var(--color-muted)]">{fieldsInSection.length} field(s)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 font-medium">Filled by</span>{roleSelect(g.fillerRole, (fillerRole) => upd(i, { fillerRole }), 'Filled by')}
                <span className="font-medium">Reviewed by</span>{roleSelect(g.reviewerRole, (reviewerRole) => upd(i, { reviewerRole }), 'Reviewed by')}
              </div>
              <div>
                <div className="mb-1 font-medium">Opens when (empty = always open)</div>
                <ConditionEditor value={g.opensWhen} onChange={(opensWhen) => upd(i, { opensWhen })} env={env} />
                {g.opensWhen && <button type="button" className={delBtn} onClick={() => upd(i, { opensWhen: undefined })}>always open</button>}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={g.lockOnAccept} onChange={(e) => upd(i, { lockOnAccept: e.target.checked })} />Lock the group after Accept</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={g.rejectCommentRequired} onChange={(e) => upd(i, { rejectCommentRequired: e.target.checked })} />Comment mandatory on Reject</label>
                <label className="flex items-center gap-1.5" title="Off: the filler's form Submit also sends this loop to the reviewer"><input type="checkbox" checked={!!g.separateSubmit} onChange={(e) => upd(i, { separateSubmit: e.target.checked || undefined })} />Own submit button (else sent with the form)</label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 font-medium">Escalate after</span>
                <input type="number" min={0} value={g.escalateAfter ?? 0} onChange={(e) => upd(i, { escalateAfter: Number(e.target.value) || undefined })} className={`${inp} w-16`} aria-label="Rejections before escalation" />
                <span>rejection(s) to</span>
                {roleSelect(g.escalateTo ?? 'SIC', (escalateTo) => upd(i, { escalateTo }), 'Escalate to')}
                <span className="text-[var(--color-muted)]">(0 = never)</span>
              </div>
              <div>
                <div className="mb-1 font-medium">Stays editable after Accept (a change then goes to the reviewer on its own) — any field of the activity</div>
                <div className="flex flex-wrap gap-1.5">
                  {env.fields.filter((f) => !f.calc).map((f) => {
                    const on = g.partialFields?.includes(f.key)
                    return (
                      <button key={f.key} type="button" aria-pressed={!!on} onClick={() => upd(i, { partialFields: on ? g.partialFields!.filter((k) => k !== f.key) : [...(g.partialFields ?? []), f.key] })} className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-muted)]'}`}>
                        {f.label || f.key}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <div className="font-medium">On Accept</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-28">Open next loop</span>
                  <select value={g.onAccept?.openGroupId ?? ''} onChange={(e) => upd(i, { onAccept: { ...g.onAccept, openGroupId: e.target.value || undefined } })} className={sel} aria-label="Loop opened on Accept">
                    <option value="">— none —</option>
                    {groups.filter((x) => x.id !== g.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <span className="w-28 pt-0.5">Show fields</span>
                  <ValueChips options={env.fields.map((f) => f.key)} labels={Object.fromEntries(env.fields.map((f) => [f.key, f.label || f.key]))} value={g.onAccept?.showFields ?? []} onChange={(showFields) => upd(i, { onAccept: { ...g.onAccept, showFields: showFields.length ? showFields : undefined } })} />
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <span className="w-28 pt-0.5">Re-open fields</span>
                  <ValueChips options={env.fields.filter((f) => !f.calc).map((f) => f.key)} labels={Object.fromEntries(env.fields.map((f) => [f.key, f.label || f.key]))} value={g.onAccept?.reopenFields ?? []} onChange={(reopenFields) => upd(i, { onAccept: { ...g.onAccept, reopenFields: reopenFields.length ? reopenFields : undefined } })} />
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <span className="w-28 pt-0.5">Clear fields</span>
                  <ValueChips options={env.fields.filter((f) => !f.calc).map((f) => f.key)} labels={Object.fromEntries(env.fields.map((f) => [f.key, f.label || f.key]))} value={g.onAccept?.clearFields ?? []} onChange={(clearFields) => upd(i, { onAccept: { ...g.onAccept, clearFields: clearFields.length ? clearFields : undefined } })} />
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">Re-opened fields become editable by their owner again after Accept, even after submit / approval. Cleared fields are emptied on Accept so they are entered afresh (the old value stays in the field's history).</div>
              </div>
              <div className="space-y-1">
                <div className="font-medium">Run the loop again when (after Accept; empty = never)</div>
                <ConditionEditor value={g.repeat?.when} onChange={(when) => upd(i, { repeat: when ? { ...g.repeat, when } : undefined })} env={env} />
                {g.repeat && (
                  <>
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="w-28 pt-0.5">Also empty</span>
                      <ValueChips options={env.fields.filter((f) => !f.calc).map((f) => f.key)} labels={Object.fromEntries(env.fields.map((f) => [f.key, f.label || f.key]))} value={g.repeat.clearFields ?? []} onChange={(clearFields) => upd(i, { repeat: { ...g.repeat!, clearFields: clearFields.length ? clearFields : undefined } })} />
                    </div>
                    <button type="button" className={delBtn} onClick={() => upd(i, { repeat: undefined })}>never repeat</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── C8: conditional deviation ───────────────────────────────────────────────────

export function DeviationEditor({ dev, onChange, env }: { dev: DeviationTrigger | undefined; onChange: (d: DeviationTrigger | undefined) => void; env: RuleEnv }) {
  return (
    <div className={card}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className={h3}>Deviation (E-Doc)</h3>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={!!dev} onChange={(e) => onChange(e.target.checked ? { when: { op: 'AND', items: [] }, title: 'Deviation required', message: 'This needs an approved E-Doc deviation.', edocField: '', statusField: '', enteredBy: 'PIC' } : undefined)} />
          Require a deviation when a condition holds
        </label>
      </div>
      <p className={hint}>When the condition holds the user must enter an E-Doc number; the deviation approval status is fetched from E-Doc and a Deviation is raised.</p>
      {dev && (
        <div className="space-y-2 text-xs">
          <div>
            <div className="mb-1 font-medium">Require a deviation when</div>
            <ConditionEditor value={dev.when} onChange={(when) => onChange({ ...dev, when })} env={env} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 font-medium">E-Doc number in</span>
            <select value={dev.edocField} onChange={(e) => onChange({ ...dev, edocField: e.target.value })} className={sel} aria-label="E-Doc number field">
              <option value="">— field —</option>
              {env.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
            </select>
            <span className="font-medium">entered by</span>
            {roleSelect(dev.enteredBy ?? 'PIC', (enteredBy) => onChange({ ...dev, enteredBy }), 'E-Doc entered by')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 font-medium">Ask first</span>
            <select value={dev.raisedField ?? ''} onChange={(e) => onChange({ ...dev, raisedField: e.target.value || undefined })} className={sel} aria-label="Deviation raised field">
              <option value="">— no “Deviation raised” question —</option>
              {env.fields.filter((f) => f.type === 'yesNo').map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
            </select>
            <span className="text-[var(--color-muted)]">Yes / No field; the E-Doc number is needed only for Yes</span>
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={dev.fetchStatus !== false} onChange={(e) => onChange({ ...dev, fetchStatus: e.target.checked ? undefined : false })} />
            Look up the deviation approval status in E-Doc
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!dev.manualStatus} onChange={(e) => onChange({ ...dev, manualStatus: e.target.checked || undefined })} />
            The approval status can also be picked by hand
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!dev.popupOnly} onChange={(e) => onChange({ ...dev, popupOnly: e.target.checked || undefined })} />
            Only in the pop-up — not as fields on the form (still required before Approve)
          </label>
          {(dev.fetchStatus !== false || dev.manualStatus) && (
            <div className="flex flex-wrap items-center gap-2 pl-5">
              <span className="font-medium">Approval status in</span>
              <select value={dev.statusField ?? ''} onChange={(e) => onChange({ ...dev, statusField: e.target.value })} className={sel} aria-label="Approval status field">
                <option value="">— field —</option>
                {env.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
            </div>
          )}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={dev.approvalChain !== false} onChange={(e) => onChange({ ...dev, approvalChain: e.target.checked ? undefined : false })} />
            Raise a Deviation that goes through the approval chain (PIC → SIC → DPM)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 font-medium">Pop-up title</span>
            <input value={dev.title} onChange={(e) => onChange({ ...dev, title: e.target.value })} className={`${inp} w-72`} aria-label="Pop-up title" />
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <span className="w-28 pt-1 font-medium">Pop-up message</span>
            <textarea value={dev.message} onChange={(e) => onChange({ ...dev, message: e.target.value })} rows={2} className={`${inp} min-w-[360px] flex-1`} aria-label="Pop-up message" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── C9: stage macro ─────────────────────────────────────────────────────────────

export function StageMacroButton({ draft, onChange }: { draft: BuilderDraft; onChange: (u: Partial<BuilderDraft>) => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'range' | 'single'>('range')
  const prefix = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const taken = !!prefix && draft.fields.some((f) => f.key.startsWith(`${prefix}_`))
  const add = () => {
    const { fields, validationRules } = buildStage({ prefix, label: label.trim(), kind, section: label.trim() })
    onChange({ fields: [...draft.fields, ...fields], validationRules: [...(draft.validationRules ?? []), ...validationRules] })
    setOpen(false)
    setLabel('')
  }
  if (!open) return <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>+ Add stage (Plan / Actual / Status)</Button>
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-[var(--color-border)] bg-white p-2 text-xs">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Stage name, e.g. Tool Cutting" className={`${inp} w-52`} aria-label="Stage name" />
      <select value={kind} onChange={(e) => setKind(e.target.value as 'range' | 'single')} className={sel} aria-label="Stage type">
        <option value="range">Start and end dates</option>
        <option value="single">Single date</option>
      </select>
      <Button variant="primary" size="sm" disabled={!prefix || taken} onClick={add}>Add stage</Button>
      <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      {taken && <span className="text-[var(--color-destructive)]">A stage with this name already exists.</span>}
      <span className="w-full text-[11px] text-[var(--color-muted)]">Creates planned / actual dates, an automatic status, a delay remark, date checks and change notifications. Edit them like any other field afterwards.</span>
    </div>
  )
}
