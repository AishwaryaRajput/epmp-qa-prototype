const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A stored ISO date (yyyy-mm-dd) as the app shows dates elsewhere: "30 Nov 2026". Anything else is returned as is. */
export function showDate(v: unknown): any {
  if (typeof v !== 'string') return v
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}` : v
}
