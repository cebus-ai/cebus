import type Database from 'better-sqlite3';

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      expiresAt TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      ipAddress TEXT,
      userAgent TEXT,
      userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Agentic OS',
      owner_id TEXT NOT NULL,
      default_context_window_size INTEGER NOT NULL DEFAULT 10,
      default_include_system_prompt INTEGER NOT NULL DEFAULT 1,
      default_include_project_context INTEGER NOT NULL DEFAULT 1,
      default_include_mode_guidance INTEGER NOT NULL DEFAULT 1,
      default_include_tier_guidance INTEGER NOT NULL DEFAULT 1,
      default_include_rich_components INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channel (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      name TEXT NOT NULL,
      subject TEXT,
      instructions TEXT,
      chat_mode TEXT NOT NULL DEFAULT 'free_chat',
      orchestrator_enabled INTEGER NOT NULL DEFAULT 0,
      orchestrator_model TEXT,
      response_length TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      context_start_at TEXT,
      context_window_size INTEGER NOT NULL DEFAULT 10,
      include_system_prompt INTEGER NOT NULL DEFAULT 1,
      include_project_context INTEGER NOT NULL DEFAULT 1,
      include_mode_guidance INTEGER NOT NULL DEFAULT 1,
      include_tier_guidance INTEGER NOT NULL DEFAULT 1,
      include_rich_components INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS channel_member (
      channel_id TEXT NOT NULL REFERENCES channel(id),
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS agent_config (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_letter TEXT NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT '#8b5cf6',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_channel_clone INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channel_agent (
      channel_id TEXT NOT NULL REFERENCES channel(id),
      agent_id TEXT NOT NULL REFERENCES agent_config(id),
      role_template TEXT,
      role_instructions TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channel(id),
      branch_id TEXT REFERENCES branch(id),
      sender_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      format_type TEXT NOT NULL DEFAULT 'text',
      reply_to_id TEXT REFERENCES message(id),
      is_dm INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      dm_agent_id TEXT REFERENCES agent_config(id),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifact (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message(id),
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS branch (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channel(id),
      origin_message_id TEXT NOT NULL REFERENCES message(id),
      name TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channel(id),
      assigned_by TEXT NOT NULL,
      assigned_to TEXT NOT NULL REFERENCES agent_config(id),
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      detection_source TEXT NOT NULL DEFAULT 'manual',
      delegation_log TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inbox_item (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      task_id TEXT REFERENCES task(id),
      channel_id TEXT REFERENCES channel(id),
      parent_message_id TEXT REFERENCES message(id),
      content TEXT NOT NULL,
      content_preview TEXT NOT NULL DEFAULT '',
      content_badges TEXT NOT NULL DEFAULT '[]',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pinned_message (
      channel_id TEXT NOT NULL REFERENCES channel(id),
      message_id TEXT NOT NULL REFERENCES message(id),
      pinned_by TEXT NOT NULL,
      pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS custom_role (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function createIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_channel_time
      ON message(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_channel_branch_time
      ON message(channel_id, branch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_dm
      ON message(channel_id, is_dm, dm_agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_inbox_user
      ON inbox_item(user_id, is_read, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_agent_status
      ON task(assigned_to, status);
    CREATE INDEX IF NOT EXISTS idx_channel_workspace
      ON channel(workspace_id, status);
    CREATE INDEX IF NOT EXISTS idx_channel_agent
      ON channel_agent(channel_id);
    CREATE INDEX IF NOT EXISTS idx_message_reply_to
      ON message(reply_to_id);
  `);
}

export function createFtsTable(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts
      USING fts5(content, content='message', content_rowid='rowid');
  `);

  // Triggers to keep FTS index in sync with message table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS message_fts_ai AFTER INSERT ON message BEGIN
      INSERT INTO message_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS message_fts_ad AFTER DELETE ON message BEGIN
      INSERT INTO message_fts(message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS message_fts_au AFTER UPDATE OF content ON message BEGIN
      INSERT INTO message_fts(message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO message_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
}

function runMigrations(db: Database.Database): void {
  // Add default_context_window_size column to workspace table if missing
  const wsCols = db.prepare('PRAGMA table_info(workspace)').all() as { name: string }[];
  if (!wsCols.some(c => c.name === 'default_context_window_size')) {
    db.exec(
      'ALTER TABLE workspace ADD COLUMN default_context_window_size INTEGER NOT NULL DEFAULT 10'
    );
  }
  if (!wsCols.some(c => c.name === 'default_include_system_prompt')) {
    db.exec(
      'ALTER TABLE workspace ADD COLUMN default_include_system_prompt INTEGER NOT NULL DEFAULT 1'
    );
  }
  if (!wsCols.some(c => c.name === 'default_include_project_context')) {
    db.exec(
      'ALTER TABLE workspace ADD COLUMN default_include_project_context INTEGER NOT NULL DEFAULT 1'
    );
  }
  if (!wsCols.some(c => c.name === 'default_include_mode_guidance')) {
    db.exec(
      'ALTER TABLE workspace ADD COLUMN default_include_mode_guidance INTEGER NOT NULL DEFAULT 1'
    );
  }
  if (!wsCols.some(c => c.name === 'default_include_tier_guidance')) {
    db.exec(
      'ALTER TABLE workspace ADD COLUMN default_include_tier_guidance INTEGER NOT NULL DEFAULT 1'
    );
  }
  if (!wsCols.some(c => c.name === 'default_include_rich_components')) {
    db.exec(
      'ALTER TABLE workspace ADD COLUMN default_include_rich_components INTEGER NOT NULL DEFAULT 1'
    );
  }

  // Add response_length column to channel table if missing
  const cols = db.prepare('PRAGMA table_info(channel)').all() as { name: string }[];
  const hasResponseLength = cols.some(c => c.name === 'response_length');
  if (!hasResponseLength) {
    db.exec("ALTER TABLE channel ADD COLUMN response_length TEXT NOT NULL DEFAULT 'free'");
  }

  // Add view_cleared_at column to channel_member if missing (for clear-view feature)
  const memberCols = db.prepare('PRAGMA table_info(channel_member)').all() as { name: string }[];
  if (!memberCols.some(c => c.name === 'view_cleared_at')) {
    db.exec('ALTER TABLE channel_member ADD COLUMN view_cleared_at TEXT');
  }

  // Add last_seen_at column to channel_member if missing (for unread badges)
  if (!memberCols.some(c => c.name === 'last_seen_at')) {
    db.exec('ALTER TABLE channel_member ADD COLUMN last_seen_at TEXT');
    db.exec("UPDATE channel_member SET last_seen_at = datetime('now') WHERE last_seen_at IS NULL");
  }

  // Add display_name_override column to channel_agent if missing
  const caCols = db.prepare('PRAGMA table_info(channel_agent)').all() as { name: string }[];
  if (!caCols.some(c => c.name === 'display_name_override')) {
    db.exec('ALTER TABLE channel_agent ADD COLUMN display_name_override TEXT');
  }

  // Add context_start_at column to channel if missing (for clear-context feature)
  if (!cols.some(c => c.name === 'context_start_at')) {
    db.exec('ALTER TABLE channel ADD COLUMN context_start_at TEXT');
  }

  // Add channel_id and parent_message_id to inbox_item if missing (for thread navigation)
  const inboxCols = db.prepare('PRAGMA table_info(inbox_item)').all() as { name: string }[];
  if (!inboxCols.some(c => c.name === 'channel_id')) {
    db.exec('ALTER TABLE inbox_item ADD COLUMN channel_id TEXT REFERENCES channel(id)');
  }
  if (!inboxCols.some(c => c.name === 'parent_message_id')) {
    db.exec('ALTER TABLE inbox_item ADD COLUMN parent_message_id TEXT REFERENCES message(id)');
  }

  // Add is_hidden column to message table if missing (for archive/collapse feature)
  const msgCols = db.prepare('PRAGMA table_info(message)').all() as { name: string }[];
  if (!msgCols.some(c => c.name === 'is_hidden')) {
    db.exec('ALTER TABLE message ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0');
  }

  // Ensure custom_role table exists (for existing DBs created before this migration)
  try {
    db.prepare('SELECT 1 FROM custom_role LIMIT 0').get();
  } catch {
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_role (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // Add context_level column to channel table if missing (for folder access feature)
  if (!cols.some(c => c.name === 'context_level')) {
    db.exec("ALTER TABLE channel ADD COLUMN context_level TEXT NOT NULL DEFAULT 'none'");
  }

  // Add context_window_size column to channel table if missing
  if (!cols.some(c => c.name === 'context_window_size')) {
    db.exec('ALTER TABLE channel ADD COLUMN context_window_size INTEGER NOT NULL DEFAULT 10');
  }

  // Add is_channel_clone column to agent_config if missing (for auto-cloned agents)
  const agentCols = db.prepare('PRAGMA table_info(agent_config)').all() as { name: string }[];
  if (!agentCols.some(c => c.name === 'is_channel_clone')) {
    db.exec('ALTER TABLE agent_config ADD COLUMN is_channel_clone INTEGER NOT NULL DEFAULT 0');
  }

  // Add sort_order column to channel if missing (for drag-and-drop reordering)
  const chColsSort = db.prepare('PRAGMA table_info(channel)').all() as { name: string }[];
  if (!chColsSort.some(c => c.name === 'sort_order')) {
    db.exec('ALTER TABLE channel ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }

  // Add sort_order column to agent_config if missing (for drag-and-drop reordering)
  if (!agentCols.some(c => c.name === 'sort_order')) {
    db.exec('ALTER TABLE agent_config ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }

  // Add granular system prompt setting columns to channel if missing
  const chCols2 = db.prepare('PRAGMA table_info(channel)').all() as { name: string }[];
  if (!chCols2.some(c => c.name === 'include_system_prompt')) {
    db.exec('ALTER TABLE channel ADD COLUMN include_system_prompt INTEGER NOT NULL DEFAULT 1');
  }
  if (!chCols2.some(c => c.name === 'include_project_context')) {
    db.exec('ALTER TABLE channel ADD COLUMN include_project_context INTEGER NOT NULL DEFAULT 1');
  }
  if (!chCols2.some(c => c.name === 'include_mode_guidance')) {
    db.exec('ALTER TABLE channel ADD COLUMN include_mode_guidance INTEGER NOT NULL DEFAULT 1');
  }
  if (!chCols2.some(c => c.name === 'include_tier_guidance')) {
    db.exec('ALTER TABLE channel ADD COLUMN include_tier_guidance INTEGER NOT NULL DEFAULT 1');
  }
  if (!chCols2.some(c => c.name === 'include_rich_components')) {
    db.exec('ALTER TABLE channel ADD COLUMN include_rich_components INTEGER NOT NULL DEFAULT 1');
  }

  // Add working_dir column to channel if missing (for per-channel working directory)
  const chCols3 = db.prepare('PRAGMA table_info(channel)').all() as { name: string }[];
  if (!chCols3.some(c => c.name === 'working_dir')) {
    db.exec('ALTER TABLE channel ADD COLUMN working_dir TEXT');
  }

  // Add default_working_dir column to workspace if missing
  const wsCols2 = db.prepare('PRAGMA table_info(workspace)').all() as { name: string }[];
  if (!wsCols2.some(c => c.name === 'default_working_dir')) {
    db.exec('ALTER TABLE workspace ADD COLUMN default_working_dir TEXT');
  }

  // Fix agent display names: "Gpt" → "GPT"
  db.prepare(
    `UPDATE agent_config SET display_name = 'GPT' || SUBSTR(display_name, 4)
     WHERE display_name LIKE 'Gpt%'`
  ).run();

  // Migrate FTS5 table to external content pattern if needed
  // Check if the FTS sync triggers exist; if not, recreate the table
  const triggers = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'message_fts_ai'")
    .get();
  if (triggers === undefined || triggers === null) {
    db.exec('DROP TABLE IF EXISTS message_fts');
    createFtsTable(db);
    // Rebuild FTS index from existing messages
    db.exec("INSERT INTO message_fts(message_fts) VALUES ('rebuild')");
  }
}

export function initializeDatabase(db: Database.Database): void {
  createTables(db);
  createIndexes(db);
  createFtsTable(db);
  runMigrations(db);
}
