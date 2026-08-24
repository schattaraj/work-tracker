# DevTrack — Personal Developer Work Tracker

A Jira/Trello/Notion-flavored tracker for a solo dev or small team: tasks,
bugs, a daily work log, voice notes, screenshots, a Kanban board, a calendar,
and reports — with real login and admin-gated registration.

## How it's built

- **Frontend**: plain HTML/CSS/vanilla JS under [`public/`](public/) — no
  build step, no framework. This is almost entirely the original static app;
  only the data layer changed.
- **Backend**: a small [Next.js](https://nextjs.org) app that exists *only*
  to serve `/api/*` routes and an auth `middleware.js`. There's no React UI
  to speak of — `app/page.js` just redirects to the static shell.
- **Storage**: pluggable — [`lib/store.js`](lib/store.js) picks between two
  interchangeable drivers under [`lib/storage/`](lib/storage/) with a single
  line (`STORAGE_DRIVER`), and nothing above that file (routes, frontend)
  needs to know or care which is active:
  - `json` (default) — one JSON document per "file" (`users.json`,
    `db.json`), read and rewritten wholesale on every change. In production
    on Vercel it lives in **Vercel Blob** (`access: 'private'` — never given
    out as a public URL, only fetched server-side with your storage token);
    locally, with no Blob token configured, it's a plain file under `./data/`.
  - `mysql` — real relational tables (see [`lib/storage/mysqlSchema.sql`](lib/storage/mysqlSchema.sql)),
    created automatically on first use. See "Using MySQL instead" below.
- **Auth**: bcrypt-hashed passwords, a JWT session in an **httpOnly cookie**
  (`jose`, Web-Crypto based so it also works in the Edge middleware).
  Registration creates a `pending` account; only an admin flipping it to
  `active` lets that person log in.
- **Data scope**: bugs/daily logs/activity are one shared workspace — every
  active user reads and writes the same records, login just controls *who's
  allowed in*. Tasks are finer-grained: personal tasks are private to their
  creator, team tasks are fully shared, and project tasks are scoped to
  project membership (read) and task assignment (write) — see "Projects"
  below. (See "Known limitations" below.)

## Local development

```bash
npm install
cp .env.example .env.local   # then edit .env.local
npm run dev
```

Open http://localhost:3000 — it redirects to `/login.html`. Sign in with the
seeded admin account (`ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env.local`,
defaults to `admin@devtrack.local` / `ChangeMe123!` if unset — **change the
password after your first login**, there's no in-app "change password" yet,
see limitations). Data is written to `./data/users.json` and `./data/db.json`
— gitignored, safe to delete to reset everything.

Register a second account from `/register.html` in an incognito window to see
the pending → admin-approves → login flow.

## Deploying to Vercel (free tier)

1. Push this repo to GitHub and import it in Vercel.
2. **Storage → Create Database → Blob** on the project, then connect it.
   Vercel injects `BLOB_READ_WRITE_TOKEN` for you automatically — that's the
   only thing that switches the app from local-file mode to Blob mode.
3. **Settings → Environment Variables**, add:
   - `AUTH_SECRET` — a long random string. Generate one with:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — optional, used only the very first
     time the app runs (when `users.json` doesn't exist yet) to seed the
     built-in admin.
4. Deploy. Visit the URL, sign in as the seeded admin, and approve real
   users as they register from `/register.html`.

### Something's broken after deploying?

Visit **`/api/health`** on your deployment (no login required). It reports
whether `AUTH_SECRET` and the Blob store are actually configured, e.g.:

```json
{
  "ok": false,
  "environment": "vercel",
  "storageMode": "local-disk",
  "authSecretConfigured": true,
  "blobConfigured": false,
  "problems": ["BLOB_READ_WRITE_TOKEN is not set — connect a Vercel Blob store..."]
}
```

The most common cause of a 500 on login/register right after deploying is
exactly this: no Blob store connected yet, so the server tries (and fails)
to write to local disk, which is read-only on Vercel. Connect one under
**Storage → Create Database → Blob**, then **redeploy** (env vars only take
effect on the next deployment, not retroactively on the running one). Every
API route also now logs the real error to the function's console — check
**Vercel Dashboard → your project → Logs** if `/api/health` looks fine but
something else is still failing.

## Using MySQL instead

Everything above defaults to the `json` driver. To switch to real MySQL
tables instead:

1. Have a MySQL server reachable (local, Docker, PlanetScale, Railway, a
   VPS — anything). Locally, the quickest way is Docker:
   ```bash
   docker run -d --name devtrack-mysql \
     -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=devtrack \
     -e MYSQL_USER=devtrack -e MYSQL_PASSWORD=devtrack_pw \
     -p 3306:3306 mysql:8.0
   ```
2. In `.env.local`, either set `DATABASE_URL=mysql://user:pass@host:3306/devtrack`
   or the discrete `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE`
   vars (see `.env.example`).
3. Flip the driver — either set `STORAGE_DRIVER=mysql` in `.env.local`, or
   edit the constant at the top of `lib/store.js` directly:
   ```js
   const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'json'; // ← change 'json' to 'mysql'
   ```
4. Run the app. **No manual migration step** — the tables (see
   [`lib/storage/mysqlSchema.sql`](lib/storage/mysqlSchema.sql)) are created
   automatically the first time the driver is used.
5. **Already have data under the `json` driver?** Bring it over once with:
   ```bash
   npm run migrate:json-to-mysql
   ```
   This reads whatever `jsonDriver.js` currently sees (Blob or local disk)
   and writes it into MySQL via the same `writeUsers`/`writeDb` the app uses
   — safe to re-run, it overwrites MySQL with the JSON source each time
   rather than merging.

`/api/health` reports which driver is active and, when it's `mysql`, whether
the connection actually works — check there first if something's off.

Both drivers implement the exact same functions
(`readUsers`/`writeUsers`/`readDb`/`writeDb`/`backupDb`/`restoreDb`), so
switching back and forth touches nothing outside `lib/store.js` and
`lib/storage/*` — not the API routes, not the frontend. The MySQL driver
also removes the JSON driver's biggest limitation: `writeDb()` runs inside a
real transaction, so a crash mid-save can no longer leave half-written data
(the JSON driver's whole-file overwrite can, in principle, if the process
dies between "read" and "write" — see "Known limitations" below).

## Projects

A `Project` (`{ id, name, description, status, assignedUserIds, createdAt,
updatedAt }`) is a real entity, separate from tasks, with its own
server-validated CRUD API:

- `GET /api/projects` — every active user can call this; the response is
  pre-scoped to their own memberships (admins get everything).
- `POST /api/projects`, `PATCH /api/projects/:id` — admin-only. Editing
  covers name/description/`status` (`active`/`archived` — the existing
  archive/deactivate concept, reused here) and `assignedUserIds`.
  `assignedUserIds` is always re-validated server-side against real,
  currently-*active* accounts — a request naming a pending/suspended/
  nonexistent user id is rejected outright, never silently dropped.
- `GET /api/projects/:id` and `GET /api/projects/:id/tasks` — re-validate
  membership from the URL's `:id` against the server's own project data on
  every call (never trust a client-supplied id) and return `404` (not
  `403`) for both "doesn't exist" and "exists but you're not on it", so
  guessing ids can't be used to enumerate real projects.

**Tasks** gained an optional `projectId` and a third `taskType: 'project'`
(alongside the existing `'personal'`/`'team'`). Project-task *storage*
stays in the existing shared `/api/data` blob (to avoid rewriting the
frontend's whole data layer around a new REST resource), but
`lib/store.js#readDbForUser` / `#writeDbForUser` now enforce, entirely
server-side, per request:

- **Read** — a project task is visible if you're an admin or a member of
  its project. (`canReadTask` in `lib/store.js`.)
- **Write** (edit/delete) — narrower: project *membership* alone is not
  enough. Only the task's specific `assigneeId`, or an admin, can write to
  it — a member who isn't the assignee gets it back from the API just like
  everyone else, but any edit they submit for it is silently discarded and
  the server's own copy is kept, regardless of what the client sends.
  (`canWriteTask`.) The frontend mirrors this (disabled fields, hidden
  Save/Delete, a "View only" notice) but that's a courtesy, not the
  enforcement — the server re-derives the same answer from its own data on
  every write, never from anything the client claims about itself.
- **Create** — needs project *membership* (or admin), checked against the
  project the new task claims to belong to before it's ever added.

Backward-compatibility / migration strategy for existing data (as
requested, documented here explicitly): **purely additive, no
migration or backfill needed.** `projectId` and `taskType: 'project'` are
optional/new — every existing task (`'personal'` or `'team'`, no
`projectId` at all) is completely unaffected, because `canReadTask` /
`canWriteTask` only ever consult project membership when
`taskType === 'project'`; for anything else they fall through to the exact
same rules as before. An old task record simply never enters the new code
path. The same applies at the storage layer — `defaultDb()` /
`readDb()` backfill a missing `projects: []` and `meta.projectSeq: 0` for
any snapshot that predates this feature (both drivers), so nothing crashes
on old data; there was nothing to convert.

`Project` IDs follow the same sequential convention as tasks/bugs
(`PROJECT-1`, `PROJECT-2`, …) via a `meta.projectSeq` counter — generated
server-side in `POST /api/projects` this time (not client-side like
task/bug ids), using an atomic `incrementCounter()` so two concurrent
project-creation requests can't collide on the same id. Dates are the same
ISO-8601-string convention used everywhere else, with `createdAt`/
`updatedAt` field names matching the existing `users` entity.

## Known limitations (by design, for a free/small-scale tool)

- **Whole-document writes.** Every save replaces the entire tasks/bugs/etc.
  data set (a full file with the `json` driver, or every row in a table
  with the `mysql` driver — see "Using MySQL instead"). Two people editing
  the exact *same* record at the exact same instant can still race — the
  later write wins — regardless of driver, since neither does per-field
  optimistic locking. Where the drivers differ: the `mysql` driver wraps
  each write in a real transaction, so a crash mid-save can't leave
  half-written data; the `json` driver's plain file write, in principle,
  can. Fine for a personal or small-team tool either way — not built for
  heavy concurrent write load.
- **Shared workspace, not per-user data.** Everyone active sees the same
  tasks/bugs/logs. Admin-only actions (Import JSON, Backup, Restore, Clear
  Storage) are hidden from regular users and, for Backup/Restore, also
  blocked server-side — but any active user can still edit/delete any task
  or bug one at a time, same as before.
- **No password reset / change-password flow yet.** An admin can suspend or
  re-activate an account from `/admin.html`, but resetting a forgotten
  password currently means an admin deleting the entry from `users.json`
  (or the Blob store) so the person can re-register.
- **Screenshots still ride along as base64 inside `db.json`.** This was the
  explicit ask ("everything in a JSON file"), but it means a workspace with
  lots of screenshots makes that one file — and every save of it — bigger.
  If that becomes a problem, the natural next step is moving screenshots to
  their own Vercel Blob entries (one per image) and storing just their URLs
  in `db.json`.
