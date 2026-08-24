#!/usr/bin/env node
// ============================================================================
// One-time migration: copies existing JSON-blob data (users.json, db.json —
// from Vercel Blob or local disk, whichever jsonDriver.js currently reads)
// into MySQL tables.
//
// Safe to re-run: it overwrites MySQL's tables with whatever the JSON
// driver currently has, using the same writeUsers()/writeDb() functions
// the app itself uses — it does not merge, and running it twice in a row
// just re-copies the same source data.
//
// Usage:
//   node scripts/migrate-json-to-mysql.mjs
//
// Reads connection info from .env.local (or real env vars) automatically —
// BLOB_READ_WRITE_TOKEN (or nothing, for local-disk ./data) as the JSON
// source, and DATABASE_URL / MYSQL_* as the MySQL destination. It does NOT
// read STORAGE_DRIVER — this script always reads JSON and always writes
// MySQL, regardless of which driver lib/store.js is currently set to.
// ============================================================================

import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Next.js loads .env.local automatically for `next dev`/`next build`; a
// plain `node` invocation like this one doesn't, so load it ourselves
// (no dotenv dependency needed for a handful of KEY=VALUE lines).
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const jsonDriver = await import('../lib/storage/jsonDriver.js');
const mysqlDriver = await import('../lib/storage/mysqlDriver.js');

async function main() {
  console.log('Reading existing data from the JSON driver…');
  const users = await jsonDriver.readUsers();
  const db = await jsonDriver.readDb();

  console.log(
    `Found ${users.users.length} user(s), ${db.tasks.length} task(s), ${db.bugs.length} bug(s), ` +
    `${Object.keys(db.dailyLogs).length} daily log(s), ${db.voiceNotes.length} voice note(s), ` +
    `${db.screenshots.length} screenshot(s), ${db.activity.length} activity entr${db.activity.length === 1 ? 'y' : 'ies'}.`
  );

  if (users.users.length) {
    console.log('Writing users to MySQL…');
    await mysqlDriver.writeUsers(users);
  } else {
    console.log('No users in the JSON source — skipping (MySQL will seed its own admin on first login, same as the JSON driver does).');
  }

  console.log('Writing workspace data (tasks/bugs/logs/voice notes/screenshots/activity) to MySQL…');
  await mysqlDriver.writeDb(db);

  console.log('\n✓ Migration complete.');
  console.log('  Set STORAGE_DRIVER=mysql (env var) or edit the constant at the top of lib/store.js to start using it.');
  process.exit(0);
}

main().catch(err => {
  console.error('\n✗ Migration failed:', err);
  process.exit(1);
});
