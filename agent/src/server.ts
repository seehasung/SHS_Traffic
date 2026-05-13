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
import { keywordGroupsRepo, knowledgesRepo, naverAccountsRepo, settingsRepo, logsRepo, workersRepo, productsRepo } from './repos';
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

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  db();

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
    const { name, loginId, loginPassword } = req.body;
    if (!name || !loginId || !loginPassword) return res.status(400).json({ error: 'INVALID_INPUT' });
    try {
      res.json({ item: workersRepo.create({ name, loginId, loginPassword }) });
    } catch (e: any) {
      res.status(409).json({ error: 'DUPLICATE_LOGIN_ID' });
    }
  });
  app.put('/api/workers/:id', requireAdmin, (req, res) => {
    try {
      res.json({ item: workersRepo.update(req.params.id, req.body) });
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
    res.json({ item: keywordGroupsRepo.create(groupName) });
  });
  app.put('/api/keyword-groups/:id', (req, res) => {
    const { groupName } = req.body;
    if (!groupName) return res.status(400).json({ error: 'INVALID_INPUT' });
    res.json({ item: keywordGroupsRepo.update(req.params.id, groupName) });
  });
  app.delete('/api/keyword-groups/:id', (req, res) => {
    keywordGroupsRepo.remove(req.params.id);
    res.json({ ok: true });
  });

  // ──────────────── knowledges ────────────────
  app.get(API.knowledges, (req, res) => {
    const session = req.session!;
    let items = knowledgesRepo.list();
    if (session.role === 'worker' && session.assignedGroupNames && session.assignedGroupNames.length > 0) {
      items = items.filter((k) => k.groupName && session.assignedGroupNames!.includes(k.groupName));
    }
    res.json({ items });
  });
  app.post(API.knowledges, (req, res) => res.json({ item: knowledgesRepo.upsert(req.body) }));
  app.put('/api/knowledges/:id', (req, res) =>
    res.json({ item: knowledgesRepo.upsert({ ...req.body, id: req.params.id }) }),
  );
  app.delete('/api/knowledges/:id', (req, res) => {
    knowledgesRepo.remove(req.params.id);
    res.json({ ok: true });
  });

  // ──────────────── naver accounts ────────────────
  app.get(API.naverAccounts, (_req, res) => res.json({ items: naverAccountsRepo.list() }));
  app.post(API.naverAccounts, (req, res) => res.json({ item: naverAccountsRepo.upsert(req.body) }));
  app.put('/api/naver-accounts/:id', (req, res) =>
    res.json({ item: naverAccountsRepo.upsert({ ...req.body, id: req.params.id }) }),
  );
  app.delete('/api/naver-accounts/:id', (req, res) => {
    naverAccountsRepo.remove(req.params.id);
    res.json({ ok: true });
  });

  // ──────────────── settings ────────────────
  app.get(API.settings, (req, res) => {
    const session = req.session!;
    const hostSettings = settingsRepo.get();
    if (session.role === 'worker' && session.workerId) {
      const workerOverride = workersRepo.getSettings(session.workerId);
      return res.json({ settings: workerOverride ?? hostSettings, isDefault: !workerOverride });
    }
    res.json({ settings: hostSettings });
  });
  app.put(API.settings, (req, res) => {
    const session = req.session!;
    if (session.role === 'worker' && session.workerId) {
      workersRepo.saveSettings(session.workerId, req.body);
      return res.json({ settings: req.body });
    }
    res.json({ settings: settingsRepo.save(req.body) });
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

          // 배정된 그룹의 키워드, 설정, 네이버 계정 전송
          const allKnowledges = knowledgesRepo.list();
          const assignedKnowledges = worker.assignedGroupNames.length > 0
            ? allKnowledges.filter((k) => k.groupName && worker.assignedGroupNames.includes(k.groupName))
            : allKnowledges;

          const ok: ServerToWorkerMessage = {
            type: 'auth:ok',
            workerId: worker.id,
            settings: settingsRepo.get(),
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
          const entry = logsRepo.append(`[워커:${authenticatedWorkerId}] ${msg.message}`, msg.level, 0);
          broadcastDashboard({ type: 'log', entry });
          broadcastDashboard({
            type: 'worker:log',
            workerId: authenticatedWorkerId,
            workerName: worker?.name ?? 'Unknown',
            entry,
          });
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

  // 하트비트 타임아웃 감시 (30초 내 응답 없으면 오프라인)
  setInterval(() => {
    const now = Date.now();
    for (const [workerId, status] of workerStatuses) {
      if (status.connectionStatus === 'online' && status.lastHeartbeat && now - status.lastHeartbeat > 30000) {
        status.connectionStatus = 'offline';
        status.runnerStatus = 'idle';
        workerStatuses.set(workerId, status);
        broadcastDashboard({ type: 'worker:status', status });
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
        wss.close();
        wssWorker.close();
        server.close(() => resolve());
      }),
  };
}

function safeSend(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}
