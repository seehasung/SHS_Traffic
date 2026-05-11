// SQLite ↔ 도메인 객체 매핑. 한 곳에 모아두면 라우트가 매우 단순해진다.
import { db } from './db';
import type { Knowledge, NaverAccount, Settings, LogEntry, LogLevel, KeywordGroup, Worker } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import { uid } from 'uid';

// ──────────────── workers ────────────────
function rowToWorker(r: any): Worker {
  return {
    id: r.id,
    name: r.name,
    loginId: r.login_id,
    loginPassword: r.login_password,
    assignedGroupNames: JSON.parse(r.assigned_group_names || '[]'),
    createdAt: r.created_at,
  };
}

export const workersRepo = {
  list(): Worker[] {
    const rows = db().prepare(`SELECT * FROM workers ORDER BY created_at`).all() as any[];
    return rows.map(rowToWorker);
  },
  findByLoginId(loginId: string): Worker | undefined {
    const row = db().prepare(`SELECT * FROM workers WHERE login_id = ?`).get(loginId) as any;
    return row ? rowToWorker(row) : undefined;
  },
  create(input: { name: string; loginId: string; loginPassword: string }): Worker {
    const id = uid(25);
    const now = Date.now();
    db().prepare(
      `INSERT INTO workers(id, name, login_id, login_password, assigned_group_names, created_at) VALUES(?, ?, ?, ?, '[]', ?)`
    ).run(id, input.name, input.loginId, input.loginPassword, now);
    return rowToWorker(db().prepare(`SELECT * FROM workers WHERE id = ?`).get(id));
  },
  update(id: string, input: Partial<{ name: string; loginId: string; loginPassword: string; assignedGroupNames: string[] }>): Worker {
    const existing = db().prepare(`SELECT * FROM workers WHERE id = ?`).get(id) as any;
    if (!existing) throw new Error('Worker not found');
    const name = input.name ?? existing.name;
    const loginId = input.loginId ?? existing.login_id;
    const loginPassword = input.loginPassword ?? existing.login_password;
    const assignedGroupNames = input.assignedGroupNames !== undefined ? JSON.stringify(input.assignedGroupNames) : existing.assigned_group_names;
    db().prepare(
      `UPDATE workers SET name=?, login_id=?, login_password=?, assigned_group_names=? WHERE id=?`
    ).run(name, loginId, loginPassword, assignedGroupNames, id);
    return rowToWorker(db().prepare(`SELECT * FROM workers WHERE id = ?`).get(id));
  },
  remove(id: string) {
    db().prepare(`DELETE FROM workers WHERE id = ?`).run(id);
  },
};

// ──────────────── keyword groups ────────────────
function rowToKeywordGroup(r: any): KeywordGroup {
  return { id: r.id, groupName: r.group_name, createdAt: r.created_at };
}

export const keywordGroupsRepo = {
  list(): KeywordGroup[] {
    const rows = db().prepare(`SELECT * FROM keyword_groups ORDER BY created_at`).all() as any[];
    return rows.map(rowToKeywordGroup);
  },
  create(groupName: string): KeywordGroup {
    const id = uid(25);
    const now = Date.now();
    db().prepare(`INSERT INTO keyword_groups(id, group_name, created_at) VALUES(?, ?, ?)`).run(id, groupName, now);
    return { id, groupName, createdAt: now };
  },
  update(id: string, groupName: string): KeywordGroup {
    db().prepare(`UPDATE keyword_groups SET group_name = ? WHERE id = ?`).run(groupName, id);
    return rowToKeywordGroup(db().prepare(`SELECT * FROM keyword_groups WHERE id = ?`).get(id));
  },
  remove(id: string) {
    const group = db().prepare(`SELECT group_name FROM keyword_groups WHERE id = ?`).get(id) as { group_name: string } | undefined;
    if (group) {
      db().prepare(`DELETE FROM knowledges WHERE group_name = ?`).run(group.group_name);
    }
    db().prepare(`DELETE FROM keyword_groups WHERE id = ?`).run(id);
  },
};

// ──────────────── knowledges ────────────────
function rowToKnowledge(r: any): Knowledge {
  return {
    id: r.id,
    keyword: r.keyword,
    itemName: r.item_name,
    purchaseName: r.purchase_name ?? undefined,
    groupName: r.group_name ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const knowledgesRepo = {
  list(): Knowledge[] {
    const rows = db().prepare(`SELECT * FROM knowledges ORDER BY created_at DESC`).all() as any[];
    return rows.map(rowToKnowledge);
  },
  upsert(input: Partial<Knowledge> & { keyword: string; itemName: string }): Knowledge {
    const now = Date.now();
    const id = input.id ?? uid(25);
    const existing = input.id
      ? (db().prepare(`SELECT created_at FROM knowledges WHERE id = ?`).get(id) as { created_at: number } | undefined)
      : undefined;
    const createdAt = existing?.created_at ?? now;
    db()
      .prepare(
        `INSERT INTO knowledges(id, keyword, item_name, purchase_name, group_name, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET keyword=excluded.keyword, item_name=excluded.item_name,
           purchase_name=excluded.purchase_name, group_name=excluded.group_name, updated_at=excluded.updated_at`,
      )
      .run(id, input.keyword, input.itemName, input.purchaseName ?? null, input.groupName ?? null, createdAt, now);
    return rowToKnowledge(db().prepare(`SELECT * FROM knowledges WHERE id = ?`).get(id));
  },
  remove(id: string) {
    db().prepare(`DELETE FROM knowledges WHERE id = ?`).run(id);
  },
};

// ──────────────── naver accounts ────────────────
function rowToNaver(r: any): NaverAccount {
  return {
    id: r.id,
    naverId: r.naver_id,
    naverPassword: r.naver_password,
    userAgent: r.user_agent ?? undefined,
  };
}

export const naverAccountsRepo = {
  list(): NaverAccount[] {
    const rows = db().prepare(`SELECT * FROM naver_accounts ORDER BY rowid`).all() as any[];
    return rows.map(rowToNaver);
  },
  upsert(input: Partial<NaverAccount> & { naverId: string; naverPassword: string }): NaverAccount {
    const id = input.id ?? uid(25);
    db()
      .prepare(
        `INSERT INTO naver_accounts(id, naver_id, naver_password, user_agent) VALUES(?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET naver_id=excluded.naver_id, naver_password=excluded.naver_password,
           user_agent=excluded.user_agent`,
      )
      .run(id, input.naverId, input.naverPassword, input.userAgent ?? null);
    return rowToNaver(db().prepare(`SELECT * FROM naver_accounts WHERE id = ?`).get(id));
  },
  remove(id: string) {
    db().prepare(`DELETE FROM naver_accounts WHERE id = ?`).run(id);
  },
  findManyByIds(ids: string[]): NaverAccount[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = db().prepare(`SELECT * FROM naver_accounts WHERE id IN (${placeholders})`).all(...ids) as any[];
    return rows.map(rowToNaver);
  },
};

// ──────────────── settings ────────────────
export const settingsRepo = {
  get(): Settings {
    const row = db().prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Settings) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  save(next: Settings): Settings {
    const merged = { ...DEFAULT_SETTINGS, ...next };
    db().prepare(`UPDATE settings SET value = ? WHERE key = 'app'`).run(JSON.stringify(merged));
    return merged;
  },
};

// ──────────────── logs ────────────────
function rowToLog(r: any): LogEntry {
  return {
    id: r.id,
    message: r.message,
    level: r.level as LogLevel,
    progressCount: r.progress_count,
    createdAt: r.created_at,
  };
}

export const logsRepo = {
  list(limit = 200): LogEntry[] {
    const rows = db()
      .prepare(`SELECT * FROM logs ORDER BY id DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.reverse().map(rowToLog);
  },
  append(message: string, level: LogLevel, progressCount: number): LogEntry {
    const now = Date.now();
    const info = db()
      .prepare(`INSERT INTO logs(message, level, progress_count, created_at) VALUES(?, ?, ?, ?)`)
      .run(message, level, progressCount, now);
    return { id: Number(info.lastInsertRowid), message, level, progressCount, createdAt: now };
  },
  clear() {
    db().prepare(`DELETE FROM logs`).run();
  },
};
