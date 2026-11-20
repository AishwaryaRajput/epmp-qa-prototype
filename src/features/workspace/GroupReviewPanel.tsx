import { useState } from 'react'
import type { ActivityDefinition, ActivityEntry, FieldDefinition, GroupCycle, GroupReview, PartRecord } from '../../domain'
import { fmtDate } from '../scope'
import { useQAStore } from '../../store/qaStore'
import { Button } from '../../components'
import { canDecideGroup, fieldMissing, groupCheckIssues, groupFieldKeys, groupRejections } from '../../engine'
import type { RuleExtra } from '../../engine'

interface Props {
  g: GroupReview
  activity: ActivityDefinition
  entry: ActivityEntry | undefined
  templateRowId: string
  partNo: string
  persona: string
  localValues: Record<string, any>
  conditionalState: Record<string, { visible: boolean; mandatory: boolean; readOnly: boolean }>
  /** Saves the form values to the entry (the review reads the saved values). */
  saveValues: (values: Record<string, any>) => boolean | void
  /** Needed to run the blocking field checks of the loop's fields before Submit / Resubmit. */
  part?: PartRecord
  extra?: RuleExtra
}

const CHIP: Record<string, string> = {
  idle: 'bg-slate-100 text-slate-700',
  filling: 'bg-slate-100 text-slate-700',
  inReview: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800'
}
const LABEL: Record<string, string> = { idle: 'Not started', filling: 'Being filled', inReview: 'With reviewer', accepted: 'Accepted', rejected: 'Rejected, to be redone' }

const show = (f: FieldDefinition | undefined, v: any): string => {
  if (v === undefined || v === null || v === '') return '—'
  if (f?.type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(String(v))
  if (f?.type === 'yesNo') return v === 'Y' ? 'Yes' : v === 'N' ? 'No' : String(v)
  return String(v)
}
/** A closed cycle of a repeating loop, read-only: its tables and values as they were when the cycle closed. */
function CycleView({ c, activity }: { c: GroupCycle; activity: ActivityDefinition }) {
  const fields = activity.fields.filter((f) => f.key in c.values)
  const tables = fields.filter((f) => f.type === 'table' && Array.isArray(c.values[f.key]) && c.values[f.key].length)
  const plain = fields.filter((f) => f.type !== 'table' && c.values[f.key] !== undefined && c.values[f.key] !== '')
  return (
    <div className="rounded border border-[var(--color-border)] bg-slate-50 p-2" data-testid={`cycle-${c.cycle}`}>
      <p className="font-semibold text-[var(--color-text)]">Cycle {c.cycle}</p>
      {tables.map((f) => {
        const cols = (f.columns ?? []).filter((col) => c.values[f.key].some((r: any) => r?.[col.key] !== undefined && r?.[col.key] !== ''))
        return (
          <table key={f.key} className="mt-1 w-full text-left">
            <thead><tr className="text-[var(--color-muted)]">{cols.map((col) => <th key={col.key} className="pr-2 font-medium">{col.label}</th>)}</tr></thead>
            <tbody>{c.values[f.key].map((r: any, i: number) => <tr key={i}>{cols.map((col) => <td key={col.key} className="pr-2 align-top">{show(col.type === 'date' ? ({ type: 'date' } as FieldDefinition) : undefined, r?.[col.key])}</td>)}</tr>)}</tbody>
          </table>
        )
      })}
      {plain.length > 0 && <p className="mt-1">{plain.map((f) => `${f.label}: ${show(f, c.values[f.key])}`).join(' · ')}</p>}
    </div>
  )
}

/** Generic Accept / Reject loop for one field group (C6). Everything it shows comes from the GroupReview config. */
export function GroupReviewPanel({ g, activity, entry, templateRowId, partNo, persona, localValues, conditionalState, saveValues, part, extra }: Props) {
  const { submitGroup, decideGroup } = useQAStore()
  const [comment, setComment] = useState('')
  const [err, setErr] = useState('')
  const st = entry?.groupReviews?.[g.id]
  const status = st?.status ?? 'idle'
  const isFiller = persona === g.fillerRole || persona === 'Admin'
  const keys = groupFieldKeys(activity, g)
  // Every field of the loop counts, including partial-review fields that live in another section.
  const own = activity.fields.filter((f) => keys.includes(f.key))
  const mandatoryMissing = own
    .filter((f) => conditionalState[f.key]?.visible && conditionalState[f.key]?.mandatory)
    .map((f) => fieldMissing(f, localValues[f.key]))
    .filter(Boolean) as string[]
  // Blocking field checks (e.g. a date that must not pass the MRD) stop Submit / Resubmit too.
  const checkMessages = extra ? groupCheckIssues(activity, g, localValues, part, extra).map((i) => i.message) : []
  const missing = [...mandatoryMissing, ...checkMessages]
  const nextLoop = g.onAccept?.openGroupId ? activity.groupReviews?.find((x) => x.id === g.onAccept!.openGroupId) : undefined
  const savedValues = entry?.values ?? {}
  const changedPartial = status === 'accepted' ? (g.partialFields ?? []).filter((k) => JSON.stringify(localValues[k] ?? null) !== JSON.stringify(savedValues[k] ?? null)) : []
  const canStart = isFiller && (status === 'idle' || status === 'filling' || status === 'rejected')
  const lastReject = [...(st?.rounds ?? [])].reverse().find((r) => r.decision === 'Reject')
  const rejections = groupRejections(st)

  function submit() {
    if (saveValues(localValues) === false) return
    submitGroup(templateRowId, partNo, g.id, persona as any)
  }
  function sendPartial() {
    if (saveValues(localValues) === false) return
    submitGroup(templateRowId, partNo, g.id, persona as any, changedPartial, Object.fromEntries(changedPartial.map((k) => [k, savedValues[k]])))
  }
  function decide(d: 'Accept' | 'Reject') {
    const e = decideGroup(templateRowId, partNo, g.id, d, persona as any, comment)
    setErr(e ?? '')
    if (!e) setComment('')
  }

  return (
    <div className="my-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs" data-testid={`group-${g.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[var(--color-text)]">{g.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP[status]}`}>{LABEL[status]}</span>
        {(st?.cycles?.length ?? 0) > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">Cycle {st!.cycles!.length + 1}</span>}
        <span className="text-[var(--color-muted)]">{g.fillerRole} fills · {g.reviewerRole} reviews{rejections > 0 ? ` · rejected ${rejections}×` : ''}</span>
      </div>
      {(st?.cycles?.length ?? 0) > 0 && (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-[var(--color-muted)]">Earlier cycles ({st!.cycles!.length})</summary>
          <div className="mt-1 space-y-1.5">{st!.cycles!.map((c) => <CycleView key={c.cycle} c={c} activity={activity} />)}</div>
        </details>
      )}
      {status === 'rejected' && lastReject?.comment && (
        <p className="mt-1.5 rounded bg-[#fffbeb] px-2 py-1 text-[#92400e]">Sent back by {lastReject.decidedBy}: {lastReject.comment}</p>
      )}
      {canStart && !g.separateSubmit && (
        <div className="mt-1.5 space-y-1">
          <p className="text-[var(--color-muted)]">
            {status === 'rejected' ? 'Correct the fields below;' : 'Fill the fields below;'} they go to {g.reviewerRole} when you {entry && entry.validationState !== 'Draft' && entry.validationState !== 'Sent back' ? 'save' : 'submit'} the form.
          </p>
          {missing.length > 0 && <p className="font-medium text-rose-600">{missing.join('; ')}</p>}
        </div>
      )}
      {canStart && g.separateSubmit && (
        <div className="mt-2 space-y-1">
          <Button variant="primary" size="sm" disabled={missing.length > 0} onClick={submit}>
            {status === 'rejected' ? `Resubmit to ${g.reviewerRole}` : `Submit to ${g.reviewerRole} for review`}
          </Button>
          {missing.length > 0 && <p className="font-medium text-rose-600">{missing.join('; ')}</p>}
        </div>
      )}
      {changedPartial.length > 0 && isFiller && (
        <div className="mt-2">
          <Button variant="secondary" size="sm" onClick={sendPartial}>Send changed {changedPartial.length === 1 ? 'field' : 'fields'} to {g.reviewerRole} for review</Button>
        </div>
      )}
      {status === 'accepted' && nextLoop && (
        <p className="mt-1.5 text-[var(--color-muted)]">Next: {nextLoop.label} ({nextLoop.fillerRole} fills).</p>
      )}
      {status === 'accepted' && (g.onAccept?.reopenFields?.length ?? 0) > 0 && (
        <p className="mt-1.5 text-[var(--color-muted)]">Re-opened for {g.fillerRole}: {g.onAccept!.reopenFields!.map((k) => activity.fields.find((f) => f.key === k)?.label ?? k).join(', ')}.</p>
      )}
      {status === 'inReview' && !canDecideGroup(g, st, persona) && <p className="mt-1.5 text-[var(--color-muted)]">Waiting for {g.reviewerRole} to accept or reject.</p>}
      {canDecideGroup(g, st, persona) && (
        <div className="mt-2 space-y-1.5">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={g.rejectCommentRequired ? 'Comment (required to reject)' : 'Comment (optional)'}
            className="w-full rounded border border-[var(--color-border)] bg-white px-2 py-1"
            aria-label="Review comment"
          />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => decide('Accept')}>Accept</Button>
            <Button variant="danger" size="sm" onClick={() => decide('Reject')}>Reject</Button>
          </div>
          {err && <p className="font-medium text-rose-600">{err}</p>}
        </div>
      )}
      {(st?.rounds.length ?? 0) > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[var(--color-muted)]">Review history ({st!.rounds.length} round{st!.rounds.length === 1 ? '' : 's'})</summary>
          <ul className="mt-1 space-y-0.5">
            {st!.rounds.map((r) => (
              <li key={r.round}>
                Round {r.round}{r.partialKeys ? ' (partial)' : ''}: submitted by {r.submittedBy} → {r.decision ? `${r.decision}ed by ${r.decidedBy}${r.comment ? ` — “${r.comment}”` : ''}` : 'awaiting decision'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
