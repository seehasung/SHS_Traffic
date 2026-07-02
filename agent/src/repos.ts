// SQLite ↔ 도메인 객체 매핑. 한 곳에 모아두면 라우트가 매우 단순해진다.
import { db } from './db';
import type { Knowledge, NaverAccount, Settings, LogEntry, LogLevel, KeywordGroup, Worker, Product, FailedKeyword, RankCheck, CafeEntry, CRankGroup, CRankKnowledge, CRankCheck } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import { uid } from 'uid';

// ──────────────── workers ────────────────
function rowToWorker(r: any): Worker {
  return {
    id: r.id,
    name: r.name,
    loginId: r.login_id,
    loginPassword: r.login_password,
    mode: r.mode === 'blog' ? 'blog' : 'shopping',
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
  create(input: { name: string; loginId: string; loginPassword: string; mode?: string }): Worker {
    const id = uid(25);
    const now = Date.now();
    const mode = input.mode === 'blog' ? 'blog' : 'shopping';
    db().prepare(
      `INSERT INTO workers(id, name, login_id, login_password, mode, assigned_group_names, created_at) VALUES(?, ?, ?, ?, ?, '[]', ?)`
    ).run(id, input.name, input.loginId, input.loginPassword, mode, now);
    return rowToWorker(db().prepare(`SELECT * FROM workers WHERE id = ?`).get(id));
  },
  update(id: string, input: Partial<{ name: string; loginId: string; loginPassword: string; mode: string; assignedGroupNames: string[] }>): Worker {
    const existing = db().prepare(`SELECT * FROM workers WHERE id = ?`).get(id) as any;
    if (!existing) throw new Error('Worker not found');
    const name = input.name ?? existing.name;
    const loginId = input.loginId ?? existing.login_id;
    const loginPassword = input.loginPassword ?? existing.login_password;
    const mode = input.mode !== undefined ? (input.mode === 'blog' ? 'blog' : 'shopping') : existing.mode;
    const assignedGroupNames = input.assignedGroupNames !== undefined ? JSON.stringify(input.assignedGroupNames) : existing.assigned_group_names;
    db().prepare(
      `UPDATE workers SET name=?, login_id=?, login_password=?, mode=?, assigned_group_names=? WHERE id=?`
    ).run(name, loginId, loginPassword, mode, assignedGroupNames, id);
    return rowToWorker(db().prepare(`SELECT * FROM workers WHERE id = ?`).get(id));
  },
  remove(id: string) {
    db().prepare(`DELETE FROM workers WHERE id = ?`).run(id);
  },
  getSettings(workerId: string): Settings | null {
    const row = db().prepare(`SELECT settings_override FROM workers WHERE id = ?`).get(workerId) as { settings_override: string | null } | undefined;
    if (!row?.settings_override) return null;
    try { return JSON.parse(row.settings_override) as Settings; } catch { return null; }
  },
  saveSettings(workerId: string, settings: Settings) {
    db().prepare(`UPDATE workers SET settings_override = ? WHERE id = ?`).run(JSON.stringify(settings), workerId);
  },
};

// ──────────────── products ────────────────
function rowToProduct(r: any): Product {
  return {
    id: r.id,
    productName: r.product_name,
    productNumber: r.product_number,
    createdAt: r.created_at,
  };
}

export const productsRepo = {
  list(): Product[] {
    const rows = db().prepare(`SELECT * FROM products ORDER BY created_at DESC`).all() as any[];
    return rows.map(rowToProduct);
  },
  create(productName: string, productNumber: string): Product {
    const id = uid(25);
    const now = Date.now();
    db().prepare(`INSERT INTO products(id, product_name, product_number, created_at) VALUES(?, ?, ?, ?)`).run(id, productName, productNumber, now);
    return { id, productName, productNumber, createdAt: now };
  },
  update(id: string, input: { productName?: string; productNumber?: string }): Product {
    const existing = db().prepare(`SELECT * FROM products WHERE id = ?`).get(id) as any;
    if (!existing) throw new Error('Product not found');
    const name = input.productName ?? existing.product_name;
    const number = input.productNumber ?? existing.product_number;
    db().prepare(`UPDATE products SET product_name=?, product_number=? WHERE id=?`).run(name, number, id);
    return rowToProduct(db().prepare(`SELECT * FROM products WHERE id = ?`).get(id));
  },
  remove(id: string) {
    db().prepare(`DELETE FROM products WHERE id = ?`).run(id);
  },
  search(query: string): Product[] {
    const pattern = `%${query}%`;
    const rows = db().prepare(
      `SELECT * FROM products WHERE product_name LIKE ? OR product_number LIKE ? ORDER BY created_at DESC`
    ).all(pattern, pattern) as any[];
    return rows.map(rowToProduct);
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
    mode: r.mode === 'blog' ? 'blog' : 'shopping',
    siteUrl: r.site_url ?? undefined,
    isActive: r.is_active === undefined || r.is_active === null ? true : !!r.is_active,
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
    const existingRow = input.id
      ? (db().prepare(`SELECT created_at, is_active FROM knowledges WHERE id = ?`).get(id) as
          | { created_at: number; is_active: number }
          | undefined)
      : undefined;
    const createdAt = existingRow?.created_at ?? now;
    // isActive 가 명시되면 그 값, 아니면 기존 값 유지(신규는 true).
    const isActiveInt =
      input.isActive === undefined
        ? existingRow
          ? existingRow.is_active
          : 1
        : input.isActive
        ? 1
        : 0;
    const mode = input.mode ?? 'shopping';
    const siteUrl = input.siteUrl ?? null;
    db()
      .prepare(
        `INSERT INTO knowledges(id, keyword, item_name, purchase_name, group_name, mode, site_url, is_active, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET keyword=excluded.keyword, item_name=excluded.item_name,
           purchase_name=excluded.purchase_name, group_name=excluded.group_name,
           mode=excluded.mode, site_url=excluded.site_url,
           is_active=excluded.is_active, updated_at=excluded.updated_at`,
      )
      .run(
        id,
        input.keyword,
        input.itemName,
        input.purchaseName ?? null,
        input.groupName ?? null,
        mode,
        siteUrl,
        isActiveInt,
        createdAt,
        now,
      );
    return rowToKnowledge(db().prepare(`SELECT * FROM knowledges WHERE id = ?`).get(id));
  },
  setActive(id: string, active: boolean): Knowledge | null {
    const exists = db().prepare(`SELECT 1 FROM knowledges WHERE id = ?`).get(id);
    if (!exists) return null;
    db()
      .prepare(`UPDATE knowledges SET is_active = ?, updated_at = ? WHERE id = ?`)
      .run(active ? 1 : 0, Date.now(), id);
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
    return this.getByMode('shopping');
  },
  save(next: Settings): Settings {
    return this.saveByMode('shopping', next);
  },
  getByMode(mode: 'shopping' | 'blog' | 'crank'): Settings {
    const key = `app:${mode}`;
    // 먼저 모드별 키를 찾고, 없으면 기존 'app' 키 폴백
    let row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    if (!row) {
      row = db().prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string } | undefined;
    }
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Settings) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  saveByMode(mode: 'shopping' | 'blog' | 'crank', next: Settings): Settings {
    const key = `app:${mode}`;
    const merged = { ...DEFAULT_SETTINGS, ...next };
    const exists = db().prepare(`SELECT 1 FROM settings WHERE key = ?`).get(key);
    if (exists) {
      db().prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(JSON.stringify(merged), key);
    } else {
      db().prepare(`INSERT INTO settings(key, value) VALUES(?, ?)`).run(key, JSON.stringify(merged));
    }
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

// ──────────────── worker_logs ────────────────
export interface WorkerLogRow {
  id: number;
  workerId: string;
  workerName: string;
  message: string;
  level: LogLevel;
  createdAt: number;
}

function rowToWorkerLog(r: any): WorkerLogRow {
  return {
    id: r.id,
    workerId: r.worker_id,
    workerName: r.worker_name,
    message: r.message,
    level: r.level as LogLevel,
    createdAt: r.created_at,
  };
}

export const workerLogsRepo = {
  list(limit = 1000, workerId?: string): WorkerLogRow[] {
    let rows: any[];
    if (workerId) {
      rows = db()
        .prepare(`SELECT * FROM worker_logs WHERE worker_id = ? ORDER BY id DESC LIMIT ?`)
        .all(workerId, limit) as any[];
    } else {
      rows = db()
        .prepare(`SELECT * FROM worker_logs ORDER BY id DESC LIMIT ?`)
        .all(limit) as any[];
    }
    return rows.reverse().map(rowToWorkerLog);
  },
  append(workerId: string, workerName: string, message: string, level: LogLevel): WorkerLogRow {
    const now = Date.now();
    const info = db()
      .prepare(`INSERT INTO worker_logs(worker_id, worker_name, message, level, created_at) VALUES(?, ?, ?, ?, ?)`)
      .run(workerId, workerName, message, level, now);
    // 오래된 로그 정리: 워커별 최근 5000건만 유지
    db().prepare(`
      DELETE FROM worker_logs WHERE worker_id = ? AND id NOT IN (
        SELECT id FROM worker_logs WHERE worker_id = ? ORDER BY id DESC LIMIT 5000
      )
    `).run(workerId, workerId);
    return { id: Number(info.lastInsertRowid), workerId, workerName, message, level, createdAt: now };
  },
  clear(workerId?: string) {
    if (workerId) {
      db().prepare(`DELETE FROM worker_logs WHERE worker_id = ?`).run(workerId);
    } else {
      db().prepare(`DELETE FROM worker_logs`).run();
    }
  },
};

// ──────────────── failed_keywords ────────────────
function rowToFailedKeyword(r: any): FailedKeyword {
  return {
    id: r.id,
    workerId: r.worker_id,
    workerName: r.worker_name,
    knowledgeId: r.knowledge_id ?? undefined,
    keyword: r.keyword,
    itemName: r.item_name,
    purchaseName: r.purchase_name ?? undefined,
    groupName: r.group_name ?? undefined,
    pagesScanned: r.pages_scanned,
    reason: r.reason,
    createdAt: r.created_at,
  };
}

export const failedKeywordsRepo = {
  list(limit = 2000, workerId?: string): FailedKeyword[] {
    let rows: any[];
    if (workerId) {
      rows = db()
        .prepare(`SELECT * FROM failed_keywords WHERE worker_id = ? ORDER BY id DESC LIMIT ?`)
        .all(workerId, limit) as any[];
    } else {
      rows = db()
        .prepare(`SELECT * FROM failed_keywords ORDER BY id DESC LIMIT ?`)
        .all(limit) as any[];
    }
    return rows.map(rowToFailedKeyword);
  },
  append(
    workerId: string,
    workerName: string,
    knowledgeId: string | undefined,
    keyword: string,
    itemName: string,
    purchaseName: string | undefined,
    groupName: string | undefined,
    pagesScanned: number,
    reason: string,
  ): FailedKeyword {
    const now = Date.now();
    const info = db()
      .prepare(
        `INSERT INTO failed_keywords(worker_id, worker_name, knowledge_id, keyword, item_name, purchase_name, group_name, pages_scanned, reason, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workerId,
        workerName,
        knowledgeId ?? null,
        keyword,
        itemName,
        purchaseName ?? null,
        groupName ?? null,
        pagesScanned,
        reason,
        now,
      );
    db()
      .prepare(
        `DELETE FROM failed_keywords WHERE worker_id = ? AND id NOT IN (
           SELECT id FROM failed_keywords WHERE worker_id = ? ORDER BY id DESC LIMIT 2000
         )`,
      )
      .run(workerId, workerId);
    return {
      id: Number(info.lastInsertRowid),
      workerId,
      workerName,
      knowledgeId,
      keyword,
      itemName,
      purchaseName,
      groupName,
      pagesScanned,
      reason,
      createdAt: now,
    };
  },
  clear(workerId?: string) {
    if (workerId) {
      db().prepare(`DELETE FROM failed_keywords WHERE worker_id = ?`).run(workerId);
    } else {
      db().prepare(`DELETE FROM failed_keywords`).run();
    }
  },
  remove(id: number) {
    db().prepare(`DELETE FROM failed_keywords WHERE id = ?`).run(id);
  },
};

// ──────────────── rank checks ────────────────
function rowToRankCheck(r: any): RankCheck {
  return {
    id: r.id,
    keyword: r.keyword,
    itemName: r.item_name,
    purchaseName: r.purchase_name ?? undefined,
    groupName: r.group_name ?? undefined,
    rankPosition: r.rank_position ?? null,
    pageNumber: r.page_number ?? null,
    found: !!r.found,
    checkedAt: r.checked_at,
  };
}

export const rankChecksRepo = {
  list(): RankCheck[] {
    const rows = db().prepare(`SELECT * FROM rank_checks ORDER BY checked_at DESC`).all();
    return rows.map(rowToRankCheck);
  },
  latestByItemName(itemName: string): RankCheck[] {
    const rows = db().prepare(
      `SELECT * FROM rank_checks WHERE item_name = ? ORDER BY checked_at DESC`
    ).all(itemName);
    return rows.map(rowToRankCheck);
  },
  latestPerKeyword(): RankCheck[] {
    const rows = db().prepare(`
      SELECT r.* FROM rank_checks r
      INNER JOIN (
        SELECT keyword, item_name, MAX(checked_at) as max_checked
        FROM rank_checks GROUP BY keyword, item_name
      ) latest ON r.keyword = latest.keyword AND r.item_name = latest.item_name AND r.checked_at = latest.max_checked
      ORDER BY r.item_name, r.keyword
    `).all();
    return rows.map(rowToRankCheck);
  },
  save(input: Omit<RankCheck, 'id'>): RankCheck {
    const result = db().prepare(
      `INSERT INTO rank_checks(keyword, item_name, purchase_name, group_name, rank_position, page_number, found, checked_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.keyword, input.itemName, input.purchaseName ?? null,
      input.groupName ?? null, input.rankPosition, input.pageNumber,
      input.found ? 1 : 0, input.checkedAt,
    );
    return rowToRankCheck(db().prepare(`SELECT * FROM rank_checks WHERE id = ?`).get(result.lastInsertRowid));
  },
  history(itemName: string, keyword: string): RankCheck[] {
    const rows = db().prepare(
      `SELECT * FROM rank_checks WHERE item_name = ? AND keyword = ? ORDER BY checked_at DESC LIMIT 100`
    ).all(itemName, keyword);
    return rows.map(rowToRankCheck);
  },
  clickCountByRange(startMs: number, endMs: number): number {
    const row = db().prepare(
      `SELECT COUNT(*) as cnt FROM rank_checks WHERE found = 1 AND checked_at >= ? AND checked_at < ?`
    ).get(startMs, endMs) as any;
    return row?.cnt ?? 0;
  },
  clickCountByKeyword(itemName: string, keyword: string, startMs: number, endMs: number): number {
    const row = db().prepare(
      `SELECT COUNT(*) as cnt FROM rank_checks WHERE found = 1 AND item_name = ? AND keyword = ? AND checked_at >= ? AND checked_at < ?`
    ).get(itemName, keyword, startMs, endMs) as any;
    return row?.cnt ?? 0;
  },
  clickHistory(itemName: string, keyword: string): { date: string; count: number }[] {
    const rows = db().prepare(`
      SELECT DATE(checked_at / 1000, 'unixepoch', 'localtime') as day, COUNT(*) as cnt
      FROM rank_checks
      WHERE found = 1 AND item_name = ? AND keyword = ?
      GROUP BY day ORDER BY day DESC LIMIT 30
    `).all(itemName, keyword) as any[];
    return rows.map((r: any) => ({ date: r.day, count: r.cnt }));
  },
  clickTodayPerKeyword(startMs: number, endMs: number): { itemName: string; keyword: string; count: number }[] {
    const rows = db().prepare(`
      SELECT item_name, keyword, COUNT(*) as cnt
      FROM rank_checks
      WHERE found = 1 AND checked_at >= ? AND checked_at < ?
      GROUP BY item_name, keyword
    `).all(startMs, endMs) as any[];
    return rows.map((r: any) => ({ itemName: r.item_name, keyword: r.keyword, count: r.cnt }));
  },
  clearAll() {
    db().prepare(`DELETE FROM rank_checks`).run();
  },
};

/* ─── 카페 관리 (CafeEntry) ─── */
function rowToCafeEntry(row: any): CafeEntry {
  return { id: row.id, cafeName: row.cafe_name, postTitle: row.post_title, targetKeyword: row.target_keyword, createdAt: row.created_at };
}

export const cafeEntriesRepo = {
  findAll(): CafeEntry[] {
    return (db().prepare(`SELECT * FROM cafe_entries ORDER BY created_at DESC`).all() as any[]).map(rowToCafeEntry);
  },
  findById(id: string): CafeEntry | undefined {
    const row = db().prepare(`SELECT * FROM cafe_entries WHERE id = ?`).get(id);
    return row ? rowToCafeEntry(row) : undefined;
  },
  create(input: Omit<CafeEntry, 'id' | 'createdAt'>): CafeEntry {
    const id = uid(16);
    const now = Date.now();
    db().prepare(`INSERT INTO cafe_entries(id, cafe_name, post_title, target_keyword, created_at) VALUES(?,?,?,?,?)`)
      .run(id, input.cafeName, input.postTitle, input.targetKeyword, now);
    return rowToCafeEntry(db().prepare(`SELECT * FROM cafe_entries WHERE id = ?`).get(id));
  },
  bulkCreate(items: Omit<CafeEntry, 'id' | 'createdAt'>[]): number {
    const stmt = db().prepare(`INSERT INTO cafe_entries(id, cafe_name, post_title, target_keyword, created_at) VALUES(?,?,?,?,?)`);
    const tx = db().transaction(() => {
      let count = 0;
      for (const item of items) {
        stmt.run(uid(16), item.cafeName, item.postTitle, item.targetKeyword, Date.now());
        count++;
      }
      return count;
    });
    return tx();
  },
  delete(id: string) {
    db().prepare(`DELETE FROM cafe_entries WHERE id = ?`).run(id);
  },
};

/* ─── C랭크 그룹 (CRankGroup) ─── */
function rowToCRankGroup(row: any): CRankGroup {
  return { id: row.id, groupName: row.group_name, createdAt: row.created_at };
}

export const crankGroupsRepo = {
  findAll(): CRankGroup[] {
    return (db().prepare(`SELECT * FROM crank_groups ORDER BY created_at ASC`).all() as any[]).map(rowToCRankGroup);
  },
  create(groupName: string): CRankGroup {
    const id = uid(16);
    const now = Date.now();
    db().prepare(`INSERT INTO crank_groups(id, group_name, created_at) VALUES(?,?,?)`).run(id, groupName, now);
    return rowToCRankGroup(db().prepare(`SELECT * FROM crank_groups WHERE id = ?`).get(id));
  },
  delete(id: string) {
    const group = db().prepare(`SELECT * FROM crank_groups WHERE id = ?`).get(id) as any;
    if (group) {
      db().prepare(`DELETE FROM crank_knowledges WHERE group_name = ?`).run(group.group_name);
    }
    db().prepare(`DELETE FROM crank_groups WHERE id = ?`).run(id);
  },
};

/* ─── C랭크 키워드 (CRankKnowledge) ─── */
function rowToCRankKnowledge(row: any): CRankKnowledge {
  return {
    id: row.id, keyword: row.keyword, cafeName: row.cafe_name, postTitle: row.post_title,
    groupName: row.group_name, isActive: !!row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export const crankKnowledgesRepo = {
  findAll(): CRankKnowledge[] {
    return (db().prepare(`SELECT * FROM crank_knowledges ORDER BY created_at DESC`).all() as any[]).map(rowToCRankKnowledge);
  },
  findByGroup(groupName: string): CRankKnowledge[] {
    return (db().prepare(`SELECT * FROM crank_knowledges WHERE group_name = ? ORDER BY created_at DESC`).all(groupName) as any[]).map(rowToCRankKnowledge);
  },
  create(input: Omit<CRankKnowledge, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>): CRankKnowledge {
    const id = uid(16);
    const now = Date.now();
    db().prepare(`INSERT INTO crank_knowledges(id, keyword, cafe_name, post_title, group_name, is_active, created_at, updated_at) VALUES(?,?,?,?,?,1,?,?)`)
      .run(id, input.keyword, input.cafeName, input.postTitle, input.groupName ?? null, now, now);
    return rowToCRankKnowledge(db().prepare(`SELECT * FROM crank_knowledges WHERE id = ?`).get(id));
  },
  update(id: string, patch: Partial<Pick<CRankKnowledge, 'isActive'>>) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (patch.isActive !== undefined) { sets.push('is_active = ?'); vals.push(patch.isActive ? 1 : 0); }
    if (sets.length === 0) return;
    sets.push('updated_at = ?'); vals.push(Date.now());
    vals.push(id);
    db().prepare(`UPDATE crank_knowledges SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  },
  setGroupActive(groupName: string, isActive: boolean) {
    db().prepare(`UPDATE crank_knowledges SET is_active = ?, updated_at = ? WHERE group_name = ?`).run(isActive ? 1 : 0, Date.now(), groupName);
  },
  delete(id: string) {
    db().prepare(`DELETE FROM crank_knowledges WHERE id = ?`).run(id);
  },
};

/* ─── C랭크 순위 체크 (CRankCheck) ─── */
function rowToCRankCheck(row: any): CRankCheck {
  return {
    id: row.id, keyword: row.keyword, cafeName: row.cafe_name, postTitle: row.post_title,
    groupName: row.group_name, rankPosition: row.rank_position, found: !!row.found, checkedAt: row.checked_at,
  };
}

export const crankChecksRepo = {
  latest(): CRankCheck[] {
    const rows = db().prepare(`
      SELECT r.* FROM crank_checks r
      INNER JOIN (
        SELECT keyword, cafe_name, post_title, MAX(checked_at) as max_checked
        FROM crank_checks GROUP BY keyword, cafe_name, post_title
      ) latest ON r.keyword = latest.keyword AND r.cafe_name = latest.cafe_name AND r.post_title = latest.post_title AND r.checked_at = latest.max_checked
      ORDER BY r.keyword, r.cafe_name
    `).all();
    return rows.map(rowToCRankCheck);
  },
  save(input: Omit<CRankCheck, 'id'>): CRankCheck {
    const result = db().prepare(
      `INSERT INTO crank_checks(keyword, cafe_name, post_title, group_name, rank_position, found, checked_at) VALUES(?,?,?,?,?,?,?)`
    ).run(input.keyword, input.cafeName, input.postTitle, input.groupName ?? null, input.rankPosition, input.found ? 1 : 0, input.checkedAt);
    return rowToCRankCheck(db().prepare(`SELECT * FROM crank_checks WHERE id = ?`).get(result.lastInsertRowid));
  },
  history(keyword: string, cafeName: string, postTitle: string): CRankCheck[] {
    return (db().prepare(
      `SELECT * FROM crank_checks WHERE keyword = ? AND cafe_name = ? AND post_title = ? ORDER BY checked_at DESC LIMIT 100`
    ).all(keyword, cafeName, postTitle) as any[]).map(rowToCRankCheck);
  },
  clickCountByRange(startMs: number, endMs: number): number {
    const row = db().prepare(`SELECT COUNT(*) as cnt FROM crank_checks WHERE found = 1 AND checked_at >= ? AND checked_at < ?`).get(startMs, endMs) as any;
    return row?.cnt ?? 0;
  },
  clickTodayPerKeyword(startMs: number, endMs: number): { keyword: string; cafeName: string; postTitle: string; count: number }[] {
    const rows = db().prepare(`
      SELECT keyword, cafe_name, post_title, COUNT(*) as cnt FROM crank_checks
      WHERE found = 1 AND checked_at >= ? AND checked_at < ? GROUP BY keyword, cafe_name, post_title
    `).all(startMs, endMs) as any[];
    return rows.map((r: any) => ({ keyword: r.keyword, cafeName: r.cafe_name, postTitle: r.post_title, count: r.cnt }));
  },
  clickHistory(keyword: string, cafeName: string, postTitle: string): { date: string; count: number }[] {
    const rows = db().prepare(`
      SELECT DATE(checked_at / 1000, 'unixepoch', 'localtime') as day, COUNT(*) as cnt
      FROM crank_checks WHERE found = 1 AND keyword = ? AND cafe_name = ? AND post_title = ?
      GROUP BY day ORDER BY day DESC LIMIT 30
    `).all(keyword, cafeName, postTitle) as any[];
    return rows.map((r: any) => ({ date: r.day, count: r.cnt }));
  },
};
