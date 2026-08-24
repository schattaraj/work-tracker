-- ============================================================================
-- DevTrack — MySQL schema (reference copy).
--
-- You don't need to run this by hand: mysqlDriver.js executes these same
-- CREATE TABLE IF NOT EXISTS statements automatically the first time it's
-- used in a process (see ensureSchema() there). This file exists so the
-- schema is easy to read, review, or run manually with a DB client if
-- you'd rather manage migrations yourself.
--
-- Design notes:
--  - Every date/time/datetime field is stored as the exact ISO-8601 string
--    the app already works with (VARCHAR), not a native DATETIME/DATE
--    column. The app does all date math in JavaScript, never in SQL, so a
--    native temporal type would only add timezone-conversion risk (MySQL's
--    DATETIME has no timezone; behavior depends on session settings) for
--    zero query benefit. Real indexes exist instead on the columns actually
--    queried by ownership/type (task_type, created_by_id).
--  - Nested/document-shaped sub-data (tags, checklist items, history
--    entries) stays as JSON columns rather than being split into join
--    tables — it's always small, always task/bug-scoped, and never queried
--    independently, so normalizing it further would add joins with no
--    payoff.
--  - Booleans are TINYINT(1), mapped to/from real JS booleans in the driver.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(64)  PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'user',
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
  created_at    VARCHAR(64)  NOT NULL,
  updated_at    VARCHAR(64)  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id               VARCHAR(64)  PRIMARY KEY,
  title            VARCHAR(500) NOT NULL,
  description      TEXT,
  category         VARCHAR(64),
  priority         VARCHAR(32),
  status           VARCHAR(32),
  project          VARCHAR(255),
  tags             JSON,
  created_date     VARCHAR(64),
  updated_date     VARCHAR(64),
  due_date         VARCHAR(16),
  estimated_hours  VARCHAR(32),
  actual_hours     VARCHAR(32),
  checklist        JSON,
  notes            MEDIUMTEXT,
  favorite         TINYINT(1) NOT NULL DEFAULT 0,
  pinned           TINYINT(1) NOT NULL DEFAULT 0,
  archived         TINYINT(1) NOT NULL DEFAULT 0,
  history          JSON,
  timer_start      VARCHAR(64),
  task_type        VARCHAR(16) NOT NULL DEFAULT 'personal',
  assignee_id      VARCHAR(64),
  created_by_id    VARCHAR(64),
  created_by_name  VARCHAR(255),
  project_id       VARCHAR(64),
  INDEX idx_tasks_task_type (task_type),
  INDEX idx_tasks_created_by (created_by_id),
  INDEX idx_tasks_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bugs (
  id                  VARCHAR(64) PRIMARY KEY,
  title               VARCHAR(500),
  severity            VARCHAR(32),
  priority            VARCHAR(32),
  environment         VARCHAR(64),
  module              VARCHAR(255),
  browser             VARCHAR(255),
  steps_to_reproduce  TEXT,
  expected_result     TEXT,
  actual_result       TEXT,
  root_cause          TEXT,
  fix_notes           TEXT,
  status              VARCHAR(32),
  created_date        VARCHAR(64),
  resolved_date       VARCHAR(64),
  history             JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS daily_logs (
  log_date        VARCHAR(16) PRIMARY KEY,
  goals           TEXT,
  completed_work  TEXT,
  pending_work    TEXT,
  blockers        TEXT,
  meeting_notes   TEXT,
  learning        TEXT,
  tomorrow_plan   TEXT,
  voice_note      TEXT,
  updated_date    VARCHAR(64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS voice_notes (
  id          VARCHAR(64) PRIMARY KEY,
  text        MEDIUMTEXT,
  date        VARCHAR(64),
  linked_type VARCHAR(32),
  linked_id   VARCHAR(64),
  INDEX idx_voice_notes_linked (linked_type, linked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS screenshots (
  id          VARCHAR(64) PRIMARY KEY,
  name        VARCHAR(255),
  data_url    LONGTEXT,
  date        VARCHAR(64),
  linked_type VARCHAR(32),
  linked_id   VARCHAR(64),
  INDEX idx_screenshots_linked (linked_type, linked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity (
  id      VARCHAR(64) PRIMARY KEY,
  icon    VARCHAR(64),
  message TEXT,
  date    VARCHAR(64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id                 VARCHAR(64)  PRIMARY KEY,
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  status             VARCHAR(16)  NOT NULL DEFAULT 'active',
  assigned_user_ids  JSON,
  created_at         VARCHAR(64),
  updated_at         VARCHAR(64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Three rows: ('taskSeq', N), ('bugSeq', N), ('projectSeq', N) — the same
-- auto-increment-by-hand counters the JSON driver keeps in meta.*Seq, for ID
-- format continuity (TASK-1, BUG-1, PROJECT-1, …) across both drivers.
CREATE TABLE IF NOT EXISTS counters (
  name  VARCHAR(32) PRIMARY KEY,
  value INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS backups (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  snapshot     LONGTEXT NOT NULL,
  backed_up_at VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
