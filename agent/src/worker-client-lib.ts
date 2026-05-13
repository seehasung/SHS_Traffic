import WebSocket from 'ws';
import os from 'os';
import { EventEmitter } from 'events';
import type { WorkerMessage, ServerToWorkerMessage, Settings, Knowledge, NaverAccount } from '@shared/types';

interface WorkerClientOptions {
  serverUrl: string;
  loginId: string;
  loginPassword: string;
}

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
  private isRunning = false;
  private isStopping = false;
  private progressCount = 0;
  private currentKeyword: string | null = null;
  private currentProductId: string | null = null;
  private currentTask: string | null = null;

  constructor(options: WorkerClientOptions) {
    super();
    this.options = options;
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'worker:request-start' }));
    }
  }

  requestStop() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'worker:request-stop' }));
    }
  }

  async start() {
    console.log(`[Worker] 서버에 연결 시도: ${this.options.serverUrl}`);
    this.connect();
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
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
      const auth: WorkerMessage = {
        type: 'worker:auth',
        loginId: this.options.loginId,
        loginPassword: this.options.loginPassword,
      };
      this.ws!.send(JSON.stringify(auth));
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
      this.stopHeartbeat();
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[Worker] WebSocket 에러:', err.message);
      this.emit('error', err.message);
    });
  }

  private handleMessage(msg: ServerToWorkerMessage) {
    switch (msg.type) {
      case 'auth:ok':
        console.log(`[Worker] 인증 성공, workerId=${msg.workerId}`);
        this.workerId = msg.workerId;
        this.settings = msg.settings;
        this.knowledges = msg.knowledges;
        this.naverAccounts = msg.naverAccounts;
        this.startHeartbeat();
        this.emit('connected');
        break;

      case 'auth:fail':
        console.error(`[Worker] 인증 실패: ${msg.reason}`);
        this.emit('error', msg.reason);
        break;

      case 'command:start':
        console.log('[Worker] 시작 명령 수신');
        this.startCrawler();
        break;

      case 'command:stop':
        console.log('[Worker] 중지 명령 수신');
        this.stopCrawler();
        break;

      case 'config:update':
        console.log('[Worker] 설정 업데이트 수신');
        this.settings = msg.settings;
        this.knowledges = msg.knowledges;
        this.naverAccounts = msg.naverAccounts;
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

    crawlerUtil.setLogger((message: string) => {
      this.currentTask = message.slice(0, 80);
      this.sendLog(message, 'info');
    });

    try {
      await crawlerController.run({
        settings: this.settings,
        knowledges: this.knowledges,
        naverAccounts: this.naverAccounts,
        logFn: (message: string) => {
          this.currentTask = message.slice(0, 80);
          const kwMatch = message.match(/키워드[:\s]*"?([^"]+)"?/);
          if (kwMatch) this.currentKeyword = kwMatch[1];
          const pidMatch = message.match(/상품번호[:\s]*"?([^"]+)"?/);
          if (pidMatch) this.currentProductId = pidMatch[1];
          this.sendLog(message, 'info');
        },
        shouldStop: () => this.isStopping,
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg === 'VPN_CONNECTION_FAILED') {
        this.sendLog('VPN 연결 실패로 작업이 중단되었습니다. VPN 프로그램을 확인하고 다시 시작해주세요.', 'error');
      } else {
        this.sendLog(`크롤러 에러: ${msg}`, 'error');
      }
    } finally {
      this.isRunning = false;
      this.currentTask = null;
      this.currentKeyword = null;
      this.currentProductId = null;
      this.progressCount++;
      this.emit('runner-status', 'idle');
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
    this.emit('log', message, level);
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const msg: WorkerMessage = { type: 'worker:log', message, level };
    this.ws.send(JSON.stringify(msg));
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
      const { publicIpv4 } = await import('public-ip');
      const ip = await publicIpv4({ timeout: 5000 } as any);
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
    console.log('[Worker] 5초 후 재연결 시도...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }
}
