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

  const current4 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current4 < 4) {
    const cols = db.pragma('table_info(workers)') as { name: string }[];
    if (!cols.some((c) => c.name === 'settings_override')) {
      db.exec(`ALTER TABLE workers ADD COLUMN settings_override TEXT DEFAULT NULL;`);
    }
    db.prepare(`UPDATE schema_version SET version = 4`).run();
  }

  const current5 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current5 < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        product_number TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    db.prepare(`UPDATE schema_version SET version = 5`).run();
  }

  const current6 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current6 < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id TEXT NOT NULL,
        worker_name TEXT NOT NULL,
        message TEXT NOT NULL,
        level TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_worker_logs_worker_id ON worker_logs(worker_id);
      CREATE INDEX idx_worker_logs_created_at ON worker_logs(created_at);
    `);
    db.prepare(`UPDATE schema_version SET version = 6`).run();
  }

  const current7 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current7 < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS failed_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id TEXT NOT NULL,
        worker_name TEXT NOT NULL,
        keyword TEXT NOT NULL,
        item_name TEXT NOT NULL,
        purchase_name TEXT,
        group_name TEXT,
        pages_scanned INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_failed_keywords_worker_id ON failed_keywords(worker_id);
      CREATE INDEX idx_failed_keywords_created_at ON failed_keywords(created_at);
    `);
    db.prepare(`UPDATE schema_version SET version = 7`).run();
  }

  const current8 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current8 < 8) {
    // knowledges.is_active: 키워드별 on/off (기본 켜짐)
    const kCols = db.pragma('table_info(knowledges)') as { name: string }[];
    if (!kCols.some((c) => c.name === 'is_active')) {
      db.exec(`ALTER TABLE knowledges ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;`);
    }
    // failed_keywords.knowledge_id: 어느 키워드 행에서 실패했는지 추적 → 자동 비활성화에 사용
    const fCols = db.pragma('table_info(failed_keywords)') as { name: string }[];
    if (!fCols.some((c) => c.name === 'knowledge_id')) {
      db.exec(`ALTER TABLE failed_keywords ADD COLUMN knowledge_id TEXT DEFAULT NULL;`);
    }
    db.prepare(`UPDATE schema_version SET version = 8`).run();
  }

  const current9 = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
  if (current9 < 9) {
    // knowledges.mode: 'shopping' (기본) 또는 'blog'
    const kCols9 = db.pragma('table_info(knowledges)') as { name: string }[];
    if (!kCols9.some((c) => c.name === 'mode')) {
      db.exec(`ALTER TABLE knowledges ADD COLUMN mode TEXT NOT NULL DEFAULT 'shopping';`);
    }
    // knowledges.site_url: 블로그 모드에서 매칭할 URL/제목
    if (!kCols9.some((c) => c.name === 'site_url')) {
      db.exec(`ALTER TABLE knowledges ADD COLUMN site_url TEXT DEFAULT NULL;`);
    }
    db.prepare(`UPDATE schema_version SET version = 9`).run();
  }
}
