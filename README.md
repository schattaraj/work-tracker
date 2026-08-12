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
- **Storage**: everything is a real JSON file (`users.json`, `db.json`),
  read and rewritten wholesale on every change — see [`lib/store.js`](lib/store.js).
  - In production on Vercel: the file lives in **Vercel Blob** (`access:
    'private'` — never given out as a public URL, only fetched server-side
    with your storage token).
  - Locally, with no Blob token configured: the file lives on disk under
    `./data/`, so you can develop without a Vercel account at all.
- **Auth**: bcrypt-hashed passwords, a JWT session in an **httpOnly cookie**
  (`jose`, Web-Crypto based so it also works in the Edge middleware).
  Registration creates a `pending` account; only an admin flipping it to
  `active` lets that person log in.
- **Data scope**: one shared workspace. Every active user reads and writes
  the same `db.json` — login controls *who's allowed in*, not who owns which
  task. (See "Known limitations" below.)

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

## Known limitations (by design, for a free/small-scale tool)

- **Whole-file writes.** Every save rewrites the entire `db.json`. Two
  people editing at the exact same instant can race — the later write wins
  and the earlier one's change to *other* records is not lost (both are
  mutating the same growing in-memory list before either writes), but two
  edits to the *same* record at the same instant can still clobber each
  other. Not a real database — fine for a personal or small-team tool, not
  built for heavy concurrent write load.
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
