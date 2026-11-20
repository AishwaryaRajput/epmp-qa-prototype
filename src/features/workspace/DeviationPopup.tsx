import { Icon as FbIcon } from '../../components/Icon'
import { useState } from 'react'
import { fetchFromEdoc } from '../../mock'
import { Button, Modal } from '../../components'

interface DeviationPopupProps {
  partNo: string
  mrd: string
  activityId: string
  initialEdocNumber: string
  /** Title and explanation come from the activity's deviation trigger (config). */
  title?: string
  message?: string
  /** Deviation setting: look up the approval status in E-Doc. Off = only the E-Doc number is entered and saved. */
  fetchStatus?: boolean
  /** Deviation setting "Deviation raised" field: ask Yes / No first; the E-Doc number is needed only for Yes. */
  askRaised?: boolean
  initialRaised?: string
  /** Deviation setting "status picked by hand": the status options to choose from. */
  statusOptions?: string[]
  initialStatus?: string
  onClose: () => void
  onEdocSave: (edocNo: string, deviationStatus?: string, raised?: 'Y' | 'N') => void
}

export function DeviationPopup({
  partNo,
  mrd,
  initialEdocNumber,
  title,
  message,
  fetchStatus = true,
  askRaised = false,
  initialRaised = '',
  statusOptions,
  initialStatus = '',
  onClose,
  onEdocSave,
}: DeviationPopupProps) {
  const [edocNumber, setEdocNumber] = useState(initialEdocNumber)
  const [raised, setRaised] = useState<'' | 'Y' | 'N'>(initialRaised === 'Y' || initialRaised === 'N' ? initialRaised : '')
  const [manual, setManual] = useState(initialStatus)
  const manualOn = !!statusOptions?.length
  const needEdoc = !askRaised || raised === 'Y'
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    deviationStatus?: string
    approvalDate?: string | null
    notes?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFetch() {
    if (!edocNumber.trim()) {
      setError('Please enter an E-Doc number.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    const res = await fetchFromEdoc(edocNumber.trim())
    setLoading(false)

    if (res.success && res.data) {
      setResult(res.data)
    } else {
      setError(res.error ?? 'Failed to fetch E-Doc status.')
    }
  }

  function handleSave() {
    const r = askRaised ? (raised || undefined) : undefined
    if (askRaised && !raised) { setError('Answer "Deviation raised" first.'); return }
    if (askRaised && raised === 'N') { onEdocSave('', undefined, 'N'); return }
    if (!edocNumber.trim()) { setError('Please enter an E-Doc number.'); return }
    if (manualOn) {
      if (!manual && !result?.deviationStatus) { setError('Choose the E-Doc approval status.'); return }
      onEdocSave(edocNumber.trim(), manual || result?.deviationStatus, r)
      return
    }
    if (!fetchStatus) { onEdocSave(edocNumber.trim(), undefined, r); return }
    const status = result?.deviationStatus ?? 'Pending'
    onEdocSave(edocNumber.trim(), status, r)
  }

  const statusColor =
    result?.deviationStatus === 'Accept'
      ? 'text-[#047857] bg-[#ecfdf5] border-[#a7f3d0]'
      : result?.deviationStatus === 'Reject'
      ? 'text-destructive bg-[#fef2f2] border-[#fecaca]'
      : 'text-[#b45309] bg-[#fffbeb] border-[#fde68a]'

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={title ?? 'Deviation required'}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          {(result || !fetchStatus || manualOn || (askRaised && raised === 'N')) && (
            <Button variant="primary" size="sm" onClick={handleSave}>{askRaised && raised === 'N' ? 'Save' : fetchStatus || manualOn ? 'Save deviation' : 'Save E-Doc number'}</Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Explanation */}
        <div className="bg-[#fffbeb] border border-[#fde68a] rounded-lg px-4 py-3 text-sm text-[#92400e]">
          <p className="font-medium mb-1"><FbIcon name="exclamation-circle" size={14} className="mr-1" />{title ?? 'Deviation required'}</p>
          <p className="text-xs">
            Part <strong>{partNo}</strong>{mrd ? <> · MRD {mrd}</> : null}. {message ?? 'A deviation E-Doc is required. Enter the E-Doc tracking number below to fetch the approval status.'}
          </p>
        </div>

        {askRaised && (
          <div>
            <span className="text-xs font-medium text-[var(--color-muted)] block mb-1">Deviation raised</span>
            <div className="inline-flex rounded-md border border-[var(--color-border)] p-0.5" role="group" aria-label="Deviation raised">
              {(['Y', 'N'] as const).map((o) => (
                <button key={o} type="button" onClick={() => { setRaised(o); setError(null) }}
                  className={`px-3 py-1 text-xs font-semibold rounded ${raised === o ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text)]'}`}>
                  {o === 'Y' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
            {raised === 'N' && <p className="mt-1 text-xs text-[var(--color-muted)]">No E-Doc number is needed.</p>}
          </div>
        )}

        {/* E-Doc number input */}
        {needEdoc && <div>
          <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">
            E-Doc tracking number
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={edocNumber}
              onChange={(e) => { setEdocNumber(e.target.value); setError(null) }}
              placeholder="e.g. EDOC-2026-1234"
              className="flex-1 border border-[var(--color-border)] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            {fetchStatus && <Button
              variant="secondary"
              size="sm"
              onClick={handleFetch}
              disabled={loading}
            >
              <><FbIcon name="refresh" size={14} className="mr-1" />{loading ? 'Fetching…' : 'Fetch status'}</>
            </Button>}
          </div>
        </div>}
        {needEdoc && manualOn && (
          <div>
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1" htmlFor="dev-status">E-Doc approval status</label>
            <select id="dev-status" value={manual} onChange={(e) => { setManual(e.target.value); setError(null) }}
              className="w-56 border border-[var(--color-border)] rounded px-2 py-1.5 text-sm">
              <option value="">Select…</option>
              {statusOptions!.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}

        {/* Result */}
        {result && (
          <div className={`border rounded-lg px-4 py-3 text-sm ${statusColor}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">Deviation status</span>
              <span className={`font-bold text-base`}>{result.deviationStatus}</span>
            </div>
            {result.approvalDate && (
              <p className="text-xs">Approval date: {result.approvalDate}</p>
            )}
            {result.notes && (
              <p className="text-xs mt-1 opacity-80">{result.notes}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
