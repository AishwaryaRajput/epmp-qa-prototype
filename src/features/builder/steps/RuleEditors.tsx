/**
 * Builder editors for the generic rule engine: operand picker, condition builder (C1), field rules (C1) and the
 * calculated-field rule table (C2). Plain-language only: every condition is also shown as an English sentence.
 */
import type {
  ActivityParameter,
  CalcSpec,
  CalcValue,
  Condition,
  ConditionGroup,
  ConditionNode,
  ConditionOp,
  FieldDefinition,
  FieldRule,
  GroupReview,
  Operand
} from '../../../domain'
import { describeCondition, isGroupNode } from '../../../engine'

export interface RuleEnv {
  fields: FieldDefinition[]
  params: ActivityParameter[]
  /** The activity's review loops (for the "review status" operand). */
  groups?: GroupReview[]
}

/** Core part attributes a rule can read (PartRecord). */
export const PART_ATTRS: { v: string; l: string }[] = [
  { v: 'department', l: 'Department' },
  { v: 'section', l: 'Section' },
  { v: 'model', l: 'Model' },
  { v: 'type', l: 'Type (NewPart / ECN)' },
  { v: 'vendorCode', l: 'Vendor code' },
  { v: 'vendorName', l: 'Vendor name' },
  { v: 'technicalCategory', l: 'Technical category' },
  { v: 'partNo', l: 'Part number' }
]
export const GROUP_STATUSES: { v: string; l: string }[] = [
  { v: 'idle', l: 'not started' },
  { v: 'filling', l: 'being filled' },
  { v: 'inReview', l: 'with the reviewer' },
  { v: 'accepted', l: 'accepted' },
  { v: 'rejected', l: 'rejected' }
]

export const sel = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'
export const inp = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'
export const linkBtn = 'text-[11px] text-[var(--color-accent)] hover:underline'
export const delBtn = 'text-[11px] text-[var(--color-destructive)] hover:underline'

export const labelOfEnv = (env: RuleEnv) => (key: string) => env.fields.find((f) => f.key === key)?.label || key

type OperandKind = Operand['kind']
const OPERAND_KINDS: { v: OperandKind; l: string }[] = [
  { v: 'field', l: 'Field' },
  { v: 'const', l: 'Fixed value' },
  { v: 'today', l: 'Today' },
  { v: 'mrd', l: 'MRD' },
  { v: 'plannedStart', l: 'Planned start' },
  { v: 'plannedEnd', l: 'Planned end' },
  { v: 'param', l: 'Setting' },
  { v: 'part', l: 'Part attribute' },
  { v: 'groupStatus', l: 'Review loop status' },
  { v: 'offset', l: 'Date ± days' }
]

export function defaultOperand(kind: OperandKind, env: RuleEnv): Operand {
  switch (kind) {
    case 'field':
      return { kind: 'field', key: env.fields[0]?.key ?? '' }
    case 'const':
      return { kind: 'const', value: '' }
    case 'param':
      return { kind: 'param', key: env.params[0]?.key ?? '' }
    case 'offset':
      return { kind: 'offset', base: { kind: 'mrd' }, days: -1 }
    case 'groupStatus':
      return { kind: 'groupStatus', groupId: env.groups?.[0]?.id ?? '' }
    case 'part':
      return { kind: 'part', attr: 'department' }
    default:
      return { kind } as Operand
  }
}

export function OperandPicker({ value, onChange, env, allowOffset = true, label }: { value: Operand; onChange: (o: Operand) => void; env: RuleEnv; allowOffset?: boolean; label?: string }) {
  const kinds = OPERAND_KINDS.filter((k) => allowOffset || k.v !== 'offset')
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select value={value.kind} onChange={(e) => onChange(defaultOperand(e.target.value as OperandKind, env))} className={sel} aria-label={label ?? 'Operand type'}>
        {kinds.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
      </select>
      {value.kind === 'field' && (
        <>
          <select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })} className={sel} aria-label="Field">
            <option value="">— field —</option>
            {env.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
            {/* A table's latest row (e.g. the latest PPVT cycle): "table.column". */}
            {env.fields.filter((f) => f.type === 'table').flatMap((f) => (f.columns ?? []).map((c) => (
              <option key={`${f.key}.${c.key}`} value={`${f.key}.${c.key}`}>{`${f.label || f.key} › ${c.label} (latest row)`}</option>
            )))}
          </select>
          {env.fields.find((f) => f.key === value.key)?.override && (
            <select value={value.attr ?? 'value'} onChange={(e) => onChange({ ...value, attr: e.target.value as any })} className={sel} aria-label="Which value">
              <option value="value">final value</option>
              <option value="systemValue">system value</option>
              <option value="overrideValue">override value</option>
              <option value="isOverridden">was overridden</option>
            </select>
          )}
        </>
      )}
      {value.kind === 'const' && <input value={String(value.value)} onChange={(e) => onChange({ kind: 'const', value: e.target.value })} className={`${inp} w-28`} placeholder="value" aria-label="Value" />}
      {value.kind === 'part' && (
        <select value={value.attr} onChange={(e) => onChange({ kind: 'part', attr: e.target.value })} className={sel} aria-label="Part attribute">
          {PART_ATTRS.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
        </select>
      )}
      {value.kind === 'groupStatus' && (
        <select value={value.groupId} onChange={(e) => onChange({ kind: 'groupStatus', groupId: e.target.value })} className={sel} aria-label="Review loop">
          <option value="">— review loop —</option>
          {(env.groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.label || g.id}</option>)}
        </select>
      )}
      {value.kind === 'param' && (
        <select value={value.key} onChange={(e) => onChange({ kind: 'param', key: e.target.value })} className={sel} aria-label="Setting">
          <option value="">— setting —</option>
          {env.params.map((p) => <option key={p.key} value={p.key}>{p.label || p.key}</option>)}
        </select>
      )}
      {value.kind === 'offset' && (
        <>
          <OperandPicker value={value.base} onChange={(b) => onChange({ ...value, base: b })} env={env} allowOffset={false} label="Date to move" />
          <select
            value={typeof value.days === 'number' ? 'n' : 'p'}
            onChange={(e) => onChange({ ...value, days: e.target.value === 'n' ? -1 : { param: env.params[0]?.key ?? '', negate: true } })}
            className={sel}
            aria-label="Days from"
          >
            <option value="n">± fixed days</option>
            <option value="p">± setting days</option>
          </select>
          {typeof value.days === 'number' ? (
            <input type="number" value={value.days} onChange={(e) => onChange({ ...value, days: Number(e.target.value) })} className={`${inp} w-16`} aria-label="Days (negative = before)" />
          ) : (
            <>
              <select value={value.days.negate ? '-' : '+'} onChange={(e) => onChange({ ...value, days: { ...(value.days as { param: string }), negate: e.target.value === '-' } })} className={sel} aria-label="Plus or minus">
                <option value="-">minus</option>
                <option value="+">plus</option>
              </select>
              <select value={value.days.param} onChange={(e) => onChange({ ...value, days: { ...(value.days as { negate?: boolean }), param: e.target.value } })} className={sel} aria-label="Setting">
                <option value="">— setting —</option>
                {env.params.map((p) => <option key={p.key} value={p.key}>{p.label || p.key}</option>)}
              </select>
            </>
          )}
        </>
      )}
    </span>
  )
}

const OPS: { v: ConditionOp; l: string }[] = [
  { v: 'filled', l: 'is filled' },
  { v: 'blank', l: 'is blank' },
  { v: '=', l: 'is equal to' },
  { v: '!=', l: 'is not equal to' },
  { v: '>', l: 'is greater than' },
  { v: '<', l: 'is less than' },
  { v: '>=', l: 'is at least' },
  { v: '<=', l: 'is at most' },
  { v: 'contains', l: 'contains' },
  { v: 'oneOf', l: 'is one of' }
]

export function ConditionRow({ c, onChange, onRemove, env }: { c: Condition; onChange: (c: Condition) => void; onRemove: () => void; env: RuleEnv }) {
  const unary = c.op === 'filled' || c.op === 'blank'
  const tables = env.fields.filter((f) => f.type === 'table')
  const table = c.anyRowOf ? tables.find((t) => t.key === c.anyRowOf) : undefined
  // "any row of table T has …": the left side then picks one of T's columns.
  const leftEnv: RuleEnv = table ? { ...env, fields: (table.columns ?? []).map((col) => ({ ...({} as FieldDefinition), key: col.key, label: col.label })) } : env
  const statusLeft = c.left.kind === 'groupStatus'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tables.length > 0 && (
        <select
          value={c.anyRowOf ?? ''}
          onChange={(e) => {
            const t = tables.find((x) => x.key === e.target.value)
            onChange({ ...c, anyRowOf: t?.key, left: t ? { kind: 'field', key: t.columns?.[0]?.key ?? '' } : defaultOperand('field', env) })
          }}
          className={sel}
          aria-label="Read from"
        >
          <option value="">this form</option>
          {tables.map((t) => <option key={t.key} value={t.key}>any row of “{t.label || t.key}”</option>)}
        </select>
      )}
      <OperandPicker value={c.left} onChange={(left) => onChange({ ...c, left, ...(left.kind === 'groupStatus' ? { op: '=' as ConditionOp, right: { kind: 'const' as const, value: 'accepted' } } : {}) })} env={leftEnv} label="Left side" />
      <select
        value={c.op}
        onChange={(e) => {
          const op = e.target.value as ConditionOp
          onChange({ ...c, op, right: op === 'filled' || op === 'blank' || op === 'oneOf' ? undefined : (c.right ?? { kind: 'const', value: '' }) })
        }}
        className={sel}
        aria-label="Operator"
      >
        {OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      {c.op === 'oneOf' && (
        <input
          value={(c.list ?? []).join(', ')}
          onChange={(e) => onChange({ ...c, list: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
          placeholder="A, B, C"
          className={`${inp} w-36`}
          aria-label="Allowed values"
        />
      )}
      {!unary && c.op !== 'oneOf' && statusLeft && (
        <select value={String((c.right as { value?: unknown } | undefined)?.value ?? 'accepted')} onChange={(e) => onChange({ ...c, right: { kind: 'const', value: e.target.value } })} className={sel} aria-label="Review status">
          {GROUP_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
      )}
      {!unary && c.op !== 'oneOf' && !statusLeft && <OperandPicker value={c.right ?? { kind: 'const', value: '' }} onChange={(right) => onChange({ ...c, right })} env={env} label="Right side" />}
      <button type="button" onClick={onRemove} className={delBtn} aria-label="Remove condition">remove</button>
    </div>
  )
}

export const emptyCondition = (env: RuleEnv): Condition => ({ left: defaultOperand('field', env), op: 'filled' })

function GroupEditor({ g, onChange, env, depth, onRemove }: { g: ConditionGroup; onChange: (g: ConditionGroup) => void; env: RuleEnv; depth: number; onRemove?: () => void }) {
  const setItem = (i: number, n: ConditionNode) => onChange({ ...g, items: g.items.map((x, j) => (j === i ? n : x)) })
  const rmItem = (i: number) => onChange({ ...g, items: g.items.filter((_, j) => j !== i) })
  return (
    <div className={depth > 0 ? 'rounded border border-dashed border-[var(--color-border)] bg-white p-1.5' : ''}>
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="text-[var(--color-muted)]">{depth > 0 ? 'Group:' : 'Match'}</span>
        <select value={g.op} onChange={(e) => onChange({ ...g, op: e.target.value as 'AND' | 'OR' })} className={sel} aria-label="All or any">
          <option value="AND">ALL of these (AND)</option>
          <option value="OR">ANY of these (OR)</option>
        </select>
        {onRemove && <button type="button" onClick={onRemove} className={delBtn}>remove group</button>}
      </div>
      <div className="space-y-1.5 pl-2">
        {g.items.map((n, i) =>
          isGroupNode(n) ? (
            <GroupEditor key={i} g={n} onChange={(x) => setItem(i, x)} env={env} depth={depth + 1} onRemove={() => rmItem(i)} />
          ) : (
            <ConditionRow key={i} c={n} onChange={(x) => setItem(i, x)} onRemove={() => rmItem(i)} env={env} />
          )
        )}
        <div className="flex gap-3">
          <button type="button" onClick={() => onChange({ ...g, items: [...g.items, emptyCondition(env)] })} className={linkBtn}>+ condition</button>
          {depth === 0 && <button type="button" onClick={() => onChange({ ...g, items: [...g.items, { op: 'OR', items: [emptyCondition(env)] }] })} className={linkBtn}>+ group</button>}
        </div>
      </div>
    </div>
  )
}

/** Wraps a bare condition (older data) in a root AND group so the editor always works on a group. */
export const asGroup = (n: ConditionNode | undefined): ConditionGroup => (!n ? { op: 'AND', items: [] } : isGroupNode(n) ? n : { op: 'AND', items: [n] })

/** C1 condition builder: AND / OR groups (one level of nesting) with a plain-English sentence underneath. */
export function ConditionEditor({ value, onChange, env }: { value: ConditionNode | undefined; onChange: (n: ConditionNode) => void; env: RuleEnv }) {
  const g = asGroup(value)
  return (
    <div className="space-y-1">
      <GroupEditor g={g} onChange={onChange} env={env} depth={0} />
      <p className="text-[11px] italic text-[var(--color-muted)]">In words: {describeCondition(g, labelOfEnv(env))}</p>
    </div>
  )
}

export const RULE_ACTIONS: { v: FieldRule['action']; l: string }[] = [
  { v: 'show', l: 'Show this field' },
  { v: 'hide', l: 'Hide this field' },
  { v: 'makeMandatory', l: 'Make it mandatory' },
  { v: 'makeOptional', l: 'Make it optional' },
  { v: 'makeReadOnly', l: 'Make it read-only' },
  { v: 'makeEditable', l: 'Let its owner edit it again (even after submit)' }
]

/** C1: list of "when <condition> then <action>" rules for one field. */
export function FieldRulesEditor({ rules, onChange, env }: { rules: FieldRule[]; onChange: (r: FieldRule[]) => void; env: RuleEnv }) {
  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={i} className="space-y-1 rounded border border-[var(--color-border)] bg-white p-2">
          <div className="text-[11px] font-medium">When</div>
          <ConditionEditor value={r.when} onChange={(when) => onChange(rules.map((x, j) => (j === i ? { ...x, when } : x)))} env={env} />
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-medium">Then</span>
            <select value={r.action} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, action: e.target.value as FieldRule['action'] } : x)))} className={sel} aria-label="Action">
              {RULE_ACTIONS.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
            </select>
            <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))} className={delBtn}>remove rule</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rules, { when: { op: 'AND', items: [emptyCondition(env)] }, action: 'show' }])} className={linkBtn}>+ Add rule</button>
    </div>
  )
}

// ── C2: calculated value table ─────────────────────────────────────────────────

const VALUE_KINDS: { v: CalcValue['kind']; l: string }[] = [
  { v: 'const', l: 'this text / number' },
  { v: 'operand', l: 'a date / field value' },
  { v: 'percent', l: 'a percentage' },
  { v: 'math', l: 'a sum / difference / product / ratio' },
  { v: 'matchPct', l: 'a match % of field pairs' },
  { v: 'aggregate', l: 'a total / count over table rows' },
  { v: 'blank', l: 'leave blank' }
]

function CalcValueEditor({ value, onChange, env }: { value: CalcValue; onChange: (v: CalcValue) => void; env: RuleEnv }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select
        value={value.kind}
        onChange={(e) => {
          const k = e.target.value as CalcValue['kind']
          onChange(k === 'const' ? { kind: 'const', value: '' } : k === 'operand' ? { kind: 'operand', operand: defaultOperand('field', env) } : k === 'percent' ? { kind: 'percent', part: '', total: '' }
            : k === 'math' ? { kind: 'math', op: '-', left: defaultOperand('field', env), right: defaultOperand('field', env) }
            : k === 'matchPct' ? { kind: 'matchPct', pairs: [] }
            : k === 'aggregate' ? { kind: 'aggregate', fn: 'sum', sources: [] } : { kind: 'blank' })
        }}
        className={sel}
        aria-label="Result type"
      >
        {VALUE_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
      </select>
      {value.kind === 'const' && <input value={String(value.value)} onChange={(e) => onChange({ kind: 'const', value: e.target.value })} className={`${inp} w-32`} placeholder="e.g. OT" aria-label="Result" />}
      {value.kind === 'operand' && <OperandPicker value={value.operand} onChange={(operand) => onChange({ kind: 'operand', operand })} env={env} label="Result source" />}
      {value.kind === 'math' && (
        <>
          <OperandPicker value={value.left} onChange={(left) => onChange({ ...value, left })} env={env} label="Left" />
          <select value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as '+' | '-' | '*' | '/' })} className={sel} aria-label="Operation">
            {(['+', '-', '*', '/'] as const).map((o) => <option key={o} value={o}>{o === '*' ? '×' : o === '/' ? '÷' : o === '-' ? '−' : o}</option>)}
          </select>
          <OperandPicker value={value.right} onChange={(right) => onChange({ ...value, right })} env={env} label="Right" />
          <input type="number" min={0} value={value.decimals ?? 0} onChange={(e) => onChange({ ...value, decimals: Number(e.target.value) || 0 })} className={`${inp} w-14`} aria-label="Decimals" title="Decimals" />
        </>
      )}
      {value.kind === 'matchPct' && (
        <span className="inline-flex flex-col gap-1">
          {value.pairs.map(([l, r], i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {[l, r].map((k, side) => (
                <select key={side} value={k} onChange={(e) => onChange({ ...value, pairs: value.pairs.map((p, j) => (j === i ? (side === 0 ? [e.target.value, p[1]] : [p[0], e.target.value]) : p)) })} className={sel} aria-label={side === 0 ? 'Compare' : 'With'}>
                  <option value="">— field —</option>
                  {env.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
                </select>
              ))}
              <button type="button" onClick={() => onChange({ ...value, pairs: value.pairs.filter((_, j) => j !== i) })} className={delBtn}>remove</button>
            </span>
          ))}
          <button type="button" onClick={() => onChange({ ...value, pairs: [...value.pairs, ['', '']] })} className={linkBtn}>+ Add pair</button>
        </span>
      )}
      {value.kind === 'aggregate' && <AggregateEditor value={value} onChange={onChange} env={env} />}
      {value.kind === 'percent' && (
        <>
          <select value={value.part} onChange={(e) => onChange({ ...value, part: e.target.value })} className={sel} aria-label="Part">
            <option value="">— part —</option>
            {env.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
          </select>
          <span>÷</span>
          <select value={value.total} onChange={(e) => onChange({ ...value, total: e.target.value })} className={sel} aria-label="Total">
            <option value="">— total —</option>
            {env.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
          </select>
        </>
      )}
    </span>
  )
}

type Aggregate = Extract<CalcValue, { kind: 'aggregate' }>
/** Total of columns / count of rows / count per value over this activity's tables (CalcValue `aggregate`). */
function AggregateEditor({ value, onChange, env }: { value: Aggregate; onChange: (v: CalcValue) => void; env: RuleEnv }) {
  const tables = env.fields.filter((f) => f.type === 'table')
  const colsOf = (t: string) => tables.find((f) => f.key === t)?.columns ?? []
  // A row condition reads the row's cells (of the first listed table) and the activity's other fields.
  const firstCols = colsOf(value.sources[0]?.table ?? '')
  const rowEnv: RuleEnv = {
    ...env,
    fields: [
      ...firstCols.map((c) => ({ key: c.key, label: `Row › ${c.label || c.key}`, type: c.type === 'longText' ? 'text' : c.type, options: c.options, mandatory: false, enteredBy: 'PIC', source: 'manual', validatedBy: null, showOnDashboard: false }) as FieldDefinition),
      ...env.fields.filter((f) => f.type !== 'table')
    ]
  }
  const setSrc = (i: number, s: Aggregate['sources'][number]) => onChange({ ...value, sources: value.sources.map((x, j) => (j === i ? s : x)) })
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <select value={value.fn} onChange={(e) => onChange({ ...value, fn: e.target.value as Aggregate['fn'] })} className={sel} aria-label="Aggregate">
          <option value="sum">total of the columns</option>
          <option value="count">number of rows</option>
          <option value="countBy">rows per value of a column</option>
        </select>
        <span>over</span>
      </span>
      {value.sources.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1 pl-3">
          <select value={s.table} onChange={(e) => setSrc(i, { table: e.target.value })} className={sel} aria-label={`Table ${i + 1}`}>
            <option value="">— table —</option>
            {tables.map((t) => <option key={t.key} value={t.key}>{t.label || t.key}</option>)}
          </select>
          {value.fn !== 'count' && (
            <select value={s.column ?? ''} onChange={(e) => setSrc(i, { ...s, column: e.target.value || undefined })} className={sel} aria-label={`Column ${i + 1}`}>
              <option value="">— column —</option>
              {colsOf(s.table).filter((c) => value.fn === 'countBy' || c.type === 'number').map((c) => <option key={c.key} value={c.key}>{c.label || c.key}</option>)}
            </select>
          )}
          <button type="button" onClick={() => onChange({ ...value, sources: value.sources.filter((_, j) => j !== i) })} className={delBtn}>remove</button>
        </span>
      ))}
      <button type="button" onClick={() => onChange({ ...value, sources: [...value.sources, { table: '' }] })} className={linkBtn}>+ Add table / column</button>
      <label className="inline-flex items-center gap-1">
        <input type="checkbox" checked={!!value.where} onChange={(e) => onChange({ ...value, where: e.target.checked ? { op: 'AND', items: [] } : undefined })} aria-label="Only rows where" />
        only rows where
      </label>
      {value.where && <ConditionEditor value={value.where} onChange={(where) => onChange({ ...value, where })} env={rowEnv} />}
    </span>
  )
}

/** C2: ordered IF / THEN list, first match wins, ELSE default. The calculated field is always read-only. */
export function CalcTableEditor({ calc, onChange, env }: { calc: CalcSpec | undefined; onChange: (c: CalcSpec | undefined) => void; env: RuleEnv }) {
  if (!calc) return <button type="button" onClick={() => onChange({ rules: [], else: { kind: 'blank' } })} className={linkBtn}>+ Calculate this field from rules</button>
  const move = (i: number, d: number) => {
    const rules = calc.rules.slice()
    const j = i + d
    if (j < 0 || j >= rules.length) return
    ;[rules[i], rules[j]] = [rules[j], rules[i]]
    onChange({ ...calc, rules })
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--color-muted)]">Rules are checked from the top; the first one that matches decides the value. The field becomes read-only.</p>
      {calc.rules.map((r, i) => (
        <div key={i} className="space-y-1 rounded border border-[var(--color-border)] bg-white p-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium">IF #{i + 1}</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => move(i, -1)} className={linkBtn} aria-label="Move up">▲</button>
              <button type="button" onClick={() => move(i, 1)} className={linkBtn} aria-label="Move down">▼</button>
              <button type="button" onClick={() => onChange({ ...calc, rules: calc.rules.filter((_, j) => j !== i) })} className={delBtn}>remove</button>
            </span>
          </div>
          <ConditionEditor value={r.when} onChange={(when) => onChange({ ...calc, rules: calc.rules.map((x, j) => (j === i ? { ...x, when } : x)) })} env={env} />
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="font-medium">THEN the value is</span>
            <CalcValueEditor value={r.value} onChange={(value) => onChange({ ...calc, rules: calc.rules.map((x, j) => (j === i ? { ...x, value } : x)) })} env={env} />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...calc, rules: [...calc.rules, { when: { op: 'AND', items: [emptyCondition(env)] }, value: { kind: 'const', value: '' } }] })} className={linkBtn}>+ Add IF row</button>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-medium">ELSE the value is</span>
        <CalcValueEditor value={calc.else ?? { kind: 'blank' }} onChange={(e) => onChange({ ...calc, else: e })} env={env} />
      </div>
      <button type="button" onClick={() => onChange(undefined)} className={delBtn}>stop calculating this field</button>
    </div>
  )
}
