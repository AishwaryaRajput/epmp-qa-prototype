/**
 * Small helpers that build rule CONFIG (plain data). Used by the Builder, the C9 stage macro and the seed data, so
 * every rule is the same JSON the Builder UI edits. No logic lives here.
 */
import type { CalcValue, Condition, ConditionNode, ConditionOp, Operand } from './index'

export const F = (key: string, attr?: 'value' | 'isOverridden' | 'overrideValue' | 'systemValue'): Operand => ({ kind: 'field', key, ...(attr ? { attr } : {}) })
export const K = (value: string | number | boolean): Operand => ({ kind: 'const', value })
export const TODAY: Operand = { kind: 'today' }
export const MRD: Operand = { kind: 'mrd' }
export const PLANNED_END: Operand = { kind: 'plannedEnd' }
export const OFFSET = (base: Operand, days: number | { param: string; negate?: boolean }): Operand => ({ kind: 'offset', base, days })
export const PARAM = (key: string): Operand => ({ kind: 'param', key })

const c = (op: ConditionOp) => (left: Operand, right?: Operand): Condition => ({ left, op, ...(right ? { right } : {}) })
export const filled = (left: Operand) => c('filled')(left)
export const blank = (left: Operand) => c('blank')(left)
export const eq = c('=')
export const ne = c('!=')
export const gt = c('>')
export const lt = c('<')
export const ge = c('>=')
export const le = c('<=')
export const oneOf = (left: Operand, list: string[]): Condition => ({ left, op: 'oneOf', list })
export const anyRow = (table: string, cond: Condition): Condition => ({ ...cond, anyRowOf: table })
export const AND = (...items: ConditionNode[]): ConditionNode => ({ op: 'AND', items })
export const OR = (...items: ConditionNode[]): ConditionNode => ({ op: 'OR', items })

export const val = (value: string | number | boolean): CalcValue => ({ kind: 'const', value })
export const operandVal = (operand: Operand): CalcValue => ({ kind: 'operand', operand })
