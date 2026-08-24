// ============================================================================
// JSON-blob storage driver.
//
// Two backends, chosen automatically:
//  - Vercel Blob (production) — used whenever BLOB_READ_WRITE_TOKEN is set.
//    Each "file" (users.json / db.json / db.backup.json) is a real private
//    blob: read and rewritten wholesale on every change. Private access means
//    it is never reachable by a public URL — only these server-side helpers
//    (holding the token) can read it.
//  - Local disk under ./data (development) — used when no Blob token is
//    configured, so the app is fully testable without a Vercel account.
//
// Known limitation: every write replaces the whole file. Two requests writing
// at nearly the same instant can race (last write wins) — acceptable for a
// small personal/team tool. See lib/storage/mysqlDriver.js for a backend
// without this limitation.
//
// This module implements the same function contract as mysqlDriver.js —
// see lib/store.js for how the active one is picked.
// ============================================================================

import { put, get as blobGet } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DIR = path.join(process.cwd(), 'data');

// Serializes read-modify-write access per file within this process. Reduces
// (does not eliminate — see limitation above) the chance of two requests
// handled by the same server instance clobbering each other.
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

async function readFileBackend(filename) {
  if (USE_BLOB) {
    const result = await blobGet(filename, { access: 'private' }).catch(err => {
      if (err && (err.name === 'BlobNotFoundError' || /not.?found/i.test(err.message || ''))) return null;
      throw err;
    });
    if (!result) return null;
    return await new Response(result.stream).text();
  }
  try {
    return await fs.readFile(path.join(LOCAL_DIR, filename), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeFileBackend(filename, text) {
  if (USE_BLOB) {
    await put(filename, text, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json'
    });
    return;
  }
  // On Vercel (and most serverless hosts) the filesystem is read-only outside
  // /tmp, and /tmp isn't persisted between invocations — so the local-disk
  // fallback can only ever work for local `next dev`. Fail loudly and early
  // with an actionable message instead of a bare EROFS/EACCES stack trace.
  if (process.env.VERCEL) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not set. On Vercel, data cannot be written to local ' +
      'disk — connect a Blob store to this project (Storage → Create Database → ' +
      'Blob) so Vercel injects that token, then redeploy.'
    );
  }
  try {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, filename), text, 'utf8');
  } catch (err) {
    err.message = `Failed to write local data file "${filename}" under ${LOCAL_DIR}: ${err.message}`;
    throw err;
  }
}

async function readJson(filename, defaultValue) {
  const text = await readFileBackend(filename);
  if (text === null) return JSON.parse(JSON.stringify(defaultValue));
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(JSON.stringify(defaultValue));
  }
}

function writeJson(filename, data) {
  return withLock(filename, () => writeFileBackend(filename, JSON.stringify(data, null, 2)));
}

/* ---------------------------- users.json ---------------------------- */

export async function readUsers() {
  return readJson('users.json', { users: [] });
}

export function writeUsers(data) {
  return writeJson('users.json', data);
}

/* ------------------------------ db.json ------------------------------ */

export function defaultDb() {
  return {
    tasks: [], bugs: [], dailyLogs: {}, voiceNotes: [], screenshots: [], activity: [], projects: [],
    meta: { taskSeq: 0, bugSeq: 0, projectSeq: 0 }
  };
}

export async function readDb() {
  const data = await readJson('db.json', defaultDb());
  // Backfill any keys missing from an older snapshot (older data predates
  // projects entirely — falls back to defaultDb()'s empty projects: []).
  const withDefaults = Object.assign(defaultDb(), data);
  withDefaults.meta = Object.assign({ taskSeq: 0, bugSeq: 0, projectSeq: 0 }, data.meta);
  return withDefaults;
}

// Atomically increments a named counter in meta (e.g. "projectSeq") and
// returns the new value — used for server-generated IDs (project creation)
// where two concurrent requests reading the same starting value would
// otherwise collide. Reads/writes db.json directly (not via readDb/writeDb)
// so the whole read-modify-write happens inside a single lock acquisition;
// calling the readJson/writeJson wrappers here would double-acquire the
// same 'db.json' lock and deadlock.
export function incrementCounter(name) {
  return withLock('db.json', async () => {
    const text = await readFileBackend('db.json');
    let current = {};
    if (text) { try { current = JSON.parse(text); } catch { current = {}; } }
    const withDefaults = Object.assign(defaultDb(), current);
    withDefaults.meta = Object.assign({ taskSeq: 0, bugSeq: 0, projectSeq: 0 }, current.meta);
    withDefaults.meta[name] = (withDefaults.meta[name] || 0) + 1;
    await writeFileBackend('db.json', JSON.stringify(withDefaults, null, 2));
    return withDefaults.meta[name];
  });
}

export function writeDb(data) {
  return writeJson('db.json', data);
}

export async function backupDb() {
  const current = await readJson('db.json', defaultDb());
  await writeJson('db.backup.json', { data: current, backedUpAt: new Date().toISOString() });
}

export async function restoreDb() {
  const backup = await readJson('db.backup.json', null);
  if (!backup) return null;
  await writeDb(backup.data);
  return backup;
}

export const usesBlobStorage = USE_BLOB;
