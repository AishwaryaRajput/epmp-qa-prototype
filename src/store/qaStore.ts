import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ActivityDefinition,
  ActivityEntry,
  DashboardConfig,
  BuilderDraft,
  Widget,
  ModelRecord,
  Section,
  MilestoneDef,
  TemplateRow,
  PicAssignment,
  PartRecord,
  PartEvent,
  PartRelease,
  PartAck,
  DelayReason,
  VendorTimeline,
  VendorInfo,
  VendorVisit,
  Action,
  ActionStatus,
  Deviation,
  CrossActivityDashboard,
  ActivityDependency,
  ActivityDocument,
  AuditEntry,
  HistoryTransferRequest,
  ProjectArchetype,
  MasterList,
  AppNotification,
} from '../domain'
import type { PersonaId } from './personaStore'
import { makeEntryId, makeTemplateRowId, DELAY_REASON_OTHERS } from '../domain'
import { syncArchetype } from '../domain/governance'
import { putBlob, deleteBlob, clearBlobs } from './docBlobs'
import { startReview } from '../engine/rowReview'
import { detectNotifyChanges, toChange, groupSubmit, groupDecide, canDecideGroup, groupFieldKeys, groupsToRepeat, groupRepeat, rowsToStart, ruleExtra, deviationRequired, overrideEvents, overrideNotices, fieldMissing, openLoopMessage } from '../engine/rules'
import { evaluateRules } from '../engine/saveRules'
import { validateSave, issuesForTouched } from '../engine/saveRules'
import type { SaveIssue } from '../engine/saveRules'
import { migrateStore, STORE_VERSION } from './migrate'
import { SEED_MASTER_LISTS } from '../mock/ppRuleConfig'
import { DEMO_TODAY, canMarkNotApplicable, canReverseNotApplicable } from '../features/scope'
import {
  SEED_ACTIVITIES,
  SEED_ENTRIES,
  SEED_MODELS,
  SEED_SECTIONS,
  SEED_MILESTONES,
  SEED_TEMPLATE_ROWS,
  SEED_PIC_ASSIGNMENTS,
  SEED_PART_EVENTS,
  SEED_PART_RELEASES,
  SEED_PART_ACKS,
  SEED_DELAY_REASONS,
  SEED_VENDOR_INFO,
  SEED_VENDOR_VISITS,
  MOCK_PART_LIST,
  SEED_ARCHETYPES,
} from '../mock'
import { deriveTechnicalCategory } from '../domain/timelineCatalog'
import { buildDemoData } from '../mock/demoParts'
import {
  evaluateCalculatedFields,
  getMilestoneMrd,
  ruleContext,
  getPicOn,
  getReleaseState,
  transitionEntry,
  generateDashboardConfig,
  generateOverviewDashboardConfig
} from '../engine'

interface QAStoreState {
  /** Governance: reusable lists of choices (e.g. Delay reasons) that dropdown fields take their options from. */
  masterLists: MasterList[]
  saveMasterList: (list: MasterList) => void
  deleteMasterList: (id: string) => void
  /** In-app notifications pushed when a notify-on-change field changes. */
  notifications: AppNotification[]
  /** Entry-level actions of the generic field-group review loop (C6). */
  submitGroup: (templateRowId: string, partNo: string, groupId: string, persona: PersonaId, partialKeys?: string[], before?: Record<string, any>) => void
  decideGroup: (templateRowId: string, partNo: string, groupId: string, decision: 'Accept' | 'Reject', persona: PersonaId, comment?: string) => string | undefined
  /** Blocking problems of a save (field checks, sum rules, change reason, override remark) — the same step every save path and the store guard use. */
  checkSave: (templateRowId: string, partNo: string, newValues: Record<string, any>, persona: string, opts?: { mandatory?: boolean; touchedOnly?: boolean }) => SaveIssue[]
  /** Checks, then saves. Returns the blocking issues; an empty list means it was saved. Every screen that saves values uses this. */
  saveChecked: (templateRowId: string, partNo: string, newValues: Record<string, any>, persona: string) => SaveIssue[]
  /** Raises the activity's configured E-Doc deviation (C8) once, when its trigger holds. */
  raiseConfiguredDeviation: (templateRowId: string, partNo: string, edocNumber: string, persona: PersonaId) => void
  activities: ActivityDefinition[]
  entries: ActivityEntry[]
  dashboards: DashboardConfig[]

  /**
   * The live part master. Seeded from MOCK_PART_LIST (simulated SAP/ENOVIA ingest) and then
   * extended at runtime with manual/dummy parts and ECN transfers. Read this, not MOCK_PART_LIST.
   */
  parts: PartRecord[]
  /** Append-only audit of part-identity events (manual creation, ECN transfer). */
  partEvents: PartEvent[]
  /** Documents attached to a part's activity entry (file content lives in IndexedDB). */
  documents: ActivityDocument[]
  /** Append-only audit log of uploads, deletions, downloads and bulk Excel loads. */
  auditLog: AuditEntry[]

  /** Vendor master: location per vendor (for manpower planning's location-based coverage). */
  vendorInfo: VendorInfo[]
  /** Planned/logged PIC vendor visits. */
  vendorVisits: VendorVisit[]
  /** Schedule a PIC visit to a vendor. */
  addVendorVisit: (visit: Omit<VendorVisit, 'id' | 'createdAt'>) => void
  /** Change a visit's status (Planned → Done / Cancelled) or edit its fields. */
  updateVendorVisit: (id: string, patch: Partial<Omit<VendorVisit, 'id' | 'createdAt' | 'createdBy'>>) => void
  deleteVendorVisit: (id: string) => void

  /** User-built cross-activity comparison dashboards (scoped to one model or one part). */
  crossDashboards: CrossActivityDashboard[]
  /** Create a cross-activity dashboard; returns nothing (the page selects it by id). */
  addCrossDashboard: (dash: Omit<CrossActivityDashboard, 'id' | 'createdAt'>) => void
  updateCrossDashboard: (id: string, patch: Partial<Omit<CrossActivityDashboard, 'id' | 'createdAt' | 'createdBy'>>) => void
  deleteCrossDashboard: (id: string) => void
  /** Governance: project archetypes (WBS templates). QA objects become Activity Builder activities. */
  archetypes: ProjectArchetype[]
  /** Create or update an archetype and sync its QA objects into activities (create / rename / checklist / retire). */
  saveArchetype: (archetype: ProjectArchetype) => void
  setArchetypeActive: (id: string, active: boolean) => void
  /** Activity-to-activity dependencies, per technical category (Activity Dependencies module). */
  activityDependencies: ActivityDependency[]
  addActivityDependency: (dep: Omit<ActivityDependency, 'id'>) => void
  updateActivityDependency: (id: string, patch: Partial<Omit<ActivityDependency, 'id'>>) => void
  deleteActivityDependency: (id: string) => void
  /**
   * Append-only log of PIC release decisions. A part with no record is unreleased; the latest record wins.
   * While unreleased the vendor does not see the part in their queue.
   */
  partReleases: PartRelease[]

  /**
   * PIC releases a part to the vendor (or recalls it with released=false) after reviewing its details.
   * Records a PartRelease and appends a line to every activity entry of the part for the audit trail.
   */
  releasePart: (args: {
    partNo: string
    released: boolean
    by: PersonaId
    actorName?: string
    comment?: string
  }) => void

  /**
   * Append-only log of the vendor's responses to released parts (acknowledge / return). A response counts only if
   * it is newer than the part's latest release record. See getReleaseState in the engine.
   */
  partAcks: PartAck[]
  /** Vendor acknowledges one or several released parts together. Only parts awaiting acknowledgement are changed. */
  acknowledgeParts: (args: { partNos: string[]; by: PersonaId; actorName?: string }) => void
  /** Vendor returns one or several released parts to the PIC with a reason (required). */
  returnParts: (args: { partNos: string[]; by: PersonaId; actorName?: string; reason: string }) => void
  /**
   * Reasons for delay. When an activity is late and the vendor holds it, the vendor gives a reason (one or several
   * activities together); the PIC accepts it or sends it back with a comment, and a sent-back reason must be redone.
   * Append-only: the latest record for an entry decides where it stands. See delayStateOf.
   */
  delayReasons: DelayReason[]
  submitDelayReasons: (args: {
    items: { rowId: string; partNo: string; activityId: string; plannedEnd: string }[]
    category: string
    remark?: string
    revisedDate?: string
    by: PersonaId
    actorName?: string
  }) => void
  /** PIC (or SIC / DPM covering) accepts or sends back submitted reasons. A send-back needs a comment. */
  decideDelayReasons: (args: { ids: string[]; decision: 'Accepted' | 'SentBack'; comment?: string; by: PersonaId; actorName?: string }) => void
  /**
   * Add a dummy/placeholder part number because SAP has none yet. `origin` is forced to 'Manual'.
   * No-op if the part number already exists. Records a 'Created' PartEvent.
   */
  addManualPart: (
    part: Omit<PartRecord, 'origin' | 'supersededBy' | 'supersedes' | 'createdBy' | 'createdAt'>,
    by: PersonaId,
    actorName?: string
  ) => void

  /**
   * Transfer a (possibly in-progress) part's history to a new ECN-revised part number. Clones every
   * activity entry of `fromPartNo` onto `toPartNo` (new entry ids), appends a transfer line to each
   * entry's history, marks the old part superseded (dropped from tracking) and the new part as its
   * successor. Creates the new part from the old one's attributes if it doesn't exist yet.
   * Records a 'Transferred' PartEvent. No-op if the old part is unknown or already superseded.
   */
  transferPart: (args: {
    fromPartNo: string
    toPartNo: string
    newPartName?: string
    by: PersonaId
    actorName?: string
    reason?: string
  }) => void

  /**
   * History Transfer: copy one source part's activity history into one OR MORE target parts at once. Each target gets
   * clones of the source's entries (new ids, a 'Transferred from …' history line); existing work on a target is kept.
   * `keepSourceActive` decides whether the source stays active or is marked inactive (superseded) after the transfer.
   * When made inactive with a single target, the source points to that target as its successor. Records one
   * 'Transferred' PartEvent per target. Targets must exist and differ from the source.
   */
  transferHistory: (args: {
    fromPartNo: string
    toPartNos: string[]
    keepSourceActive: boolean
    /** Template row ids of the source's activities to transfer. Omit/undefined = all of them. */
    templateRowIds?: string[]
    by: PersonaId
    actorName?: string
    reason?: string
  }) => void

  /** History Transfer requests awaiting the SIC's decision. */
  historyTransferRequests: HistoryTransferRequest[]
  /**
   * Raise a History Transfer request. If `by` is SIC it is applied immediately (no approval) and recorded Approved;
   * otherwise it is left Pending for the SIC. Returns nothing; read historyTransferRequests to see the result.
   */
  requestHistoryTransfer: (args: {
    fromPartNo: string
    toPartNos: string[]
    keepSourceActive: boolean
    templateRowIds: string[]
    by: PersonaId
    actorName?: string
    reason?: string
  }) => void
  /** SIC approves (runs the transfer) or rejects a pending request. Only SIC may decide. */
  decideHistoryTransfer: (requestId: string, decision: 'Approve' | 'Reject', by: PersonaId, byName: string, comment?: string) => void

  // Model Coordinator / Admin / Section Admin reference data
  models: ModelRecord[]
  sections: Section[]
  milestones: MilestoneDef[]
  templateRows: TemplateRow[]
  /** PIC overrides on top of the SAP PIC (SIC/Admin). Append-only; see getPicOn. */
  picAssignments: PicAssignment[]

  /** Assign a PIC to a part from `effectiveFrom`. Replaces the PIC in force from that date forward. */
  assignPic: (assignment: Omit<PicAssignment, 'id' | 'assignedAt'>) => void

  // Models (keyed by unique name); `mrds` omits blank milestones
  addModel: (model: ModelRecord) => void
  updateModel: (name: string, model: Partial<ModelRecord>) => void
  deleteModel: (name: string) => void

  // Sections (Admin-maintained list)
  addSection: (section: Section) => void
  updateSection: (id: string, section: Partial<Omit<Section, 'id'>>) => void
  /** Also removes the section's template rows and their entries. */
  deleteSection: (id: string) => void

  // Milestones (Admin-maintained list). Mandatory milestones cannot be removed.
  addMilestone: (milestone: MilestoneDef) => void
  updateMilestone: (id: string, milestone: Partial<Omit<MilestoneDef, 'id' | 'mandatory'>>) => void
  /** No-op for mandatory milestones. Also removes dependent template rows, entries and model MRD values. */
  deleteMilestone: (id: string) => void

  // Section templates
  addTemplateRow: (row: TemplateRow) => void
  updateTemplateRow: (id: string, row: Partial<Omit<TemplateRow, 'id'>>) => void
  /** Also removes the row's entries. */
  deleteTemplateRow: (id: string) => void

  /** Drafts being edited in the builder — never shown in Workspace/Dashboards until published */
  drafts: BuilderDraft[]

  // Named Views Persistence
  savedViews: { id: string; name: string; activityId: string; widgets: Widget[] }[]
  saveView: (name: string, activityId: string, widgets: Widget[]) => void
  deleteView: (id: string) => void

  // Activity Actions
  addActivity: (activity: ActivityDefinition) => void
  updateActivity: (id: string, activity: Partial<ActivityDefinition>) => void
  /** Retires the activity (sets `retired`). Template rows, entries and the dashboard are kept; there is no restore. */
  deleteActivity: (id: string) => void

  // Draft/Builder Actions
  saveDraft: (draft: BuilderDraft) => void
  deleteDraft: (draftId: string) => void
  publishDraft: (draftId: string) => void

  // Entry Actions
  addEntry: (entry: ActivityEntry) => void
  updateEntry: (id: string, entry: Partial<ActivityEntry>) => void
  updateEntryValues: (
    templateRowId: string,
    partNo: string,
    values: Record<string, any>,
    currentPersona?: string
  ) => void
  /**
   * Mark (notApplicable=true) or reverse (false) applicability for several parts of one template row.
   * Enforced here, not only in the UI: marking needs persona PIC and an activity with allowNotApplicable;
   * reversing needs PIC, SIC or Admin. Creates the entry if missing. Each change appends a named history line.
   */
  setNotApplicable: (
    templateRowId: string,
    partNos: string[],
    notApplicable: boolean,
    persona: PersonaId,
    reason?: string
  ) => void
  /**
   * Set or update the vendor planned timeline for one entry. Allowed only when the activity has
   * allowVendorPlannedTimeline and the persona is Vendor, PIC, SIC or Admin. The previous value (if any)
   * is pushed into vendorTimeline.history (for the strikethrough view) and a named history line is appended.
   * Creates the entry if missing.
   */
  setVendorTimeline: (
    templateRowId: string,
    partNo: string,
    start: string,
    end: string,
    persona: PersonaId,
    actorName?: string,
    comment?: string
  ) => void

  /**
   * Raise an action / recommendation on an entry and assign it (usually to the Vendor). PIC/SIC/Admin only.
   * Creates the entry if missing and appends a named line to the entry history.
   */
  addAction: (
    templateRowId: string,
    partNo: string,
    draft: { title: string; description?: string; assignedTo: PersonaId; assignedToName?: string; targetDate?: string },
    persona: PersonaId,
    actorName?: string
  ) => void
  /**
   * Update an action: status (assignee may advance their own; PIC/SIC/Admin may edit anything), target date
   * (superseded dates kept in targetHistory for the strikethrough view), title/description/assignee.
   * Each change appends to the action's own history.
   */
  updateAction: (
    templateRowId: string,
    partNo: string,
    actionId: string,
    patch: Partial<{ title: string; description: string; assignedTo: PersonaId; assignedToName: string; targetDate: string; status: ActionStatus }>,
    persona: PersonaId,
    actorName?: string,
    comment?: string
  ) => void
  /** Remove an action. PIC/SIC/Admin only. */
  deleteAction: (templateRowId: string, partNo: string, actionId: string, persona: PersonaId) => void

  /**
   * Raise a deviation on an entry. It is snapshotted with the activity's deviation flow (default PIC→SIC→DPM)
   * and starts at step 0. Only PIC/SIC/Admin may raise. Creates the entry if missing.
   */
  addDeviation: (
    templateRowId: string,
    partNo: string,
    draft: { title: string; description?: string; edocNumber?: string; targetDate?: string },
    persona: PersonaId,
    actorName?: string
  ) => void
  /**
   * Advance a deviation through its flow. Only the current-step role (or Admin) may act. 'Approve' moves to the
   * next role, or marks Approved at the end; 'Reject' ends it Rejected; 'Send back' returns it to step 0.
   */
  advanceDeviation: (
    templateRowId: string,
    partNo: string,
    deviationId: string,
    action: 'Approve' | 'Reject' | 'Send back',
    persona: PersonaId,
    actorName?: string,
    comment?: string
  ) => void
  transitionEntryState: (
    entryId: string,
    action: 'Submit' | 'Approve' | 'Send back' | 'Edit',
    comment?: string,
    currentPersona?: string
  ) => void
  /**
   * PIC marks a Submitted entry NG (no-go): records a resubmission round (reason + optional target date) and sends the
   * entry back to the vendor. Only for activities with trackNgRounds; only the PIC/SIC/DPM may call it.
   */
  markEntryNg: (entryId: string, reason: string, targetDate: string | undefined, currentPersona: string) => void

  // Dashboard Actions
  updateDashboard: (activityId: string, config: DashboardConfig) => void
  resetDashboard: (activityId: string) => void

  // Demo Reset Action
  resetDemoData: () => void
  /** Adds a log line (id and time are set here). */
  logAudit: (entry: Omit<AuditEntry, 'id' | 'at'>) => void
  /** Attaches a file to a part's activity entry and logs it. */
  addDocument: (doc: Omit<ActivityDocument, 'id' | 'uploadedAt'>, file: File) => Promise<void>
  /** Only the SIC may delete a document; the deletion is logged. Returns false when not allowed. */
  deleteDocument: (docId: string, by: PersonaId, byName: string) => boolean
  /** Put one activity back to its shipped definition (fields, rules, dashboard) and drop its builder draft. */
  restoreActivityDefault: (activityId: string) => void
  /** TEMPORARY: replace all parts + entries with sample data built from the current activity fields. */
  loadSampleParts: (mode?: 'blank' | 'samples') => void
  /** TEMPORARY: remove all parts and their activity data (leaves the activity list). */
  unloadParts: () => void
}

export const useQAStore = create<QAStoreState>()(
  persist(
    (set, get) => ({
      masterLists: SEED_MASTER_LISTS,
      notifications: [],
      saveMasterList: (list) =>
        set((state) => ({ masterLists: state.masterLists.some((l) => l.id === list.id) ? state.masterLists.map((l) => (l.id === list.id ? list : l)) : [...state.masterLists, list] })),
      deleteMasterList: (id) =>
        set((state) => {
          // A list that a field still uses cannot be deleted (the Governance page shows which fields use it).
          const inUse = state.activities.some((a) => a.fields.some((f) => f.optionsFrom === id || f.reasonRemark?.listId === id))
          return inUse ? {} : { masterLists: state.masterLists.filter((l) => l.id !== id) }
        }),
      checkSave: (templateRowId, partNo, newValues, persona, opts) => {
        const state = get()
        const row = state.templateRows.find((r) => r.id === templateRowId)
        const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
        const part = state.parts.find((p) => p.partNo === partNo)
        if (!row || !activity || !part) return []
        const entry = state.entries.find((e) => e.id === makeEntryId(templateRowId, partNo))
        const model = state.models.find((m) => m.name === part.model)
        const extra = ruleContext(activity, row, part, entry, model)
        const all = validateSave(activity, entry, { ...(entry?.values ?? {}), ...newValues }, part, extra, { persona, changedKeys: Object.keys(newValues), mandatory: opts?.mandatory }).issues
        return opts?.touchedOnly === false ? all.filter((i) => i.severity === 'block') : issuesForTouched(all, Object.keys(newValues))
      },
      saveChecked: (templateRowId, partNo, newValues, persona) => {
        const issues = get().checkSave(templateRowId, partNo, newValues, persona)
        if (issues.length === 0) get().updateEntryValues(templateRowId, partNo, newValues, persona as PersonaId)
        return issues
      },
      submitGroup: (templateRowId, partNo, groupId, persona, partialKeys, before) =>
        set((state) => {
          const entryId = makeEntryId(templateRowId, partNo)
          const entry = state.entries.find((e) => e.id === entryId)
          const row = state.templateRows.find((r) => r.id === templateRowId)
          const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
          const g = activity?.groupReviews?.find((x) => x.id === groupId)
          if (!entry || !activity || !g || !row) return {}
          // A full round cannot be sent with a mandatory field of the loop empty (e.g. the Non-OT reason + remark).
          if (!partialKeys?.length) {
            const part = state.parts.find((p) => p.partNo === partNo)
            const model = part ? state.models.find((m) => m.name === part.model) : undefined
            const { values: v, states } = evaluateRules(activity, { ...entry.values }, part, ruleContext(activity, row, part, entry, model))
            const missing = activity.fields.filter((f) => groupFieldKeys(activity, g).includes(f.key) && states[f.key]?.visible && states[f.key]?.mandatory && fieldMissing(f, v[f.key]))
            if (missing.length > 0) return {}
          }
          const now = new Date().toISOString()
          const snap = Object.fromEntries(groupFieldKeys(activity, g).map((k) => [k, entry.values[k]]))
          const next = groupSubmit(entry.groupReviews?.[groupId], snap, persona, now, partialKeys, before)
          const round = next.rounds.length
          const log = { timestamp: now, persona, action: `${g.label}: round ${round} sent to ${g.reviewerRole} for review${partialKeys?.length ? ' (changed field only)' : ''}` }
          const entries = state.entries.map((e) => (e.id === entryId ? { ...e, groupReviews: { ...(e.groupReviews ?? {}), [groupId]: next }, history: [...e.history, log], updatedAt: now, updatedBy: persona } : e))
          const note: AppNotification = { id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now, roles: [g.reviewerRole], partNo, rowId: templateRowId, activityId: activity.id, title: `${g.label}: review needed`, detail: `Round ${round} submitted by ${persona}` }
          const audit = { id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now, persona, actorName: persona, action: 'Review round submitted', partNo, activityId: activity.id, templateRowId, detail: `${g.label}, round ${round}` }
          return { entries, notifications: [...state.notifications, note], auditLog: [...state.auditLog, audit] }
        }),
      decideGroup: (templateRowId, partNo, groupId, decision, persona, comment) => {
        let error: string | undefined
        set((state) => {
          const entryId = makeEntryId(templateRowId, partNo)
          const entry = state.entries.find((e) => e.id === entryId)
          const row = state.templateRows.find((r) => r.id === templateRowId)
          const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
          const g = activity?.groupReviews?.find((x) => x.id === groupId)
          const cur = entry?.groupReviews?.[groupId]
          if (!entry || !activity || !g || !cur) return {}
          if (!canDecideGroup(g, cur, persona)) { error = 'You cannot decide this review.'; return {} }
          if (decision === 'Reject' && g.rejectCommentRequired && !comment?.trim()) { error = 'A comment is required to reject.'; return {} }
          const now = new Date().toISOString()
          const res = groupDecide(g, cur, decision, persona, now, comment?.trim())
          let values = res.restore ? { ...entry.values, ...res.restore } : entry.values
          // "On Accept, clear …" (a full round only): the owner enters these afresh; the old value is kept struck through.
          let fieldHistory = entry.fieldHistory
          const fullRound = !cur.rounds[cur.rounds.length - 1]?.partialKeys?.length
          if (decision === 'Accept' && fullRound && g.onAccept?.clearFields?.length) {
            values = { ...values }
            fieldHistory = { ...(fieldHistory ?? {}) }
            for (const k of g.onAccept.clearFields) {
              if (values[k] === undefined || values[k] === '') continue
              fieldHistory[k] = [...(fieldHistory[k] ?? []), { value: values[k], at: now, by: persona, reason: `${g.label} accepted — to be entered again` }]
              delete values[k]
            }
          }
          const log = { timestamp: now, persona, action: `${g.label}: round ${cur.rounds.length} ${decision === 'Accept' ? 'accepted' : 'rejected'}${comment?.trim() ? ' — ' + comment.trim() : ''}` }
          const entries = state.entries.map((e) => (e.id === entryId ? { ...e, values, fieldHistory, groupReviews: { ...(e.groupReviews ?? {}), [groupId]: res.state }, history: [...e.history, log], updatedAt: now, updatedBy: persona } : e))
          const note: AppNotification = { id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now, roles: [g.fillerRole], partNo, rowId: templateRowId, activityId: activity.id, title: `${g.label}: ${decision === 'Accept' ? 'accepted' : 'rejected'}`, detail: comment?.trim() || `Round ${cur.rounds.length} ${decision === 'Accept' ? 'accepted' : 'rejected'} by ${persona}` }
          const audit = { id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now, persona, actorName: persona, action: `Review ${decision === 'Accept' ? 'accepted' : 'rejected'}`, partNo, activityId: activity.id, templateRowId, detail: `${g.label}, round ${cur.rounds.length}${comment?.trim() ? ': ' + comment.trim() : ''}` }
          return { entries, notifications: [...state.notifications, note], auditLog: [...state.auditLog, audit] }
        })
        return error
      },
      raiseConfiguredDeviation: (templateRowId, partNo, edocNumber, persona) => {
        const state = get()
        const row = state.templateRows.find((r) => r.id === templateRowId)
        const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
        const entry = state.entries.find((e) => e.id === makeEntryId(templateRowId, partNo))
        const part = state.parts.find((p) => p.partNo === partNo)
        if (!row || !activity?.deviation || !part) return
        // Deviation setting: no approval chain → only the E-Doc number is kept on the entry.
        if (activity.deviation.approvalChain === false) return
        const model = state.models.find((m) => m.name === part.model)
        const extra = ruleExtra(activity, entry, { mrd: getMilestoneMrd(model, row.milestoneId), part })
        if (!deviationRequired(activity, entry?.values ?? {}, extra)) return
        if (entry?.deviations?.some((d) => d.edocNumber === edocNumber && d.status === 'In progress')) return
        get().addDeviation(templateRowId, partNo, { title: activity.deviation.title, description: activity.deviation.message, edocNumber }, persona)
      },
      activities: SEED_ACTIVITIES,
      entries: SEED_ENTRIES,
      dashboards: [generateOverviewDashboardConfig(), ...SEED_ACTIVITIES.map((act) => generateDashboardConfig(act))],
      models: SEED_MODELS,
      sections: SEED_SECTIONS,
      milestones: SEED_MILESTONES,
      templateRows: SEED_TEMPLATE_ROWS,
      picAssignments: SEED_PIC_ASSIGNMENTS,
      parts: MOCK_PART_LIST.map((p) => ({ ...p, origin: 'SAP' as const, technicalCategory: deriveTechnicalCategory(p) })),
      documents: [],
      auditLog: [],
      historyTransferRequests: [],
      partEvents: SEED_PART_EVENTS,
      partReleases: SEED_PART_RELEASES,
      partAcks: SEED_PART_ACKS,
      delayReasons: SEED_DELAY_REASONS,
      crossDashboards: [],
      activityDependencies: [],
      archetypes: SEED_ARCHETYPES,
      vendorInfo: SEED_VENDOR_INFO,
      vendorVisits: SEED_VENDOR_VISITS,
      drafts: [],
      savedViews: [],

      saveArchetype: (archetype) =>
        set((state) => {
          const previous = state.archetypes.find((a) => a.id === archetype.id)
          const r = syncArchetype(archetype, previous, state.activities, state.drafts)
          return {
            archetypes: previous
              ? state.archetypes.map((a) => (a.id === archetype.id ? r.archetype : a))
              : [...state.archetypes, r.archetype],
            activities: r.activities,
            drafts: r.drafts,
          }
        }),
      setArchetypeActive: (id, active) =>
        set((state) => ({ archetypes: state.archetypes.map((a) => (a.id === id ? { ...a, active } : a)) })),

      addActivityDependency: (dep) =>
        set((state) => ({
          activityDependencies: [...state.activityDependencies, { ...dep, id: `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }]
        })),
      updateActivityDependency: (id, patch) =>
        set((state) => ({
          activityDependencies: state.activityDependencies.map((d) => (d.id === id ? { ...d, ...patch } : d))
        })),
      deleteActivityDependency: (id) =>
        set((state) => ({ activityDependencies: state.activityDependencies.filter((d) => d.id !== id) })),

      addVendorVisit: (visit) =>
        set((state) => ({
          vendorVisits: [
            ...state.vendorVisits,
            { ...visit, id: `visit-${Date.now().toString(36)}`, createdAt: new Date().toISOString() }
          ]
        })),

      updateVendorVisit: (id, patch) =>
        set((state) => ({
          vendorVisits: state.vendorVisits.map((v) => (v.id === id ? { ...v, ...patch } : v))
        })),

      deleteVendorVisit: (id) =>
        set((state) => ({ vendorVisits: state.vendorVisits.filter((v) => v.id !== id) })),

      addCrossDashboard: (dash) =>
        set((state) => ({
          crossDashboards: [
            ...state.crossDashboards,
            { ...dash, id: `cross-${Date.now().toString(36)}`, createdAt: new Date().toISOString() }
          ]
        })),

      updateCrossDashboard: (id, patch) =>
        set((state) => ({
          crossDashboards: state.crossDashboards.map((d) => (d.id === id ? { ...d, ...patch } : d))
        })),

      deleteCrossDashboard: (id) =>
        set((state) => ({ crossDashboards: state.crossDashboards.filter((d) => d.id !== id) })),

      releasePart: ({ partNo, released, by, actorName, comment }) =>
        set((state) => {
          if (!state.parts.some((p) => p.partNo === partNo)) return {}
          const now = new Date().toISOString()
          const actor = actorName || by
          const record: PartRelease = {
            id: `rel-${partNo}-${state.partReleases.filter((r) => r.partNo === partNo).length + 1}`,
            partNo,
            released,
            by: actor,
            byRole: by,
            at: now,
            comment: comment?.trim() || undefined
          }
          // Trail the decision on every entry of the part so it shows in the audit "who did what".
          const entries = state.entries.map((e) =>
            e.partNo === partNo
              ? {
                  ...e,
                  history: [
                    ...e.history,
                    {
                      timestamp: now,
                      persona: by,
                      actorName: by === 'PIC' ? actor : undefined,
                      action: released ? 'Released to vendor' : 'Recalled from vendor',
                      comment: comment?.trim() || undefined
                    }
                  ]
                }
              : e
          )
          return { partReleases: [...state.partReleases, record], entries }
        }),

      acknowledgeParts: ({ partNos, by, actorName }) =>
        set((state) => {
          if (by !== 'Vendor') return {}
          const now = new Date().toISOString()
          const actor = actorName || by
          const todo = partNos.filter((n) => getReleaseState(n, state.partReleases, state.partAcks) === 'Released')
          if (todo.length === 0) return {}
          const records: PartAck[] = todo.map((partNo, i) => ({
            id: `ack-${partNo}-${state.partAcks.filter((a) => a.partNo === partNo).length + 1}`,
            partNo, status: 'Acknowledged', by: actor, byRole: by,
            at: new Date(Date.parse(now) + i).toISOString()
          }))
          const set1 = new Set(todo)
          const entries = state.entries.map((e) =>
            set1.has(e.partNo)
              ? { ...e, history: [...e.history, { timestamp: now, persona: by, action: 'Acknowledged by vendor' }] }
              : e
          )
          return { partAcks: [...state.partAcks, ...records], entries }
        }),
      returnParts: ({ partNos, by, actorName, reason }) =>
        set((state) => {
          const why = reason.trim()
          if (by !== 'Vendor' || !why) return {}
          const now = new Date().toISOString()
          const actor = actorName || by
          const todo = partNos.filter((n) => getReleaseState(n, state.partReleases, state.partAcks) === 'Released')
          if (todo.length === 0) return {}
          const records: PartAck[] = todo.map((partNo, i) => ({
            id: `ack-${partNo}-${state.partAcks.filter((a) => a.partNo === partNo).length + 1}`,
            partNo, status: 'Returned', by: actor, byRole: by, reason: why,
            at: new Date(Date.parse(now) + i).toISOString()
          }))
          const set1 = new Set(todo)
          const entries = state.entries.map((e) =>
            set1.has(e.partNo)
              ? { ...e, history: [...e.history, { timestamp: now, persona: by, action: 'Returned by vendor', comment: why }] }
              : e
          )
          return { partAcks: [...state.partAcks, ...records], entries }
        }),
      submitDelayReasons: ({ items, category, remark, revisedDate, by, actorName }) =>
        set((state) => {
          const text = remark?.trim()
          if (by !== 'Vendor' || !category || (category === DELAY_REASON_OTHERS && !text) || items.length === 0) return {}
          const now = new Date().toISOString()
          const actor = actorName || by
          const todo = items.filter((it) => {
            const id = makeEntryId(it.rowId, it.partNo)
            const latest = state.delayReasons.filter((r) => r.entryId === id).sort((a, b) => (a.at < b.at ? 1 : -1))[0]
            return !latest || latest.status === 'SentBack'
          })
          if (todo.length === 0) return {}
          const records: DelayReason[] = todo.map((it, i) => {
            const entryId = makeEntryId(it.rowId, it.partNo)
            return {
              id: `dr-${entryId}-${state.delayReasons.filter((r) => r.entryId === entryId).length + 1}`,
              entryId, rowId: it.rowId, partNo: it.partNo, activityId: it.activityId,
              category, remark: text || undefined, revisedDate: revisedDate || undefined,
              by: actor, byRole: by, at: new Date(Date.parse(now) + i).toISOString(),
              plannedEnd: it.plannedEnd, status: 'Submitted'
            }
          })
          const ids = new Set(records.map((r) => r.entryId))
          const entries = state.entries.map((e) =>
            ids.has(e.id)
              ? { ...e, history: [...e.history, { timestamp: now, persona: by, action: 'Delay reason submitted', comment: `${category}${text ? ': ' + text : ''}` }] }
              : e
          )
          return { delayReasons: [...state.delayReasons, ...records], entries }
        }),
      decideDelayReasons: ({ ids, decision, comment, by, actorName }) =>
        set((state) => {
          const note = comment?.trim()
          if (!(by === 'PIC' || by === 'SIC' || by === 'DPM')) return {}
          if (decision === 'SentBack' && !note) return {}
          const now = new Date().toISOString()
          const actor = actorName || by
          const pick = new Set(ids)
          const hit: DelayReason[] = []
          const delayReasons = state.delayReasons.map((r) => {
            if (!pick.has(r.id) || r.status !== 'Submitted') return r
            const next = { ...r, status: decision, decidedBy: actor, decidedAt: now, decisionComment: note || undefined }
            hit.push(next)
            return next
          })
          if (hit.length === 0) return {}
          const eids = new Set(hit.map((r) => r.entryId))
          const entries = state.entries.map((e) =>
            eids.has(e.id)
              ? {
                  ...e,
                  history: [...e.history, {
                    timestamp: now, persona: by, actorName: by === 'PIC' ? actor : undefined,
                    action: decision === 'Accepted' ? 'Delay reason accepted' : 'Delay reason sent back',
                    comment: note || undefined
                  }]
                }
              : e
          )
          return { delayReasons, entries }
        }),
      assignPic: (a) =>
        set((state) => {
          const assignedAt = new Date().toISOString()
          const id = `pic-${a.partNo}-${state.picAssignments.filter((x) => x.partNo === a.partNo).length + 1}`
          return { picAssignments: [...state.picAssignments, { ...a, id, assignedAt }] }
        }),

      addManualPart: (part, by, actorName) =>
        set((state) => {
          const partNo = part.partNo.trim()
          if (by !== 'SectionAdmin' && by !== 'Admin' && by !== 'PIC') return {} // dummy parts are raised by the Department Co-ordinator, the PIC or Admin
          if (!partNo || state.parts.some((p) => p.partNo === partNo)) return {}
          const now = new Date().toISOString()
          const newPart: PartRecord = { ...part, partNo, origin: 'Manual', createdBy: by, createdAt: now }
          const event: PartEvent = {
            id: `evt-created-${partNo}-${state.partEvents.length + 1}`,
            kind: 'Created',
            partNo,
            by: actorName || by,
            byRole: by,
            at: now,
            reason: 'SAP has no part number yet — placeholder created'
          }
          return { parts: [...state.parts, newPart], partEvents: [...state.partEvents, event] }
        }),

      transferPart: ({ fromPartNo, toPartNo, newPartName, by, actorName, reason }) =>
        set((state) => {
          const from = state.parts.find((p) => p.partNo === fromPartNo)
          const to = toPartNo.trim()
          if (!from || from.supersededBy || !to || to === fromPartNo) return {}

          const now = new Date().toISOString()
          const actor = actorName || by

          // Ensure the new part exists. If not, derive it from the old part's attributes.
          let parts = state.parts
          const existingNew = parts.find((p) => p.partNo === to)
          if (!existingNew) {
            parts = [
              ...parts,
              {
                ...from,
                partNo: to,
                partName: newPartName?.trim() || from.partName,
                origin: from.origin ?? 'SAP',
                supersededBy: undefined,
                supersedes: fromPartNo,
                createdBy: by,
                createdAt: now
              }
            ]
          } else {
            parts = parts.map((p) => (p.partNo === to ? { ...p, supersedes: fromPartNo } : p))
          }

          // Clone the old part's entries onto the new part number, carrying history.
          const movedEntries: ActivityEntry[] = []
          for (const e of state.entries) {
            if (e.partNo !== fromPartNo) continue
            const newId = makeEntryId(e.templateRowId, to)
            if (state.entries.some((x) => x.id === newId)) continue // don't clobber existing work on the new part
            movedEntries.push({
              ...e,
              id: newId,
              partNo: to,
              history: [
                ...e.history,
                {
                  timestamp: now,
                  persona: by,
                  actorName: by === 'PIC' ? actor : undefined,
                  action: `Transferred from ${fromPartNo} (ECN)`,
                  comment: reason?.trim() || undefined
                }
              ],
              updatedAt: now,
              updatedBy: by
            })
          }

          // Mark the old part superseded so it drops out of all tracking views.
          parts = parts.map((p) => (p.partNo === fromPartNo ? { ...p, supersededBy: to } : p))

          const event: PartEvent = {
            id: `evt-transfer-${fromPartNo}-${to}-${state.partEvents.length + 1}`,
            kind: 'Transferred',
            partNo: to,
            fromPartNo,
            entriesMoved: movedEntries.length,
            by: actor,
            byRole: by,
            at: now,
            reason: reason?.trim() || undefined
          }

          return {
            parts,
            entries: [...state.entries, ...movedEntries],
            partEvents: [...state.partEvents, event]
          }
        }),

      transferHistory: ({ fromPartNo, toPartNos, keepSourceActive, templateRowIds, by, actorName, reason }) =>
        set((state) => {
          const from = state.parts.find((p) => p.partNo === fromPartNo)
          const targets = Array.from(new Set(toPartNos.map((t) => t.trim()).filter((t) => t && t !== fromPartNo)))
          if (!from || from.supersededBy || targets.length === 0) return {}
          // Every target must be a known, non-superseded part with the SAME vendor code as the source.
          const valid = targets.filter((t) => state.parts.some((p) => p.partNo === t && !p.supersededBy && p.vendorCode === from.vendorCode))
          if (valid.length === 0) return {}

          const now = new Date().toISOString()
          const actor = actorName || by
          // Only the chosen activities (by template row); omitted = all of the source's activities.
          const pick = templateRowIds && templateRowIds.length > 0 ? new Set(templateRowIds) : null
          const sourceEntries = state.entries.filter((e) => e.partNo === fromPartNo && (!pick || pick.has(e.templateRowId)))
          if (sourceEntries.length === 0) return {}
          const newEntries: ActivityEntry[] = []
          const events: PartEvent[] = []

          valid.forEach((to, ti) => {
            let moved = 0
            for (const e of sourceEntries) {
              const newId = makeEntryId(e.templateRowId, to)
              // Keep any existing work on the target; only add entries it does not already have.
              if (state.entries.some((x) => x.id === newId) || newEntries.some((x) => x.id === newId)) continue
              newEntries.push({
                ...e,
                id: newId,
                partNo: to,
                history: [
                  ...e.history,
                  {
                    timestamp: now,
                    persona: by,
                    actorName: by === 'PIC' ? actor : undefined,
                    action: `History transferred from ${fromPartNo}`,
                    comment: reason?.trim() || undefined
                  }
                ],
                updatedAt: now,
                updatedBy: by
              })
              moved++
            }
            events.push({
              id: `evt-histxfer-${fromPartNo}-${to}-${state.partEvents.length + ti + 1}`,
              kind: 'Transferred',
              partNo: to,
              fromPartNo,
              entriesMoved: moved,
              by: actor,
              byRole: by,
              at: now,
              reason: reason?.trim() || undefined
            })
          })

          // Record provenance on the targets; mark the source inactive unless the user keeps it active.
          let parts = state.parts.map((p) => (valid.includes(p.partNo) ? { ...p, supersedes: fromPartNo } : p))
          if (!keepSourceActive) {
            // Mark the source inactive; it points to the first target as its nominal successor.
            parts = parts.map((p) => (p.partNo === fromPartNo ? { ...p, supersededBy: valid[0] } : p))
          }

          return {
            parts,
            entries: [...state.entries, ...newEntries],
            partEvents: [...state.partEvents, ...events]
          }
        }),

      requestHistoryTransfer: ({ fromPartNo, toPartNos, keepSourceActive, templateRowIds, by, actorName, reason }) => {
        const now = new Date().toISOString()
        const byName = actorName || by
        const id = `htx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        const immediate = by === 'SIC' // the SIC needs no approval
        set((state) => ({
          historyTransferRequests: [
            ...state.historyTransferRequests,
            {
              id, fromPartNo, toPartNos, templateRowIds, keepSourceActive, reason,
              requestedBy: by, requestedByName: byName, requestedAt: now,
              status: immediate ? 'Approved' : 'Pending',
              ...(immediate ? { decidedBy: byName, decidedAt: now, decisionComment: 'Auto-approved (requested by SIC)' } : {})
            }
          ],
          auditLog: [
            ...state.auditLog,
            { id: `aud-${id}`, at: now, persona: by, actorName: byName, action: immediate ? 'History transfer (SIC, no approval)' : 'History transfer requested', partNo: fromPartNo, detail: `${templateRowIds.length || 'all'} activit${templateRowIds.length === 1 ? 'y' : 'ies'} → ${toPartNos.length} part${toPartNos.length === 1 ? '' : 's'}${reason ? ` — ${reason}` : ''}` }
          ]
        }))
        if (immediate) {
          get().transferHistory({ fromPartNo, toPartNos, keepSourceActive, templateRowIds, by, actorName, reason })
        }
      },

      decideHistoryTransfer: (requestId, decision, by, byName, comment) => {
        if (by !== 'SIC') return
        const req = get().historyTransferRequests.find((r) => r.id === requestId)
        if (!req || req.status !== 'Pending') return
        const now = new Date().toISOString()
        set((state) => ({
          historyTransferRequests: state.historyTransferRequests.map((r) =>
            r.id === requestId ? { ...r, status: decision === 'Approve' ? 'Approved' : 'Rejected', decidedBy: byName, decidedAt: now, decisionComment: comment } : r
          ),
          auditLog: [
            ...state.auditLog,
            { id: `aud-${requestId}-${decision}`, at: now, persona: by, actorName: byName, action: `History transfer ${decision === 'Approve' ? 'approved' : 'rejected'}`, partNo: req.fromPartNo, detail: `by ${req.requestedByName}: ${req.templateRowIds.length || 'all'} activities → ${req.toPartNos.length} parts${comment ? ` — ${comment}` : ''}` }
          ]
        }))
        if (decision === 'Approve') {
          get().transferHistory({ fromPartNo: req.fromPartNo, toPartNos: req.toPartNos, keepSourceActive: req.keepSourceActive, templateRowIds: req.templateRowIds, by, actorName: byName, reason: req.reason })
        }
      },

      // Models
      addModel: (model) =>
        set((state) =>
          state.models.some((m) => m.name === model.name) ? {} : { models: [...state.models, model] }
        ),

      updateModel: (name, updated) =>
        set((state) => ({
          models: state.models.map((m) => (m.name === name ? { ...m, ...updated, name: m.name } : m))
        })),

      deleteModel: (name) =>
        set((state) => ({ models: state.models.filter((m) => m.name !== name) })),

      // Sections
      addSection: (section) =>
        set((state) =>
          state.sections.some((s) => s.id === section.id) ? {} : { sections: [...state.sections, section] }
        ),

      updateSection: (id, updated) =>
        set((state) => ({
          sections: state.sections.map((s) => (s.id === id ? { ...s, ...updated } : s))
        })),

      deleteSection: (id) =>
        set((state) => {
          const removed = new Set(state.templateRows.filter((r) => r.section === id).map((r) => r.id))
          return {
            sections: state.sections.filter((s) => s.id !== id),
            templateRows: state.templateRows.filter((r) => r.section !== id),
            entries: state.entries.filter((e) => !removed.has(e.templateRowId))
          }
        }),

      // Milestones
      addMilestone: (milestone) =>
        set((state) =>
          state.milestones.some((m) => m.id === milestone.id)
            ? {}
            : { milestones: [...state.milestones, milestone] }
        ),

      updateMilestone: (id, updated) =>
        set((state) => ({
          milestones: state.milestones.map((m) => (m.id === id ? { ...m, ...updated } : m))
        })),

      deleteMilestone: (id) =>
        set((state) => {
          if (state.milestones.find((m) => m.id === id)?.mandatory) return {}
          const removed = new Set(state.templateRows.filter((r) => r.milestoneId === id).map((r) => r.id))
          return {
            milestones: state.milestones.filter((m) => m.id !== id),
            templateRows: state.templateRows.filter((r) => r.milestoneId !== id),
            entries: state.entries.filter((e) => !removed.has(e.templateRowId)),
            models: state.models.map((m) => {
              const { [id]: _dropped, ...mrds } = m.mrds
              return { ...m, mrds }
            })
          }
        }),

      // Section templates
      addTemplateRow: (row) =>
        set((state) =>
          state.templateRows.some((r) => r.id === row.id) ? {} : { templateRows: [...state.templateRows, row] }
        ),

      updateTemplateRow: (id, updated) =>
        set((state) => ({
          templateRows: state.templateRows.map((r) => (r.id === id ? { ...r, ...updated } : r))
        })),

      deleteTemplateRow: (id) =>
        set((state) => ({
          templateRows: state.templateRows.filter((r) => r.id !== id),
          entries: state.entries.filter((e) => e.templateRowId !== id)
        })),

      saveView: (name, activityId, widgets) =>
        set((state) => {
          const id = `view-${Date.now()}`
          return {
            savedViews: [...state.savedViews, { id, name, activityId, widgets }]
          }
        }),

      deleteView: (id) =>
        set((state) => ({
          savedViews: state.savedViews.filter((v) => v.id !== id)
        })),

      // Activity Actions
      addActivity: (activity) =>
        set((state) => {
          const dashboards = [...state.dashboards]
          if (!dashboards.some((d) => d.activityId === activity.id)) {
            dashboards.push(generateDashboardConfig(activity))
          }
          return {
            activities: [...state.activities, activity],
            dashboards
          }
        }),

      updateActivity: (id, updated) =>
        set((state) => ({
          activities: state.activities.map((act) =>
            act.id === id ? { ...act, ...updated } : act
          )
        })),

      deleteActivity: (id) =>
        set((state) => ({
          activities: state.activities.map((act) => (act.id === id ? { ...act, retired: true } : act))
        })),

      // Draft/Builder Actions
      saveDraft: (draft) =>
        set((state) => {
          const exists = state.drafts.some((d) => d.id === draft.id)
          return {
            drafts: exists
              ? state.drafts.map((d) => (d.id === draft.id ? draft : d))
              : [...state.drafts, draft]
          }
        }),

      deleteDraft: (draftId) =>
        set((state) => ({
          drafts: state.drafts.filter((d) => d.id !== draftId)
        })),

      publishDraft: (draftId) =>
        set((state) => {
          const draft = state.drafts.find((d) => d.id === draftId)
          if (!draft) return {}

          // Create/update the published activity from the draft
          const publishedActivity: ActivityDefinition = {
            ...draft,
            published: true,
          }

          const existsInActivities = draft.sourceId
            ? state.activities.some((a) => a.id === draft.sourceId)
            : false

          let newActivities: ActivityDefinition[]
          if (existsInActivities && draft.sourceId) {
            // Update existing
            newActivities = state.activities.map((a) =>
              a.id === draft.sourceId ? { ...publishedActivity, id: draft.sourceId } : a
            )
          } else {
            // Brand new — use draft id as the canonical id
            newActivities = [...state.activities, publishedActivity]
          }

          // Generate dashboard if not exists
          const dashboards = [...state.dashboards]
          const targetId = draft.sourceId || draft.id
          if (!dashboards.some((d) => d.activityId === targetId)) {
            dashboards.push(generateDashboardConfig({ ...publishedActivity, id: targetId }))
          }

          // First publish of an archetype activity: place it in every section under its WBS trial (default offsets),
          // so it is tracked straight away. Department Co-ordinators adjust offsets in Section Template.
          let templateRows = state.templateRows
          const trial = publishedActivity.defaultMilestoneId
          if (trial && !templateRows.some((r) => r.activityId === targetId)) {
            templateRows = [
              ...templateRows,
              ...state.sections.map((sec) => ({
                id: makeTemplateRowId(sec.id, targetId, trial),
                section: sec.id,
                activityId: targetId,
                milestoneId: trial,
                startOffset: -23,
                endOffset: 3,
              })),
            ]
          }

          return {
            activities: newActivities,
            drafts: state.drafts.filter((d) => d.id !== draftId),
            dashboards,
            templateRows,
          }
        }),

      // Entry Actions
      addEntry: (entry) =>
        set((state) => ({
          entries: [...state.entries, entry]
        })),

      updateEntry: (id, updated) =>
        set((state) => ({
          entries: state.entries.map((ent) =>
            ent.id === id ? { ...ent, ...updated } : ent
          )
        })),

      updateEntryValues: (templateRowId, partNo, newValues, currentPersona) =>
        set((state) => {
          const entryId = makeEntryId(templateRowId, partNo)
          const existingEntry = state.entries.find((e) => e.id === entryId)
          const row = state.templateRows.find((r) => r.id === templateRowId)
          const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
          const part = state.parts.find((p) => p.partNo === partNo)

          if (!row || !activity || !part) return {}
          if (part.supersededBy) return {} // Superseded part is read-only; work on the new part
          if (existingEntry?.notApplicable) return {} // Read-only while Not applicable
          const activityId = activity.id

          const mergedValues = {
            ...(existingEntry?.values || {}),
            ...newValues
          }
          // Tables that keep a history per row (FieldDefinition.logRows): stamp who changed which cells, and when.
          for (const f of activity.fields) {
            if (!f.logRows || !(f.key in newValues) || !Array.isArray(mergedValues[f.key])) continue
            const before: Record<string, any>[] = Array.isArray(existingEntry?.values?.[f.key]) ? existingEntry!.values[f.key] : []
            const at = new Date().toISOString()
            mergedValues[f.key] = (mergedValues[f.key] as Record<string, any>[]).map((r, i) => {
              const old = before[i] ?? {}
              const changed = (f.columns ?? []).filter((c) => JSON.stringify(r?.[c.key] ?? '') !== JSON.stringify(old[c.key] ?? '')).map((c) => c.label)
              const log = Array.isArray(old._log) ? old._log : []
              return changed.length ? { ...r, _log: [...log, { at, by: currentPersona || 'Admin', cells: changed }] } : { ...r, _log: log.length ? log : r?._log }
            })
          }

          // Evaluate calculated fields using the pure engine
          const model = state.models.find((m) => m.name === part.model)
          const rctx = ruleContext(activity, row, part, existingEntry, model)
          // Final guard: a blocking rule failure on a field this save touches refuses the save, whichever screen sent it.
          const touched = new Set(Object.keys(newValues))
          const blocked = issuesForTouched(validateSave(activity, existingEntry, mergedValues, part, rctx, { persona: currentPersona || 'Admin', changedKeys: [...touched] }).issues, touched)
          if (blocked.length > 0) return {}
          const calculatedValues = evaluateCalculatedFields(activity, mergedValues, part, rctx.mrd, undefined, rctx)

          let updatedEntry: ActivityEntry
          const now = new Date().toISOString()
          const actor = currentPersona || 'System'

          if (existingEntry) {
            updatedEntry = {
              ...existingEntry,
              values: calculatedValues,
              updatedAt: now,
              updatedBy: actor as any
            }
          } else {
            updatedEntry = {
              id: entryId,
              templateRowId,
              activityId,
              partNo,
              values: calculatedValues,
              validationState: 'Draft',
              currentStepIndex: 0,
              history: [
                {
                  timestamp: now,
                  persona: actor as any,
                  actorName: actor === 'PIC' ? getPicOn(part, state.picAssignments, DEMO_TODAY).name || undefined : undefined,
                  action: 'Draft entry initialized'
                }
              ],
              updatedAt: now,
              updatedBy: actor as any
            }
          }

          // Merge field metadata/status
          if (!updatedEntry.fieldMeta) {
            updatedEntry.fieldMeta = {}
          }
          for (const key of Object.keys(newValues)) {
            updatedEntry.fieldMeta[key] = {
              value: newValues[key],
              status: 'Pending'
            }
          }

          // C4: a notify-on-change field replaced after its first save keeps the old value (struck through in the form),
          // is written to the audit log and pushes a notification to the configured roles.
          const changes = detectNotifyChanges(activity, existingEntry?.values, calculatedValues)
          let notifications = state.notifications
          let auditLog = state.auditLog
          if (changes.length > 0) {
            const hist = { ...(updatedEntry.fieldHistory ?? {}) }
            const newNotes: AppNotification[] = []
            const newAudit: AuditEntry[] = []
            for (const c of changes) {
              hist[c.field.key] = [...(hist[c.field.key] ?? []), toChange(c.from, actor, now, (newValues as any)[`${c.field.key}__reason`])]
              const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
              newNotes.push({ id: `ntf-${stamp}`, at: now, roles: c.roles, partNo, rowId: templateRowId, activityId, title: `${c.field.label} changed`, detail: `${String(c.from)} → ${String(c.to ?? '(cleared)')} by ${actor}` })
              newAudit.push({ id: `aud-${stamp}`, at: now, persona: (currentPersona || 'Admin') as PersonaId, actorName: actor, action: 'Field changed', partNo, activityId, templateRowId, detail: `${c.field.label}: ${String(c.from)} → ${String(c.to ?? '(cleared)')}` })
            }
            updatedEntry = {
              ...updatedEntry,
              fieldHistory: hist,
              history: [...updatedEntry.history, ...changes.map((c) => ({ timestamp: now, persona: actor as any, action: `${c.field.label} changed: ${String(c.from)} → ${String(c.to ?? '(cleared)')}` }))]
            }
            notifications = [...notifications, ...newNotes]
            auditLog = [...auditLog, ...newAudit]
          }

          // C5: every override that was set, changed or cleared (by a person or by a rule) is audited and kept in history.
          const ovs = overrideEvents(activity, existingEntry?.values, calculatedValues, Object.keys(newValues))
          if (ovs.length > 0) {
            const hist = { ...(updatedEntry.fieldHistory ?? {}) }
            const ovAudit: AuditEntry[] = []
            for (const o of ovs) {
              const hk = `${o.field.key}__override`
              const remark = String(calculatedValues[`${o.field.key}__override_remark`] ?? newValues[`${o.field.key}__override_remark`] ?? '').trim()
              if (o.kind !== 'set') hist[hk] = [...(hist[hk] ?? []), toChange(o.from, o.by === 'system' ? 'System' : actor, now, o.kind === 'cleared' ? (o.by === 'system' ? 'Cleared by rule: override no longer allowed' : remark || undefined) : remark || undefined)]
              ovAudit.push({
                id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                at: now,
                persona: (o.by === 'system' ? 'Admin' : currentPersona || 'Admin') as PersonaId,
                actorName: o.by === 'system' ? 'System' : actor,
                action: `Override ${o.kind}`,
                partNo,
                activityId,
                templateRowId,
                detail: `${o.field.label}: system value ${String(o.systemValue ?? '(blank)')}; override ${String(o.from ?? '(none)')} → ${String(o.to ?? '(cleared)')}${remark ? '; remark: ' + remark : ''}${o.by === 'system' ? ' (cleared by rule)' : ''}`
              })
            }
            updatedEntry = { ...updatedEntry, fieldHistory: hist, history: [...updatedEntry.history, ...ovs.map((o) => ({ timestamp: now, persona: (o.by === 'system' ? 'System' : actor) as any, action: `${o.field.label} override ${o.kind}` }))] }
            auditLog = [...auditLog, ...ovAudit]
            // Override setting "notify": tell the configured roles, with the fields the Admin chose (e.g. reason + remark).
            const ovNotes: AppNotification[] = overrideNotices(activity, ovs, calculatedValues, actor).map((n) => ({
              id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now, roles: n.roles, partNo, rowId: templateRowId, activityId, title: n.title, detail: n.detail
            }))
            notifications = [...notifications, ...ovNotes]
          }

          // "Run again when …" (e.g. re-verification NG): the accepted loop closes its cycle and opens a new one, with its
          // fields empty for the filler; the closed cycle stays on the entry (read-only).
          const repeating = groupsToRepeat(activity, updatedEntry.values, { ...rctx, groupState: updatedEntry.groupReviews })
          if (repeating.length > 0) {
            let vals = updatedEntry.values
            const groupReviews = { ...(updatedEntry.groupReviews ?? {}) }
            const logs: typeof updatedEntry.history = []
            for (const g of repeating) {
              const r = groupRepeat(activity, g, groupReviews[g.id], vals, actor, now)
              vals = r.values
              groupReviews[g.id] = r.state
              const n = r.state.cycles!.length + 1
              logs.push({ timestamp: now, persona: actor as any, action: `${g.label}: cycle ${n} opened` })
              notifications = [...notifications, { id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now, roles: [g.fillerRole], partNo, rowId: templateRowId, activityId, title: `${g.label}: cycle ${n}`, detail: `To be entered again (cycle ${n})` }]
            }
            vals = evaluateCalculatedFields(activity, vals, part, rctx.mrd, undefined, { ...rctx, groupState: groupReviews })
            updatedEntry = { ...updatedEntry, values: vals, groupReviews, history: [...updatedEntry.history, ...logs] }
          }

          // "Start a new row when …" (e.g. a cycle closed as Open → the next cycle; Re-PPVT → fresh PPVT results): one
          // empty row per table, decided on the saved values; a table with `sendBack` returns the form to its filler.
          const starting = rowsToStart(activity, updatedEntry.values, { ...rctx, groupState: updatedEntry.groupReviews })
          if (starting.length > 0) {
            let vals = { ...updatedEntry.values }
            for (const f of starting) vals[f.key] = [...(Array.isArray(vals[f.key]) ? vals[f.key] : []), {}]
            vals = evaluateCalculatedFields(activity, vals, part, rctx.mrd, undefined, { ...rctx, groupState: updatedEntry.groupReviews })
            const back = starting.find((f) => f.nextRow!.sendBack)
            const sendBack = !!back && (updatedEntry.validationState === 'Submitted' || updatedEntry.validationState === 'Approved')
            const logs = starting.map((f) => ({ timestamp: now, persona: actor as any, action: `${f.label}: ${f.rowNoun ?? 'row'} ${(vals[f.key] as unknown[]).length} started` }))
            if (sendBack) {
              logs.push({ timestamp: now, persona: actor as any, action: 'Sent back', comment: back!.nextRow!.sendBack } as any)
              const filler = back!.enteredBy && back!.enteredBy !== 'System' ? back!.enteredBy : 'Vendor'
              notifications = [...notifications, { id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now, roles: [filler], partNo, rowId: templateRowId, activityId, title: `${activity.name}: sent back`, detail: back!.nextRow!.sendBack! }]
            }
            updatedEntry = { ...updatedEntry, values: vals, history: [...updatedEntry.history, ...logs], ...(sendBack ? { validationState: 'Sent back' as const, currentStepIndex: 0 } : {}) }
          }

          const updatedEntries = state.entries.map((e) =>
            e.id === entryId ? updatedEntry : e
          )

          if (!state.entries.some((e) => e.id === entryId)) {
            updatedEntries.push(updatedEntry)
          }

          return { entries: updatedEntries, notifications, auditLog }
        }),

      setNotApplicable: (templateRowId, partNos, notApplicable, persona, reason) =>
        set((state) => {
          const row = state.templateRows.find((r) => r.id === templateRowId)
          const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
          if (!row || !activity) return {}
          if (notApplicable && !(canMarkNotApplicable(persona) && activity.allowNotApplicable)) return {}
          if (!notApplicable && !canReverseNotApplicable(persona)) return {}

          const now = new Date().toISOString()
          const trimmed = reason?.trim() || undefined
          let entries = state.entries

          for (const partNo of partNos) {
            const part = state.parts.find((p) => p.partNo === partNo)
            if (!part || part.section !== row.section || part.supersededBy) continue
            const entryId = makeEntryId(templateRowId, partNo)
            const existing = entries.find((e) => e.id === entryId)
            if (notApplicable === !!existing?.notApplicable) continue // already in the requested state

            // The named person behind a PIC action is the part's PIC today; other roles are logged by role
            const picName = getPicOn(part, state.picAssignments, DEMO_TODAY).name || undefined
            const actorName = persona === 'PIC' ? picName : undefined
            const log = {
              timestamp: now,
              persona,
              actorName,
              action: notApplicable ? 'Marked Not applicable' : 'Marked applicable again',
              comment: trimmed
            }
            const mark = notApplicable
              ? { reason: trimmed, by: actorName ?? persona, byRole: persona, at: now }
              : undefined

            const updated: ActivityEntry = existing
              ? { ...existing, notApplicable: mark, history: [...existing.history, log], updatedAt: now, updatedBy: persona }
              : {
                  id: entryId,
                  templateRowId,
                  activityId: activity.id,
                  partNo,
                  values: {},
                  validationState: 'Draft',
                  currentStepIndex: 0,
                  notApplicable: mark,
                  history: [log],
                  updatedAt: now,
                  updatedBy: persona
                }
            entries = existing ? entries.map((e) => (e.id === entryId ? updated : e)) : [...entries, updated]
          }

          return { entries }
        }),

      setVendorTimeline: (templateRowId, partNo, start, end, persona, actorName, comment) =>
        set((state) => {
          if (!start || !end || start > end) return {}
          const row = state.templateRows.find((r) => r.id === templateRowId)
          const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
          const part = state.parts.find((p) => p.partNo === partNo)
          if (!row || !activity || !part || part.supersededBy) return {}
          if (!activity.allowVendorPlannedTimeline) return {}
          // Vendor owns this; PIC/SIC/Admin may also set/correct it on the vendor's behalf.
          const allowed = persona === 'Vendor' || persona === 'PIC' || persona === 'SIC' || persona === 'Admin'
          if (!allowed) return {}

          const now = new Date().toISOString()
          const actor = actorName || persona
          const entryId = makeEntryId(templateRowId, partNo)
          const existing = state.entries.find((e) => e.id === entryId)
          const prior = existing?.vendorTimeline

          // No-op if unchanged
          if (prior?.current.start === start && prior?.current.end === end) return {}

          const newVersion = {
            start,
            end,
            setBy: actor,
            setByRole: persona,
            at: now,
            comment: comment?.trim() || undefined
          }
          // Push the previous "current" (with its own metadata) into history before setting the new one.
          const history = prior ? [...prior.history, prior.current] : []
          const finalTimeline: VendorTimeline = { current: newVersion, history }

          const log = {
            timestamp: now,
            persona,
            actorName: persona === 'Vendor' ? actor : undefined,
            action: prior ? 'Updated planned timeline' : 'Set planned timeline',
            comment: comment?.trim() || undefined
          }

          const updated: ActivityEntry = existing
            ? { ...existing, vendorTimeline: finalTimeline, history: [...existing.history, log], updatedAt: now, updatedBy: persona }
            : {
                id: entryId,
                templateRowId,
                activityId: activity.id,
                partNo,
                values: {},
                validationState: 'Draft',
                currentStepIndex: 0,
                vendorTimeline: finalTimeline,
                history: [log],
                updatedAt: now,
                updatedBy: persona
              }

          const entries = existing
            ? state.entries.map((e) => (e.id === entryId ? updated : e))
            : [...state.entries, updated]
          return { entries }
        }),

      addAction: (templateRowId, partNo, draft, persona, actorName) =>
        set((state) => {
          const title = draft.title?.trim()
          if (!title) return {}
          const canRaise = persona === 'PIC' || persona === 'SIC' || persona === 'Admin'
          if (!canRaise) return {}
          const row = state.templateRows.find((r) => r.id === templateRowId)
          const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
          const part = state.parts.find((p) => p.partNo === partNo)
          if (!row || !activity || !part || part.supersededBy) return {}

          const now = new Date().toISOString()
          const actor = actorName || persona
          const entryId = makeEntryId(templateRowId, partNo)
          const existing = state.entries.find((e) => e.id === entryId)

          const action: Action = {
            id: `act-${entryId}-${(existing?.actions?.length ?? 0) + 1}-${Date.now().toString(36)}`,
            title,
            description: draft.description?.trim() || undefined,
            assignedTo: draft.assignedTo,
            assignedToName: draft.assignedToName?.trim() || undefined,
            targetDate: draft.targetDate || undefined,
            status: 'Open',
            createdBy: actor,
            createdByRole: persona,
            createdAt: now,
            history: [{ at: now, by: actor, byRole: persona, action: 'Raised action' }]
          }
          const log = {
            timestamp: now,
            persona,
            actorName: persona === 'PIC' ? actor : undefined,
            action: `Raised action for ${draft.assignedTo}: ${title}`
          }

          const updated: ActivityEntry = existing
            ? { ...existing, actions: [...(existing.actions ?? []), action], history: [...existing.history, log], updatedAt: now, updatedBy: persona }
            : {
                id: entryId,
                templateRowId,
                activityId: activity.id,
                partNo,
                values: {},
                validationState: 'Draft',
                currentStepIndex: 0,
                actions: [action],
                history: [log],
                updatedAt: now,
                updatedBy: persona
              }

          const entries = existing
            ? state.entries.map((e) => (e.id === entryId ? updated : e))
            : [...state.entries, updated]
          return { entries }
        }),

      updateAction: (templateRowId, partNo, actionId, patch, persona, actorName, comment) =>
        set((state) => {
          const entryId = makeEntryId(templateRowId, partNo)
          const entry = state.entries.find((e) => e.id === entryId)
          const action = entry?.actions?.find((a) => a.id === actionId)
          if (!entry || !action) return {}

          const isManager = persona === 'PIC' || persona === 'SIC' || persona === 'Admin'
          const isAssignee = persona === action.assignedTo
          // The assignee may only move status; managers may edit anything.
          const statusOnly = Object.keys(patch).every((k) => k === 'status')
          if (!isManager && !(isAssignee && statusOnly)) return {}

          const now = new Date().toISOString()
          const actor = actorName || persona
          const logs: typeof action.history = []
          const next: Action = { ...action }

          if (patch.status && patch.status !== action.status) {
            next.status = patch.status
            next.completedAt = patch.status === 'Done' ? now : undefined
            logs.push({ at: now, by: actor, byRole: persona, action: `Status → ${patch.status}`, comment: comment?.trim() || undefined })
          }
          if (patch.targetDate !== undefined && patch.targetDate !== action.targetDate) {
            // Keep the superseded target date for the strikethrough view.
            if (action.targetDate) {
              next.targetHistory = [
                ...(action.targetHistory ?? []),
                { targetDate: action.targetDate, setBy: actor, setByRole: persona, at: now }
              ]
            }
            next.targetDate = patch.targetDate || undefined
            logs.push({ at: now, by: actor, byRole: persona, action: patch.targetDate ? `Target date → ${patch.targetDate}` : 'Target date cleared' })
          }
          if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== action.title) {
            next.title = patch.title.trim()
            logs.push({ at: now, by: actor, byRole: persona, action: 'Edited title' })
          }
          if (patch.description !== undefined) {
            next.description = patch.description.trim() || undefined
            logs.push({ at: now, by: actor, byRole: persona, action: 'Edited description' })
          }
          if (patch.assignedTo !== undefined && patch.assignedTo !== action.assignedTo) {
            next.assignedTo = patch.assignedTo
            next.assignedToName = patch.assignedToName?.trim() || undefined
            logs.push({ at: now, by: actor, byRole: persona, action: `Reassigned to ${patch.assignedTo}` })
          } else if (patch.assignedToName !== undefined) {
            next.assignedToName = patch.assignedToName.trim() || undefined
          }

          if (logs.length === 0) return {}
          next.history = [...action.history, ...logs]

          const actions = entry.actions!.map((a) => (a.id === actionId ? next : a))
          const updatedEntry: ActivityEntry = { ...entry, actions, updatedAt: now, updatedBy: persona }
          return { entries: state.entries.map((e) => (e.id === entryId ? updatedEntry : e)) }
        }),

      deleteAction: (templateRowId, partNo, actionId, persona) =>
        set((state) => {
          if (!(persona === 'PIC' || persona === 'SIC' || persona === 'Admin')) return {}
          const entryId = makeEntryId(templateRowId, partNo)
          const entry = state.entries.find((e) => e.id === entryId)
          if (!entry?.actions) return {}
          const actions = entry.actions.filter((a) => a.id !== actionId)
          if (actions.length === entry.actions.length) return {}
          const updatedEntry: ActivityEntry = { ...entry, actions, updatedAt: new Date().toISOString(), updatedBy: persona }
          return { entries: state.entries.map((e) => (e.id === entryId ? updatedEntry : e)) }
        }),

      addDeviation: (templateRowId, partNo, draft, persona, actorName) =>
        set((state) => {
          const title = draft.title?.trim()
          if (!title) return {}
          if (!(persona === 'PIC' || persona === 'SIC' || persona === 'Admin')) return {}
          const row = state.templateRows.find((r) => r.id === templateRowId)
          const activity = row ? state.activities.find((a) => a.id === row.activityId) : undefined
          const part = state.parts.find((p) => p.partNo === partNo)
          if (!row || !activity || !part || part.supersededBy) return {}

          const now = new Date().toISOString()
          const actor = actorName || persona
          const flow = (activity.deviationFlow && activity.deviationFlow.length > 0)
            ? activity.deviationFlow
            : (['PIC', 'SIC', 'DPM'] as PersonaId[])
          const entryId = makeEntryId(templateRowId, partNo)
          const existing = state.entries.find((e) => e.id === entryId)

          const deviation: Deviation = {
            id: `dev-${entryId}-${(existing?.deviations?.length ?? 0) + 1}-${Date.now().toString(36)}`,
            title,
            description: draft.description?.trim() || undefined,
            edocNumber: draft.edocNumber?.trim() || undefined,
            targetDate: draft.targetDate || undefined,
            flow,
            currentStep: 0,
            status: 'In progress',
            raisedBy: actor,
            raisedByRole: persona,
            raisedAt: now,
            history: [{ at: now, by: actor, byRole: persona, action: `Raised (awaiting ${flow[0]})`, comment: draft.description?.trim() || undefined }]
          }
          const log = { timestamp: now, persona, actorName: persona === 'PIC' ? actor : undefined, action: `Raised deviation: ${title}` }

          const updated: ActivityEntry = existing
            ? { ...existing, deviations: [...(existing.deviations ?? []), deviation], history: [...existing.history, log], updatedAt: now, updatedBy: persona }
            : {
                id: entryId, templateRowId, activityId: activity.id, partNo, values: {},
                validationState: 'Draft', currentStepIndex: 0,
                deviations: [deviation], history: [log], updatedAt: now, updatedBy: persona
              }
          const entries = existing ? state.entries.map((e) => (e.id === entryId ? updated : e)) : [...state.entries, updated]
          return { entries }
        }),

      advanceDeviation: (templateRowId, partNo, deviationId, action, persona, actorName, comment) =>
        set((state) => {
          const entryId = makeEntryId(templateRowId, partNo)
          const entry = state.entries.find((e) => e.id === entryId)
          const dev = entry?.deviations?.find((d) => d.id === deviationId)
          if (!entry || !dev || dev.status === 'Approved' || dev.status === 'Rejected') return {}

          const currentRole = dev.flow[dev.currentStep]
          // Only the role whose turn it is (or Admin) can act.
          if (persona !== currentRole && persona !== 'Admin') return {}

          const now = new Date().toISOString()
          const actor = actorName || persona
          const next: Deviation = { ...dev }
          const log = (a: string) => ({ at: now, by: actor, byRole: persona, action: a, comment: comment?.trim() || undefined })

          if (action === 'Reject') {
            next.status = 'Rejected'
            next.decidedAt = now
            next.history = [...dev.history, log(`Rejected at ${currentRole}`)]
          } else if (action === 'Send back') {
            next.status = 'Sent back'
            next.currentStep = 0
            next.history = [...dev.history, log(`Sent back from ${currentRole} (restart at ${dev.flow[0]})`)]
          } else {
            // Approve: advance, or finalise at the last step.
            if (dev.currentStep >= dev.flow.length - 1) {
              next.status = 'Approved'
              next.decidedAt = now
              next.history = [...dev.history, log(`Approved at ${currentRole} — deviation approved`)]
            } else {
              next.status = 'In progress'
              next.currentStep = dev.currentStep + 1
              next.history = [...dev.history, log(`Approved at ${currentRole} (awaiting ${dev.flow[dev.currentStep + 1]})`)]
            }
          }
          // A sent-back deviation re-enters the flow as In progress on the next approver action; mark it so now.
          if (action === 'Send back') next.status = 'In progress'

          const deviations = entry.deviations!.map((d) => (d.id === deviationId ? next : d))
          const updatedEntry: ActivityEntry = { ...entry, deviations, updatedAt: now, updatedBy: persona }
          return { entries: state.entries.map((e) => (e.id === entryId ? updatedEntry : e)) }
        }),

      transitionEntryState: (entryId, action, comment, currentPersona) =>
        set((state) => {
          const entry = state.entries.find((e) => e.id === entryId)
          if (!entry) return {}
          const activity = state.activities.find((a) => a.id === entry.activityId)
          if (!activity) return {}
          if (entry.notApplicable) return {} // No workflow on a Not-applicable part; reverse it first

          // PIC actions are stamped with the person who is the part's PIC today
          const part = state.parts.find((p) => p.partNo === entry.partNo)
          const actorName =
            currentPersona === 'PIC' && part
              ? getPicOn(part, state.picAssignments, DEMO_TODAY).name || undefined
              : undefined
          // Submit / Approve wait until every open review loop of the entry is accepted.
          if (action === 'Submit' || action === 'Approve') {
            const row = state.templateRows.find((r) => r.id === entry.templateRowId)
            const model = part ? state.models.find((m) => m.name === part.model) : undefined
            if (row && openLoopMessage(activity, entry.values, ruleContext(activity, row, part, entry, model), action === 'Submit' ? currentPersona : undefined, action === 'Submit')) return {}
          }
          let transitioned = transitionEntry(activity, entry, action, comment, currentPersona, actorName)
          if (action === 'Submit' || transitioned.validationState === 'Submitted') {
            transitioned = { ...transitioned, values: startReview(activity, transitioned.values) }
          }

          // Approving a resubmission clears the latest open NG round.
          if (action === 'Approve' && transitioned.validationState === 'Approved' && transitioned.ngRounds?.some((r) => !r.resolvedAt)) {
            const now = new Date().toISOString()
            let cleared = false
            const ngRounds = [...transitioned.ngRounds]
              .reverse()
              .map((r) => (!cleared && !r.resolvedAt ? ((cleared = true), { ...r, resolvedAt: now }) : r))
              .reverse()
            transitioned = { ...transitioned, ngRounds }
          }

          return {
            entries: state.entries.map((e) => (e.id === entryId ? transitioned : e))
          }
        }),

      markEntryNg: (entryId, reason, targetDate, currentPersona) =>
        set((state) => {
          if (currentPersona !== 'PIC' && currentPersona !== 'SIC' && currentPersona !== 'DPM') return {}
          const entry = state.entries.find((e) => e.id === entryId)
          if (!entry || entry.notApplicable || entry.validationState !== 'Submitted') return {}
          const activity = state.activities.find((a) => a.id === entry.activityId)
          if (!activity?.trackNgRounds) return {}
          const part = state.parts.find((p) => p.partNo === entry.partNo)
          const byName =
            (currentPersona === 'PIC' && part ? getPicOn(part, state.picAssignments, DEMO_TODAY).name : '') || currentPersona
          const round = (entry.ngRounds?.length ?? 0) + 1
          const now = new Date().toISOString()
          const ngRounds = [...(entry.ngRounds ?? []), { round, reason, by: currentPersona as PersonaId, byName, at: now, targetDate }]
          // Send it back to the vendor, logging the NG as the reason.
          const sentBack = transitionEntry(activity, { ...entry, ngRounds }, 'Send back', `NG (round ${round}): ${reason}`, currentPersona, byName === currentPersona ? undefined : byName)
          return { entries: state.entries.map((e) => (e.id === entryId ? sentBack : e)) }
        }),

      // Dashboard Actions
      updateDashboard: (activityId, config) =>
        set((state) => ({
          dashboards: state.dashboards.map((dash) =>
            dash.activityId === activityId ? config : dash
          )
        })),

      resetDashboard: (activityId) =>
        set((state) => {
          let freshDashboard: any
          if (activityId === 'overview') {
            freshDashboard = generateOverviewDashboardConfig()
          } else {
            const activity = state.activities.find((a) => a.id === activityId)
            if (!activity) return {}
            freshDashboard = generateDashboardConfig(activity)
          }
          return {
            dashboards: state.dashboards.map((dash) =>
              dash.activityId === activityId ? freshDashboard : dash
            )
          }
        }),

      logAudit: (entry) =>
        set((state) => ({
          auditLog: [...state.auditLog, { ...entry, id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() }]
        })),
      addDocument: async (doc, file) => {
        const id = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        await putBlob(id, file)
        const now = new Date().toISOString()
        set((state) => ({
          documents: [...state.documents, { ...doc, id, uploadedAt: now }],
          auditLog: [
            ...state.auditLog,
            {
              id: `aud-${id}`,
              at: now,
              persona: doc.uploadedBy,
              actorName: doc.uploadedByName,
              action: 'Document uploaded',
              partNo: doc.partNo,
              activityId: doc.activityId,
              templateRowId: doc.templateRowId,
              detail: `${doc.name} (${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB)`
            }
          ]
        }))
      },
      deleteDocument: (docId, by, byName) => {
        if (by !== 'SIC') return false
        let removed = false
        set((state) => {
          const doc = state.documents.find((d) => d.id === docId)
          if (!doc) return {}
          removed = true
          void deleteBlob(docId)
          return {
            documents: state.documents.filter((d) => d.id !== docId),
            auditLog: [
              ...state.auditLog,
              {
                id: `aud-del-${docId}`,
                at: new Date().toISOString(),
                persona: by,
                actorName: byName,
                action: 'Document deleted',
                partNo: doc.partNo,
                activityId: doc.activityId,
                templateRowId: doc.templateRowId,
                detail: `${doc.name} (uploaded by ${doc.uploadedByName} on ${doc.uploadedAt.slice(0, 10)})`
              }
            ]
          }
        })
        return removed
      },
      restoreActivityDefault: (activityId) =>
        set((state) => {
          const seed = SEED_ACTIVITIES.find((a) => a.id === activityId)
          if (!seed) return {}
          const fresh = generateDashboardConfig(seed)
          return {
            activities: state.activities.map((a) => (a.id === activityId ? seed : a)),
            drafts: state.drafts.filter((d) => d.id !== `draft-edit-${activityId}` && d.sourceId !== activityId),
            dashboards: state.dashboards.map((d) => (d.activityId === activityId ? fresh : d))
          }
        }),
      // TEMPORARY authoring aid (remove with the header button): rebuild sample parts from the live activity fields.
      loadSampleParts: (mode = 'samples') =>
        set((state) => {
          void clearBlobs()
          const d = buildDemoData(state.activities, state.templateRows, state.models)
          // "From scratch": the parts (released to and acknowledged by the vendor) with nothing entered by people, so a
          // part's journey can be shown end to end; nothing filled, submitted, delayed or raised. What the systems
          // provide (ENOVIA, SAP, … fields entered by "System") stays, as it would in production — e.g. the OT planned date.
          if (mode === 'blank') {
            const systemKeys = new Map(state.activities.map((a) => [a.id, new Set(a.fields.filter((f) => f.enteredBy === 'System' && f.source !== 'manual' && f.source !== 'calculated').map((f) => f.key))]))
            const entries = d.entries
              .map((e) => {
                const keys = systemKeys.get(e.activityId) ?? new Set<string>()
                const values = Object.fromEntries(Object.entries(e.values ?? {}).filter(([k, v]) => keys.has(k) && v !== undefined && v !== null && v !== ''))
                return { id: e.id, templateRowId: e.templateRowId, activityId: e.activityId, partNo: e.partNo, values, validationState: 'Draft' as const, history: [], currentStepIndex: 0, updatedAt: new Date().toISOString(), updatedBy: 'System' as const }
              })
              .filter((e) => Object.keys(e.values).length > 0)
            return {
              parts: d.parts, entries, partReleases: d.partReleases, partAcks: d.partAcks, partEvents: [], picAssignments: [],
              delayReasons: [], models: d.models, documents: [], historyTransferRequests: [], notifications: [], auditLog: []
            }
          }
          // Two sample PENDING history-transfer requests (Minda V1001 parts) so the SIC has something to approve.
          const now = '2026-10-14T10:00:00Z'
          const sampleHtx: HistoryTransferRequest[] = d.parts.some((p) => p.partNo === '31100-M74LD0')
            ? [
                {
                  id: 'htx-sample-1', fromPartNo: '31100-M74LD0', toPartNos: ['31100-M74LD1'], templateRowIds: [],
                  keepSourceActive: true, reason: 'ECN-2041 — carry headlamp LH history to RH', requestedBy: 'PIC',
                  requestedByName: 'Rahul Verma', requestedAt: now, status: 'Pending'
                },
                {
                  id: 'htx-sample-2', fromPartNo: '31100-M74LD0', toPartNos: ['35520-M68P00'], templateRowIds: [],
                  keepSourceActive: false, reason: 'Second sourcing — move history and retire the old number', requestedBy: 'PIC',
                  requestedByName: 'Suresh Nair', requestedAt: now, status: 'Pending'
                }
              ]
            : []
          return {
            parts: d.parts,
            entries: d.entries,
            partReleases: d.partReleases,
            partAcks: d.partAcks,
            partEvents: [],
            picAssignments: [],
            delayReasons: d.delayReasons,
            models: d.models,
            documents: [],
            historyTransferRequests: sampleHtx,
            notifications: [],
            auditLog: []
          }
        }),
      unloadParts: () => {
        void clearBlobs()
        set({ parts: [], entries: [], partReleases: [], partAcks: [], partEvents: [], picAssignments: [], delayReasons: [], documents: [], historyTransferRequests: [], notifications: [], auditLog: [] })
      },
      // Reset Demo Data
      resetDemoData: () =>
        set({
          activities: SEED_ACTIVITIES,
          entries: SEED_ENTRIES,
          dashboards: [generateOverviewDashboardConfig(), ...SEED_ACTIVITIES.map((act) => generateDashboardConfig(act))],
          models: SEED_MODELS,
          sections: SEED_SECTIONS,
          milestones: SEED_MILESTONES,
          templateRows: SEED_TEMPLATE_ROWS,
          picAssignments: SEED_PIC_ASSIGNMENTS,
          parts: MOCK_PART_LIST.map((p) => ({ ...p, origin: 'SAP' as const, technicalCategory: deriveTechnicalCategory(p) })),
          documents: [],
          masterLists: SEED_MASTER_LISTS,
          notifications: [],
          auditLog: [],
          historyTransferRequests: [],
          partEvents: SEED_PART_EVENTS,
          partReleases: SEED_PART_RELEASES,
          partAcks: SEED_PART_ACKS,
          delayReasons: SEED_DELAY_REASONS,
          crossDashboards: [],
          activityDependencies: [],
          archetypes: SEED_ARCHETYPES,
          vendorInfo: SEED_VENDOR_INFO,
          vendorVisits: SEED_VENDOR_VISITS,
          drafts: [],
          savedViews: []
        })
    }),
    {
      name: 'qa-tracker-store',
      // v2: planned dates removed from activities; entries keyed by template row. v3: PIC assignments. v4: part applicability. v6: default "Completion rate by Model / Department" charts. v7: part master lifted into store (manual/dummy parts + ECN transfer). v8: PIC release-to-vendor gate. v9: vendor-set planned timelines. v10: actions/recommendations on entries. v11: cross-activity dashboards. v12: table field type + SOR activity. v13: removed Temporary/Permanent from PIC assignments. v14: manpower planning (vendor info + visits). v15: seed activities replaced with ~45 PPT blueprints + deviations on entries. v20: delay reasons (vendor gives, PIC accepts or sends back). v19: vendor acknowledge/return of released parts, ddvm/dvm personas removed. v44: governance archetypes (WBS templates feed the Activity Builder). Stale data is dropped.
      version: STORE_VERSION,
      // Real migration (see ./migrate): keeps entries and activities, converts old rules, maps renamed pp-9 keys.
      migrate: (persisted, from) => migrateStore(persisted, from, { activities: SEED_ACTIVITIES, masterLists: SEED_MASTER_LISTS, templateRows: SEED_TEMPLATE_ROWS, archetypes: SEED_ARCHETYPES }) as any
    }
  )
)

if (typeof window !== 'undefined') {
  ;(window as any).useQAStore = useQAStore
}


