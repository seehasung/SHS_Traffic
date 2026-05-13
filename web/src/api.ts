// 단일 fetch 래퍼. 항상 같은 출처(에이전트)에 쿠키와 함께 요청한다.
import { API } from '@shared/api';
import type {
  Knowledge,
  KeywordGroup,
  NaverAccount,
  Settings,
  RunnerSnapshot,
  StartJobPayload,
  LogEntry,
  UserAccount,
  Worker,
  WorkerStatus,
  Product,
} from '@shared/types';

class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const j = await res.json();
      code = j?.error ?? code;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // ─── auth ───
  setupStatus: () => call<{ firstRun: boolean }>('GET', API.setupStatus),
  setup: (email: string, password: string) =>
    call<{ ok: true; user: UserAccount }>('POST', API.setup, { email, password }),
  login: (email: string, password: string) =>
    call<{ ok: true; user: UserAccount }>('POST', API.login, { email, password }),
  logout: () => call<{ ok: true }>('POST', API.logout),
  me: () => call<{ user: UserAccount }>('GET', API.me),

  // ─── workers ───
  workers: {
    list: () => call<{ items: Worker[] }>('GET', API.workers).then((r) => r.items),
    statuses: () => call<{ statuses: WorkerStatus[] }>('GET', API.workerStatuses).then((r) => r.statuses),
    create: (input: { name: string; loginId: string; loginPassword: string }) =>
      call<{ item: Worker }>('POST', API.workers, input).then((r) => r.item),
    update: (id: string, input: Partial<{ name: string; loginId: string; loginPassword: string; assignedGroupNames: string[] }>) =>
      call<{ item: Worker }>('PUT', API.worker(id), input).then((r) => r.item),
    remove: (id: string) => call<{ ok: true }>('DELETE', API.worker(id)),
    start: (id: string) => call<{ ok: true }>('POST', `/api/workers/${encodeURIComponent(id)}/start`),
    stop: (id: string) => call<{ ok: true }>('POST', `/api/workers/${encodeURIComponent(id)}/stop`),
  },

  // ─── data ───
  keywordGroups: {
    list: () => call<{ items: KeywordGroup[] }>('GET', API.keywordGroups).then((r) => r.items),
    create: (groupName: string) =>
      call<{ item: KeywordGroup }>('POST', API.keywordGroups, { groupName }).then((r) => r.item),
    update: (id: string, groupName: string) =>
      call<{ item: KeywordGroup }>('PUT', API.keywordGroup(id), { groupName }).then((r) => r.item),
    remove: (id: string) => call<{ ok: true }>('DELETE', API.keywordGroup(id)),
  },
  knowledges: {
    list: () => call<{ items: Knowledge[] }>('GET', API.knowledges).then((r) => r.items),
    upsert: (k: Partial<Knowledge> & { keyword: string; itemName: string }) =>
      call<{ item: Knowledge }>(k.id ? 'PUT' : 'POST', k.id ? API.knowledge(k.id) : API.knowledges, k).then(
        (r) => r.item,
      ),
    remove: (id: string) => call<{ ok: true }>('DELETE', API.knowledge(id)),
  },
  naverAccounts: {
    list: () => call<{ items: NaverAccount[] }>('GET', API.naverAccounts).then((r) => r.items),
    upsert: (a: Partial<NaverAccount> & { naverId: string; naverPassword: string }) =>
      call<{ item: NaverAccount }>(a.id ? 'PUT' : 'POST', a.id ? API.naverAccount(a.id) : API.naverAccounts, a).then(
        (r) => r.item,
      ),
    remove: (id: string) => call<{ ok: true }>('DELETE', API.naverAccount(id)),
  },
  settings: {
    get: () => call<{ settings: Settings }>('GET', API.settings).then((r) => r.settings),
    save: (s: Settings) => call<{ settings: Settings }>('PUT', API.settings, s).then((r) => r.settings),
  },
  runner: {
    status: () => call<{ snapshot: RunnerSnapshot }>('GET', API.runnerStatus).then((r) => r.snapshot),
    start: (payload: StartJobPayload) =>
      call<{ ok: true; snapshot: RunnerSnapshot }>('POST', API.runnerStart, payload),
    stop: () => call<{ ok: true; snapshot: RunnerSnapshot }>('POST', API.runnerStop),
  },
  products: {
    list: () => call<{ items: Product[] }>('GET', '/api/products').then((r) => r.items),
    search: (q: string) => call<{ items: Product[] }>('GET', `/api/products/search?q=${encodeURIComponent(q)}`).then((r) => r.items),
    create: (productName: string, productNumber: string) => call<{ item: Product }>('POST', '/api/products', { productName, productNumber }).then((r) => r.item),
    update: (id: string, data: Partial<{ productName: string; productNumber: string }>) => call<{ item: Product }>('PUT', `/api/products/${id}`, data).then((r) => r.item),
    remove: (id: string) => call('DELETE', `/api/products/${id}`),
    bulk: (items: { productName: string; productNumber: string }[]) =>
      call<{ ok: true; created: number }>('POST', '/api/products/bulk', { items }),
  },
  logs: {
    list: () => call<{ items: LogEntry[] }>('GET', API.logs).then((r) => r.items),
    clear: () => call<{ ok: true }>('DELETE', API.logs),
  },
};

export { ApiError };
