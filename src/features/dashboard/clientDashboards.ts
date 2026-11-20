/**
 * Maps each activity id to the client-provided pixel-perfect HTML dashboard
 * (served from /public/client-dashboards). When an activity has a mapping, its
 * Dashboard view embeds the real client file in an iframe instead of the generic
 * auto-generated widgets. Activities without a mapping fall back to the generic view.
 *
 * The HTML files are the client's own prototypes and run on their own demo data.
 */
// The activity → file table is seed data (src/mock/clientDashboardMap.ts).
import { CLIENT_DASHBOARD_BY_ACTIVITY } from '../../mock/clientDashboardMap'
export { CLIENT_DASHBOARD_BY_ACTIVITY }

/** Returns the public URL of the client dashboard for an activity, or null if none. */
export function clientDashboardUrl(activityId: string): string | null {
  const file = CLIENT_DASHBOARD_BY_ACTIVITY[activityId]
  if (!file) return null
  // import.meta.env.BASE_URL respects the Vite `base` (e.g. '/qa-activity-tracker/' on Pages).
  return `${import.meta.env.BASE_URL}client-dashboards/${file}`
}
