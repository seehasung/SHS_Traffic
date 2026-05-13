import { EventEmitter } from 'node:events';
import type { LogEntry, LogLevel, RunnerSnapshot, StartJobPayload } from '@shared/types';
import { INITIAL_SNAPSHOT } from '@shared/types';
import { knowledgesRepo, naverAccountsRepo, logsRepo, settingsRepo } from './repos';

export interface RunnerEvents {
  log: (entry: LogEntry) => void;
  snapshot: (snap: RunnerSnapshot) => void;
  cleared: () => void;
}

class Runner extends EventEmitter {
  private snap: RunnerSnapshot = { ...INITIAL_SNAPSHOT };
  private cancelled = false;
  private currentPromise: Promise<void> | null = null;

  snapshot(): RunnerSnapshot {
    return { ...this.snap };
  }

  private setSnap(patch: Partial<RunnerSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.emit('snapshot', this.snapshot());
  }

  private log(message: string, level: LogLevel = 'info') {
    const entry = logsRepo.append(message, level, this.snap.progressCount);
    this.emit('log', entry);
  }

  async start(payload: StartJobPayload) {
    if (this.snap.status === 'running') throw new Error('이미 실행 중입니다.');

    this.cancelled = false;
    this.setSnap({ status: 'running', startedAt: Date.now(), lastError: null, progressCount: 0, currentStep: '준비 중' });

    const settings = settingsRepo.get();
    const knowledges = payload.selectedKnowledgeIds.length
      ? knowledgesRepo.list().filter((k) => payload.selectedKnowledgeIds.includes(k.id))
      : knowledgesRepo.list();
    const accounts = naverAccountsRepo.findManyByIds(payload.selectedNaverAccountIds);

    this.log(`작업을 시작합니다. (logicType=${settings.logicType}, pageType=${settings.pageType})`, 'success');
    this.log(`선택된 키워드 ${knowledges.length}건, 네이버 계정 ${accounts.length}건`, 'info');

    this.currentPromise = this.runCrawler(settings, knowledges, accounts).finally(() => {
      this.currentPromise = null;
    });

    try {
      await this.currentPromise;
      if (!this.cancelled) {
        this.log('모든 사이클이 정상 종료되었습니다.', 'success');
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg === 'CANCELLED') {
        this.log('사용자 요청으로 정지되었습니다.', 'warn');
      } else {
        this.setSnap({ lastError: msg });
        this.log(`작업 중 오류: ${msg}`, 'error');
      }
    } finally {
      try {
        const { crawlerController } = await import('./crawler/crawlerController');
        await crawlerController.close();
      } catch {}
      this.setSnap({ status: 'idle', currentStep: null });
    }
  }

  async stop() {
    if (this.snap.status !== 'running') return;
    this.cancelled = true;
    this.setSnap({ status: 'stopping' });
    this.log('정지 요청을 받았습니다. 현재 단계가 끝나면 안전하게 종료합니다.', 'warn');
  }

  clearLogs() {
    logsRepo.clear();
    this.emit('cleared');
  }

  private async runCrawler(settings: any, knowledges: any[], accounts: any[]) {
    this.setSnap({ progressCount: 1, currentStep: '크롤러 실행 중' });

    const { crawlerController } = await import('./crawler/crawlerController');
    await crawlerController.run({
      settings,
      knowledges,
      naverAccounts: accounts,
      logFn: (message: string) => {
        this.setSnap({ currentStep: message.slice(0, 80) });
        this.log(message);
      },
      shouldStop: () => this.cancelled,
    });
  }
}

export const runner = new Runner();

export interface TypedRunner {
  on<K extends keyof RunnerEvents>(event: K, listener: RunnerEvents[K]): this;
}
