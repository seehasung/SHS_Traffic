// 웹과 에이전트가 공유하는 REST API 경로 상수.
// 단일 출처 원칙 — 한 곳에서 바꾸면 양쪽 다 따라간다.

export const API = {
  /** 최초 사용자 등록이 필요한지(첫 실행) */
  setupStatus: '/api/auth/setup-status',
  /** 최초 사용자 등록 (첫 실행에만 사용) */
  setup: '/api/auth/setup',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  me: '/api/auth/me',

  keywordGroups: '/api/keyword-groups',
  keywordGroup: (id: string) => `/api/keyword-groups/${encodeURIComponent(id)}`,

  knowledges: '/api/knowledges',
  knowledge: (id: string) => `/api/knowledges/${encodeURIComponent(id)}`,

  naverAccounts: '/api/naver-accounts',
  naverAccount: (id: string) => `/api/naver-accounts/${encodeURIComponent(id)}`,

  products: '/api/products',
  product: (id: string) => `/api/products/${encodeURIComponent(id)}`,
  workerLogs: '/api/workers/logs',
  workerFailedKeywords: '/api/worker-failed-keywords',

  workers: '/api/workers',
  worker: (id: string) => `/api/workers/${encodeURIComponent(id)}`,
  workerStatuses: '/api/workers/statuses',

  settings: '/api/settings',

  runnerStatus: '/api/runner/status',
  runnerStart: '/api/runner/start',
  runnerStop: '/api/runner/stop',

  logs: '/api/logs',

  rankChecks: '/api/rank-checks',
  rankCheckStart: '/api/rank-checks/start',
  rankCheckStatus: '/api/rank-checks/status',

  // C랭크 (카페)
  cafeEntries: '/api/cafe-entries',
  cafeEntry: (id: string) => `/api/cafe-entries/${encodeURIComponent(id)}`,

  crankGroups: '/api/crank-groups',
  crankGroup: (id: string) => `/api/crank-groups/${encodeURIComponent(id)}`,

  crankKnowledges: '/api/crank-knowledges',
  crankKnowledge: (id: string) => `/api/crank-knowledges/${encodeURIComponent(id)}`,

  crankChecks: '/api/crank-checks',
} as const;

export const WS_PATH = '/ws';
export const WS_WORKER_PATH = '/ws/worker';

/** 기본 포트. agent 가 이 포트로 listen, web dev 서버는 vite proxy 로 우회. */
export const DEFAULT_AGENT_PORT = 17321;
