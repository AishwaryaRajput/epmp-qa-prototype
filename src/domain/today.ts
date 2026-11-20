/**
 * The app's one "today". Every rule ("not in the future", RYG, overdue, delay) and the sample data use it.
 * Setting (Settings → "Today's date"): the real calendar date (default), or a fixed date for demos. Stored in this
 * browser only; the page reloads after a change so every screen uses the same value.
 */
export interface TodaySetting {
  mode: 'real' | 'fixed'
  /** YYYY-MM-DD, used when mode is 'fixed'. */
  date?: string
}

const KEY = 'qa-today-setting'
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Today's calendar date in the browser's time zone, as YYYY-MM-DD. */
export function realToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function readTodaySetting(): TodaySetting {
  try {
    const s = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null')
    if (s?.mode === 'fixed' && isDate(s.date)) return { mode: 'fixed', date: s.date }
  } catch {
    // no storage (tests, private mode): real date
  }
  return { mode: 'real' }
}

export function writeTodaySetting(s: TodaySetting): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s.mode === 'fixed' && isDate(s.date) ? s : { mode: 'real' }))
  } catch {
    // ignore
  }
}

/** The date the app treats as today (read once when the app loads). */
export const APP_TODAY: string = (() => {
  const s = readTodaySetting()
  return s.mode === 'fixed' && s.date ? s.date : realToday()
})()
