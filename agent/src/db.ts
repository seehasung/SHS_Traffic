import Database from 'better-sqlite3';
import { dbPath } from './paths';
import { DEFAULT_SETTINGS } from '@shared/types';

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(dbPath());
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  // 매우 단순한 버전 테이블 — 0 → 1 한 번만 마이그레이션.
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`);
  const row = db.prepare(`SELECT version FROM schema_version`).get() as { version: number } | undefined;
  const current = row?.version ?? 0;

  if (current < 1) {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE knowledges (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        item_name TEXT NOT NULL,
        purchase_name TEXT,
        group_name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE naver_accounts (
        id TEXT PRIMARY KEY,
        naver_id TEXT NOT NULL,
        naver_password TEXT NOT NULL,
        user_agent TEXT
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        level TEXT NOT NULL,
        progress_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_logs_created_at ON logs(created_at);
    `);

    db.prepare(`INSERT INTO settings(key, value) VALUES('app', ?)`).run(JSON.stringify(DEFAULT_SETTINGS));

    if (row) db.prepare(`UPDATE schema_version SET version = 1`).run();
    else db.prepare(`INSERT INTO schema_version(version) VALUES(1)`).run();
  }

  const current2 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current2 < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS keyword_groups (
        id TEXT PRIMARY KEY,
        group_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    db.prepare(`UPDATE schema_version SET version = 2`).run();
  }

  const current3 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current3 < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        login_id TEXT NOT NULL UNIQUE,
        login_password TEXT NOT NULL,
        assigned_group_names TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
    `);
    db.prepare(`UPDATE schema_version SET version = 3`).run();
  }
}
