import WebSocket from 'ws';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { WorkerMessage, ServerToWorkerMessage, Settings, Knowledge, NaverAccount, CRankKnowledge } from '@shared/types';

interface WorkerClientOptions {
  serverUrl: string;
  loginId: string;
  loginPassword: string;
  /**
   * 로그인 시 받은 설정/키워드/계정을 디스크에 캐싱할 디렉터리.
   * 지정하면 다음 부팅 때 서버 연결 실패 상황에서도 이전 데이터로 작업을 시작할 수 있다.
   */
  cacheDir?: string;
}

interface PendingLog {
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
  timestamp: number;
}

interface PendingFailedKeyword {
  knowledgeId?: string;
  keyword: string;
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  pagesScanned: number;
  reason: string;
}

const MAX_PENDING_LOGS = 5000;
const MAX_PENDING_FAILED = 2000;

export class WorkerClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private publicIpTimer: ReturnType<typeof setInterval> | null = null;
  private publicIp: string = '';
  private options: WorkerClientOptions;
  private workerId: string | null = null;
  private settings: Settings | null = null;
  private knowledges: Knowledge[] = [];
  private naverAccounts: NaverAccount[] = [];
  private crankKnowledges: CRankKnowledge[] = [];
  private crankSettings: Settings | null = null;
  private isRunning = false;
  private isStopping = false;
  private progressCount = 0;
  private currentKeyword: string | null = null;
  private currentProductId: string | null = null;
  private currentTask: string | null = null;
  private pendingLogs: PendingLog[] = [];
  private pendingFailedKeywords: PendingFailedKeyword[] = [];
  private cacheFile: string | null = null;
  private isAuthenticated = false;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private reconnectAttempt = 0;

  constructor(options: WorkerClientOptions) {
    super();
    this.options = options;
    if (options.cacheDir) {
      try {
        fs.mkdirSync(options.cacheDir, { recursive: true });
        // 로그인 ID별로 별도 캐시 (여러 계정 사용 대비)
        const safeId = (options.loginId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
        this.cacheFile = path.join(options.cacheDir, `worker-cache-${safeId}.json`);
        this.loadCacheFromDisk();
      } catch (e) {
        console.warn('[Worker] 캐시 디렉터리 준비 실패:', (e as Error).message);
      }
    }
  }

  private loadCacheFromDisk() {
    if (!this.cacheFile || !fs.existsSync(this.cacheFile)) return;
    try {
      const raw = fs.readFileSync(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.settings) this.settings = parsed.settings;
      if (Array.isArray(parsed.knowledges)) this.knowledges = parsed.knowledges;
      if (Array.isArray(parsed.naverAccounts)) this.naverAccounts = parsed.naverAccounts;
      if (typeof parsed.workerId === 'string') this.workerId = parsed.workerId;
      if (Array.isArray(parsed.crankKnowledges)) this.crankKnowledges = parsed.crankKnowledges;
      if (parsed.crankSettings) this.crankSettings = parsed.crankSettings;
      console.log(
        `[Worker] 로컬 캐시 로드: knowledges=${this.knowledges.length}, accounts=${this.naverAccounts.length}`,
      );
    } catch (e) {
      console.warn('[Worker] 로컬 캐시 로드 실패:', (e as Error).message);
    }
  }

  private saveCacheToDisk() {
    if (!this.cacheFile) return;
    try {
      const payload = {
        workerId: this.workerId,
        settings: this.settings,
        knowledges: this.knowledges,
        naverAccounts: this.naverAccounts,
        crankKnowledges: this.crankKnowledges,
        crankSettings: this.crankSettings,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.cacheFile, JSON.stringify(payload), 'utf-8');
    } catch (e) {
      console.warn('[Worker] 로컬 캐시 저장 실패:', (e as Error).message);
    }
  }

  getKnowledges(): Knowledge[] {
    return this.knowledges;
  }

  /**
   * 외부(예: IP 변경 직후)에서 공인 IP를 즉시 다시 가져오게 한다.
   */
  refreshPublicIpNow(): Promise<void> {
    return this.refreshPublicIp();
  }

  requestStart() {
    // 서버가 연결된 경우: 서버로 요청을 보내면 서버가 다시 command:start 로 돌려준다 (대시보드 동기화 목적).
    // 연결이 끊긴 경우: 서버 없이도 로컬 데이터로 바로 작업을 시작한다.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'worker:request-start' }));
    } else {
      console.log('[Worker] 서버 연결 없음 → 로컬 데이터로 직접 작업을 시작합니다.');
      void this.startCrawler();
    }
  }

  requestStop() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'worker:request-stop' }));
    } else {
      console.log('[Worker] 서버 연결 없음 → 로컬에서 직접 정지합니다.');
      void this.stopCrawler();
    }
  }

  async start() {
    console.log(`[Worker] 서버에 연결 시도: ${this.options.serverUrl}`);
    this.connect();
  }

  disconnect() {
    this.isAuthenticated = false;
    this.stopHeartbeat();
    this.stopWsPingLoop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    // 사용자가 명시적으로 연결을 끊었으면 작업 사이클도 함께 정지
    if (this.isRunning) {
      this.isStopping = true;
      void this.stopCrawler();
    }
  }

  private connect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    const wsUrl = this.options.serverUrl.replace(/^http/, 'ws') + '/ws/worker';
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('[Worker] 서버 연결됨, 인증 시작');
      this.reconnectAttempt = 0;
      this.startWsPingLoop();
      const auth: WorkerMessage = {
        type: 'worker:auth',
        loginId: this.options.loginId,
        loginPassword: this.options.loginPassword,
      };
      this.ws!.send(JSON.stringify(auth));
    });

    this.ws.on('pong', () => {
      this.lastPongAt = Date.now();
    });

    this.ws.on('message', (raw) => {
      try {
        const msg: ServerToWorkerMessage = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch (e) {
        console.error('[Worker] 메시지 파싱 에러:', e);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[Worker] 연결 종료 (code=${code}, reason=${reason})`);
      this.isAuthenticated = false;
      this.stopHeartbeat();
      this.stopWsPingLoop();
      this.emit('disconnected');
      // 작업은 계속 돌아간다 (this.isRunning 유지). 로그는 pendingLogs 에 큐잉됨.
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[Worker] WebSocket 에러:', err.message);
      // error 시 ws 라이브러리는 close 도 함께 발생시키지만, 혹시 누락될 경우를 대비해 재연결도 스케줄
      this.emit('error', err.message);
      this.scheduleReconnect();
    });
  }

  /**
   * WebSocket 자체 ping/pong 으로 stale 연결을 빨리 감지한다.
   * 25초마다 ping → 60초 안에 pong 응답 없으면 강제로 terminate → 재연결 트리거.
   * Render 같은 reverse proxy 환경에서 close 이벤트가 늦게 오는 문제 해결.
   */
  private startWsPingLoop() {
    this.stopWsPingLoop();
    this.lastPongAt = Date.now();
    this.wsPingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - this.lastPongAt > 60000) {
        console.warn('[Worker] 60초간 pong 응답 없음 → 강제 재연결');
        try {
          this.ws.terminate();
        } catch {}
        return;
      }
      try {
        this.ws.ping();
      } catch {}
    }, 25000);
  }

  private stopWsPingLoop() {
    if (this.wsPingTimer) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = null;
    }
  }

  private handleMessage(msg: ServerToWorkerMessage) {
    switch (msg.type) {
      case 'auth:ok':
        console.log(`[Worker] 인증 성공, workerId=${msg.workerId}`);
        this.workerId = msg.workerId;
        this.settings = msg.settings;
        this.knowledges = msg.knowledges;
        this.naverAccounts = msg.naverAccounts;
        if (msg.crankKnowledges) this.crankKnowledges = msg.crankKnowledges;
        if (msg.crankSettings) this.crankSettings = msg.crankSettings;
        this.isAuthenticated = true;
        this.saveCacheToDisk();
        this.startHeartbeat();
        this.emit('connected');
        this.emit('knowledges', this.knowledges);
        // 끊어져 있던 동안 쌓인 로그/실패 키워드를 모두 서버로 전송
        this.flushPendingLogs();
        this.flushPendingFailedKeywords();
        // 재연결 시 현재 워커 상태도 즉시 한 번 동기화
        this.sendHeartbeat();
        break;

      case 'auth:fail':
        console.error(`[Worker] 인증 실패: ${msg.reason}`);
        this.isAuthenticated = false;
        this.emit('error', msg.reason);
        break;

      case 'command:start':
        console.log('[Worker] 시작 명령 수신');
        void this.startCrawler();
        break;

      case 'command:stop':
        console.log('[Worker] 중지 명령 수신');
        void this.stopCrawler();
        break;

      case 'config:update':
        console.log('[Worker] 설정 업데이트 수신');
        this.settings = msg.settings;
        this.knowledges = msg.knowledges;
        this.naverAccounts = msg.naverAccounts;
        if (msg.crankKnowledges) this.crankKnowledges = msg.crankKnowledges;
        if (msg.crankSettings) this.crankSettings = msg.crankSettings;
        this.saveCacheToDisk();
        this.emit('knowledges', this.knowledges);
        break;
    }
  }

  private async startCrawler() {
    if (this.isRunning) return;
    if (!this.settings || this.knowledges.length === 0) {
      this.sendLog('배정된 키워드가 없습니다.', 'warn');
      return;
    }

    this.isRunning = true;
    this.isStopping = false;
    this.progressCount = 0;
    this.emit('runner-status', 'running');

    const { crawlerController } = await import('./crawler/crawlerController');
    const { crawlerUtil } = await import('./crawler/utils/crawlerUtil');

    // ─── 워치독: 5분 동안 새 로그/작업 메시지가 없으면 브라우저 강제 종료 → 다음 사이클로 진행 ───
    const HANG_THRESHOLD_MS = 5 * 60 * 1000; // 5분
    const WATCHDOG_INTERVAL_MS = 30 * 1000; // 30초마다 검사
    let lastActivityAt = Date.now();
    let watchdogTimer: ReturnType<typeof setInterval> | null = null;
    let watchdogClosing = false;

    const noteActivity = () => {
      lastActivityAt = Date.now();
    };
    const armWatchdog = () => {
      if (watchdogTimer) return;
      lastActivityAt = Date.now();
      watchdogTimer = setInterval(async () => {
        if (this.isStopping || watchdogClosing) return;
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs >= HANG_THRESHOLD_MS) {
          watchdogClosing = true;
          this.sendLog(
            `[감시] ${Math.round(HANG_THRESHOLD_MS / 60000)}분 동안 새 작업 메시지가 없습니다 → 브라우저 강제 종료 후 다음 사이클로 진행합니다.`,
            'warn',
          );
          // close 자체가 hang 될 가능성을 대비해 15초 timeout race
          try {
            await Promise.race([
              crawlerController.close(),
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('CLOSE_TIMEOUT')), 15000),
              ),
            ]);
          } catch (e) {
            this.sendLog(
              `[감시] 브라우저 종료 처리 중 문제: ${(e as Error).message} (다음 사이클은 계속 진행됩니다)`,
              'error',
            );
          }
          // close 후에도 puppeteer await 가 깨어나려면 약간의 여유 필요
          await new Promise((r) => setTimeout(r, 3000));
          // 강제 종료가 끝나면 활동시각을 갱신해 같은 사이클에서 중복 트리거되지 않게 함.
          lastActivityAt = Date.now();
          watchdogClosing = false;
        }
      }, WATCHDOG_INTERVAL_MS);
    };
    const disarmWatchdog = () => {
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
    };

    crawlerUtil.setLogger((message: string) => {
      noteActivity();
      this.currentTask = message.slice(0, 80);
      this.sendLog(message, 'info');
    });

    armWatchdog();

    // 사이클을 자동 반복: 정지 요청이 오기 전까지 계속 돈다.
    // 서버 연결이 끊겨도 메모리에 보관된 settings/knowledges 로 사이클 반복이 가능하다.
    let cycleNo = 0;
    let vpnFailed = false;
    try {
      while (!this.isStopping) {
        cycleNo++;
        noteActivity();
        this.sendLog(`\n========== 사이클 #${cycleNo} 시작 ==========\n`, 'info');
        try {
          await crawlerController.run({
            settings: this.settings,
            knowledges: this.knowledges,
            naverAccounts: this.naverAccounts,
            logFn: (message: string) => {
              noteActivity();
              this.currentTask = message.slice(0, 80);
              const kwMatch = message.match(/키워드[:\s]*"?([^"]+)"?/);
              if (kwMatch) this.currentKeyword = kwMatch[1];
              const pidMatch = message.match(/상품번호[:\s]*"?([^"]+)"?/);
              if (pidMatch) this.currentProductId = pidMatch[1];
              this.sendLog(message, 'info');
            },
            shouldStop: () => this.isStopping,
            onFailedKeyword: (info) => {
              this.sendFailedKeyword(info);
              this.sendLog(
                `[실패] 키워드 "${info.keyword}" 상품번호 "${info.itemName}" — ${info.reason} (${info.pagesScanned}페이지 검색)`,
                'warn',
              );
            },
            onRankFound: (info) => {
              this.sendRankReport(info);
            },
            crankKnowledges: this.crankKnowledges,
            crankSettings: this.crankSettings ?? undefined,
            onCRankReport: (info) => {
              this.sendCRankReport(info);
            },
            onCRankFailed: (info) => {
              this.sendCRankFailed(info);
            },
          });
        } catch (e: any) {
          const msg = e?.message || String(e);
          if (msg === 'CANCELLED') {
            // 사용자 정지 요청 → 루프 종료
            break;
          }
          if (msg === 'VPN_CONNECTION_FAILED') {
            this.sendLog(
              'VPN 연결 실패로 작업이 중단되었습니다. VPN 프로그램을 확인하고 다시 시작해주세요.',
              'error',
            );
            vpnFailed = true;
            break;
          }
          // 기타 일회성 오류: 다음 사이클로 넘어감
          this.sendLog(`사이클 #${cycleNo} 중 오류: ${msg} → 잠시 후 다음 사이클로 넘어갑니다.`, 'error');
          // 5초 쉰 후 재시도 (단, 정지 요청이 들어오면 즉시 빠져나옴)
          for (let i = 0; i < 10 && !this.isStopping; i++) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        this.progressCount++;
        if (!this.isStopping) {
          this.sendLog(`사이클 #${cycleNo} 완료. 다음 사이클을 시작합니다.`, 'success');
        }
      }
    } finally {
      disarmWatchdog();
      this.isRunning = false;
      this.currentTask = null;
      this.currentKeyword = null;
      this.currentProductId = null;
      this.emit('runner-status', 'idle');
      if (!vpnFailed) {
        this.sendLog('작업 루프가 종료되었습니다.', 'info');
      }
    }
  }

  private async stopCrawler() {
    this.isStopping = true;
    this.emit('runner-status', 'stopping');
    try {
      const { crawlerController } = await import('./crawler/crawlerController');
      await crawlerController.close();
    } catch {}
  }

  private sendLog(message: string, level: 'info' | 'warn' | 'error' | 'success') {
    // 워커 PC 자체 UI 에는 항상 표시
    this.emit('log', message, level);

    const entry: PendingLog = { message, level, timestamp: Date.now() };

    // 서버 연결되어 있으면 바로 전송
    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      try {
        const msg: WorkerMessage = { type: 'worker:log', message, level };
        this.ws.send(JSON.stringify(msg));
        return;
      } catch {
        // 전송 실패 시 큐에 적재
      }
    }

    // 연결이 끊겨 있거나 전송 실패 → 큐잉
    this.pendingLogs.push(entry);
    if (this.pendingLogs.length > MAX_PENDING_LOGS) {
      // 너무 오래된 로그는 버려 메모리 폭주 방지
      this.pendingLogs.splice(0, this.pendingLogs.length - MAX_PENDING_LOGS);
    }
  }

  /**
   * 50페이지까지 못 찾고 다음 상품으로 넘어간 키워드를 서버로 보고한다.
   * 서버 연결이 끊겨 있으면 큐에 쌓아뒀다가 재연결 시 flush.
   */
  sendFailedKeyword(info: PendingFailedKeyword) {
    // 로컬 캐시에서도 해당 키워드를 즉시 비활성화 → 같은 세션에서 재시도 방지.
    // 서버에서 config:update 가 곧 오지만, 그 사이에도 안전하게 작동하도록.
    if (info.knowledgeId) {
      const idx = this.knowledges.findIndex((k) => k.id === info.knowledgeId);
      if (idx !== -1) {
        this.knowledges[idx] = { ...this.knowledges[idx], isActive: false };
        this.saveCacheToDisk();
        this.emit('knowledges', this.knowledges);
      }
    }

    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      try {
        const msg: WorkerMessage = {
          type: 'worker:failed-keyword',
          knowledgeId: info.knowledgeId,
          keyword: info.keyword,
          itemName: info.itemName,
          purchaseName: info.purchaseName,
          groupName: info.groupName,
          pagesScanned: info.pagesScanned,
          reason: info.reason,
        };
        this.ws.send(JSON.stringify(msg));
        return;
      } catch {
        // 전송 실패 → 큐로
      }
    }
    this.pendingFailedKeywords.push(info);
    if (this.pendingFailedKeywords.length > MAX_PENDING_FAILED) {
      this.pendingFailedKeywords.splice(0, this.pendingFailedKeywords.length - MAX_PENDING_FAILED);
    }
  }

  private sendRankReport(info: { keyword: string; itemName: string; purchaseName?: string; groupName?: string; pageNumber: number; rankPosition: number; found?: boolean }) {
    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      try {
        const msg: WorkerMessage = {
          type: 'worker:rank-report' as any,
          keyword: info.keyword,
          itemName: info.itemName,
          purchaseName: info.purchaseName,
          groupName: info.groupName,
          pageNumber: info.pageNumber,
          rankPosition: info.rankPosition,
          found: info.found !== false,
        } as any;
        this.ws.send(JSON.stringify(msg));
      } catch {
        // ignore
      }
    }
  }

  private sendCRankReport(info: { keyword: string; cafeName: string; postTitle: string; groupName?: string; rankPosition: number | null; found: boolean }) {
    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      try {
        this.ws.send(JSON.stringify({ type: 'worker:crank-report', ...info }));
      } catch { /* ignore */ }
    }
  }

  private sendCRankFailed(info: { crankKnowledgeId: string; keyword: string; cafeName: string; postTitle: string }) {
    // 로컬에서 즉시 비활성화
    const idx = this.crankKnowledges.findIndex((k) => k.id === info.crankKnowledgeId);
    if (idx !== -1) {
      this.crankKnowledges[idx] = { ...this.crankKnowledges[idx], isActive: false };
      this.saveCacheToDisk();
    }
    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      try {
        this.ws.send(JSON.stringify({ type: 'worker:crank-failed', ...info }));
      } catch { /* ignore */ }
    }
  }

  private flushPendingFailedKeywords() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.pendingFailedKeywords.length === 0) return;
    const batch = this.pendingFailedKeywords.splice(0);
    console.log(`[Worker] 큐에 쌓인 ${batch.length}건의 실패 키워드를 서버로 재전송합니다.`);
    for (const info of batch) {
      try {
        const msg: WorkerMessage = {
          type: 'worker:failed-keyword',
          knowledgeId: info.knowledgeId,
          keyword: info.keyword,
          itemName: info.itemName,
          purchaseName: info.purchaseName,
          groupName: info.groupName,
          pagesScanned: info.pagesScanned,
          reason: info.reason,
        };
        this.ws.send(JSON.stringify(msg));
      } catch {
        this.pendingFailedKeywords.unshift(info);
        break;
      }
    }
  }

  /**
   * 끊김 동안 큐에 쌓인 로그를 모두 서버로 전송한다.
   * 재인증 직후 호출된다.
   */
  private flushPendingLogs() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.pendingLogs.length === 0) return;
    const batch = this.pendingLogs.splice(0);
    console.log(`[Worker] 큐에 쌓인 ${batch.length}건의 로그를 서버로 재전송합니다.`);
    // 재전송임을 한 줄 표시 (서버/대시보드에서 누락 없이 보였음을 알 수 있도록)
    try {
      const head: WorkerMessage = {
        type: 'worker:log',
        message: `[재전송] 서버 연결이 끊긴 동안 발생한 ${batch.length}건의 로그를 전송합니다.`,
        level: 'info',
      };
      this.ws.send(JSON.stringify(head));
    } catch {}
    for (const e of batch) {
      try {
        const ts = new Date(e.timestamp).toLocaleTimeString();
        const msg: WorkerMessage = {
          type: 'worker:log',
          message: `[지연 ${ts}] ${e.message}`,
          level: e.level,
        };
        this.ws.send(JSON.stringify(msg));
      } catch {
        // 전송 도중 다시 끊겼다면 남은 항목들은 다시 큐 앞쪽에 넣어 둔다
        this.pendingLogs.unshift(e);
        break;
      }
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.startPublicIpRefresh();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 10000);
    this.sendHeartbeat();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.stopPublicIpRefresh();
  }

  /**
   * 공인 IP를 백그라운드에서 주기적으로 새로 가져온다.
   * VPN이 켜지면 LAN IP는 그대로지만 공인 IP가 바뀌므로,
   * 워커 관리 화면에 정확한 (= 외부에서 보이는) IP를 표시하기 위해 사용.
   */
  private startPublicIpRefresh() {
    void this.refreshPublicIp();
    if (this.publicIpTimer) return;
    this.publicIpTimer = setInterval(() => {
      void this.refreshPublicIp();
    }, 30000);
  }

  private stopPublicIpRefresh() {
    if (this.publicIpTimer) {
      clearInterval(this.publicIpTimer);
      this.publicIpTimer = null;
    }
  }

  private async refreshPublicIp(): Promise<void> {
    try {
      const { getPublicIp } = await import('./crawler/utils/ipUtil');
      const ip = await getPublicIp(5000);
      if (ip && ip !== this.publicIp) {
        this.publicIp = ip;
        // 새 IP가 잡히면 즉시 한 번 하트비트를 보내 대시보드에 빠르게 반영
        this.sendHeartbeat();
      }
    } catch {
      // 실패 시 기존 캐시 유지 (네트워크 일시 끊김 등)
    }
  }

  private sendHeartbeat() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    const cpus = os.cpus();
    const cpuUsage = cpus.reduce((sum, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return sum + ((total - cpu.times.idle) / total) * 100;
    }, 0) / cpus.length;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramUsage = ((totalMem - freeMem) / totalMem) * 100;

    const msg: WorkerMessage = {
      type: 'worker:heartbeat',
      ipAddress: this.publicIp || this.getLocalIp(),
      cpuUsage: Math.round(cpuUsage * 10) / 10,
      ramUsage: Math.round(ramUsage * 10) / 10,
      currentTask: this.currentTask,
      currentKeyword: this.currentKeyword,
      currentProductId: this.currentProductId,
      progressCount: this.progressCount,
      runnerStatus: this.isRunning ? (this.isStopping ? 'stopping' : 'running') : 'idle',
    };
    this.ws.send(JSON.stringify(msg));
  }

  private getLocalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    // 지수 백오프: 2s, 4s, 8s, 16s, 30s (cap)
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempt - 1), 30000);
    console.log(`[Worker] ${Math.round(delay / 1000)}초 후 재연결 시도... (attempt=${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
