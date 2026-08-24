// ============================================================================
// MySQL storage driver — real relational tables instead of a JSON blob.
//
// Implements the exact same function contract as jsonDriver.js (see
// lib/store.js for how the active one is picked), so nothing above this
// file — not the API routes, not the frontend — needs to know or care
// which one is active.
//
// Schema lives in mysqlSchema.sql (human-readable reference); the same
// CREATE TABLE IF NOT EXISTS statements are executed here automatically the
// first time this driver is used in a process, so there's no separate
// migration step to run by hand.
//
// Design notes (see mysqlSchema.sql for the full rationale):
//  - Date/time fields are stored as the app's own ISO-8601 strings
//    (VARCHAR), not native DATETIME — the app already does all date math in
//    JS, so this avoids MySQL session-timezone conversion pitfalls for zero
//    loss of capability.
//  - tags / checklist / history stay as JSON columns rather than join
//    tables — small, always scoped to one task/bug, never queried alone.
//  - writeDb() replaces each table's contents wholesale inside a single
//    transaction (matching the JSON driver's "whole document" semantics
//    exactly, so lib/store.js#writeDbForUser's merge/authorization logic
//    works unchanged against either driver) — but because it's a real
//    transaction, a crash mid-write can no longer leave half-written data,
//    which the JSON driver can't guarantee.
// ============================================================================

import mysql from 'mysql2/promise';

function getConnectionConfig() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'devtrack',
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 5)
  };
}

let pool = null;
function getPool() {
  if (!pool) pool = mysql.createPool(getConnectionConfig());
  return pool;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'user',
    status VARCHAR(16) NOT NULL DEFAULT 'pending', created_at VARCHAR(64) NOT NULL, updated_at VARCHAR(64) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY, title VARCHAR(500) NOT NULL, description TEXT, category VARCHAR(64),
    priority VARCHAR(32), status VARCHAR(32), project VARCHAR(255), tags JSON, created_date VARCHAR(64),
    updated_date VARCHAR(64), due_date VARCHAR(16), estimated_hours VARCHAR(32), actual_hours VARCHAR(32),
    checklist JSON, notes MEDIUMTEXT, favorite TINYINT(1) NOT NULL DEFAULT 0, pinned TINYINT(1) NOT NULL DEFAULT 0,
    archived TINYINT(1) NOT NULL DEFAULT 0, history JSON, timer_start VARCHAR(64),
    task_type VARCHAR(16) NOT NULL DEFAULT 'personal', assignee_id VARCHAR(64), created_by_id VARCHAR(64),
    created_by_name VARCHAR(255), project_id VARCHAR(64),
    INDEX idx_tasks_task_type (task_type), INDEX idx_tasks_created_by (created_by_id), INDEX idx_tasks_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS bugs (
    id VARCHAR(64) PRIMARY KEY, title VARCHAR(500), severity VARCHAR(32), priority VARCHAR(32),
    environment VARCHAR(64), module VARCHAR(255), browser VARCHAR(255), steps_to_reproduce TEXT,
    expected_result TEXT, actual_result TEXT, root_cause TEXT, fix_notes TEXT, status VARCHAR(32),
    created_date VARCHAR(64), resolved_date VARCHAR(64), history JSON
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS daily_logs (
    log_date VARCHAR(16) PRIMARY KEY, goals TEXT, completed_work TEXT, pending_work TEXT, blockers TEXT,
    meeting_notes TEXT, learning TEXT, tomorrow_plan TEXT, voice_note TEXT, updated_date VARCHAR(64)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS voice_notes (
    id VARCHAR(64) PRIMARY KEY, text MEDIUMTEXT, date VARCHAR(64), linked_type VARCHAR(32), linked_id VARCHAR(64),
    INDEX idx_voice_notes_linked (linked_type, linked_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS screenshots (
    id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), data_url LONGTEXT, date VARCHAR(64), linked_type VARCHAR(32),
    linked_id VARCHAR(64), INDEX idx_screenshots_linked (linked_type, linked_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS activity (
    id VARCHAR(64) PRIMARY KEY, icon VARCHAR(64), message TEXT, date VARCHAR(64)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, description TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'active', assigned_user_ids JSON,
    created_at VARCHAR(64), updated_at VARCHAR(64)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS counters (
    name VARCHAR(32) PRIMARY KEY, value INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS backups (
    id INT AUTO_INCREMENT PRIMARY KEY, snapshot LONGTEXT NOT NULL, backed_up_at VARCHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = getPool();
      for (const stmt of SCHEMA_STATEMENTS) await p.query(stmt);
    })().catch(err => {
      schemaReady = null; // let the next call retry rather than staying wedged on a transient failure
      err.message = `MySQL schema setup failed (check DATABASE_URL / MYSQL_* env vars and that the server is reachable): ${err.message}`;
      throw err;
    });
  }
  return schemaReady;
}

// JSON columns come back already parsed as JS values from mysql2 in some
// configurations and as raw strings in others — handle both.
function parseJsonCol(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

function mapTaskRow(r) {
  return {
    id: r.id, title: r.title, description: r.description || '', category: r.category || '',
    priority: r.priority || '', status: r.status || '', project: r.project || '',
    tags: parseJsonCol(r.tags, []), createdDate: r.created_date, updatedDate: r.updated_date,
    dueDate: r.due_date || '', estimatedHours: r.estimated_hours || '', actualHours: r.actual_hours || '',
    checklist: parseJsonCol(r.checklist, []), notes: r.notes || '', favorite: !!r.favorite,
    pinned: !!r.pinned, archived: !!r.archived, history: parseJsonCol(r.history, []),
    timerStart: r.timer_start || null, taskType: r.task_type || 'personal', assigneeId: r.assignee_id || '',
    createdById: r.created_by_id || '', createdByName: r.created_by_name || '', projectId: r.project_id || ''
  };
}

function mapProjectRow(r) {
  return {
    id: r.id, name: r.name, description: r.description || '', status: r.status || 'active',
    assignedUserIds: parseJsonCol(r.assigned_user_ids, []), createdAt: r.created_at, updatedAt: r.updated_at
  };
}

function mapBugRow(r) {
  return {
    id: r.id, title: r.title || '', severity: r.severity || '', priority: r.priority || '',
    environment: r.environment || '', module: r.module || '', browser: r.browser || '',
    stepsToReproduce: r.steps_to_reproduce || '', expectedResult: r.expected_result || '',
    actualResult: r.actual_result || '', rootCause: r.root_cause || '', fixNotes: r.fix_notes || '',
    status: r.status || '', createdDate: r.created_date, resolvedDate: r.resolved_date || '',
    history: parseJsonCol(r.history, [])
  };
}

function mapDailyLogRow(r) {
  return {
    date: r.log_date, goals: r.goals || '', completedWork: r.completed_work || '',
    pendingWork: r.pending_work || '', blockers: r.blockers || '', meetingNotes: r.meeting_notes || '',
    learning: r.learning || '', tomorrowPlan: r.tomorrow_plan || '', voiceNote: r.voice_note || '',
    updatedDate: r.updated_date
  };
}

function mapVoiceNoteRow(r) {
  return { id: r.id, text: r.text || '', date: r.date, linkedType: r.linked_type, linkedId: r.linked_id };
}

function mapScreenshotRow(r) {
  return { id: r.id, name: r.name || '', dataUrl: r.data_url || '', date: r.date, linkedType: r.linked_type, linkedId: r.linked_id };
}

function mapActivityRow(r) {
  return { id: r.id, icon: r.icon || '', message: r.message || '', date: r.date };
}

/* ----------------------------- users ----------------------------- */

export async function readUsers() {
  await ensureSchema();
  const [rows] = await getPool().query(
    'SELECT id, name, email, password_hash AS passwordHash, role, status, created_at AS createdAt, updated_at AS updatedAt FROM users'
  );
  return { users: rows };
}

export async function writeUsers(data) {
  await ensureSchema();
  const users = Array.isArray(data.users) ? data.users : [];
  if (!users.length) return;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const u of users) {
      await conn.query(
        `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), password_hash=VALUES(password_hash),
           role=VALUES(role), status=VALUES(status), updated_at=VALUES(updated_at)`,
        [u.id, u.name, u.email, u.passwordHash, u.role, u.status, u.createdAt || new Date().toISOString(), u.updatedAt || null]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------- db ------------------------------- */

export function defaultDb() {
  return {
    tasks: [], bugs: [], dailyLogs: {}, voiceNotes: [], screenshots: [], activity: [], projects: [],
    meta: { taskSeq: 0, bugSeq: 0, projectSeq: 0 }
  };
}

export async function readDb() {
  await ensureSchema();
  const p = getPool();
  const [[taskRows], [bugRows], [logRows], [voiceRows], [shotRows], [activityRows], [counterRows], [projectRows]] = await Promise.all([
    p.query('SELECT * FROM tasks ORDER BY updated_date DESC'),
    p.query('SELECT * FROM bugs ORDER BY created_date DESC'),
    p.query('SELECT * FROM daily_logs'),
    p.query('SELECT * FROM voice_notes ORDER BY date DESC'),
    p.query('SELECT * FROM screenshots ORDER BY date DESC'),
    p.query('SELECT * FROM activity ORDER BY date DESC LIMIT 200'),
    p.query('SELECT name, value FROM counters'),
    p.query('SELECT * FROM projects ORDER BY created_at DESC')
  ]);

  const dailyLogs = {};
  logRows.forEach(r => { dailyLogs[r.log_date] = mapDailyLogRow(r); });
  const meta = { taskSeq: 0, bugSeq: 0, projectSeq: 0 };
  counterRows.forEach(r => { meta[r.name] = r.value; });

  return {
    tasks: taskRows.map(mapTaskRow),
    bugs: bugRows.map(mapBugRow),
    dailyLogs,
    voiceNotes: voiceRows.map(mapVoiceNoteRow),
    screenshots: shotRows.map(mapScreenshotRow),
    activity: activityRows.map(mapActivityRow),
    projects: projectRows.map(mapProjectRow),
    meta
  };
}

// Replaces every table's contents wholesale inside one transaction — see the
// file header for why this (rather than row-level diffing) is the right
// trade-off here.
export async function writeDb(data) {
  await ensureSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    await conn.query('DELETE FROM tasks');
    for (const t of data.tasks || []) {
      await conn.query(
        `INSERT INTO tasks (id,title,description,category,priority,status,project,tags,created_date,updated_date,
          due_date,estimated_hours,actual_hours,checklist,notes,favorite,pinned,archived,history,timer_start,
          task_type,assignee_id,created_by_id,created_by_name,project_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          t.id, t.title || '', t.description || '', t.category || '', t.priority || '', t.status || '', t.project || '',
          JSON.stringify(t.tags || []), t.createdDate || null, t.updatedDate || null, t.dueDate || '',
          String(t.estimatedHours ?? ''), String(t.actualHours ?? ''), JSON.stringify(t.checklist || []), t.notes || '',
          t.favorite ? 1 : 0, t.pinned ? 1 : 0, t.archived ? 1 : 0, JSON.stringify(t.history || []),
          t.timerStart || null, t.taskType || 'personal', t.assigneeId || '', t.createdById || '', t.createdByName || '',
          t.projectId || ''
        ]
      );
    }

    await conn.query('DELETE FROM bugs');
    for (const b of data.bugs || []) {
      await conn.query(
        `INSERT INTO bugs (id,title,severity,priority,environment,module,browser,steps_to_reproduce,
          expected_result,actual_result,root_cause,fix_notes,status,created_date,resolved_date,history)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          b.id, b.title || '', b.severity || '', b.priority || '', b.environment || '', b.module || '', b.browser || '',
          b.stepsToReproduce || '', b.expectedResult || '', b.actualResult || '', b.rootCause || '', b.fixNotes || '',
          b.status || '', b.createdDate || null, b.resolvedDate || '', JSON.stringify(b.history || [])
        ]
      );
    }

    await conn.query('DELETE FROM daily_logs');
    for (const [date, log] of Object.entries(data.dailyLogs || {})) {
      await conn.query(
        `INSERT INTO daily_logs (log_date,goals,completed_work,pending_work,blockers,meeting_notes,learning,tomorrow_plan,voice_note,updated_date)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          date, log.goals || '', log.completedWork || '', log.pendingWork || '', log.blockers || '',
          log.meetingNotes || '', log.learning || '', log.tomorrowPlan || '', log.voiceNote || '', log.updatedDate || null
        ]
      );
    }

    await conn.query('DELETE FROM voice_notes');
    for (const v of data.voiceNotes || []) {
      await conn.query(
        'INSERT INTO voice_notes (id,text,date,linked_type,linked_id) VALUES (?,?,?,?,?)',
        [v.id, v.text || '', v.date || null, v.linkedType || null, v.linkedId || null]
      );
    }

    await conn.query('DELETE FROM screenshots');
    for (const s of data.screenshots || []) {
      await conn.query(
        'INSERT INTO screenshots (id,name,data_url,date,linked_type,linked_id) VALUES (?,?,?,?,?,?)',
        [s.id, s.name || '', s.dataUrl || '', s.date || null, s.linkedType || null, s.linkedId || null]
      );
    }

    await conn.query('DELETE FROM activity');
    for (const a of (data.activity || []).slice(0, 200)) {
      await conn.query(
        'INSERT INTO activity (id,icon,message,date) VALUES (?,?,?,?)',
        [a.id, a.icon || '', a.message || '', a.date || null]
      );
    }

    await conn.query('DELETE FROM projects');
    for (const proj of data.projects || []) {
      await conn.query(
        'INSERT INTO projects (id,name,description,status,assigned_user_ids,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        [
          proj.id, proj.name || '', proj.description || '', proj.status || 'active',
          JSON.stringify(proj.assignedUserIds || []), proj.createdAt || null, proj.updatedAt || null
        ]
      );
    }

    const meta = Object.assign({ taskSeq: 0, bugSeq: 0, projectSeq: 0 }, data.meta);
    for (const [name, value] of Object.entries(meta)) {
      await conn.query(
        'INSERT INTO counters (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [name, value]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function backupDb() {
  await ensureSchema();
  const p = getPool();
  const current = await readDb();
  await p.query('INSERT INTO backups (snapshot, backed_up_at) VALUES (?, ?)', [JSON.stringify(current), new Date().toISOString()]);
  // Keep only the latest backup — matches the single-file db.backup.json
  // semantics of the JSON driver rather than growing unbounded.
  await p.query('DELETE FROM backups WHERE id NOT IN (SELECT id FROM (SELECT id FROM backups ORDER BY id DESC LIMIT 1) AS keep_latest)');
}

export async function restoreDb() {
  await ensureSchema();
  const [rows] = await getPool().query('SELECT snapshot, backed_up_at AS backedUpAt FROM backups ORDER BY id DESC LIMIT 1');
  if (!rows.length) return null;
  const data = JSON.parse(rows[0].snapshot);
  await writeDb(data);
  return { data, backedUpAt: rows[0].backedUpAt };
}

// Atomically increments a named counter (e.g. "projectSeq") and returns the
// new value — used for server-generated IDs. The UPDATE takes a row lock
// inside the transaction, so two concurrent callers can't both read the
// same starting value the way a plain read-then-write could.
export async function incrementCounter(name) {
  await ensureSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO counters (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1', [name]);
    const [rows] = await conn.query('SELECT value FROM counters WHERE name = ?', [name]);
    await conn.commit();
    return rows[0].value;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// MySQL is never "Blob storage" — this exists only so lib/store.js can
// re-export a consistent shape regardless of which driver is active.
export const usesBlobStorage = false;

// Exposed for a lightweight connectivity check from /api/health.
export async function ping() {
  await ensureSchema();
  await getPool().query('SELECT 1');
}
