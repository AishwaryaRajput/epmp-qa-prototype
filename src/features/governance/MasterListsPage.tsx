import { useMemo, useState } from 'react'
import { useQAStore } from '../../store/qaStore'
import { Button } from '../../components'

const field = 'rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm'

/** Governance: reusable lists of choices (e.g. Delay reasons) that Builder dropdowns and Reason + remark fields draw from. */
export function MasterListsPage() {
  const { masterLists, saveMasterList, deleteMasterList, activities } = useQAStore()
  // Which fields use each list (dropdown options, or the reason list of a reason + remark field).
  const usage = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const a of activities) for (const f of a.fields) {
      for (const id of [f.optionsFrom, f.reasonRemark?.listId]) if (id) m.set(id, [...(m.get(id) ?? []), `${a.name} → ${f.label}`])
    }
    return m
  }, [activities])
  const [newName, setNewName] = useState('')
  const [newItem, setNewItem] = useState<Record<string, string>>({})

  const addList = () => {
    const name = newName.trim()
    if (!name) return
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `list-${Date.now().toString(36)}`
    if (masterLists.some((l) => l.id === id)) return
    saveMasterList({ id, name, items: [] })
    setNewName('')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Master lists</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Lists of choices shared by activities, for example “Delay reasons”. Change a list here and every dropdown that uses it follows. Existing answers are kept.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addList()} placeholder="New list name, e.g. Delay reasons" className={`${field} w-72`} aria-label="New list name" />
        <Button variant="primary" size="sm" disabled={!newName.trim()} onClick={addList}>+ Add list</Button>
      </div>

      {masterLists.length === 0 && <p className="text-sm italic text-[var(--color-muted)]">No lists yet.</p>}
      {masterLists.map((l) => (
        <section key={l.id} className="rounded-lg border border-[var(--color-border)] bg-white p-4" aria-label={l.name}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <input value={l.name} onChange={(e) => saveMasterList({ ...l, name: e.target.value })} className={`${field} w-72 font-medium`} aria-label="List name" />
            {l.placeholder && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800" title="These items are placeholders until the business confirms the real list">Placeholder</span>}
            <label className="ml-auto flex items-center gap-1 text-xs text-[var(--color-muted)]">
              <input type="checkbox" checked={!!l.placeholder} onChange={(e) => saveMasterList({ ...l, placeholder: e.target.checked || undefined })} aria-label={`${l.name} is a placeholder list`} /> Placeholder
            </label>
            <button
              type="button"
              disabled={(usage.get(l.id)?.length ?? 0) > 0}
              title={(usage.get(l.id)?.length ?? 0) > 0 ? 'In use: remove it from the fields first' : 'Delete this list'}
              onClick={() => deleteMasterList(l.id)}
              className="text-xs text-[var(--color-destructive)] hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
            >Delete list</button>
          </div>
          {(usage.get(l.id)?.length ?? 0) > 0 && (
            <p className="mb-2 text-[11px] text-[var(--color-muted)]">Used by: {usage.get(l.id)!.join('; ')}. It cannot be deleted while a field uses it.</p>
          )}
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {l.items.map((it, i) => (
              <li key={`${it}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-0.5 text-xs">
                {it}
                <button type="button" aria-label={`Remove ${it}`} onClick={() => saveMasterList({ ...l, items: l.items.filter((_, j) => j !== i) })} className="text-[var(--color-destructive)]">×</button>
              </li>
            ))}
            {l.items.length === 0 && <li className="text-xs italic text-[var(--color-muted)]">No items yet.</li>}
          </ul>
          <div className="flex items-center gap-2">
            <input
              value={newItem[l.id] ?? ''}
              onChange={(e) => setNewItem((s) => ({ ...s, [l.id]: e.target.value }))}
              onKeyDown={(e) => {
                const v = (newItem[l.id] ?? '').trim()
                if (e.key === 'Enter' && v && !l.items.includes(v)) {
                  saveMasterList({ ...l, items: [...l.items, v] })
                  setNewItem((s) => ({ ...s, [l.id]: '' }))
                }
              }}
              placeholder="Add an item and press Enter"
              className={`${field} w-72`}
              aria-label="New item"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!(newItem[l.id] ?? '').trim() || l.items.includes((newItem[l.id] ?? '').trim())}
              onClick={() => {
                saveMasterList({ ...l, items: [...l.items, (newItem[l.id] ?? '').trim()] })
                setNewItem((s) => ({ ...s, [l.id]: '' }))
              }}
            >
              Add item
            </Button>
          </div>
        </section>
      ))}
    </div>
  )
}
