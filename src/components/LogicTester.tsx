/**
 * C10 · Logic tester. The Admin types sample values (and a sample MRD / today) and sees what the rules would do:
 * calculated values, which fields show / are mandatory / read-only, validation messages, review state and whether
 * a deviation is required. Nothing is saved; it calls the same engine the workspace uses (`evaluateAll`).
 */
import { useMemo, useState } from 'react'
import type { BuilderDraft, GroupReviewState, TestScenario } from '../domain'
import { evaluateAll, withMasterLists, RULE_TODAY, runScenario } from '../engine'
import type { ScenarioResult } from '../engine'
import { useQAStore } from '../store/qaStore'

const box = 'rounded border border-[var(--color-border)] bg-white px-1.5 py-1 text-xs'
const STATUSES = ['idle', 'filling', 'inReview', 'accepted', 'rejected'] as const

export function LogicTester({ draft, onSaveScenarios }: { draft: BuilderDraft; /** Stores the saved scenarios on the activity. */ onSaveScenarios?: (s: TestScenario[]) => void }) {
  const lists = useQAStore((s) => s.masterLists)
  const fields = useMemo(() => withMasterLists(draft.fields, lists), [draft.fields, lists])
  const [mrd, setMrd] = useState('2026-12-01')
  const [today, setToday] = useState(RULE_TODAY)
  const [input, setInput] = useState<Record<string, any>>({})
  const [groups, setGroups] = useState<Record<string, string>>({})
  const [results, setResults] = useState<ScenarioResult[] | null>(null)
  const scenarios = draft.testScenarios ?? []
  const runAll = () => setResults(scenarios.map((sc) => runScenario({ ...draft, fields }, sc, { mrd, today })))
  const [scName, setScName] = useState('')

  const groupState: Record<string, GroupReviewState> = {}
  for (const [id, st] of Object.entries(groups)) if (st && st !== 'idle') groupState[id] = { status: st as GroupReviewState['status'], rounds: [] }

  const snap = useMemo(
    () => evaluateAll({ ...draft, fields }, input, { mrd, today, groupState }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, fields, input, mrd, today, groups]
  )
  const set = (key: string, v: any) => setInput((p) => ({ ...p, [key]: v === '' ? undefined : v }))
  const show = (v: any) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

  // Save what is typed now as a scenario: its inputs, plus what the rules give now (calculated values, shown / hidden /
  // mandatory fields, deviation) as the expected result. Re-running it later flags any rule change that alters this.
  const saveScenario = () => {
    if (!onSaveScenarios || !scName.trim()) return
    const calcKeys = fields.filter((f) => f.calc || f.source === 'calculated').map((f) => f.key)
    const keys = fields.map((f) => f.key)
    const sc: TestScenario = {
      id: `sc-${Date.now().toString(36)}`,
      name: scName.trim(),
      input: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      mrd,
      today,
      expect: {
        values: Object.fromEntries(calcKeys.filter((k) => snap.values[k] !== undefined).map((k) => [k, snap.values[k]])),
        deviation: snap.deviation,
        visible: keys.filter((k) => snap.states[k]?.visible),
        hidden: keys.filter((k) => snap.states[k] && !snap.states[k].visible),
        mandatory: keys.filter((k) => snap.states[k]?.visible && snap.states[k]?.mandatory)
      }
    }
    onSaveScenarios([...scenarios, sc])
    setScName('')
  }

  const editable = fields.filter((f) => !f.calc && f.type !== 'table' && f.type !== 'pivotSummary' && f.type !== 'derived' && f.type !== 'button' && f.type !== 'file')
  return (
    <div className="space-y-4 text-xs">
      <p className="text-[var(--color-muted)]">Try sample values. Dates are YYYY-MM-DD. Save a case as a scenario to re-check it after every rule change.</p>
      {onSaveScenarios && (
        <div className="flex items-center gap-1.5">
          <input value={scName} onChange={(e) => setScName(e.target.value)} placeholder="Scenario name, e.g. Actual after MRD → Non-OT" className={`${box} flex-1`} aria-label="Scenario name" />
          <button type="button" onClick={saveScenario} disabled={!scName.trim()} className="rounded border border-[var(--color-border)] bg-white px-2 py-1 font-medium hover:bg-[var(--color-surface)] disabled:opacity-50">Save as scenario</button>
        </div>
      )}

      {scenarios.length > 0 && (
        <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5" data-testid="saved-scenarios">
          <div className="flex items-center justify-between">
            <span className="font-medium">Saved scenarios ({scenarios.length})</span>
            <button type="button" onClick={runAll} className="rounded border border-[var(--color-border)] bg-white px-2 py-1 font-medium hover:bg-[var(--color-surface)]">Run saved scenarios</button>
          </div>
          {results && (
            <>
              <div className={results.every((r) => r.pass) ? 'text-[#15803d]' : 'text-[var(--color-destructive)]'}>
                {results.filter((r) => r.pass).length} of {results.length} passed
              </div>
              <ul className="space-y-0.5">
                {results.map((r) => (
                  <li key={r.id}>
                    <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.pass ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#fee2e2] text-[#991b1b]'}`}>{r.pass ? 'PASS' : 'FAIL'}</span>
                    {r.name}
                    {onSaveScenarios && <button type="button" onClick={() => { onSaveScenarios(scenarios.filter((s) => s.id !== r.id)); setResults(null) }} className="ml-2 text-[11px] text-[var(--color-destructive)] hover:underline">delete</button>}
                    {!r.pass && <div className="pl-12 text-[11px] text-[var(--color-destructive)]">{r.failures.join(' · ')}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5"><span className="block font-medium">Sample MRD</span><input type="date" value={mrd} onChange={(e) => setMrd(e.target.value)} className={`${box} w-full`} /></label>
        <label className="space-y-0.5"><span className="block font-medium">Sample “today”</span><input type="date" value={today} onChange={(e) => setToday(e.target.value)} className={`${box} w-full`} /></label>
      </div>

      {(draft.groupReviews ?? []).length > 0 && (
        <div className="space-y-1">
          <div className="font-medium">Review loops</div>
          {(draft.groupReviews ?? []).map((g) => (
            <label key={g.id} className="flex items-center gap-2">
              <span className="w-40 truncate">{g.label}</span>
              <select value={groups[g.id] ?? 'idle'} onChange={(e) => setGroups((p) => ({ ...p, [g.id]: e.target.value }))} className={box} aria-label={`${g.label} status`}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="font-medium">Sample answers</div>
        {editable.map((f) => {
          const st = snap.states[f.key]
          const v = input[f.key]
          return (
            <label key={f.key} className={`flex items-center gap-2 ${st?.visible === false ? 'opacity-40' : ''}`}>
              <span className="w-44 shrink-0 truncate" title={f.label}>{f.label || f.key}{st?.mandatory && ' *'}</span>
              {f.type === 'date' ? (
                <input type="date" value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} className={`${box} flex-1`} aria-label={f.label} />
              ) : f.type === 'dropdown' ? (
                <select value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} className={`${box} flex-1`} aria-label={f.label}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === 'yesNo' ? (
                <select value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} className={`${box} flex-1`} aria-label={f.label}>
                  <option value="">—</option><option value="Y">Yes</option><option value="N">No</option>
                </select>
              ) : f.type === 'reasonRemark' ? (
                <span className="flex flex-1 gap-1">
                  <select value={v?.reason ?? ''} onChange={(e) => set(f.key, { ...(v ?? {}), reason: e.target.value })} className={`${box} flex-1`} aria-label={`${f.label} reason`}>
                    <option value="">reason…</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input value={v?.remark ?? ''} onChange={(e) => set(f.key, { ...(v ?? {}), remark: e.target.value })} placeholder="remark" className={`${box} flex-1`} aria-label={`${f.label} remark`} />
                </span>
              ) : (
                <input type={f.type === 'number' || f.type === 'percent' ? 'number' : 'text'} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} className={`${box} flex-1`} aria-label={f.label} />
              )}
            </label>
          )
        })}
        {fields.filter((f) => f.override && f.calc).map((f) => (
          <label key={`${f.key}-ov`} className="flex items-center gap-2">
            <span className="w-44 shrink-0 truncate">Override: {f.label}</span>
            <select value={input[`${f.key}__override`] ?? ''} onChange={(e) => set(`${f.key}__override`, e.target.value)} className={`${box} flex-1`} aria-label={`Override ${f.label}`}>
              <option value="">no override</option>
              {(f.override?.options ?? f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>

      <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
        <div className="font-medium">Result</div>
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-[var(--color-muted)]"><th className="py-0.5">Field</th><th>Value</th><th>Shown</th><th>Mandatory</th><th>Read-only</th></tr></thead>
          <tbody>
            {fields.map((f) => {
              const st = snap.states[f.key]
              return (
                <tr key={f.key} className="border-t border-[var(--color-border)]">
                  <td className="py-0.5 pr-2">{f.label || f.key}{f.calc && <em className="ml-1 text-[var(--color-muted)]">(calculated)</em>}</td>
                  <td className="pr-2 font-medium">{show(snap.values[f.key])}</td>
                  <td>{st?.visible ? 'yes' : 'no'}</td>
                  <td>{st?.mandatory ? 'yes' : '—'}</td>
                  <td>{st?.readOnly || f.calc ? 'yes' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div>
          <span className="font-medium">Checks: </span>
          {snap.violations.length === 0 ? <span className="text-[var(--color-success,#15803d)]">all pass</span> : (
            <ul className="mt-0.5 list-disc pl-4">
              {snap.violations.map((v) => <li key={v.ruleId} className={v.severity === 'warn' ? 'text-[#92400e]' : 'text-[var(--color-destructive)]'}>{v.severity === 'warn' ? 'Warning: ' : 'Blocked: '}{v.message}</li>)}
            </ul>
          )}
        </div>
        {(draft.groupReviews ?? []).length > 0 && (
          <div><span className="font-medium">Review loops: </span>{(draft.groupReviews ?? []).map((g) => `${g.label} — ${snap.groups[g.id]}`).join('; ')}</div>
        )}
        <div><span className="font-medium">Deviation required: </span>{draft.deviation ? (snap.deviation ? 'YES — an E-Doc number is needed' : 'no') : 'not configured'}</div>
      </div>
    </div>
  )
}
