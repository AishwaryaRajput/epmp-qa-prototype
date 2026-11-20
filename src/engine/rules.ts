/**
 * Generic rule engine (C1–C8). Pure functions over the plain-data config in `domain` (Operand, Condition, FieldRule,
 * CalcSpec, ValidationRule, GroupReview, DeviationTrigger). Nothing here knows an activity id or a field key:
 * every behaviour comes from the config stored on ActivityDefinition / FieldDefinition.
 * This file must not import from './index' (index re-exports it).
 */
import type {
  ActivityDefinition,
  CalcSpec,
  CalcValue,
  Condition,
  ConditionNode,
  FieldChange,
  FieldDefinition,
  FieldRule,
  DeviationTrigger,
  GroupReview,
  GroupReviewState,
  GroupCycle,
  MasterList,
  ActivityEntry,
  Operand,
  TestScenario,
  ValidationRule
} from '../domain'
import type { PersonaId } from '../store/personaStore'
import { APP_TODAY } from '../domain/today'

/** The app's "today" (one setting, see domain/today; same as features/scope DEMO_TODAY). Callers can override it via RuleExtra.today. */
export const RULE_TODAY = APP_TODAY

/** Everything a condition can read. */
export interface RuleCtx {
  values: Record<string, any>
  today: string
  mrd?: string
  plannedStart?: string
  plannedEnd?: string
  part?: Record<string, any>
  params?: Record<string, number>
  /** GroupReview.id → status (idle | filling | inReview | accepted | rejected). */
  groupStatus?: Record<string, string>
}
/** Optional context a caller adds on top of the values. */
export interface RuleExtra {
  mrd?: string
  today?: string
  plannedStart?: string
  plannedEnd?: string
  part?: Record<string, any>
  params?: Record<string, number>
  groupReviews?: GroupReview[]
  groupState?: Record<string, GroupReviewState>
  deviation?: DeviationTrigger
  /** The entry's saved values: "lock the form when …" is decided on these, so choosing "Closed" locks only once saved. */
  savedValues?: Record<string, any>
}
export interface FieldState {
  visible: boolean
  mandatory: boolean
  readOnly: boolean
  /** A field-group "On Accept" setting (or a makeEditable rule) re-opened this field for its owner (even after submit / approval). */
  reopened?: boolean
  /** Roles the field is hidden from right now (FieldDefinition.hiddenFrom). */
  hiddenFor?: string[]
}

export const isBlank = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const str = (v: unknown) => (isBlank(v) ? '' : String(v))
const isDateStr = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** YYYY-MM-DD plus N days (no time-zone drift). */
export function shiftDate(d: string, days: number): string {
  if (!isDateStr(d)) return d
  const [y, m, day] = d.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, day + days))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

export function buildRuleCtx(def: Pick<ActivityDefinition, 'parameters'>, values: Record<string, any>, extra: RuleExtra = {}): RuleCtx {
  const params: Record<string, number> = { ...(extra.params ?? {}) }
  for (const p of def.parameters ?? []) if (!(p.key in params)) params[p.key] = p.value
  return {
    values,
    today: extra.today ?? RULE_TODAY,
    mrd: extra.mrd,
    plannedStart: extra.plannedStart,
    plannedEnd: extra.plannedEnd,
    part: extra.part,
    params,
    groupStatus: groupStatusMap(extra.groupReviews, extra.groupState)
  }
}

export function groupStatusMap(groups: GroupReview[] | undefined, state: Record<string, GroupReviewState> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const g of groups ?? []) out[g.id] = state?.[g.id]?.status ?? 'idle'
  return out
}

// ── C1: operands, conditions ────────────────────────────────────────────────────────────────────────────────────

/** "table.column" = that column in the table's latest (last) row, e.g. the latest PPVT result of a row-per-cycle table. */
export function lastRowValue(values: Record<string, any>, key: string): any {
  const [t, c] = key.split('.')
  const rows = values[t]
  if (!Array.isArray(rows) || rows.length === 0) return undefined
  return rows[rows.length - 1]?.[c]
}

export function resolveOperand(o: Operand, ctx: RuleCtx, row?: Record<string, any>): any {
  switch (o.kind) {
    case 'const':
      return o.value
    case 'today':
      return ctx.today
    case 'mrd':
      return ctx.mrd
    case 'plannedStart':
      return ctx.plannedStart
    case 'plannedEnd':
      return ctx.plannedEnd
    case 'part':
      // "attrs.supply_chain_dept" reads a further intake attribute.
      return o.attr.split('.').reduce<any>((x, k) => (x == null ? undefined : x[k]), ctx.part)
    case 'param':
      return ctx.params?.[o.key]
    case 'groupStatus':
      return ctx.groupStatus?.[o.groupId] ?? 'idle'
    case 'field': {
      const k = o.key
      if (o.attr === 'systemValue') return ctx.values[`${k}__system`] ?? ctx.values[k]
      if (o.attr === 'overrideValue') return ctx.values[`${k}__override`]
      if (o.attr === 'isOverridden') return !isBlank(ctx.values[`${k}__override`])
      const v = (row ?? ctx.values)[k]
      if (v !== undefined || !k.includes('.')) return v
      return lastRowValue(ctx.values, k)
    }
    case 'offset': {
      const b = resolveOperand(o.base, ctx, row)
      if (isBlank(b)) return undefined
      const n = typeof o.days === 'number' ? o.days : (ctx.params?.[o.days.param] ?? 0) * (o.days.negate ? -1 : 1)
      return shiftDate(String(b), n)
    }
  }
}

function compare(op: Condition['op'], l: unknown, r: unknown): boolean {
  if (op === '=') return str(l) === str(r)
  if (op === '!=') return str(l) !== str(r)
  if (isBlank(l) || isBlank(r)) return false
  let a: any = l
  let b: any = r
  if (!(isDateStr(a) && isDateStr(b))) {
    const na = Number(a)
    const nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      a = na
      b = nb
    }
  }
  if (op === '>') return a > b
  if (op === '<') return a < b
  if (op === '>=') return a >= b
  if (op === '<=') return a <= b
  return false
}

function evalOne(c: Condition, ctx: RuleCtx, row?: Record<string, any>): boolean {
  const l = resolveOperand(c.left, ctx, row)
  switch (c.op) {
    case 'filled':
      return !isBlank(l)
    case 'blank':
      return isBlank(l)
    case 'oneOf':
      return (c.list ?? []).includes(str(l))
    case 'contains': {
      const r = c.right ? resolveOperand(c.right, ctx, row) : ''
      return Array.isArray(l) ? l.includes(r) : str(l).includes(str(r))
    }
    default:
      return compare(c.op, l, c.right ? resolveOperand(c.right, ctx, row) : '')
  }
}

/**
 * Row rules of a table column (TableColumn.showRule / requiredRule): a field operand reads the row's cell first, then
 * the entry's own fields; MRD, today and the activity settings come from `extra`.
 */
export function rowRuleFor(def: Pick<ActivityDefinition, 'parameters'>, values: Record<string, any>, extra: RuleExtra = {}) {
  return (node: ConditionNode, row: Record<string, any>): boolean => evalCondition(node, buildRuleCtx(def, { ...values, ...row }, extra))
}

export const isGroupNode = (n: ConditionNode): n is Extract<ConditionNode, { items: ConditionNode[] }> => 'items' in n

export function evalCondition(node: ConditionNode | undefined, ctx: RuleCtx): boolean {
  if (!node) return true
  if (isGroupNode(node)) {
    if (node.items.length === 0) return true
    return node.op === 'AND' ? node.items.every((n) => evalCondition(n, ctx)) : node.items.some((n) => evalCondition(n, ctx))
  }
  if (node.anyRowOf) {
    const rows: Record<string, any>[] = Array.isArray(ctx.values[node.anyRowOf]) ? ctx.values[node.anyRowOf] : []
    return rows.some((r) => evalOne(node, ctx, r))
  }
  return evalOne(node, ctx)
}

const OP_WORDS: Record<Condition['op'], string> = {
  filled: 'is filled',
  blank: 'is blank',
  '=': 'is',
  '!=': 'is not',
  '>': 'is greater than',
  '<': 'is less than',
  '>=': 'is at least',
  '<=': 'is at most',
  contains: 'contains',
  oneOf: 'is one of'
}
export const CONDITION_OP_WORDS = OP_WORDS

export function describeOperand(o: Operand | undefined, labelOf: (key: string) => string): string {
  if (!o) return '…'
  switch (o.kind) {
    case 'const':
      return typeof o.value === 'string' ? `“${o.value}”` : String(o.value)
    case 'today':
      return 'today'
    case 'mrd':
      return 'the MRD'
    case 'plannedStart':
      return 'the planned start'
    case 'plannedEnd':
      return 'the planned end'
    case 'part':
      return `the part’s ${o.attr}`
    case 'param':
      return `the setting “${o.key}”`
    case 'groupStatus':
      return `the review status of “${o.groupId}”`
    case 'field': {
      const l = labelOf(o.key)
      return o.attr === 'isOverridden' ? `“${l}” was overridden` : o.attr === 'overrideValue' ? `the override of “${l}”` : o.attr === 'systemValue' ? `the system value of “${l}”` : `“${l}”`
    }
    case 'offset': {
      const n = typeof o.days === 'number' ? o.days : (o.days.negate ? -1 : 1) * 1
      const lab = typeof o.days === 'number' ? `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}` : `“${o.days.param}” days`
      const minus = typeof o.days === 'number' ? o.days < 0 : !!o.days.negate
      return `${describeOperand(o.base, labelOf)} ${minus ? '−' : '+'} ${lab}`
    }
  }
}

/** Plain-English sentence for a condition tree. */
export function describeCondition(node: ConditionNode | undefined, labelOf: (key: string) => string): string {
  if (!node) return 'always'
  if (isGroupNode(node)) {
    if (node.items.length === 0) return 'always'
    const parts = node.items.map((n) => (isGroupNode(n) ? `(${describeCondition(n, labelOf)})` : describeCondition(n, labelOf)))
    return parts.join(node.op === 'AND' ? ' AND ' : ' OR ')
  }
  const left = describeOperand(node.left, labelOf)
  const prefix = node.anyRowOf ? `any row of “${labelOf(node.anyRowOf)}” has ` : ''
  if (node.op === 'filled' || node.op === 'blank') return `${prefix}${left} ${OP_WORDS[node.op]}`
  if (node.op === 'oneOf') return `${prefix}${left} is one of ${(node.list ?? []).map((x) => `“${x}”`).join(', ') || '…'}`
  return `${prefix}${left} ${OP_WORDS[node.op]} ${describeOperand(node.right, labelOf)}`
}

/** Old single-condition rules become FieldRules (same meaning, so saved activities keep working). */
export function legacyToRules(field: FieldDefinition): FieldRule[] {
  const map: Record<string, Condition['op']> = { equals: '=', notEquals: '!=', greaterThan: '>', lessThan: '<', contains: 'contains' }
  return (field.conditionalRules ?? []).map((r) => ({
    when: { left: { kind: 'field', key: r.dependsOn }, op: map[r.operator] ?? '=', right: { kind: 'const', value: r.value ?? '' } } as Condition,
    action: r.action
  }))
}

/**
 * Visibility / mandatory / read-only for every field (C1 + C6 group locks).
 *
 * How several rules on ONE field combine (order = the order of the rules on the field, legacy rules first):
 *  - visible:   starts true. If the field has any "show" rule it is visible only while at least one "show" rule matches.
 *               Any matching "hide" rule then hides it (hide wins over show).
 *  - mandatory: starts at the field's own setting; every MATCHING makeMandatory / makeOptional rule is applied in order,
 *               so the last matching one wins. A rule whose condition does not match changes nothing (it never undoes
 *               an earlier rule).
 *  - readOnly:  true when any makeReadOnly rule matches.
 * Then the review-loop locks and the deviation block run on top (see below).
 */
export function groupIsOpen(g: GroupReview, groups: GroupReview[], state: Record<string, GroupReviewState> | undefined, ctx: RuleCtx): boolean {
  if (state?.[g.id]?.status) return true
  const openers = groups.filter((h) => h.onAccept?.openGroupId === g.id)
  if (openers.length > 0) return openers.some((h) => state?.[h.id]?.status === 'accepted') || (!!g.opensWhen && evalCondition(g.opensWhen, ctx))
  return evalCondition(g.opensWhen, ctx)
}
/** Visibility / mandatory / read-only for every field — see the combination rules above. */
export function evaluateFieldStates(
  fields: FieldDefinition[],
  values: Record<string, any>,
  extra: RuleExtra & { def?: Pick<ActivityDefinition, 'parameters'> & { lockWhen?: ConditionNode } } = {}
): Record<string, FieldState> {
  const ctx = buildRuleCtx(extra.def ?? {}, values, extra)
  const out: Record<string, FieldState> = {}
  for (const f of fields) out[f.key] = { visible: true, mandatory: f.mandatory, readOnly: false }
  for (const f of fields) {
    const st = out[f.key]
    const rules = [...legacyToRules(f), ...(f.rules ?? [])]
    const showRules = rules.filter((r) => r.action === 'show')
    if (showRules.length > 0) st.visible = showRules.some((r) => evalCondition(r.when, ctx))
    for (const rule of rules) {
      const m = evalCondition(rule.when, ctx)
      if (!m) continue
      if (rule.action === 'hide') st.visible = false
      else if (rule.action === 'makeMandatory') st.mandatory = true
      else if (rule.action === 'makeOptional') st.mandatory = false
      else if (rule.action === 'makeReadOnly') st.readOnly = true
      else if (rule.action === 'makeEditable') st.reopened = true
    }
    // Hidden from some roles (e.g. the Vendor's values from the PIC while the PIC enters their own).
    if (f.hiddenFrom && (!f.hiddenFrom.when || evalCondition(f.hiddenFrom.when, ctx))) st.hiddenFor = [...f.hiddenFrom.roles]
  }
  const groups = extra.groupReviews ?? []
  // A field covered by several loops (e.g. one for a system value, one after a PIC override — mutually exclusive) is
  // hidden only when none of them is open; the locks come from the open ones.
  const openIds = new Set(groups.filter((g) => groupIsOpen(g, groups, extra.groupState, ctx)).map((g) => g.id))
  for (const f of fields) {
    const covering = groups.filter((g) => f.section === g.section || g.partialFields?.includes(f.key))
    if (!covering.length) continue
    const st = out[f.key]
    const open = covering.filter((g) => openIds.has(g.id))
    if (!open.length) st.visible = false
    for (const g of open) {
      const status = extra.groupState?.[g.id]?.status
      const partial = g.partialFields?.includes(f.key)
      if (status === 'inReview' || (status === 'accepted' && g.lockOnAccept && !partial)) st.readOnly = true
    }
  }
  // "On Accept, open …": fields to show / re-open once the loop is accepted.
  for (const g of groups) {
    const accepted = extra.groupState?.[g.id]?.status === 'accepted'
    for (const k of g.onAccept?.showFields ?? []) if (out[k] && !accepted) out[k].visible = false
    if (accepted) for (const k of g.onAccept?.reopenFields ?? []) if (out[k]) out[k].reopened = true
  }
  if (extra.deviation) {
    const need = evalCondition(extra.deviation.when, ctx)
    const { edocField, statusField, raisedField, manualStatus } = extra.deviation
    // With a "Deviation raised" field, the E-Doc number (and status) are needed only once it is answered Yes.
    const raised = !raisedField || str(values[raisedField]) === 'Y'
    // "Pop-up only": the answers are kept but not shown as form fields (the pop-up and the banner show them).
    const onForm = !extra.deviation.popupOnly
    if (raisedField && out[raisedField]) {
      out[raisedField].visible = onForm && (need || !isBlank(values[raisedField]))
      out[raisedField].mandatory = need
    }
    if (out[edocField]) {
      out[edocField].visible = onForm && need && raised
      out[edocField].mandatory = need && raised
    }
    // The approval-status field shows when the E-Doc lookup is on or the status is picked by hand.
    if (statusField && out[statusField]) {
      out[statusField].visible = onForm && need && raised && (extra.deviation.fetchStatus !== false || !!manualStatus)
      out[statusField].mandatory = need && raised && !!manualStatus
    }
  }
  // "Lock the form when …" (e.g. the case is closed): everything read-only, nothing mandatory, nothing re-opened.
  if (extra.def?.lockWhen && evalCondition(extra.def.lockWhen, 'savedValues' in extra ? buildRuleCtx(extra.def, extra.savedValues ?? {}, extra) : ctx)) {
    for (const f of fields) Object.assign(out[f.key], { readOnly: true, mandatory: false, reopened: false })
  }
  // "Planned / hidden from form": kept in the configuration, never shown, never mandatory.
  for (const f of fields) {
    if (!f.hiddenFromForm) continue
    out[f.key].visible = false
    out[f.key].mandatory = false
  }

  return out
}

// ── C2: calculated fields ───────────────────────────────────────────────────────────────────────────────────────

export function evalCalcValue(v: CalcValue, ctx: RuleCtx): any {
  switch (v.kind) {
    case 'const':
      return v.value
    case 'operand':
      return resolveOperand(v.operand, ctx)
    case 'blank':
      return undefined
    case 'percent': {
      const total = Number(ctx.values[v.total])
      const part = Number(ctx.values[v.part])
      if (!(total > 0) || isBlank(ctx.values[v.part]) || !Number.isFinite(part)) return undefined
      const f = Math.pow(10, v.decimals ?? 1)
      return Math.round((part / total) * (100 * f)) / f
    }
    case 'math': {
      const a = resolveOperand(v.left, ctx)
      const b = resolveOperand(v.right, ctx)
      if (isBlank(a) || isBlank(b) || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return undefined
      const x = Number(a)
      const y = Number(b)
      const r = v.op === '+' ? x + y : v.op === '-' ? x - y : v.op === '*' ? x * y : y === 0 ? NaN : x / y
      if (!Number.isFinite(r)) return undefined
      const f = Math.pow(10, v.decimals ?? 0)
      return Math.round(r * f) / f
    }
    case 'aggregate': {
      // Over the rows of the listed tables: a row condition sees the row's cells over the entry's values.
      const rowsOf = (t: string): Record<string, any>[] => (Array.isArray(ctx.values[t]) ? ctx.values[t] : [])
      const holds = (r: Record<string, any>) => !v.where || evalCondition(v.where, { ...ctx, values: { ...ctx.values, ...r } })
      if (v.fn === 'sum') {
        let total = 0
        let any = false
        for (const s of v.sources) for (const r of rowsOf(s.table)) {
          const x = r?.[s.column ?? '']
          if (isBlank(x) || !holds(r)) continue
          const n = Number(x)
          if (Number.isFinite(n)) { total += n; any = true }
        }
        return any ? total : undefined
      }
      if (v.fn === 'count') return v.sources.reduce((n, s) => n + rowsOf(s.table).filter(holds).length, 0)
      const counts = new Map<string, number>()
      for (const s of v.sources) for (const r of rowsOf(s.table)) {
        const x = r?.[s.column ?? '']
        if (isBlank(x) || !holds(r)) continue
        counts.set(str(x), (counts.get(str(x)) ?? 0) + 1)
      }
      return counts.size ? [...counts].map(([k, n]) => `${k} ${n}`).join(' · ') : undefined
    }
    case 'matchPct': {
      const same = (a: unknown, b: unknown) => {
        if (isBlank(a) || isBlank(b)) return false
        const na = Number(a)
        const nb = Number(b)
        return Number.isFinite(na) && Number.isFinite(nb) && typeof a !== 'boolean' ? na === nb : str(a).trim().toLowerCase() === str(b).trim().toLowerCase()
      }
      const get = (k: string) => (k in ctx.values || !k.includes('.') ? ctx.values[k] : lastRowValue(ctx.values, k))
      const compared = v.pairs.filter(([l, r]) => !(isBlank(get(l)) && isBlank(get(r))))
      if (compared.length === 0) return undefined
      const f = Math.pow(10, v.decimals ?? 0)
      return Math.round((compared.filter(([l, r]) => same(get(l), get(r))).length / compared.length) * 100 * f) / f
    }
  }
}
/** First matching IF row wins, else the ELSE value. `undefined` means "blank". */
export function runCalc(spec: CalcSpec, ctx: RuleCtx): any {
  for (const r of spec.rules) if (evalCondition(r.when, ctx)) return evalCalcValue(r.value, ctx)
  return spec.else ? evalCalcValue(spec.else, ctx) : undefined
}

function nodeKeys(n: ConditionNode | undefined, out: Set<string>) {
  if (!n) return
  if (isGroupNode(n)) return n.items.forEach((x) => nodeKeys(x, out))
  const op = (o: Operand | undefined): void => {
    if (!o) return
    if (o.kind === 'field') out.add(o.key)
    else if (o.kind === 'offset') op(o.base)
  }
  op(n.left)
  op(n.right)
  if (n.anyRowOf) out.add(n.anyRowOf)
}
/** Field keys a calculated field reads (excluding itself). */
export function calcDependencies(f: FieldDefinition): string[] {
  const out = new Set<string>()
  for (const r of f.calc?.rules ?? []) {
    nodeKeys(r.when, out)
    collectValueKeys(r.value, out)
  }
  if (f.calc?.else) collectValueKeys(f.calc.else, out)
  out.delete(f.key)
  return [...out]
}
function collectValueKeys(v: CalcValue, out: Set<string>) {
  if (v.kind === 'operand') {
    const o = v.operand
    const walk = (x: Operand): void => (x.kind === 'field' ? void out.add(x.key) : x.kind === 'offset' ? walk(x.base) : undefined)
    walk(o)
  } else if (v.kind === 'percent') {
    out.add(v.part)
    out.add(v.total)
  } else if (v.kind === 'math') {
    for (const x of [v.left, v.right]) collectValueKeys({ kind: 'operand', operand: x }, out)
  } else if (v.kind === 'matchPct') {
    for (const [l, r] of v.pairs) { out.add(l); out.add(r) }
  } else if (v.kind === 'aggregate') {
    for (const s of v.sources) out.add(s.table)
  }
}
/** A loop of calculated fields that depend on each other (e.g. ["a","b","a"]), or null. The Builder rejects these. */
export function findCalcCycle(fields: FieldDefinition[]): string[] | null {
  const calc = new Map(fields.filter((f) => f.calc).map((f) => [f.key, f]))
  const state = new Map<string, 1 | 2>()
  let found: string[] | null = null
  const stack: string[] = []
  const visit = (k: string) => {
    if (found) return
    if (state.get(k) === 2) return
    if (state.get(k) === 1) {
      found = [...stack.slice(stack.indexOf(k)), k]
      return
    }
    state.set(k, 1)
    stack.push(k)
    for (const d of calcDependencies(calc.get(k)!)) if (calc.has(d)) visit(d)
    stack.pop()
    state.set(k, 2)
  }
  for (const k of calc.keys()) visit(k)
  return found
}
/** Calculated fields in dependency order (a field is calculated after the calculated fields it reads). */
function calcOrder(fields: FieldDefinition[]): FieldDefinition[] {
  const calc = fields.filter((f) => f.calc)
  const byKey = new Map(calc.map((f) => [f.key, f]))
  const seen = new Set<string>()
  const out: FieldDefinition[] = []
  const visit = (f: FieldDefinition) => {
    if (seen.has(f.key)) return
    seen.add(f.key)
    for (const d of calcDependencies(f)) {
      const g = byKey.get(d)
      if (g) visit(g)
    }
    out.push(f)
  }
  calc.forEach(visit)
  return out
}

/** Applies every `calc` field (C2) in dependency order, with its role override (C5). Mutates and returns `values`. */
export function applyCalcFields(def: Pick<ActivityDefinition, 'fields' | 'parameters'>, values: Record<string, any>, extra: RuleExtra = {}): Record<string, any> {
  const ordered = calcOrder(def.fields)
  // Dependency order makes one pass enough; a second pass only matters for (rejected) circular configs.
  for (let pass = 0; pass < 2; pass++) {
    const snap = JSON.stringify(ordered.map((f) => values[f.key]))
    calcPass(def, ordered, values, extra)
    if (pass === 0 && !findCalcCycle(def.fields)) break
    if (snap === JSON.stringify(ordered.map((f) => values[f.key]))) break
  }
  // Calculated table columns (TableColumn.calc), row by row; then the field calcs again, so fields reading them see the result.
  if (def.fields.some((f) => f.columns?.some((c) => c.calc))) {
    for (const f of def.fields) {
      const cc = (f.columns ?? []).filter((c) => c.calc)
      if (!cc.length || !Array.isArray(values[f.key])) continue
      values[f.key] = (values[f.key] as Record<string, any>[]).map((row) => {
        const r = { ...row }
        for (const c of cc) {
          const v = runCalc(c.calc!, buildRuleCtx(def, { ...values, ...r }, extra))
          if (v === undefined || v === '') delete r[c.key]
          else r[c.key] = v
        }
        return r
      })
    }
    calcPass(def, ordered, values, extra)
  }
  return values
}
function calcPass(def: Pick<ActivityDefinition, 'fields' | 'parameters'>, ordered: FieldDefinition[], values: Record<string, any>, extra: RuleExtra) {
  for (const f of ordered) {
    const ctx = buildRuleCtx(def, values, extra)
    const sys = runCalc(f.calc!, ctx)
    if (isBlank(sys)) delete values[`${f.key}__system`]
    else values[`${f.key}__system`] = sys
    let final = sys
    if (f.override) {
      const ok = `${f.key}__override`
      const set = !isBlank(values[ok])
      // A value the role may not set (outside the override's choices) is never kept.
      if (set && !overrideOptions(f).includes(String(values[ok]))) delete values[ok]
      else if (set) {
        const allowed = overrideOpenFor(f, sys, ctx)
        // "Drop the override again when …" wins over "stay overridden".
        if (f.override.releaseWhen && evalCondition(f.override.releaseWhen, ctx)) delete values[ok]
        // "Stay overridden": once set it is kept even when the condition / direction no longer holds.
        else if (!allowed && !f.override.sticky) delete values[ok]
        else final = values[ok]
      }
    }
    if (isBlank(final) && final !== false && final !== 0) delete values[f.key]
    else values[f.key] = final
  }
}

// ── C5: override audit + deviation guard ────────────────────────────────────────────────────────────────────────

export interface OverrideEvent {
  field: FieldDefinition
  kind: 'set' | 'changed' | 'cleared'
  /** 'person' = the role changed it; 'system' = a rule cleared it (its "only allowed when" condition stopped holding). */
  by: 'person' | 'system'
  systemValue: any
  from: any
  to: any
}
/** Every override that was set, changed or cleared between two saved states. `explicit` = keys the user touched. */
export function overrideEvents(def: Pick<ActivityDefinition, 'fields'>, before: Record<string, any> | undefined, after: Record<string, any>, explicit: string[] = []): OverrideEvent[] {
  const out: OverrideEvent[] = []
  for (const f of def.fields) {
    if (!f.override) continue
    const k = `${f.key}__override`
    const a = before?.[k]
    const b = after[k]
    if (isBlank(a) && isBlank(b)) continue
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue
    out.push({
      field: f,
      kind: isBlank(a) ? 'set' : isBlank(b) ? 'cleared' : 'changed',
      by: explicit.includes(k) ? 'person' : 'system',
      systemValue: after[`${f.key}__system`] ?? before?.[`${f.key}__system`],
      from: a,
      to: b
    })
  }
  return out
}
/** Notifications an override asks for (FieldOverride.notify): who, a title, and the details incl. the chosen fields. */
export function overrideNotices(def: Pick<ActivityDefinition, 'fields'>, events: OverrideEvent[], values: Record<string, any>, actor: string): { roles: PersonaId[]; title: string; detail: string }[] {
  const out: { roles: PersonaId[]; title: string; detail: string }[] = []
  for (const o of events) {
    const n = o.field.override?.notify
    if (!n?.roles.length || o.by !== 'person' || o.kind === 'cleared') continue
    const extras = (n.includeFields ?? [])
      .map((k) => ({ f: def.fields.find((x) => x.key === k), v: values[k] }))
      .filter((x) => x.f && !isBlank(x.v))
      .map((x) => `${x.f!.label}: ${describeValue(x.v)}`)
    out.push({
      roles: n.roles,
      title: `${o.field.label} overridden to ${String(o.to)}`,
      detail: [`System value ${str(o.systemValue) || '(blank)'} → ${String(o.to)} by ${actor}`, ...extras].join(' · ')
    })
  }
  return out
}
/** Fields whose current override removes the deviation requirement (e.g. Non-OT → OT). */
export function overrideRemovesDeviation(def: Pick<ActivityDefinition, 'fields' | 'parameters' | 'deviation'>, values: Record<string, any>, extra: RuleExtra = {}): FieldDefinition[] {
  if (!def.deviation) return []
  const out: FieldDefinition[] = []
  for (const f of def.fields) {
    if (!f.override || isBlank(values[`${f.key}__override`])) continue
    const without = { ...values }
    delete without[`${f.key}__override`]
    const a = applyCalcFields(def, without, extra)
    const b = applyCalcFields(def, { ...values }, extra)
    if (deviationRequired(def, a, extra) && !deviationRequired(def, b, extra)) out.push(f)
  }
  return out
}
/** The override's own condition AND its direction ("only while the system value is one of …"). */
function overrideOpenFor(f: FieldDefinition, systemValue: unknown, ctx: RuleCtx): boolean {
  if (!f.override) return false
  if (f.override.fromValues?.length && !f.override.fromValues.includes(str(systemValue))) return false
  return evalCondition(f.override.when, ctx)
}
/** Choices offered for an override: the Admin's list, else the field's options without the "pending" style value. */
export function overrideOptions(f: FieldDefinition): string[] {
  if (f.override?.options?.length) return f.override.options
  return (f.options ?? []).filter((o) => !/^pending$/i.test(o))
}

// ── C3: field validations ───────────────────────────────────────────────────────────────────────────────────────

export interface FieldViolation {
  ruleId: string
  message: string
  severity: 'block' | 'warn'
  field: string
}
export function evaluateFieldChecks(
  def: Pick<ActivityDefinition, 'fields' | 'validationRules' | 'parameters'>,
  values: Record<string, any>,
  extra: RuleExtra = {},
  visibility?: Record<string, { visible: boolean }>
): FieldViolation[] {
  const ctx = buildRuleCtx(def, values, extra)
  const labelOf = (k: string) => def.fields.find((f) => f.key === k)?.label ?? k
  const out: FieldViolation[] = []
  for (const r of def.validationRules ?? []) {
    if (!r.type || r.type === 'sum' || !r.field) continue
    if (visibility?.[r.field]?.visible === false) continue
    if (!evalCondition(r.when, ctx)) continue
    const v = values[r.field]
    const sev = r.severity ?? 'block'
    const fail = (dflt: string) => out.push({ ruleId: r.id, field: r.field!, severity: sev, message: r.message || dflt })
    if (r.type === 'notFuture') {
      if (!isBlank(v) && String(v) > ctx.today) fail(`${labelOf(r.field)} cannot be in the future`)
    } else if (r.type === 'compare' && r.compareTo) {
      const rhs = resolveOperand(r.compareTo, ctx)
      if (!isBlank(v) && !isBlank(rhs) && !compare(r.op, v, rhs)) {
        fail(`${labelOf(r.field)} ${OP_WORDS[r.op as Condition['op']] ?? r.op} ${describeOperand(r.compareTo, labelOf)}`)
      }
    } else if (r.type === 'requires' && r.requiresField) {
      if (!isBlank(v) && isBlank(values[r.requiresField])) fail(`Fill ${labelOf(r.requiresField)} before ${labelOf(r.field)}`)
    }
  }
  return out
}
export const isFieldCheck = (r: ValidationRule) => !!r.type && r.type !== 'sum'

// ── C7: reason + remark ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A reason + remark value as `{ reason, remark }`. Older saves stored plain text; that text is read as the remark
 * (or as the reason when it is exactly one of `reasons`), so it is never spread into an object one character per key.
 */
export function normalizeReasonRemark(v: unknown, reasons?: string[]): { reason?: string; remark?: string } {
  if (isBlank(v)) return {}
  if (typeof v === 'string') return reasons?.includes(v) ? { reason: v } : { remark: v }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    // A value corrupted by an earlier save ({ 0: 'D', 1: 'e', … }) is rebuilt from its character keys.
    const chars = Object.keys(o).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
    const rebuilt = chars.length ? chars.map((k) => String(o[k] ?? '')).join('') : ''
    const reason = typeof o.reason === 'string' ? o.reason : undefined
    const remark = typeof o.remark === 'string' ? o.remark : rebuilt || undefined
    return { ...(reason !== undefined ? { reason } : {}), ...(remark !== undefined ? { remark } : {}) }
  }
  return { remark: String(v) }
}

/** Why a mandatory field is not complete (null when it is). Handles reason+remark pairs. */
/** A value as one line of text: a table as "a — b; c — d" (row cells, reserved `_` keys left out), an object by its values. */
export function describeValue(v: unknown): string {
  const obj = (o: Record<string, any>) => Object.entries(o).filter(([k, x]) => !k.startsWith('_') && !isBlank(x)).map(([, x]) => String(x)).join(' — ')
  if (Array.isArray(v)) return v.map((r) => (r && typeof r === 'object' ? obj(r) : String(r))).filter(Boolean).join('; ')
  if (v && typeof v === 'object') return obj(v as Record<string, any>)
  return str(v)
}

/** A table row left completely empty beyond the table's minimum rows (1 by default): it is ignored, never required. */
export function isBlankExtraRow(f: Pick<FieldDefinition, 'minRows'>, r: unknown, index: number): boolean {
  return index >= Math.max(f.minRows ?? 1, 1) && Object.entries((r ?? {}) as Record<string, unknown>).every(([k, x]) => k.startsWith('_') || isBlank(x))
}
export function fieldMissing(f: FieldDefinition, v: unknown, persona?: string): string | null {
  if (f.type === 'reasonRemark') {
    const x = normalizeReasonRemark(v, f.options)
    const cfg = f.reasonRemark
    if ((cfg?.reasonRequired ?? true) && isBlank(x.reason)) return `${f.label}: choose a reason`
    const needRemark = cfg?.remark === 'always' || (cfg?.remark === 'whenOthers' && x.reason === (cfg.othersValue ?? 'Others'))
    if (needRemark && isBlank(x.remark?.trim?.())) return `${f.label}: remark is required`
    return null
  }
  // Rows generated from counts (one per item counted): a count of 0 means no rows and nothing to fill.
  if (f.type === 'table' && f.derivedRows?.from === 'count' && (!Array.isArray(v) || v.length === 0)) return null
  // A mandatory table needs at least one row, and every row its required cells (e.g. a reason row needs its remark).
  if (f.type === 'table' && Array.isArray(v) && v.length > 0 && !f.rowReview) {
    // With a persona, only the required columns that role fills count (a shared table: each role answers for its own columns).
    const fills = (c: NonNullable<FieldDefinition['columns']>[number]) => {
      if (!persona) return true
      const owner = c.enteredBy ?? f.enteredBy
      return owner === persona || (!c.enteredBy && (f.alsoEditableBy ?? []).includes(persona as never))
    }
    const req = (f.columns ?? []).filter((c) => (c.required || c.mandatoryMode === 'always') && fills(c))
    // A completely empty row beyond the minimum (an extra "+ Add row" left blank) is ignored: one row is enough.
    const i = v.findIndex((r, ri) => !isBlankExtraRow(f, r, ri) && req.some((c) => isBlank(r?.[c.key])))
    if (i >= 0) {
      // The row is named by its first text column when it has one (e.g. its category), else by its number.
      const nameCol = (f.columns ?? []).find((c) => c.type === 'text' || c.type === 'dropdown')?.key
      const name = nameCol && !isBlank(v[i]?.[nameCol]) ? String(v[i][nameCol]) : `row ${v[i]?._sl ?? i + 1}`
      return `${f.label} · ${name}: fill ${req.filter((c) => isBlank(v[i]?.[c.key])).map((c) => (c.group ? `${c.group} ${c.label}` : c.label)).join(', ')}`
    }
    return null
  }
  return isBlank(v) ? `${f.label} is required` : null
}

// ── C4: change tracking ─────────────────────────────────────────────────────────────────────────────────────────

export interface FieldChangeEvent {
  field: FieldDefinition
  from: any
  to: any
  roles: PersonaId[]
}
/** Notify-on-change fields whose saved value is replaced by a different one (the first save never counts). */
export function detectNotifyChanges(def: Pick<ActivityDefinition, 'fields'>, before: Record<string, any> | undefined, after: Record<string, any>): FieldChangeEvent[] {
  if (!before) return []
  const out: FieldChangeEvent[] = []
  for (const f of def.fields) {
    if (!f.notifyOnChange) continue
    const a = before[f.key]
    const b = after[f.key]
    if (isBlank(a) || JSON.stringify(a) === JSON.stringify(b)) continue
    out.push({ field: f, from: a, to: b, roles: f.notifyOnChange.roles })
  }
  return out
}
export const toChange = (value: any, by: string, at: string, reason?: string): FieldChange => ({ value, by, at, ...(reason ? { reason } : {}) })

// ── C6: field-group review ──────────────────────────────────────────────────────────────────────────────────────

export function groupFieldKeys(def: Pick<ActivityDefinition, 'fields'>, g: GroupReview): string[] {
  return def.fields.filter((f) => f.section === g.section || g.partialFields?.includes(f.key)).map((f) => f.key)
}
export const groupRejections = (s: GroupReviewState | undefined) => (s?.rounds ?? []).filter((r) => r.decision === 'Reject').length
/** The reviewer may decide; after `escalateAfter` rejections the escalation role may too. */
export function canDecideGroup(g: GroupReview, s: GroupReviewState | undefined, persona: string): boolean {
  if (s?.status !== 'inReview') return false
  if (persona === g.reviewerRole || persona === 'Admin') return true
  return !!g.escalateAfter && !!g.escalateTo && persona === g.escalateTo && groupRejections(s) >= g.escalateAfter
}
export function groupSubmit(prev: GroupReviewState | undefined, snapshot: Record<string, any>, by: string, now: string, partialKeys?: string[], before?: Record<string, any>): GroupReviewState {
  const rounds = prev?.rounds ?? []
  return {
    status: 'inReview',
    escalated: prev?.escalated,
    // Closed cycles of a repeating loop stay with the loop (a new round never drops them).
    ...(prev?.cycles?.length ? { cycles: prev.cycles } : {}),
    rounds: [...rounds, { round: rounds.length + 1, submittedBy: by, submittedAt: now, snapshot, ...(partialKeys?.length ? { partialKeys, before } : {}) }]
  }
}
/** Accept / Reject the open round. A rejected partial change is reverted to the last accepted snapshot. */
export function groupDecide(
  g: GroupReview,
  prev: GroupReviewState,
  decision: 'Accept' | 'Reject',
  by: string,
  now: string,
  comment?: string
): { state: GroupReviewState; restore?: Record<string, any> } {
  const rounds = prev.rounds.slice()
  const last = rounds[rounds.length - 1]
  rounds[rounds.length - 1] = { ...last, decision, decidedBy: by, decidedAt: now, ...(comment ? { comment } : {}) }
  if (decision === 'Accept') return { state: { ...prev, status: 'accepted', rounds } }
  const rejections = rounds.filter((r) => r.decision === 'Reject').length
  const escalated = prev.escalated || (!!g.escalateAfter && rejections >= g.escalateAfter)
  if (last.partialKeys?.length) {
    const restore: Record<string, any> = {}
    for (const k of last.partialKeys) restore[k] = last.before?.[k]
    return { state: { ...prev, status: 'accepted', rounds, escalated }, restore }
  }
  return { state: { ...prev, status: 'rejected', rounds, escalated } }
}

/** Accepted loops whose "run again when" now holds (the save that made it hold starts a new cycle). */
export function groupsToRepeat(def: Pick<ActivityDefinition, 'groupReviews' | 'parameters'>, values: Record<string, any>, extra: RuleExtra): GroupReview[] {
  const ctx = buildRuleCtx(def, values, extra)
  return (def.groupReviews ?? []).filter((g) => g.repeat && extra.groupState?.[g.id]?.status === 'accepted' && evalCondition(g.repeat.when, ctx))
}
/** Closes the loop's cycle (values + rounds kept) and opens a new one with its fields and `repeat.clearFields` empty. */
export function groupRepeat(
  def: Pick<ActivityDefinition, 'fields'>,
  g: GroupReview,
  prev: GroupReviewState,
  values: Record<string, any>,
  by: string,
  now: string
): { state: GroupReviewState; values: Record<string, any>; cleared: string[] } {
  const keys = [...new Set([...groupFieldKeys(def, g), ...(g.repeat?.clearFields ?? [])])]
  const cycles = prev.cycles ?? []
  const closed: GroupCycle = { cycle: cycles.length + 1, values: Object.fromEntries(keys.map((k) => [k, values[k]])), rounds: prev.rounds, closedAt: now, closedBy: by }
  const next = { ...values }
  const cleared = keys.filter((k) => !isBlank(next[k]))
  for (const k of keys) delete next[k]
  return { state: { status: 'filling', rounds: [], cycles: [...cycles, closed] }, values: next, cleared }
}

// ── C8: deviation trigger ───────────────────────────────────────────────────────────────────────────────────────

/** What the deviation still needs (raised answer, E-Doc number, status), or null. Used where the answers are not form fields (pop-up only). */
export function deviationMissing(def: Pick<ActivityDefinition, 'deviation' | 'parameters' | 'fields'>, values: Record<string, any>, extra: RuleExtra = {}): string | null {
  const d = def.deviation
  if (!d || !deviationRequired(def, values, extra)) return null
  if (d.raisedField && isBlank(values[d.raisedField])) return 'Answer “Deviation raised” in the deviation pop-up first.'
  if (d.raisedField && str(values[d.raisedField]) !== 'Y') return null
  if (isBlank(values[d.edocField])) return 'Enter the E-Doc number in the deviation pop-up first.'
  if (d.manualStatus && d.statusField && isBlank(values[d.statusField])) return 'Choose the E-Doc approval status in the deviation pop-up first.'
  return null
}

export function deviationRequired(def: Pick<ActivityDefinition, 'deviation' | 'parameters'>, values: Record<string, any>, extra: RuleExtra = {}): boolean {
  if (!def.deviation) return false
  return evalCondition(def.deviation.when, buildRuleCtx(def, values, extra))
}

// ── C10: one-shot evaluation used by the Live Preview tester ────────────────────────────────────────────────────

export interface LogicSnapshot {
  values: Record<string, any>
  states: Record<string, FieldState>
  violations: FieldViolation[]
  groups: Record<string, string>
  deviation: boolean
}
export function evaluateAll(def: ActivityDefinition, input: Record<string, any>, extra: RuleExtra = {}): LogicSnapshot {
  const full: RuleExtra = { ...extra, groupReviews: def.groupReviews, groupState: extra.groupState, deviation: def.deviation }
  const values = applyCalcFields(def, { ...input }, full)
  const states = evaluateFieldStates(def.fields, values, { ...full, def })
  const vis: Record<string, { visible: boolean }> = {}
  for (const f of def.fields) vis[f.key] = { visible: states[f.key].visible }
  return {
    values,
    states,
    violations: evaluateFieldChecks(def, values, full, vis),
    groups: groupStatusMap(def.groupReviews, extra.groupState),
    deviation: deviationRequired(def, values, full)
  }
}

// ── C6: review loops that hold up the entry ─────────────────────────────────────────────────────────────────────

/**
 * Review loops that are open but not accepted: with the reviewer, rejected, or opened (their condition holds) but not
 * yet submitted. While any is listed, the entry's Submit and Approve are blocked (see openLoopMessage).
 */
export function openReviewLoops(def: Pick<ActivityDefinition, 'groupReviews' | 'parameters'>, values: Record<string, any>, extra: RuleExtra = {}): { group: GroupReview; status: string }[] {
  const groups = def.groupReviews ?? []
  if (groups.length === 0) return []
  const ctx = buildRuleCtx(def, values, { ...extra, groupReviews: groups })
  return groups
    .filter((g) => groupIsOpen(g, groups, extra.groupState, ctx))
    .map((g) => ({ group: g, status: extra.groupState?.[g.id]?.status ?? 'idle' }))
    .filter((x) => x.status !== 'accepted')
}
/**
 * Loops the given role sends to the reviewer with its normal form Submit (GroupReview.separateSubmit off): open, not
 * yet with the reviewer (not started, being filled or rejected), and filled by that role.
 */
export function loopsSentWithForm(def: Pick<ActivityDefinition, 'groupReviews' | 'parameters'>, values: Record<string, any>, extra: RuleExtra = {}, persona?: string): GroupReview[] {
  if (!persona) return []
  return openReviewLoops(def, values, extra)
    .filter((o) => !o.group.separateSubmit && (o.group.fillerRole === persona || persona === 'Admin') && ['idle', 'filling', 'rejected'].includes(o.status))
    .map((o) => o.group)
}
const LOOP_WORDS: Record<string, string> = { idle: 'not submitted yet', filling: 'not submitted yet', inReview: 'waiting for the reviewer', rejected: 'rejected, to be redone' }
/** "Finish the review loop “…” first (with the PIC)." — null when no loop holds up the entry. */
export function openLoopMessage(def: Pick<ActivityDefinition, 'groupReviews' | 'parameters'>, values: Record<string, any>, extra: RuleExtra = {}, persona?: string, forSubmit = false): string | null {
  // A loop this role sends with its own Submit does not hold that Submit up; nor (for Submit) does one already with
  // the reviewer: the form and the loop then wait with the reviewer together, and Approve waits for the loop's Accept.
  const withForm = new Set(loopsSentWithForm(def, values, extra, persona).map((g) => g.id))
  const open = openReviewLoops(def, values, extra).filter((o) => !withForm.has(o.group.id) && !(forSubmit && o.status === 'inReview'))
  if (open.length === 0) return null
  return `Finish the review loop${open.length > 1 ? 's' : ''} first: ${open.map((o) => `“${o.group.label}” (${LOOP_WORDS[o.status] ?? o.status})`).join(', ')}.`
}

// ── C10: saved test scenarios (Builder "Run saved scenarios" and the test suite use the same runner) ────────────

export interface ScenarioResult {
  id: string
  name: string
  pass: boolean
  failures: string[]
  snapshot: LogicSnapshot
}
/**
 * Plays one saved scenario: the input values, then each review loop's rounds (submit → Accept / Reject), then the
 * values entered afterwards, and compares the result with what the scenario expects.
 */
export function runScenario(def: ActivityDefinition, sc: TestScenario, base: RuleExtra = {}): ScenarioResult {
  const extra: RuleExtra = { ...base, mrd: sc.mrd ?? base.mrd, today: sc.today ?? base.today }
  const groupState: Record<string, GroupReviewState> = {}
  let values: Record<string, any> = { ...sc.input }
  const failures: string[] = []
  for (const r of sc.rounds ?? []) {
    const g = def.groupReviews?.find((x) => x.id === r.groupId)
    if (!g) { failures.push(`unknown review loop “${r.groupId}”`); continue }
    r.decisions.forEach((d, i) => {
      const snap = Object.fromEntries(groupFieldKeys(def, g).map((k) => [k, values[k]]))
      let s = groupSubmit(groupState[g.id], snap, g.fillerRole, `r${i}`)
      if (!(r.leaveOpen && i === r.decisions.length - 1)) s = groupDecide(g, s, d, g.reviewerRole, `d${i}`, d === 'Reject' ? 'Rejected in scenario' : undefined).state
      groupState[g.id] = s
    })
  }
  values = { ...applyCalcFields(def, values, { ...extra, groupReviews: def.groupReviews, groupState, deviation: def.deviation }), ...(sc.afterInput ?? {}) }
  // "Run again when …": an accepted loop whose condition now holds starts a new cycle.
  for (const g of groupsToRepeat(def, values, { ...extra, groupReviews: def.groupReviews, groupState })) {
    const r = groupRepeat(def, g, groupState[g.id], values, g.reviewerRole, 'repeat')
    groupState[g.id] = r.state
    values = r.values
  }
  const snapshot = evaluateAll(def, values, { ...extra, groupState })
  const e = sc.expect
  const show = (v: unknown) => (isBlank(v) ? '(blank)' : JSON.stringify(v))
  for (const [k, v] of Object.entries(e.values ?? {})) {
    // "table.column" checks the table's latest row.
    const got = k in snapshot.values || !k.includes('.') ? snapshot.values[k] : lastRowValue(snapshot.values, k)
    const want = v === '' || v === null ? undefined : v
    if (show(got) !== show(want)) failures.push(`${k}: expected ${show(want)}, got ${show(got)}`)
  }
  if (e.deviation !== undefined && snapshot.deviation !== e.deviation) failures.push(`deviation: expected ${e.deviation ? 'required' : 'not required'}`)
  for (const [k, v] of Object.entries(e.groups ?? {})) if (snapshot.groups[k] !== v) failures.push(`loop ${k}: expected ${v}, got ${snapshot.groups[k]}`)
  for (const k of e.visible ?? []) if (!snapshot.states[k]?.visible) failures.push(`${k} should be shown`)
  for (const k of e.hidden ?? []) if (snapshot.states[k]?.visible) failures.push(`${k} should be hidden`)
  for (const k of e.mandatory ?? []) if (!snapshot.states[k]?.mandatory) failures.push(`${k} should be mandatory`)
  for (const k of e.blocked ?? []) if (!snapshot.violations.some((x) => x.field === k && x.severity === 'block')) failures.push(`${k} should be blocked by a check`)
  return { id: sc.id, name: sc.name, pass: failures.length === 0, failures, snapshot }
}

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** Builds the context every evaluator needs from an activity, its entry and the part's dates. */
export function ruleExtra(
  def: Pick<ActivityDefinition, 'groupReviews' | 'deviation' | 'parameters'>,
  entry: Pick<ActivityEntry, 'groupReviews'> | undefined,
  o: { mrd?: string; part?: unknown; plannedStart?: string; plannedEnd?: string; today?: string } = {}
): RuleExtra {
  return {
    mrd: o.mrd,
    part: o.part as Record<string, any> | undefined,
    plannedStart: o.plannedStart,
    plannedEnd: o.plannedEnd,
    today: o.today,
    groupReviews: def.groupReviews,
    groupState: entry?.groupReviews,
    deviation: def.deviation,
    params: Object.fromEntries((def.parameters ?? []).map((p) => [p.key, p.value]))
  }
}

/** Dropdown options of a field: its master list when `optionsFrom` is set, else its own options. */
export function resolveFieldOptions(f: FieldDefinition, lists: MasterList[]): string[] | undefined {
  if (!f.optionsFrom) return f.options
  return lists.find((l) => l.id === f.optionsFrom)?.items ?? f.options
}
/** The activity's fields with master-list options filled in (what the form and preview render). */
export function withMasterLists(fields: FieldDefinition[], lists: MasterList[]): FieldDefinition[] {
  return fields.map((f0) => {
    const f = f0.optionsFrom ? { ...f0, options: resolveFieldOptions(f0, lists) } : f0
    // Dropdown columns of a table can take their options from a master list too.
    if (!f.columns?.some((c) => c.optionsFrom)) return f
    return { ...f, columns: f.columns.map((c) => (c.optionsFrom ? { ...c, options: lists.find((l) => l.id === c.optionsFrom)?.items ?? c.options } : c)) }
  })
}

/**
 * Whether `persona` may type into the field. Calculated fields are read-only (a role override is a separate control);
 * a field is also locked by a `makeReadOnly` rule or an open field-group review. Vendors can normally edit only while the
 * form is a Draft / Sent back, unless the field is `alwaysEditable` or belongs to a field-group review.
 */
export function canEditField(
  f: FieldDefinition,
  persona: string,
  entry: Pick<ActivityEntry, 'validationState'> | undefined,
  state: { readOnly?: boolean; reopened?: boolean } | undefined,
  inGroup = false
): boolean {
  if (f.source === 'calculated' || f.calc || f.pullFrom || f.enteredBy === 'System' || f.hiddenFromForm) return false
  if (state?.readOnly) return false
  if (f.enteredBy !== persona && !(f.alsoEditableBy ?? []).includes(persona as PersonaId)) return false
  if (persona === 'Vendor' && !f.alwaysEditable && !inGroup && !state?.reopened) {
    const s = entry?.validationState ?? 'Draft'
    return s === 'Draft' || s === 'Sent back'
  }
  return true
}


/** Maps an E-Doc system status (e.g. "Accept") onto the field's own option wording (e.g. "Approved"). */
export function edocStatusToOption(status: string | undefined, options: string[] | undefined): string | undefined {
  if (!status) return undefined
  const opts = options ?? []
  if (opts.length === 0 || opts.includes(status)) return status
  const stem = status.toLowerCase().replace(/(ed|ing|e|ance|al)$/g, '')
  const hit = opts.find((o) => o.toLowerCase().startsWith(stem.slice(0, 5)))
  const alias: Record<string, string> = { accept: 'approv', reject: 'reject' }
  return hit ?? opts.find((o) => o.toLowerCase().startsWith(alias[status.toLowerCase()] ?? '\u0000')) ?? status
}

/** Whether the role override of a field is open right now (its condition holds). */
export function overrideAllowed(f: FieldDefinition, values: Record<string, any>, extra: RuleExtra & { def?: Pick<ActivityDefinition, 'parameters'> } = {}): boolean {
  if (!f.override) return false
  // A "stay overridden" value, once set, is final: the role cannot change or clear it.
  if (f.override.sticky && !isBlank(values[`${f.key}__override`])) return false
  return overrideOpenFor(f, values[`${f.key}__system`], buildRuleCtx(extra.def ?? {}, values, extra))
}

