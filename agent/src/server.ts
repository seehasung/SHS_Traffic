import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

import { API, WS_PATH, WS_WORKER_PATH, DEFAULT_AGENT_PORT } from '@shared/api';
import type { ServerMessage, WorkerStatus, WorkerMessage, ServerToWorkerMessage } from '@shared/types';
import { INITIAL_WORKER_STATUS } from '@shared/types';

import { db } from './db';
import {
  clearSessionCookie,
  createUser,
  isFirstRun,
  issueSessionCookie,
  readSession,
  requireAuth,
  requireAdmin,
  verifyLogin,
  verifyWorkerLogin,
} from './auth';
import type { SessionPayload } from './auth';
import { keywordGroupsRepo, knowledgesRepo, naverAccountsRepo, settingsRepo, logsRepo, workersRepo, productsRepo, workerLogsRepo, failedKeywordsRepo, rankChecksRepo } from './repos';
import { runner } from './runner';
import { staticWebDir } from './paths';

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionPayload;
  }
}

function parseCookies(req: Request, _res: Response, next: () => void) {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (header) {
    for (const pair of header.split(';')) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const k = pair.slice(0, idx).trim();
      const v = decodeURIComponent(pair.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  (req as any).cookies = out;
  next();
}

export interface StartServerOptions {
  port?: number;
  host?: string;
}

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

// ──────────────── 워커 상태 관리 ────────────────
const workerSockets = new Map<string, WebSocket>();
const workerStatuses = new Map<string, WorkerStatus>();

function getWorkerStatusList(): WorkerStatus[] {
  const workers = workersRepo.list();
  return workers.map((w) => {
    const live = workerStatuses.get(w.id);
    if (live) return live;
    return { ...INITIAL_WORKER_STATUS, workerId: w.id, workerName: w.name };
  });
}

/**
 * 연결된 모든 워커에게 본인 그룹에 해당하는 최신 설정/키워드/계정을 push.
 * 호스트에서 키워드/그룹/네이버계정/설정이 변경된 직후 호출.
 */
function broadcastConfigToAllWorkers() {
  const allKnowledges = knowledgesRepo.list().filter((k) => k.isActive !== false);
  const naverAccounts = naverAccountsRepo.list();
  for (const worker of workersRepo.list()) {
    const ws = workerSockets.get(worker.id);
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;
    // 워커 모드에 맞는 설정과 키워드 전달
    const workerMode = worker.mode ?? 'shopping';
    const workerSettings = settingsRepo.getByMode(workerMode);
    const modeFiltered = allKnowledges.filter((k) => (k.mode ?? 'shopping') === workerMode);
    const assignedKnowledges = worker.assignedGroupNames.length > 0
      ? modeFiltered.filter((k) => k.groupName && worker.assignedGroupNames.includes(k.groupName))
      : [];
    const update: ServerToWorkerMessage = {
      type: 'config:update',
      settings: workerSettings,
      knowledges: assignedKnowledges,
      naverAccounts,
    };
    try {
      ws.send(JSON.stringify(update));
    } catch {
      // ignore send failure
    }
  }
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  db();

  // 존재하지 않는 그룹명을 워커 배정에서 정리
  const existingGroupNames = new Set(keywordGroupsRepo.list().map((g) => g.groupName));
  for (const w of workersRepo.list()) {
    const cleaned = w.assignedGroupNames.filter((n) => existingGroupNames.has(n));
    if (cleaned.length !== w.assignedGroupNames.length) {
      workersRepo.update(w.id, { assignedGroupNames: cleaned });
    }
  }

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(parseCookies);

  app.use(
    cors({
      origin: (origin, cb) => cb(null, true),
      credentials: true,
    }),
  );

  // ──────────────── auth ────────────────
  app.get(API.setupStatus, (_req, res) => {
    res.json({ firstRun: isFirstRun() });
  });

  app.post(API.setup, async (req, res) => {
    if (!isFirstRun()) return res.status(409).json({ error: 'ALREADY_INITIALIZED' });
    const { email, password } = req.body ?? {};
    if (!email || !password || password.length < 4) {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }
    createUser(email, password, true);
    const session = verifyLogin(email, password)!;
    await issueSessionCookie(res, session);
    res.json({ ok: true, user: session });
  });

  app.post(API.login, async (req, res) => {
    const { email, password } = req.body ?? {};
    const session = verifyLogin(email, password) ?? verifyWorkerLogin(email, password);
    if (!session) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    await issueSessionCookie(res, session);
    res.json({ ok: true, user: session });
  });

  app.post(API.logout, (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get(API.me, async (req, res) => {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (session.role === 'worker' && session.workerId) {
      const worker = workersRepo.list().find((w) => w.id === session.workerId);
      if (worker) {
        session.assignedGroupNames = worker.assignedGroupNames;
      }
    }
    res.json({ user: session });
  });

  app.use('/api', requireAuth);

  // ──────────────── products ────────────────
  app.get(`${API.products}/search`, (req, res) => {
    const q = (req.query.q as string) ?? '';
    res.json({ items: productsRepo.search(q) });
  });
  app.get(API.products, requireAdmin, (_req, res) => res.json({ items: productsRepo.list() }));
  app.post(API.products, requireAdmin, (req, res) => {
    const { productName, productNumber } = req.body;
    if (!productName || !productNumber) return res.status(400).json({ error: 'INVALID_INPUT' });
    res.json({ item: productsRepo.create(productName, productNumber) });
  });
  app.put('/api/products/:id', requireAdmin, (req, res) => {
    try {
      res.json({ item: productsRepo.update(req.params.id, req.body) });
    } catch (e: any) {
      res.status(404).json({ error: 'NOT_FOUND' });
    }
  });
  app.delete('/api/products/:id', requireAdmin, (req, res) => {
    productsRepo.remove(req.params.id);
    res.json({ ok: true });
  });
  app.post(`${API.products}/bulk`, requireAdmin, (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'INVALID_INPUT' });
    let created = 0;
    for (const item of items) {
      const name = String(item.productName ?? '').trim();
      const number = String(item.productNumber ?? '').trim();
      if (name && number) {
        productsRepo.create(name, number);
        created++;
      }
    }
    res.json({ ok: true, created });
  });

  // ──────────────── workers (관리자 전용) ────────────────
  app.get(API.workers, requireAdmin, (_req, res) => res.json({ items: workersRepo.list() }));
  app.get(API.workerStatuses, requireAdmin, (_req, res) => res.json({ statuses: getWorkerStatusList() }));
  app.post(API.workers, requireAdmin, (req, res) => {
    const { name, loginId, loginPassword, mode } = req.body;
    if (!name || !loginId || !loginPassword) return res.status(400).json({ error: 'INVALID_INPUT' });
    try {
      res.json({ item: workersRepo.create({ name, loginId, loginPassword, mode }) });
    } catch (e: any) {
      res.status(409).json({ error: 'DUPLICATE_LOGIN_ID' });
    }
  });
  app.put('/api/workers/:id', requireAdmin, (req, res) => {
    try {
      const updated = workersRepo.update(req.params.id, req.body);
      // 그룹 배정이나 모드가 바뀌었을 수 있으니 연결된 워커에게 새 키워드/설정 push
      const ws = workerSockets.get(req.params.id);
      if (ws && ws.readyState === WebSocket.OPEN) {
        const workerMode = updated.mode ?? 'shopping';
        const allKnowledges = knowledgesRepo.list().filter((k) => k.isActive !== false && (k.mode ?? 'shopping') === workerMode);
        const assignedKnowledges = updated.assignedGroupNames.length > 0
          ? allKnowledges.filter((k) => k.groupName && updated.assignedGroupNames.includes(k.groupName))
          : [];
        const update: ServerToWorkerMessage = {
          type: 'config:update',
          settings: settingsRepo.getByMode(workerMode),
          knowledges: assignedKnowledges,
          naverAccounts: naverAccountsRepo.list(),
        };
        ws.send(JSON.stringify(update));
      }
      res.json({ item: updated });
    } catch (e: any) {
      res.status(404).json({ error: 'NOT_FOUND' });
    }
  });
  app.delete('/api/workers/:id', requireAdmin, (req, res) => {
    const ws = workerSockets.get(req.params.id);
    if (ws) ws.close(4000, 'DELETED');
    workerSockets.delete(req.params.id);
    workerStatuses.delete(req.params.id);
    workersRepo.remove(req.params.id);
    res.json({ ok: true });
  });

  // 워커에 시작/중지 명령 전송
  app.post('/api/workers/:id/start', requireAdmin, (req, res) => {
    const ws = workerSockets.get(req.params.id);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return res.status(400).json({ error: 'WORKER_OFFLINE' });
    }
    const msg: ServerToWorkerMessage = { type: 'command:start' };
    ws.send(JSON.stringify(msg));
    res.json({ ok: true });
  });
  app.post('/api/workers/:id/stop', requireAdmin, (req, res) => {
    const ws = workerSockets.get(req.params.id);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return res.status(400).json({ error: 'WORKER_OFFLINE' });
    }
    const msg: ServerToWorkerMessage = { type: 'command:stop' };
    ws.send(JSON.stringify(msg));
    res.json({ ok: true });
  });

  // ──────────────── keyword groups ────────────────
  app.get(API.keywordGroups, (req, res) => {
    const session = req.session!;
    let items = keywordGroupsRepo.list();
    if (session.role === 'worker' && session.assignedGroupNames && session.assignedGroupNames.length > 0) {
      items = items.filter((g) => session.assignedGroupNames!.includes(g.groupName));
    }
    res.json({ items });
  });
  app.post(API.keywordGroups, (req, res) => {
    const { groupName } = req.body;
    if (!groupName) return res.status(400).json({ error: 'INVALID_INPUT' });
    const item = keywordGroupsRepo.create(groupName);
    broadcastConfigToAllWorkers();
    res.json({ item });
  });
  app.put('/api/keyword-groups/:id', (req, res) => {
    const { groupName } = req.body;
    if (!groupName) return res.status(400).json({ error: 'INVALID_INPUT' });
    const item = keywordGroupsRepo.update(req.params.id, groupName);
    broadcastConfigToAllWorkers();
    res.json({ item });
  });
  app.delete('/api/keyword-groups/:id', (req, res) => {
    const group = keywordGroupsRepo.list().find((g) => g.id === req.params.id);
    keywordGroupsRepo.remove(req.params.id);
    if (group) {
      for (const w of workersRepo.list()) {
        if (w.assignedGroupNames.includes(group.groupName)) {
          workersRepo.update(w.id, {
            assignedGroupNames: w.assignedGroupNames.filter((n) => n !== group.groupName),
          });
        }
      }
    }
    broadcastConfigToAllWorkers();
    res.json({ ok: true });
  });

  // ──────────────── knowledges ────────────────
  app.get(API.knowledges, (req, res) => {
    const session = req.session!;
    let items = knowledgesRepo.list();
    if (session.role === 'worker') {
      // 워커 HTTP 세션도 활성 + 배정된 그룹만
      items = items.filter((k) => k.isActive !== false);
      if (session.assignedGroupNames && session.assignedGroupNames.length > 0) {
        items = items.filter((k) => k.groupName && session.assignedGroupNames!.includes(k.groupName));
      } else {
        items = [];
      }
    }
    // admin 은 isActive 포함한 전체 목록을 받아 스위치 UI 에서 사용
    res.json({ items });
  });
  app.post(API.knowledges, (req, res) => {
    const item = knowledgesRepo.upsert(req.body);
    broadcastConfigToAllWorkers();
    res.json({ item });
  });
  app.put('/api/knowledges/:id', (req, res) => {
    const item = knowledgesRepo.upsert({ ...req.body, id: req.params.id });
    broadcastConfigToAllWorkers();
    res.json({ item });
  });
  // 스위치 전용 빠른 토글 (다른 필드는 건드리지 않음)
  app.patch('/api/knowledges/:id/active', (req, res) => {
    const active = !!req.body?.isActive;
    const item = knowledgesRepo.setActive(req.params.id, active);
    if (!item) return res.status(404).json({ error: 'NOT_FOUND' });
    broadcastConfigToAllWorkers();
    res.json({ item });
  });
  app.patch('/api/knowledges/group-active', (req, res) => {
    const { groupName, isActive } = req.body;
    if (!groupName) return res.status(400).json({ error: 'INVALID_INPUT' });
    const all = knowledgesRepo.list().filter((k) => k.groupName === groupName);
    let updated = 0;
    for (const k of all) {
      if ((k.isActive ?? true) !== !!isActive) {
        knowledgesRepo.setActive(k.id, !!isActive);
        updated++;
      }
    }
    broadcastConfigToAllWorkers();
    res.json({ ok: true, updated });
  });
  app.delete('/api/knowledges/:id', (req, res) => {
    knowledgesRepo.remove(req.params.id);
    broadcastConfigToAllWorkers();
    res.json({ ok: true });
  });

  // ──────────────── naver accounts ────────────────
  app.get(API.naverAccounts, (_req, res) => res.json({ items: naverAccountsRepo.list() }));
  app.post(API.naverAccounts, (req, res) => {
    const item = naverAccountsRepo.upsert(req.body);
    broadcastConfigToAllWorkers();
    res.json({ item });
  });
  app.put('/api/naver-accounts/:id', (req, res) => {
    const item = naverAccountsRepo.upsert({ ...req.body, id: req.params.id });
    broadcastConfigToAllWorkers();
    res.json({ item });
  });
  app.delete('/api/naver-accounts/:id', (req, res) => {
    naverAccountsRepo.remove(req.params.id);
    broadcastConfigToAllWorkers();
    res.json({ ok: true });
  });

  // ──────────────── settings ────────────────
  // mode 쿼리 파라미터로 설정 모드 구분: ?mode=shopping 또는 ?mode=blog
  app.get(API.settings, (req, res) => {
    const session = req.session!;
    const mode = (req.query.mode as string) === 'blog' ? 'blog' : 'shopping';
    const hostSettings = settingsRepo.getByMode(mode);
    if (session.role === 'worker' && session.workerId) {
      const workerOverride = workersRepo.getSettings(session.workerId);
      return res.json({ settings: workerOverride ?? hostSettings, isDefault: !workerOverride });
    }
    res.json({ settings: hostSettings });
  });
  app.put(API.settings, (req, res) => {
    const session = req.session!;
    const mode = (req.query.mode as string) === 'blog' ? 'blog' : 'shopping';
    if (session.role === 'worker' && session.workerId) {
      workersRepo.saveSettings(session.workerId, req.body);
      return res.json({ settings: req.body });
    }
    res.json({ settings: settingsRepo.saveByMode(mode, req.body) });
  });

  // ──────────────── runner (로컬 실행용, 호환 유지) ────────────────
  app.get(API.runnerStatus, (_req, res) => res.json({ snapshot: runner.snapshot() }));
  app.post(API.runnerStart, async (req, res) => {
    const payload = {
      selectedKnowledgeIds: Array.isArray(req.body?.selectedKnowledgeIds) ? req.body.selectedKnowledgeIds : [],
      selectedNaverAccountIds: Array.isArray(req.body?.selectedNaverAccountIds) ? req.body.selectedNaverAccountIds : [],
    };
    runner.start(payload).catch(() => {});
    res.json({ ok: true, snapshot: runner.snapshot() });
  });
  app.post(API.runnerStop, async (_req, res) => {
    await runner.stop();
    res.json({ ok: true, snapshot: runner.snapshot() });
  });

  // ──────────────── logs ────────────────
  app.get(API.logs, (_req, res) => res.json({ items: logsRepo.list() }));
  app.delete(API.logs, (_req, res) => {
    runner.clearLogs();
    res.json({ ok: true });
  });

  // ──────────────── rank checks (순위 추적 — 워커가 크롤링 중 자동 보고) ────────────────
  app.get(API.rankChecks, (_req, res) => {
    res.json({ items: rankChecksRepo.latestPerKeyword() });
  });
  // 특정 상품+키워드의 전체 이력
  app.get('/api/rank-checks/history', (req, res) => {
    const itemName = req.query.itemName as string;
    const keyword = req.query.keyword as string;
    if (!itemName || !keyword) return res.status(400).json({ error: 'INVALID_INPUT' });
    const items = rankChecksRepo.history(itemName, keyword);
    res.json({ items });
  });
  app.delete(API.rankChecks, (_req, res) => {
    rankChecksRepo.clearAll();
    res.json({ ok: true });
  });

  // ──────────────── click stats (클릭 통계) ────────────────
  app.get('/api/click-stats', (_req, res) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowStart = todayStart + 86400000;
    const yesterdayStart = todayStart - 86400000;
    const dayBeforeStart = todayStart - 2 * 86400000;
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = todayStart - mondayOffset * 86400000;

    const today = rankChecksRepo.clickCountByRange(todayStart, tomorrowStart);
    const yesterday = rankChecksRepo.clickCountByRange(yesterdayStart, todayStart);
    const dayBefore = rankChecksRepo.clickCountByRange(dayBeforeStart, yesterdayStart);
    const thisWeek = rankChecksRepo.clickCountByRange(weekStart, tomorrowStart);
    const todayPerKeyword = rankChecksRepo.clickTodayPerKeyword(todayStart, tomorrowStart);

    res.json({ today, yesterday, dayBefore, thisWeek, todayPerKeyword });
  });
  app.get('/api/click-stats/history', (req, res) => {
    const itemName = req.query.itemName as string;
    const keyword = req.query.keyword as string;
    if (!itemName || !keyword) return res.status(400).json({ error: 'INVALID_INPUT' });
    const items = rankChecksRepo.clickHistory(itemName, keyword);
    res.json({ items });
  });

  // ──────────────── worker logs (영구 저장) ────────────────
  app.get('/api/worker-logs', (req, res) => {
    const workerId = (req.query.workerId as string | undefined) || undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '1000', 10) || 1000, 5000);
    const items = workerLogsRepo.list(limit, workerId);
    res.json({ items });
  });
  app.delete('/api/worker-logs', (req, res) => {
    const workerId = (req.query.workerId as string | undefined) || undefined;
    workerLogsRepo.clear(workerId);
    res.json({ ok: true });
  });

  // ──────────────── failed keywords (50페이지까지 못 찾은 키워드 영구 저장) ────────────────
  app.get(API.workerFailedKeywords, (req, res) => {
    const workerId = (req.query.workerId as string | undefined) || undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '2000', 10) || 2000, 5000);
    const items = failedKeywordsRepo.list(limit, workerId);
    res.json({ items });
  });
  app.delete(API.workerFailedKeywords, (req, res) => {
    const workerId = (req.query.workerId as string | undefined) || undefined;
    failedKeywordsRepo.clear(workerId);
    res.json({ ok: true });
  });
  app.delete(`${API.workerFailedKeywords}/:id`, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'INVALID_ID' });
    failedKeywordsRepo.remove(id);
    res.json({ ok: true });
  });

  // ──────────────── 정적 파일 서빙 ────────────────
  const webDir = staticWebDir();
  if (webDir) {
    app.use(express.static(webDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  // ──────────────── 서버 시작 ────────────────
  const server = http.createServer(app);

  // 대시보드 WebSocket (브라우저 → 서버)
  const wss = new WebSocketServer({ noServer: true });
  // 워커 WebSocket (워커 PC → 서버)
  const wssWorker = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    if (pathname === WS_PATH) {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    } else if (pathname === WS_WORKER_PATH) {
      wssWorker.handleUpgrade(request, socket, head, (ws) => wssWorker.emit('connection', ws, request));
    } else {
      socket.destroy();
    }
  });

  // 대시보드 WebSocket
  wss.on('connection', async (socket, req) => {
    const fakeReq = { headers: req.headers, cookies: {} } as unknown as Request;
    parseCookies(fakeReq, {} as any, () => undefined);
    const session = await readSession(fakeReq);
    if (!session) {
      socket.close(4401, 'UNAUTHORIZED');
      return;
    }
    safeSend(socket, { type: 'snapshot', snapshot: runner.snapshot() });
    safeSend(socket, { type: 'worker:status:all', statuses: getWorkerStatusList() });
  });

  function broadcastDashboard(msg: ServerMessage) {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  runner.on('log', (entry) => broadcastDashboard({ type: 'log', entry }));
  runner.on('snapshot', (snapshot) => broadcastDashboard({ type: 'snapshot', snapshot }));
  runner.on('cleared', () => broadcastDashboard({ type: 'log:cleared' }));

  // ──────────────── 워커 WebSocket ────────────────
  wssWorker.on('connection', (socket) => {
    let authenticatedWorkerId: string | null = null;

    // ping/pong 기반 keep-alive: 워커가 비정상 종료되어도 서버가 30초 안에 감지하여 socket 정리.
    (socket as any).isAlive = true;
    socket.on('pong', () => {
      (socket as any).isAlive = true;
    });

    socket.on('error', (err) => {
      console.warn('[Worker WS] socket error:', err?.message ?? err);
    });

    socket.on('message', (raw) => {
      try {
        const msg: WorkerMessage = JSON.parse(raw.toString());

        if (msg.type === 'worker:auth') {
          const worker = workersRepo.findByLoginId(msg.loginId);
          if (!worker || worker.loginPassword !== msg.loginPassword) {
            const fail: ServerToWorkerMessage = { type: 'auth:fail', reason: 'INVALID_CREDENTIALS' };
            socket.send(JSON.stringify(fail));
            socket.close(4401, 'AUTH_FAILED');
            return;
          }
          authenticatedWorkerId = worker.id;

          // 기존 연결 끊기
          const oldSocket = workerSockets.get(worker.id);
          if (oldSocket && oldSocket !== socket && oldSocket.readyState === WebSocket.OPEN) {
            oldSocket.close(4000, 'REPLACED');
          }
          workerSockets.set(worker.id, socket);

          // 초기 상태 설정
          workerStatuses.set(worker.id, {
            ...INITIAL_WORKER_STATUS,
            workerId: worker.id,
            workerName: worker.name,
            connectionStatus: 'online',
            lastHeartbeat: Date.now(),
          });

          // 워커 모드에 맞는 설정/키워드만 전송
          const workerMode = worker.mode ?? 'shopping';
          const allKnowledges = knowledgesRepo.list().filter((k) => k.isActive !== false && (k.mode ?? 'shopping') === workerMode);
          const assignedKnowledges = worker.assignedGroupNames.length > 0
            ? allKnowledges.filter((k) => k.groupName && worker.assignedGroupNames.includes(k.groupName))
            : [];

          const ok: ServerToWorkerMessage = {
            type: 'auth:ok',
            workerId: worker.id,
            settings: settingsRepo.getByMode(workerMode),
            knowledges: assignedKnowledges,
            naverAccounts: naverAccountsRepo.list(),
          };
          socket.send(JSON.stringify(ok));

          broadcastDashboard({ type: 'worker:status', status: workerStatuses.get(worker.id)! });
          return;
        }

        if (!authenticatedWorkerId) {
          socket.close(4401, 'NOT_AUTHENTICATED');
          return;
        }

        if (msg.type === 'worker:heartbeat') {
          const worker = workersRepo.list().find((w) => w.id === authenticatedWorkerId);
          const status: WorkerStatus = {
            workerId: authenticatedWorkerId,
            workerName: worker?.name ?? 'Unknown',
            connectionStatus: 'online',
            ipAddress: msg.ipAddress,
            cpuUsage: msg.cpuUsage,
            ramUsage: msg.ramUsage,
            currentTask: msg.currentTask,
            currentKeyword: msg.currentKeyword,
            currentProductId: msg.currentProductId,
            progressCount: msg.progressCount,
            runnerStatus: msg.runnerStatus,
            lastHeartbeat: Date.now(),
          };
          workerStatuses.set(authenticatedWorkerId, status);
          broadcastDashboard({ type: 'worker:status', status });
        }

        if (msg.type === 'worker:log') {
          const worker = workersRepo.list().find((w) => w.id === authenticatedWorkerId);
          const workerName = worker?.name ?? 'Unknown';
          const entry = logsRepo.append(`[워커:${authenticatedWorkerId}] ${msg.message}`, msg.level, 0);
          workerLogsRepo.append(authenticatedWorkerId, workerName, msg.message, msg.level);
          broadcastDashboard({ type: 'log', entry });
          broadcastDashboard({
            type: 'worker:log',
            workerId: authenticatedWorkerId,
            workerName,
            entry,
          });
        }

        if (msg.type === 'worker:failed-keyword') {
          const worker = workersRepo.list().find((w) => w.id === authenticatedWorkerId);
          const workerName = worker?.name ?? 'Unknown';
          const failed = failedKeywordsRepo.append(
            authenticatedWorkerId,
            workerName,
            msg.knowledgeId,
            msg.keyword,
            msg.itemName,
            msg.purchaseName,
            msg.groupName,
            msg.pagesScanned,
            msg.reason,
          );
          // 50페이지까지 못 찾은 키워드는 자동으로 OFF 처리하여 다음 사이클부터 워커가 작업하지 않음
          let autoDisabled = false;
          if (msg.knowledgeId) {
            const updated = knowledgesRepo.setActive(msg.knowledgeId, false);
            if (updated) {
              autoDisabled = true;
              // 모든 워커에 새 active 목록을 즉시 push
              broadcastConfigToAllWorkers();
              // 대시보드에도 자동 off 로그 한 줄 남김
              const noteMsg = `[자동 OFF] 키워드 "${msg.keyword}" 상품번호 "${msg.itemName}" — ${msg.reason} (${msg.pagesScanned}페이지 검색)`;
              const note = logsRepo.append(`[워커:${authenticatedWorkerId}] ${noteMsg}`, 'warn', 0);
              workerLogsRepo.append(authenticatedWorkerId, workerName, noteMsg, 'warn');
              broadcastDashboard({ type: 'log', entry: note });
              broadcastDashboard({
                type: 'worker:log',
                workerId: authenticatedWorkerId,
                workerName,
                entry: note,
              });
            }
          }
          broadcastDashboard({ type: 'worker:failed-keyword', failed });
          if (autoDisabled) {
            console.log(`[server] knowledge ${msg.knowledgeId} 를 50페이지 실패로 자동 비활성화함`);
          }
        }

        if ((msg as any).type === 'worker:rank-report') {
          const rm = msg as any;
          const saved = rankChecksRepo.save({
            keyword: rm.keyword,
            itemName: rm.itemName,
            purchaseName: rm.purchaseName,
            groupName: rm.groupName,
            rankPosition: rm.rankPosition ?? 0,
            pageNumber: rm.pageNumber ?? 0,
            found: rm.found !== false,
            checkedAt: Date.now(),
          });
          broadcastDashboard({ type: 'rank:update', rank: saved } as any);
        }

        if (msg.type === 'worker:request-start') {
          const ws = workerSockets.get(authenticatedWorkerId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            const cmd: ServerToWorkerMessage = { type: 'command:start' };
            ws.send(JSON.stringify(cmd));
          }
        }

        if (msg.type === 'worker:request-stop') {
          const ws = workerSockets.get(authenticatedWorkerId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            const cmd: ServerToWorkerMessage = { type: 'command:stop' };
            ws.send(JSON.stringify(cmd));
          }
        }
      } catch (e) {
        console.error('워커 메시지 파싱 에러:', e);
      }
    });

    socket.on('close', () => {
      if (authenticatedWorkerId) {
        const existing = workerStatuses.get(authenticatedWorkerId);
        if (existing) {
          existing.connectionStatus = 'offline';
          existing.runnerStatus = 'idle';
          workerStatuses.set(authenticatedWorkerId, existing);
          broadcastDashboard({ type: 'worker:status', status: existing });
        }
        if (workerSockets.get(authenticatedWorkerId) === socket) {
          workerSockets.delete(authenticatedWorkerId);
        }
      }
    });
  });

  // ─── WS keep-alive: 30초마다 모든 워커 소켓에 ping → 30초 안에 pong 없으면 terminate ───
  // Render 등 reverse proxy 환경에서 한쪽이 끊겨도 close 이벤트가 한참 동안 안 오는 stale 문제 방지.
  const wsPingInterval = setInterval(() => {
    wssWorker.clients.forEach((client) => {
      const c = client as WebSocket & { isAlive?: boolean };
      if (c.isAlive === false) {
        try {
          c.terminate();
        } catch {}
        return;
      }
      c.isAlive = false;
      try {
        c.ping();
      } catch {}
    });
  }, 30000);

  // 하트비트 타임아웃 감시 (45초 내 application heartbeat 없으면 오프라인 + socket 강제 정리)
  const staleInterval = setInterval(() => {
    const now = Date.now();
    for (const [workerId, status] of workerStatuses) {
      if (
        status.connectionStatus === 'online' &&
        status.lastHeartbeat &&
        now - status.lastHeartbeat > 45000
      ) {
        status.connectionStatus = 'offline';
        status.runnerStatus = 'idle';
        workerStatuses.set(workerId, status);
        broadcastDashboard({ type: 'worker:status', status });

        // stale socket 도 정리해서 다음 재연결을 깨끗하게.
        const sock = workerSockets.get(workerId);
        if (sock) {
          try {
            sock.terminate();
          } catch {}
          workerSockets.delete(workerId);
        }
      }
    }
  }, 10000);

  const port = options.port ?? DEFAULT_AGENT_PORT;
  const host = options.host ?? '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.once('error', reject);
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(wsPingInterval);
        clearInterval(staleInterval);
        wss.close();
        wssWorker.close();
        server.close(() => resolve());
      }),
  };
}

function safeSend(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}
