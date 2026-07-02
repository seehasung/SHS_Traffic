// 웹과 에이전트가 공유하는 도메인 타입 정의 (외부 서비스 의존 없음).
// 기존 vscode_project 의 모델과 호환되는 형태로 작성한다.

export type WorkType = 'pc' | 'mobile';
export type LogicType = 'clean' | 'detail' | 'hidden';
export type YN = 'Y' | 'N';
export type PageType = 'pc' | 'mobile' | 'random';
/** 키워드 동작 모드: 쇼핑 상위노출 vs 블로그/사이트 상위노출 vs C랭크 카페. */
export type KnowledgeMode = 'shopping' | 'blog' | 'crank';
/** 설정 모드 (쇼핑/블로그/C랭크). */
export type SettingsMode = 'shopping' | 'blog' | 'crank';

/** 로컬 사용자. 단일 사용자가 일반적이지만 멀티유저도 지원. */
export interface UserAccount {
  id: number;
  email: string;
  isAdmin: boolean;
  role: 'admin' | 'worker';
  workerId?: string;
  assignedGroupNames?: string[];
  createdAt: number;
}

/** 키워드 그룹. 기존 KeywordGroupModel 과 호환. */
export interface KeywordGroup {
  id: string;
  groupName: string;
  createdAt: number;
}

/** 한 줄짜리 상품 행. 기존 KnowledgeModel 과 호환. */
export interface Knowledge {
  id: string;
  keyword: string;
  /** 쇼핑 모드: 상품번호, 블로그 모드: 블로그 글 URL 또는 제목 일부. */
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  /** shopping = 쇼핑 상위노출, blog = 블로그/사이트 상위노출. 기본 shopping. */
  mode: KnowledgeMode;
  /** 블로그 모드 전용: 검색 결과에서 매칭할 사이트 URL 또는 제목 부분문자열. */
  siteUrl?: string;
  /** 활성 여부. false 면 워커가 이 키워드를 작업하지 않는다. 기본 true. */
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 네이버 자동 로그인 계정. 기존 NaverAccountModel 과 호환. */
export interface NaverAccount {
  id: string;
  naverId: string;
  naverPassword: string;
  userAgent?: string;
}

/** 작업 설정. 기존 SettingModel 의 핵심 필드를 단순화. */
export interface Settings {
  pageType: PageType;
  testMode: YN;
  ipChangeType: 'phone' | 'vpn' | 'none';
  naverLoginType: 'no' | 'random' | 'inOrder' | 'fixed';
  logType: 'save-init' | 'no-save';
  logicType: LogicType;
  minWaitTime1: number;
  maxWaitTime1: number;
  minWaitTime2: number;
  maxWaitTime2: number;
  keywordShuffleControlRole: YN;
  scrollSpeed?: 'slow' | 'normal' | 'fast';
  showBrowser?: YN;
  showImage?: YN;
  macAddressChange?: YN;
  storeType?: 'normal' | 'plus' | 'special';
  isIncludeAds?: YN;
  shoppingRandomSearch?: YN;
  vpnType?: 'hi' | 'cool' | 'momo';
  maxPages?: number;
  /** C랭크: 최대 검색 순위 (기본 100) */
  maxCafeRank?: number;
  /** C랭크: 카페 내 게시판 진입 수 (기본 3) */
  cafeInternalClicks?: number;
  서비스번호?: number;
  상품번호?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pageType: 'pc',
  testMode: 'N',
  ipChangeType: 'none',
  naverLoginType: 'no',
  logType: 'no-save',
  logicType: 'clean',
  minWaitTime1: 10,
  maxWaitTime1: 30,
  minWaitTime2: 180,
  maxWaitTime2: 250,
  keywordShuffleControlRole: 'N',
};

/** 상품 관리용. */
export interface Product {
  id: string;
  productName: string;
  productNumber: string;
  createdAt: number;
}

/** 워커 PC 등록 정보. */
export interface Worker {
  id: string;
  name: string;
  loginId: string;
  loginPassword: string;
  /** 이 워커가 작업할 모드. shopping = 쇼핑 상위노출, blog = 블로그/사이트 상위노출. */
  mode: KnowledgeMode;
  assignedGroupNames: string[];
  createdAt: number;
}

/** 워커 PC 실시간 상태 (WebSocket으로 수신). */
export type WorkerConnectionStatus = 'online' | 'offline';

export interface WorkerStatus {
  workerId: string;
  workerName: string;
  connectionStatus: WorkerConnectionStatus;
  ipAddress: string | null;
  cpuUsage: number | null;
  ramUsage: number | null;
  currentTask: string | null;
  currentKeyword: string | null;
  currentProductId: string | null;
  progressCount: number;
  runnerStatus: RunnerStatus;
  lastHeartbeat: number | null;
}

export const INITIAL_WORKER_STATUS: Omit<WorkerStatus, 'workerId' | 'workerName'> = {
  connectionStatus: 'offline',
  ipAddress: null,
  cpuUsage: null,
  ramUsage: null,
  currentTask: null,
  currentKeyword: null,
  currentProductId: null,
  progressCount: 0,
  runnerStatus: 'idle',
  lastHeartbeat: null,
};

/** 작업 실행 상태. */
export type RunnerStatus = 'idle' | 'running' | 'stopping';

/** 작업 시작 페이로드. */
export interface StartJobPayload {
  selectedKnowledgeIds: string[];
  selectedNaverAccountIds: string[];
}

/** 작업 진행 정보(스냅샷). */
export interface RunnerSnapshot {
  status: RunnerStatus;
  progressCount: number;
  startedAt: number | null;
  lastError: string | null;
  /** 현재 처리 중 단계의 사람이 읽을 수 있는 설명. */
  currentStep: string | null;
}

export const INITIAL_SNAPSHOT: RunnerSnapshot = {
  status: 'idle',
  progressCount: 0,
  startedAt: null,
  lastError: null,
  currentStep: null,
};

/** 로그 한 줄. */
export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export interface LogEntry {
  id: number;
  message: string;
  level: LogLevel;
  progressCount: number;
  createdAt: number;
}

/** 50페이지까지 찾았는데 못 찾고 다음 상품으로 넘어간 키워드 기록. */
export interface FailedKeyword {
  id: number;
  workerId: string;
  workerName: string;
  /** 실패한 키워드의 knowledge.id (워커가 보고할 때 함께 전달). 자동 비활성화에 사용. */
  knowledgeId?: string;
  keyword: string;
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  pagesScanned: number;
  reason: string;
  createdAt: number;
}

/** WebSocket 으로 흐르는 메시지 종류. */
export type ServerMessage =
  | { type: 'log'; entry: LogEntry }
  | { type: 'snapshot'; snapshot: RunnerSnapshot }
  | { type: 'log:cleared' }
  | { type: 'worker:status'; status: WorkerStatus }
  | { type: 'worker:status:all'; statuses: WorkerStatus[] }
  | { type: 'worker:log'; workerId: string; workerName: string; entry: LogEntry }
  | { type: 'worker:failed-keyword'; failed: FailedKeyword };

export type ClientMessage = { type: 'subscribe' };

/** 워커 → 서버 WebSocket 메시지. */
export type WorkerMessage =
  | { type: 'worker:auth'; loginId: string; loginPassword: string }
  | { type: 'worker:heartbeat'; ipAddress: string; cpuUsage: number; ramUsage: number; currentTask: string | null; currentKeyword: string | null; currentProductId: string | null; progressCount: number; runnerStatus: RunnerStatus }
  | { type: 'worker:log'; message: string; level: LogLevel }
  | { type: 'worker:request-start' }
  | { type: 'worker:request-stop' }
  | {
      type: 'worker:failed-keyword';
      knowledgeId?: string;
      keyword: string;
      itemName: string;
      purchaseName?: string;
      groupName?: string;
      pagesScanned: number;
      reason: string;
    };

/** 카페 관리 마스터 데이터. */
export interface CafeEntry {
  id: string;
  cafeName: string;
  postTitle: string;
  targetKeyword: string;
  createdAt: number;
}

/** C랭크 키워드 그룹. */
export interface CRankGroup {
  id: string;
  groupName: string;
  createdAt: number;
}

/** C랭크 키워드 행. */
export interface CRankKnowledge {
  id: string;
  keyword: string;
  cafeName: string;
  postTitle: string;
  groupName?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/** C랭크 순위 조회 결과 */
export interface CRankCheck {
  id: number;
  keyword: string;
  cafeName: string;
  postTitle: string;
  groupName?: string;
  rankPosition: number | null;
  found: boolean;
  checkedAt: number;
}

/** 순위 조회 결과 */
export interface RankCheck {
  id: number;
  keyword: string;
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  /** 노출 순위 (data-ap-index-ori + 1). 미발견 시 null. */
  rankPosition: number | null;
  /** 발견된 페이지 번호. 미발견 시 null. */
  pageNumber: number | null;
  /** 발견 여부 */
  found: boolean;
  checkedAt: number;
}

/** 서버 → 워커 WebSocket 메시지. */
export type ServerToWorkerMessage =
  | { type: 'auth:ok'; workerId: string; settings: Settings; knowledges: Knowledge[]; naverAccounts: NaverAccount[]; crankKnowledges?: CRankKnowledge[]; crankSettings?: Settings }
  | { type: 'auth:fail'; reason: string }
  | { type: 'command:start' }
  | { type: 'command:stop' }
  | { type: 'config:update'; settings: Settings; knowledges: Knowledge[]; naverAccounts: NaverAccount[]; crankKnowledges?: CRankKnowledge[]; crankSettings?: Settings };
