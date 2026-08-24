// ============================================================================
// Storage entry point.
//
// Two interchangeable drivers live under lib/storage/ — jsonDriver.js (the
// original: one JSON document per "file", in Vercel Blob or a local file)
// and mysqlDriver.js (real relational tables). Both implement the exact
// same function contract (readUsers/writeUsers/readDb/writeDb/defaultDb/
// backupDb/restoreDb/incrementCounter), so nothing outside this file needs
// to know or care which is active — not the API routes, not the frontend.
//
//   ▼▼▼ Change this one line to switch storage backends manually ▼▼▼
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'json'; // 'json' | 'mysql'
//   ▲▲▲ ------------------------------------------------------------- ▲▲▲
//
// (An env var override is also honored, so a deployment can pick its
// driver without a code change — but the constant above is what to edit
// for local/manual switching, and is what applies whenever the env var
// isn't set.)
// ============================================================================

import * as jsonDriver from './storage/jsonDriver.js';
import * as mysqlDriver from './storage/mysqlDriver.js';

const driver = STORAGE_DRIVER === 'mysql' ? mysqlDriver : jsonDriver;

export const activeStorageDriver = STORAGE_DRIVER === 'mysql' ? 'mysql' : 'json';
export const usesBlobStorage = driver.usesBlobStorage;

export const readUsers = driver.readUsers;
export const writeUsers = driver.writeUsers;
export const defaultDb = driver.defaultDb;
export const readDb = driver.readDb;
export const writeDb = driver.writeDb;
export const backupDb = driver.backupDb;
export const restoreDb = driver.restoreDb;
export const incrementCounter = driver.incrementCounter;

/* ========================================================================
   Everything below is driver-agnostic: it only calls the exports above, so
   it behaves identically no matter which backend is active.

   PROJECTS — data model & access rules
   -------------------------------------
   A project: { id, name, description, status ('active'|'archived'),
   assignedUserIds, createdAt, updatedAt }. Project *mutations* (create /
   edit / archive / membership) only ever happen through the dedicated
   app/api/projects* routes, which validate independently against the
   requested project — never through the general /api/data blob (see
   writeDbForUser below, which always discards whatever a client sends for
   `projects`). Project *reads* (the list, and read-through into tasks) are
   scoped here so the rule lives in exactly one place for both paths.

   TASK VISIBILITY / WRITE LEVELS — additive, backward-compatible
   -----------------------------------------------------------------
   Existing tasks (taskType 'personal' | 'team', no projectId) are
   completely unaffected — taskWriteLevel() falls through to the exact same
   rules as before for those (full access, same as pre-project behavior).
   The new taskType 'project' is the only thing that consults project
   membership/assignment at all, and projectId is simply absent/ignored for
   every other task — no migration/backfill of old rows was needed.

   For a project task specifically, write access has three levels:
     'none'    — not the assignee, not admin: read-only (or no access at
                 all, if not even a project member — see canReadTask).
     'limited' — the task's assignee (not admin): can update status,
                 checklist items, and developer notes, and can attach new
                 screenshots — but cannot edit any other field, cannot
                 delete the task, and cannot remove an existing screenshot.
                 The idea: the assignee updates progress and evidence of
                 work, but doesn't rewrite the task's definition or make it
                 disappear.
     'full'    — admin only, for project tasks: every field, delete
                 included.
   ==================================================================== */

export function isProjectMember(project, userId) {
  return !!project && Array.isArray(project.assignedUserIds) && project.assignedUserIds.includes(userId);
}

// READ: can this user see the task at all?
//  - team: everyone (unchanged existing behavior)
//  - personal: the creator only (unrecorded creator = pre-dates ownership
//    tracking, stays visible to everyone — see the Claim feature)
//  - project: admin, or a member of the task's project
export function canReadTask(task, user, projectsById) {
  if (user.role === 'admin') return true;
  const type = task.taskType || 'personal';
  if (type === 'team') return true;
  if (type === 'personal') return !task.createdById || task.createdById === user.id;
  if (type === 'project') return isProjectMember(projectsById.get(task.projectId), user.id);
  return true; // unknown/legacy type — fail open to the pre-existing permissive default
}

// 'none' | 'limited' | 'full' — see the file header for what each means.
function taskWriteLevel(task, user, projectsById) {
  if (user.role === 'admin') return 'full';
  const type = task.taskType || 'personal';
  if (type === 'team') return 'full'; // unchanged: any active user can edit a team task
  if (type === 'personal') return (!task.createdById || task.createdById === user.id) ? 'full' : 'none';
  if (type === 'project') return task.assigneeId === user.id ? 'limited' : 'none';
  return 'full';
}

// Can this user change *anything* about the task (used to decide whether
// the edit modal opens interactively at all, vs. fully read-only)?
export function canWriteTask(task, user, projectsById) {
  return taskWriteLevel(task, user, projectsById) !== 'none';
}

// Can this user delete the task, or edit fields beyond the limited set?
// Only 'full' qualifies — a limited-write assignee cannot.
export function canFullyWriteTask(task, user, projectsById) {
  return taskWriteLevel(task, user, projectsById) === 'full';
}

export function isLimitedWriteTask(task, user, projectsById) {
  return taskWriteLevel(task, user, projectsById) === 'limited';
}

// The only task fields a limited-write user (a project task's assignee) may
// change. Everything else on the task is forced back to the server's
// existing value regardless of what the client sends — see writeDbForUser.
const LIMITED_WRITE_FIELDS = ['status', 'checklist', 'notes'];

// CREATE: governs whether a brand-new task (an id not yet in current.tasks)
// may be added at all. Project tasks need project *membership* (not
// assignee — the assignee may be a teammate, not necessarily the creator);
// personal tasks need self-attribution; team tasks stay open to anyone.
function canCreateTask(task, user, projectsById) {
  if (user.role === 'admin') return true;
  const type = task.taskType || 'personal';
  if (type === 'project') return isProjectMember(projectsById.get(task.projectId), user.id);
  if (type === 'personal') return !task.createdById || task.createdById === user.id;
  return true;
}

// Server-side view for a given user: personal tasks belonging to *other*
// users, and project tasks for projects they're not a member of (plus
// anything attached to any hidden task — screenshots, voice notes), are
// stripped out before the response ever leaves the server. Hiding this only
// in the UI wouldn't be real privacy — the browser would still have received
// the data and could still act on it (including deleting it).
//
// `user` is the full session user ({ id, role, ... }) — role is needed here
// for the admin bypass, not just id.
export async function readDbForUser(user) {
  const db = await readDb();
  const projectsById = new Map((db.projects || []).map(p => [p.id, p]));
  const isAdmin = user.role === 'admin';

  const visibleProjects = isAdmin ? db.projects : (db.projects || []).filter(p => isProjectMember(p, user.id));
  const visibleTasks = db.tasks.filter(t => canReadTask(t, user, projectsById));
  const visibleTaskIds = new Set(visibleTasks.map(t => t.id));

  return {
    ...db,
    projects: visibleProjects,
    tasks: visibleTasks,
    screenshots: db.screenshots.filter(s => s.linkedType !== 'task' || visibleTaskIds.has(s.linkedId)),
    voiceNotes: db.voiceNotes.filter(v => v.linkedType !== 'task' || visibleTaskIds.has(v.linkedId))
  };
}

// Merges a client's write with the full server state instead of blindly
// overwriting it, because that client's own copy never contained tasks it
// can't read (readDbForUser stripped them) — a naive overwrite would
// silently delete them. Every task in the incoming payload is re-validated
// against *server-trusted* state (the current record, and current project
// membership) — never against whatever the client claims about itself —
// so a crafted request can't rename/steal/edit/delete a task, or edit a
// field / remove a screenshot it only has limited access to, by forging
// the request.
//
// `projects` are never accepted from this endpoint at all: project
// mutations only happen through app/api/projects*, which validate
// independently per-project. Whatever a client sends here for `projects`
// is discarded and the server's current list is kept as-is.
export async function writeDbForUser(user, incoming) {
  const current = await readDb();
  const projectsById = new Map((current.projects || []).map(p => [p.id, p]));
  const currentTasksById = new Map(current.tasks.map(t => [t.id, t]));

  // Tasks this user can't even read must be preserved untouched (privacy).
  const notReadable = current.tasks.filter(t => !canReadTask(t, user, projectsById));
  const notReadableIds = new Set(notReadable.map(t => t.id));

  // Among tasks they CAN read: some they can't touch at all (project
  // member, not assignee) — fully preserved, no exceptions. Some they can
  // only partially edit (the assignee) — handled specially below.
  const noWrite = current.tasks.filter(t => !notReadableIds.has(t.id) && taskWriteLevel(t, user, projectsById) === 'none');
  const limited = current.tasks.filter(t => !notReadableIds.has(t.id) && taskWriteLevel(t, user, projectsById) === 'limited');
  const limitedById = new Map(limited.map(t => [t.id, t]));

  const preserved = [...notReadable, ...noWrite];
  const preservedIds = new Set(preserved.map(t => t.id));

  const incomingTasks = Array.isArray(incoming.tasks) ? incoming.tasks : [];
  const sanitizedIncomingTasks = incomingTasks
    .filter(t => !preservedIds.has(t.id)) // server's copy always wins for these — drop whatever the client sent
    .map(t => {
      const limitedExisting = limitedById.get(t.id);
      if (limitedExisting) {
        // Take only the whitelisted fields from the client; every other
        // field — including taskType/projectId/assigneeId/title/etc. —
        // is forced back to the server's existing value, regardless of
        // what the incoming object claims.
        const patched = { ...limitedExisting };
        for (const field of LIMITED_WRITE_FIELDS) {
          if (field in t) patched[field] = t[field];
        }
        patched.updatedDate = t.updatedDate || limitedExisting.updatedDate;
        if (Array.isArray(t.history)) patched.history = t.history;
        return patched;
      }
      const existing = currentTasksById.get(t.id);
      // Editing an existing, fully-writable task: re-check against the
      // AUTHORITATIVE existing record, not the (possibly tampered) incoming
      // one.
      if (existing) return canFullyWriteTask(existing, user, projectsById) ? t : existing;
      // Brand-new task.
      return canCreateTask(t, user, projectsById) ? t : null;
    })
    .filter(Boolean);

  // A limited-write user can't delete their task by simply omitting it
  // from the payload (the normal way a delete is expressed) — restore it
  // from the server if it went missing from what they sent.
  const sanitizedIds = new Set(sanitizedIncomingTasks.map(t => t.id));
  for (const t of limited) {
    if (!sanitizedIds.has(t.id)) sanitizedIncomingTasks.push(t);
  }

  const writableTaskIds = new Set(sanitizedIncomingTasks.map(t => t.id)); // includes limited-write task ids

  function mergeVoiceNotes(incomingArr, currentArr) {
    const sanitizedIncoming = (Array.isArray(incomingArr) ? incomingArr : [])
      .filter(x => x.linkedType !== 'task' || writableTaskIds.has(x.linkedId));
    const preservedForeign = currentArr.filter(x => x.linkedType === 'task' && preservedIds.has(x.linkedId));
    return [...sanitizedIncoming, ...preservedForeign];
  }

  // Screenshots follow the same base rule as voice notes (can't touch ones
  // on a task you can't write to at all), plus one more: on a
  // limited-write task, existing screenshots can't be removed — only
  // added to. Any screenshot the server already has for that task is kept
  // even if the client's payload dropped it.
  function mergeScreenshots(incomingArr, currentArr) {
    const incoming = Array.isArray(incomingArr) ? incomingArr : [];
    const sanitizedIncoming = incoming.filter(x => x.linkedType !== 'task' || writableTaskIds.has(x.linkedId));
    const preservedForeign = currentArr.filter(x => x.linkedType === 'task' && preservedIds.has(x.linkedId));
    const sanitizedIncomingIds = new Set(sanitizedIncoming.map(x => x.id));
    const preservedUndeletable = currentArr.filter(x =>
      x.linkedType === 'task' && limitedById.has(x.linkedId) && !sanitizedIncomingIds.has(x.id)
    );
    return [...sanitizedIncoming, ...preservedForeign, ...preservedUndeletable];
  }

  const merged = {
    ...defaultDb(),
    ...incoming,
    tasks: [...sanitizedIncomingTasks, ...preserved],
    screenshots: mergeScreenshots(incoming.screenshots, current.screenshots),
    voiceNotes: mergeVoiceNotes(incoming.voiceNotes, current.voiceNotes),
    projects: current.projects // never accepted from this endpoint — see doc comment above
  };
  await writeDb(merged);
  return merged;
}
