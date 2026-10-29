import type { Browser, Page, Target, ElementHandle, CDPSession } from 'puppeteer-core';

/**
 * 상품 링크를 클릭했을 때 새로 열린 탭이 정말 그 링크의 결과인지 검증한다.
 * 네이버는 클릭 기록 처리기로 기본 이동을 막고 새 창을 따로 열기 때문에,
 * 단순히 "다음에 생긴 탭"을 잡으면 광고/추적 탭을 상품 페이지로 오인할 수 있다.
 */

const SOURCE_PROBE_KEY = '__knowledgeShoppingTopClickedTargetProbe';

export type ClickedTargetDiagnosticWriter = (message: string) => void | Promise<void>;

export interface BoundPageResult {
  page: Page;
  binding: {
    targetType: 'page';
    openerPresent: boolean;
    openerMatchesSource: boolean | null;
    expectedDocumentMatched: boolean;
    sourceOpenerMatched: boolean;
    sourcePointerDownObserved: true;
    sourceClickObserved: true;
    sourceWindowOpenObserved: true;
    sourceWindowOpenUserGesture: true;
    matchingCandidateCount: number;
  };
}

interface SourceClickProof {
  pointerDownObserved: boolean;
  clickObserved: boolean;
  pointerAndClickSameAnchor: boolean;
  pointerDownTrusted: boolean;
  clickTrusted: boolean;
}

const writeBindingDiagnostic = (writer: ClickedTargetDiagnosticWriter | undefined, message: string) => {
  if (!writer) return;
  try {
    void Promise.resolve(writer(message)).catch(() => undefined);
  } catch {
    // 진단 로그가 상품 클릭 결과를 바꾸면 안 된다
  }
};

const normalizeNavigationUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
};

// 가격비교 목록 링크는 네이버 클릭 기록 처리기가 기본 이동을 막고 클릭한 주소 뒤에 nl-au 하나만 붙여 새 창을 연다
const NAVER_CLICK_LOG_SUFFIX = /^nl-au=[^&]*$/;

export const navigationMatchesClickedAnchor = (candidateUrl: string, expectedHref: string): boolean => {
  const candidate = normalizeNavigationUrl(candidateUrl);
  const expected = normalizeNavigationUrl(expectedHref);
  if (candidate === '' || expected === '') return false;
  if (candidate === expected) return true;
  const expectedUrl = new URL(expected);
  if (expectedUrl.searchParams.has('nl-au')) return false;
  const separator = expectedUrl.search ? '&' : '?';
  return (
    candidate.startsWith(expected + separator) &&
    NAVER_CLICK_LOG_SUFFIX.test(candidate.slice(expected.length + 1))
  );
};

export const navigationMatchesExpectedProductCatalog = (
  candidateUrl: string,
  expectedProductId?: string,
): boolean => {
  if (!expectedProductId || !/^\d+$/.test(expectedProductId)) return false;
  try {
    const url = new URL(candidateUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'search.shopping.naver.com' &&
      url.pathname === `/catalog/${expectedProductId}`
    );
  } catch {
    return false;
  }
};

const navigationMatchesExpectedDestination = (
  candidateUrl: string,
  expectedHref: string,
  expectedProductId?: string,
): boolean =>
  navigationMatchesClickedAnchor(candidateUrl, expectedHref) ||
  navigationMatchesExpectedProductCatalog(candidateUrl, expectedProductId);

const navigationMatchesKnownProductFailureDestination = (candidateUrl: string): boolean => {
  try {
    const url = new URL(candidateUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'nid.naver.com' &&
      url.pathname === '/nidlogin.login'
    );
  } catch {
    return false;
  }
};

// 가격비교 목록의 중간 이동 링크(adcr 등)는 네이버 스토어 상품 화면으로 바로 넘어가 클릭 href·catalog 와 주소가 다르다
const NAVER_STORE_PRODUCT_HOSTS = new Set([
  'smartstore.naver.com',
  'm.smartstore.naver.com',
  'brand.naver.com',
  'm.brand.naver.com',
]);

export const navigationMatchesNaverStoreProduct = (candidateUrl: string): boolean => {
  try {
    const url = new URL(candidateUrl);
    return (
      url.protocol === 'https:' &&
      NAVER_STORE_PRODUCT_HOSTS.has(url.hostname.toLowerCase()) &&
      /^\/[^/]+\/products\/\d+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
};

const navigationDiagnosticCategory = (
  candidateUrl: string,
  expectedHref: string,
  expectedProductId?: string,
): string => {
  if (!candidateUrl) return 'EMPTY';
  if (candidateUrl === 'about:blank') return 'ABOUT_BLANK';
  if (navigationMatchesClickedAnchor(candidateUrl, expectedHref)) return 'EXPECTED';
  if (navigationMatchesExpectedProductCatalog(candidateUrl, expectedProductId)) return 'EXPECTED_CATALOG';
  if (navigationMatchesKnownProductFailureDestination(candidateUrl)) return 'NAVER_LOGIN';
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return 'OTHER_HTTP';
  } catch {
    return 'OTHER';
  }
  return 'OTHER';
};

const headerValue = (headers: Record<string, unknown> | undefined, name: string): string => {
  const key = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(headers?.[key] || '') : '';
};

const safeInternalRedirectReason = (response: any): string => {
  if (!response) return 'UNOBSERVED';
  if (headerValue(response.headers, 'non-authoritative-reason').toLowerCase() === 'hsts') return 'HSTS';
  if (String(response.statusText || '').toLowerCase() === 'internal redirect') return 'OTHER_INTERNAL';
  return 'NONE';
};

const summarizeBlockedCookies = (associatedCookies: any): { count: number; category: string } => {
  const reasons: string[] = (Array.isArray(associatedCookies) ? associatedCookies : []).flatMap(
    (item: any) => (Array.isArray(item?.blockedReasons) ? item.blockedReasons.map(String) : []),
  );
  if (reasons.length === 0) return { count: 0, category: 'NONE' };
  if (reasons.some((reason) => /SameSite|Schemeful/.test(reason))) return { count: reasons.length, category: 'SAMESITE' };
  if (reasons.includes('UserPreferences')) return { count: reasons.length, category: 'USER_PREFERENCES' };
  if (reasons.some((reason) => /ThirdParty/.test(reason))) return { count: reasons.length, category: 'THIRD_PARTY' };
  return { count: reasons.length, category: 'OTHER' };
};

const installSourceClickProbe = async (link: ElementHandle<Element>): Promise<string> =>
  link.evaluate((element: any, probeKey: string) => {
    const anchor =
      String(element?.tagName || '').toLowerCase() === 'a' ? element : element?.closest?.('a');
    if (!anchor || !anchor.href) return '';
    const holder = (window as any)[probeKey];
    if (holder && typeof holder.cleanup === 'function') holder.cleanup();
    const state = {
      anchor,
      pointerDownObserved: false,
      clickObserved: false,
      pointerHref: '',
      clickHref: '',
      pointerDownTrusted: false,
      clickTrusted: false,
    };
    const eventUsesAnchor = (event: any) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      return path.includes(anchor);
    };
    const onPointerDown = (event: any) => {
      if (!eventUsesAnchor(event)) return;
      state.pointerDownObserved = true;
      state.pointerDownTrusted = event.isTrusted === true;
      state.pointerHref = String(anchor.href);
    };
    const onClick = (event: any) => {
      if (!eventUsesAnchor(event)) return;
      state.clickObserved = true;
      state.clickTrusted = event.isTrusted === true;
      state.clickHref = String(anchor.href);
    };
    const cleanup = () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    (window as any)[probeKey] = { state, cleanup };
    anchor.target = '_blank';
    return String(anchor.href);
  }, SOURCE_PROBE_KEY);

const readSourceClickProof = async (link: ElementHandle<Element>): Promise<SourceClickProof> =>
  link.evaluate((_element: any, probeKey: string) => {
    const state = (window as any)[probeKey]?.state;
    return {
      pointerDownObserved: state?.pointerDownObserved === true,
      clickObserved: state?.clickObserved === true,
      pointerAndClickSameAnchor: Boolean(state?.pointerHref && state?.clickHref && state.pointerHref === state.clickHref),
      pointerDownTrusted: state?.pointerDownTrusted === true,
      clickTrusted: state?.clickTrusted === true,
    };
  }, SOURCE_PROBE_KEY);

const cleanupSourceClickProbe = async (link: ElementHandle<Element>): Promise<void> => {
  await link
    .evaluate((_element: any, probeKey: string) => {
      const holder = (window as any)[probeKey];
      if (holder && typeof holder.cleanup === 'function') holder.cleanup();
      delete (window as any)[probeKey];
    }, SOURCE_PROBE_KEY)
    .catch(() => undefined);
};

interface CandidateDiagnostic {
  targetType: string;
  opener: string;
  targetBeforePageCategory: string;
  targetBeforePageMatches: boolean;
  targetAfterPageCategory: string;
  targetAfterPageMatches: boolean;
  pageAfterPageCategory: string;
  pageAfterPageMatches: boolean;
  listenerInstalled: boolean;
  navigationAdvancedBeforeListener: boolean;
  mainDocumentObservedAfterListener: boolean;
  mainDocumentExpectedAfterListener: boolean;
  earlyNetworkProbeAttached: boolean;
  earlyDocumentCount: number;
  earlyExpectedAnchorDocumentCount: number;
  earlyExpectedCatalogDocumentCount: number;
  earlyNidDocumentCount: number;
  earlyCatalogToNidRedirectCount: number;
  earlyRedirect3xxCount: number;
  earlyRedirectSourceCategory: string;
  earlyRedirectLocationCategory: string;
  earlyInternalRedirectReason: string;
  earlyNidFromDiskCache: boolean;
  earlyNidFromServiceWorker: boolean;
  earlyNidBlockedCookieCount: number;
  earlyNidBlockedCookieCategory: string;
}

const waitForExpectedDocument = async (
  target: Target,
  page: Page,
  expectedHref: string,
  expectedProductId: string | undefined,
  timeoutMs: number,
  registerCleanup: (cleanup: () => void) => void,
  unregisterCleanup: (cleanup: () => void) => void,
  diagnostic: CandidateDiagnostic,
): Promise<boolean> => {
  const targetUrl = target.url();
  const pageUrl = page.url();
  diagnostic.targetAfterPageCategory = navigationDiagnosticCategory(targetUrl, expectedHref, expectedProductId);
  diagnostic.targetAfterPageMatches = navigationMatchesClickedAnchor(targetUrl, expectedHref);
  diagnostic.pageAfterPageCategory = navigationDiagnosticCategory(pageUrl, expectedHref, expectedProductId);
  diagnostic.pageAfterPageMatches = navigationMatchesClickedAnchor(pageUrl, expectedHref);

  if (
    navigationMatchesExpectedDestination(targetUrl, expectedHref, expectedProductId) ||
    navigationMatchesExpectedDestination(pageUrl, expectedHref, expectedProductId)
  ) {
    return true;
  }

  const hasDifferentNavigation = [targetUrl, pageUrl].some(
    (url) => url && url !== 'about:blank' && !navigationMatchesExpectedDestination(url, expectedHref, expectedProductId),
  );
  if (hasDifferentNavigation) {
    diagnostic.navigationAdvancedBeforeListener = true;
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      page.off('request', onRequest);
      unregisterCleanup(cleanup);
      resolve(false);
    };
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      page.off('request', onRequest);
      unregisterCleanup(cleanup);
      resolve(value);
    };
    const onRequest = (request: any) => {
      try {
        if (
          !request.isNavigationRequest() ||
          request.resourceType() !== 'document' ||
          request.frame() !== page.mainFrame()
        ) {
          return;
        }
        diagnostic.mainDocumentObservedAfterListener = true;
        diagnostic.mainDocumentExpectedAfterListener = navigationMatchesExpectedDestination(
          request.url(),
          expectedHref,
          expectedProductId,
        );
        finish(diagnostic.mainDocumentExpectedAfterListener);
      } catch {
        finish(false);
      }
    };

    registerCleanup(cleanup);
    timer = setTimeout(() => finish(false), timeoutMs);
    diagnostic.listenerInstalled = true;
    page.on('request', onRequest);
    if (navigationMatchesClickedAnchor(page.url(), expectedHref)) finish(true);
  });
};

interface MatchingCandidate {
  page: Page;
  openerPresent: boolean;
  openerMatchesSource: boolean | null;
  expectedDocumentMatched: boolean;
  sourceOpenerMatched: boolean;
}

interface BoundPageWait {
  promise: Promise<BoundPageResult>;
  confirmClickProof: (proof: SourceClickProof | null) => void;
  cancel: (error: Error) => void;
}

const createBoundPageWait = async (
  browser: Browser,
  sourcePage: Page,
  expectedHref: string,
  expectedProductId: string | undefined,
  timeoutMs: number,
  ambiguitySettleMs: number,
  diagnosticWriter?: ClickedTargetDiagnosticWriter,
): Promise<BoundPageWait> => {
  let settled = false;
  let clickProof: SourceClickProof | null = null;
  let clickPromiseCompleted = false;
  let matchingWindowOpenCount = 0;
  let matchingWindowOpenUserGesture = false;
  let sourceEventSequence = 0;
  const matchingWindowOpenSequences: number[] = [];
  let timeoutTimer: NodeJS.Timeout | undefined;
  let ambiguityTimer: NodeJS.Timeout | undefined;
  let resolvePromise!: (value: BoundPageResult) => void;
  let rejectPromise!: (error: Error) => void;

  const sourceTarget = sourcePage.target();
  const matchingCandidates: MatchingCandidate[] = [];
  let exactDocumentCandidateCount = 0;
  const observedTargets = new Set<Target>();
  const pendingCandidateAssessments = new Set<Target>();
  const candidateCleanups = new Set<() => void>();
  let eligibleTargetCount = 0;
  let sourceOpenerTargetCount = 0;
  let nonPageTargetCount = 0;

  const d: CandidateDiagnostic = {
    targetType: 'UNOBSERVED',
    opener: 'UNOBSERVED',
    targetBeforePageCategory: 'UNOBSERVED',
    targetBeforePageMatches: false,
    targetAfterPageCategory: 'UNOBSERVED',
    targetAfterPageMatches: false,
    pageAfterPageCategory: 'UNOBSERVED',
    pageAfterPageMatches: false,
    listenerInstalled: false,
    navigationAdvancedBeforeListener: false,
    mainDocumentObservedAfterListener: false,
    mainDocumentExpectedAfterListener: false,
    earlyNetworkProbeAttached: false,
    earlyDocumentCount: 0,
    earlyExpectedAnchorDocumentCount: 0,
    earlyExpectedCatalogDocumentCount: 0,
    earlyNidDocumentCount: 0,
    earlyCatalogToNidRedirectCount: 0,
    earlyRedirect3xxCount: 0,
    earlyRedirectSourceCategory: 'UNOBSERVED',
    earlyRedirectLocationCategory: 'UNOBSERVED',
    earlyInternalRedirectReason: 'UNOBSERVED',
    earlyNidFromDiskCache: false,
    earlyNidFromServiceWorker: false,
    earlyNidBlockedCookieCount: 0,
    earlyNidBlockedCookieCategory: 'NONE',
  };

  const report = (outcome: string) => {
    const pointerObserved = clickProof?.pointerDownObserved === true;
    const clickObserved = clickProof?.clickObserved === true;
    const exactAnchorEvents = pointerObserved && clickObserved && clickProof?.pointerAndClickSameAnchor === true;
    const trustedEvents = clickProof?.pointerDownTrusted === true && clickProof?.clickTrusted === true;
    writeBindingDiagnostic(
      diagnosticWriter,
      `[상품 클릭 결합 진단] outcome=${outcome} clickPromise=${Number(clickPromiseCompleted)}` +
        ` pointer=${Number(pointerObserved)} click=${Number(clickObserved)}` +
        ` exactAnchorEvents=${Number(exactAnchorEvents)} trusted=${Number(trustedEvents)}` +
        ` windowIntentExact=${matchingWindowOpenCount} windowIntentGesture=${Number(matchingWindowOpenUserGesture)}` +
        ` exactDocumentCandidates=${exactDocumentCandidateCount} pendingCandidates=${pendingCandidateAssessments.size}` +
        ` targetType=${d.targetType} opener=${d.opener}` +
        ` targetBeforePage=${d.targetBeforePageCategory} targetBeforeMatch=${Number(d.targetBeforePageMatches)}` +
        ` targetAfterPage=${d.targetAfterPageCategory} targetAfterMatch=${Number(d.targetAfterPageMatches)}` +
        ` pageAfterPage=${d.pageAfterPageCategory} pageAfterMatch=${Number(d.pageAfterPageMatches)}` +
        ` listenerInstalled=${Number(d.listenerInstalled)}` +
        ` navigationAdvancedBeforeListener=${Number(d.navigationAdvancedBeforeListener)}` +
        ` mainDocumentAfterListener=${Number(d.mainDocumentObservedAfterListener)}` +
        ` mainDocumentExpectedAfterListener=${Number(d.mainDocumentExpectedAfterListener)}` +
        ` eligibleTargets=${eligibleTargetCount} nonPageTargets=${nonPageTargetCount}` +
        ` earlyNetwork=${Number(d.earlyNetworkProbeAttached)} earlyDocuments=${d.earlyDocumentCount}` +
        ` earlyExpectedAnchor=${d.earlyExpectedAnchorDocumentCount} earlyExpectedCatalog=${d.earlyExpectedCatalogDocumentCount}` +
        ` earlyNid=${d.earlyNidDocumentCount} earlyCatalogToNidRedirect=${d.earlyCatalogToNidRedirectCount}` +
        ` earlyRedirect3xx=${d.earlyRedirect3xxCount} earlyRedirectSource=${d.earlyRedirectSourceCategory}` +
        ` earlyRedirectLocation=${d.earlyRedirectLocationCategory} earlyInternalReason=${d.earlyInternalRedirectReason}` +
        ` earlyNidCache=${Number(d.earlyNidFromDiskCache)} earlyNidServiceWorker=${Number(d.earlyNidFromServiceWorker)}` +
        ` earlyNidBlockedCookies=${d.earlyNidBlockedCookieCount} earlyNidBlockedCategory=${d.earlyNidBlockedCookieCategory}`,
    );
  };

  const sourceSession: CDPSession = await sourceTarget.createCDPSession();
  try {
    await sourceSession.send('Page.enable');
  } catch {
    await sourceSession.detach().catch(() => undefined);
    report('PAGE_ENABLE_FAILED');
    throw new Error('CLICKED_TARGET_NOT_BOUND');
  }

  const promise = new Promise<BoundPageResult>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);

  const cleanup = () => {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (ambiguityTimer) clearTimeout(ambiguityTimer);
    browser.off('targetcreated', onTargetCreated);
    browser.off('disconnected', onDisconnected);
    sourceSession.off('Page.windowOpen', onWindowOpen);
    candidateCleanups.forEach((cancel) => cancel());
    void sourceSession.detach().catch(() => undefined);
  };

  const finish = (result?: BoundPageResult, error?: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (result) {
      report('BOUND');
      resolvePromise(result);
      return;
    }
    const message = error?.message;
    const outcome =
      message === 'CLICKED_TARGET_CLICK_FAILED'
        ? 'CLICK_FAILED'
        : message === 'CLICKED_TARGET_BROWSER_DISCONNECTED'
          ? 'BROWSER_DISCONNECTED'
          : 'NOT_BOUND';
    report(outcome);
    rejectPromise(error || new Error('CLICKED_TARGET_NOT_BOUND'));
  };

  const strongClickProof = () =>
    Boolean(
      clickProof?.pointerDownObserved &&
        clickProof.clickObserved &&
        clickProof.pointerAndClickSameAnchor &&
        clickProof.pointerDownTrusted &&
        clickProof.clickTrusted,
    );

  const attemptBoundedSettlement = () => {
    if (settled || ambiguityTimer || !strongClickProof() || matchingWindowOpenCount < 1 || matchingCandidates.length < 1) {
      return;
    }
    ambiguityTimer = setTimeout(() => {
      ambiguityTimer = undefined;
      const candidate = matchingCandidates.length === 1 ? matchingCandidates[0] : undefined;
      if (
        !candidate ||
        matchingWindowOpenCount !== 1 ||
        pendingCandidateAssessments.size !== 0 ||
        !matchingWindowOpenUserGesture ||
        !strongClickProof() ||
        (!candidate.expectedDocumentMatched && sourceOpenerTargetCount !== 1)
      ) {
        finish(undefined, new Error('CLICKED_TARGET_NOT_BOUND'));
        return;
      }
      finish({
        page: candidate.page,
        binding: {
          targetType: 'page',
          openerPresent: candidate.openerPresent,
          openerMatchesSource: candidate.openerMatchesSource,
          expectedDocumentMatched: candidate.expectedDocumentMatched,
          sourceOpenerMatched: candidate.sourceOpenerMatched,
          sourcePointerDownObserved: true,
          sourceClickObserved: true,
          sourceWindowOpenObserved: true,
          sourceWindowOpenUserGesture: true,
          matchingCandidateCount: 1,
        },
      });
    }, ambiguitySettleMs);
  };

  const onWindowOpen = (event: any) => {
    if (!navigationMatchesClickedAnchor(String(event?.url || ''), expectedHref)) return;
    matchingWindowOpenSequences.push(++sourceEventSequence);
    matchingWindowOpenCount += 1;
    if (event?.userGesture === true) matchingWindowOpenUserGesture = true;
    attemptBoundedSettlement();
  };

  const onTargetCreated = (target: Target) => {
    const targetCreatedSequence = ++sourceEventSequence;
    void (async () => {
      try {
        if (observedTargets.has(target)) return;
        observedTargets.add(target);
        if (!matchingWindowOpenSequences.some((sequence) => sequence < targetCreatedSequence)) return;
        if (target.type() !== 'page') {
          nonPageTargetCount += 1;
          return;
        }
        eligibleTargetCount += 1;
        const opener = target.opener();
        if (opener === sourceTarget) sourceOpenerTargetCount += 1;
        if (d.targetType === 'UNOBSERVED') {
          const targetUrlBeforePage = target.url();
          d.targetType = 'PAGE';
          d.opener = opener ? (opener === sourceTarget ? 'SOURCE' : 'OTHER') : 'NONE';
          d.targetBeforePageCategory = navigationDiagnosticCategory(targetUrlBeforePage, expectedHref, expectedProductId);
          d.targetBeforePageMatches = navigationMatchesClickedAnchor(targetUrlBeforePage, expectedHref);
        }
        if (opener && opener !== sourceTarget) return;

        pendingCandidateAssessments.add(target);
        let targetSession: CDPSession | undefined;
        try {
          targetSession = await target.createCDPSession();
          await targetSession.send('Network.enable');
          if (settled) {
            await targetSession.detach().catch(() => undefined);
            return;
          }
          d.earlyNetworkProbeAttached = true;
          const nidRequestIds = new Set<string>();
          const pendingCookieSummaries = new Map<string, { count: number; category: string }>();

          const applyCookieSummary = (requestId: string, summary: { count: number; category: string }) => {
            if (!nidRequestIds.has(requestId)) {
              pendingCookieSummaries.set(requestId, summary);
              return;
            }
            d.earlyNidBlockedCookieCount += summary.count;
            if (summary.category !== 'NONE') d.earlyNidBlockedCookieCategory = summary.category;
          };

          const onRequestWillBeSent = (event: any) => {
            try {
              if (event?.type !== 'Document') return;
              d.earlyDocumentCount += 1;
              const category = navigationDiagnosticCategory(String(event?.request?.url || ''), expectedHref, expectedProductId);
              if (category === 'EXPECTED') d.earlyExpectedAnchorDocumentCount += 1;
              if (category === 'EXPECTED_CATALOG') d.earlyExpectedCatalogDocumentCount += 1;
              if (event?.redirectResponse && Number(event.redirectResponse.status) >= 300 && Number(event.redirectResponse.status) < 400) {
                d.earlyRedirect3xxCount += 1;
              }
              if (category !== 'NAVER_LOGIN') return;
              d.earlyNidDocumentCount += 1;
              const requestId = String(event?.requestId || '');
              if (requestId) {
                nidRequestIds.add(requestId);
                const pending = pendingCookieSummaries.get(requestId);
                if (pending) {
                  pendingCookieSummaries.delete(requestId);
                  applyCookieSummary(requestId, pending);
                }
              }
              if (!event?.redirectResponse) return;
              d.earlyRedirectSourceCategory = navigationDiagnosticCategory(String(event.redirectResponse.url || ''), expectedHref, expectedProductId);
              d.earlyRedirectLocationCategory = navigationDiagnosticCategory(headerValue(event.redirectResponse.headers, 'location'), expectedHref, expectedProductId);
              d.earlyInternalRedirectReason = safeInternalRedirectReason(event.redirectResponse);
              if (Number(event.redirectResponse.status) >= 300 && Number(event.redirectResponse.status) < 400) {
                if (d.earlyRedirectSourceCategory === 'EXPECTED_CATALOG') d.earlyCatalogToNidRedirectCount += 1;
              }
            } catch {
              /* 진단용이므로 무시 */
            }
          };
          const onRequestExtraInfo = (event: any) => {
            try {
              const requestId = String(event?.requestId || '');
              if (requestId) applyCookieSummary(requestId, summarizeBlockedCookies(event?.associatedCookies));
            } catch {
              /* 진단용이므로 무시 */
            }
          };
          const onResponseReceived = (event: any) => {
            try {
              if (!nidRequestIds.has(String(event?.requestId || ''))) return;
              if (event?.response?.fromDiskCache === true) d.earlyNidFromDiskCache = true;
              if (event?.response?.fromServiceWorker === true) d.earlyNidFromServiceWorker = true;
            } catch {
              /* 진단용이므로 무시 */
            }
          };

          const session = targetSession;
          session.on('Network.requestWillBeSent', onRequestWillBeSent);
          session.on('Network.requestWillBeSentExtraInfo', onRequestExtraInfo);
          session.on('Network.responseReceived', onResponseReceived);
          candidateCleanups.add(() => {
            session.off('Network.requestWillBeSent', onRequestWillBeSent);
            session.off('Network.requestWillBeSentExtraInfo', onRequestExtraInfo);
            session.off('Network.responseReceived', onResponseReceived);
            pendingCookieSummaries.clear();
            void session.detach().catch(() => undefined);
          });
        } catch {
          if (targetSession) await targetSession.detach().catch(() => undefined);
        }

        const candidatePage = await target.page();
        if (settled || !candidatePage) return;
        const expectedDocumentMatched = await waitForExpectedDocument(
          target,
          candidatePage,
          expectedHref,
          expectedProductId,
          Math.min(timeoutMs, 5000),
          (candidateCleanup) => candidateCleanups.add(candidateCleanup),
          (candidateCleanup) => candidateCleanups.delete(candidateCleanup),
          d,
        );
        if (settled) return;
        const sourceOpenerMatched = opener === sourceTarget;
        const candidateUrl = candidatePage.url();
        const knownProductDestination =
          navigationMatchesKnownProductFailureDestination(candidateUrl) || navigationMatchesNaverStoreProduct(candidateUrl);
        if (!expectedDocumentMatched && !(sourceOpenerMatched && d.navigationAdvancedBeforeListener && knownProductDestination)) {
          return;
        }
        if (expectedDocumentMatched) exactDocumentCandidateCount += 1;
        matchingCandidates.push({
          page: candidatePage,
          openerPresent: Boolean(opener),
          openerMatchesSource: opener ? opener === sourceTarget : null,
          expectedDocumentMatched,
          sourceOpenerMatched,
        });
      } catch {
        return;
      } finally {
        pendingCandidateAssessments.delete(target);
        attemptBoundedSettlement();
      }
    })();
  };

  const onDisconnected = () => finish(undefined, new Error('CLICKED_TARGET_BROWSER_DISCONNECTED'));

  sourceSession.on('Page.windowOpen', onWindowOpen);
  browser.on('targetcreated', onTargetCreated);
  browser.on('disconnected', onDisconnected);
  timeoutTimer = setTimeout(() => finish(undefined, new Error('CLICKED_TARGET_NOT_BOUND')), timeoutMs);

  return {
    promise,
    confirmClickProof: (proof) => {
      clickPromiseCompleted = true;
      clickProof = proof;
      attemptBoundedSettlement();
    },
    cancel: (error) => finish(undefined, error),
  };
};

export const openLinkInBoundPage = async ({
  browser,
  sourcePage,
  link,
  expectedProductId,
  timeoutMs = 60000,
  ambiguitySettleMs = 250,
  diagnosticWriter,
}: {
  browser: Browser;
  sourcePage: Page;
  link: ElementHandle<Element>;
  expectedProductId?: string;
  timeoutMs?: number;
  ambiguitySettleMs?: number;
  diagnosticWriter?: ClickedTargetDiagnosticWriter;
}): Promise<BoundPageResult> => {
  const expectedHref = await installSourceClickProbe(link).catch(() => '');
  if (!expectedHref) {
    await cleanupSourceClickProbe(link);
    writeBindingDiagnostic(diagnosticWriter, '[상품 클릭 결합 진단] outcome=ANCHOR_MISSING');
    throw new Error('CLICKED_TARGET_ANCHOR_MISSING');
  }

  try {
    const binding = await createBoundPageWait(
      browser,
      sourcePage,
      expectedHref,
      expectedProductId,
      timeoutMs,
      ambiguitySettleMs,
      diagnosticWriter,
    );
    try {
      await link.click();
    } catch {
      binding.cancel(new Error('CLICKED_TARGET_CLICK_FAILED'));
    }
    const proof = await readSourceClickProof(link).catch(() => null);
    binding.confirmClickProof(proof);
    return await binding.promise;
  } finally {
    await cleanupSourceClickProbe(link);
  }
};

export const isClickedTargetBindingError = (error: unknown): boolean =>
  error instanceof Error &&
  [
    'CLICKED_TARGET_NOT_BOUND',
    'CLICKED_TARGET_ANCHOR_MISSING',
    'CLICKED_TARGET_CLICK_FAILED',
    'CLICKED_TARGET_BROWSER_DISCONNECTED',
  ].includes(error.message);
