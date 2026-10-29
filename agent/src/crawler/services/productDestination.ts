import type { Page } from 'puppeteer-core';

/**
 * 상품 링크를 연 뒤 실제로 상품 페이지에 도착했는지 검증한다.
 * 네이버는 로그인 화면으로 튕기거나 중간 이동 주소(cr.shopping.naver.com/adcr)에
 * 머무른 채 끝나는 경우가 있어서, 그 상태로 체류/스크롤을 진행하면 작업이 헛돈다.
 */

export const UNSTABLE_PRODUCT_DESTINATION_LOG =
  '상품 페이지 주소가 계속 바뀌었지만 상품 페이지에 도착해 그대로 진행합니다.';

export const PRODUCT_DESTINATION_FAILURE_CODES = [
  'NAVER_PRODUCT_LOGIN_REDIRECT',
  'PRODUCT_DESTINATION_UNSETTLED',
] as const;

export const CRAWLER_FAILURE_CODES = [
  ...PRODUCT_DESTINATION_FAILURE_CODES,
  'BROWSER_START_FAILED',
  'UNKNOWN_CRAWLER_FAILURE',
] as const;

export type ProductDestinationFailureCode = (typeof PRODUCT_DESTINATION_FAILURE_CODES)[number];
export type CrawlerFailureCode = (typeof CRAWLER_FAILURE_CODES)[number];

const productDestinationFailureMessages = new Set<string>(PRODUCT_DESTINATION_FAILURE_CODES);

export const isProductDestinationFailure = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && productDestinationFailureMessages.has(message);
};

export const getProductDestinationFailureCode = (error: unknown): ProductDestinationFailureCode | null => {
  if (!isProductDestinationFailure(error)) return null;
  return (error as Error).message as ProductDestinationFailureCode;
};

export const rethrowProductDestinationFailure = (error: unknown): void => {
  if (isProductDestinationFailure(error)) throw error;
};

export const getCrawlerFailureCode = (error: unknown): CrawlerFailureCode | null => {
  if (error === undefined || error === null) return null;
  const productCode = getProductDestinationFailureCode(error);
  if (productCode) return productCode;
  if (error instanceof Error && error.message === 'NOT OPEN BROWSER') return 'BROWSER_START_FAILED';
  return 'UNKNOWN_CRAWLER_FAILURE';
};

export const getCrawlerTerminalOutcome = (
  error: unknown,
  isManuallyStopping: boolean,
): { kind: 'failure'; code: CrawlerFailureCode } | { kind: 'success' } | null => {
  if (isManuallyStopping) return null;
  const code = getCrawlerFailureCode(error);
  return code ? { kind: 'failure', code } : { kind: 'success' };
};

export const shouldSendCrawlerSuccess = (error: unknown, isManuallyStopping: boolean): boolean =>
  getCrawlerTerminalOutcome(error, isManuallyStopping)?.kind === 'success';

/** 아직 상품 페이지에 정착하지 않은 중간 상태인지. */
const isTransitionalProductDestination = (rawUrl: string): boolean => {
  if (!rawUrl || rawUrl === 'about:blank') return true;
  try {
    const url = new URL(rawUrl);
    return url.hostname.toLowerCase() === 'cr.shopping.naver.com' && url.pathname.toLowerCase().startsWith('/adcr');
  } catch {
    return true;
  }
};

export const isNaverProductLoginRedirect = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    return url.hostname.toLowerCase() === 'nid.naver.com' && url.pathname === '/nidlogin.login';
  } catch {
    return false;
  }
};

export const validateProductDestination = async <T extends Page | undefined>(page: T): Promise<T> => {
  if (!page || !isNaverProductLoginRedirect(page.url())) return page;
  throw new Error('NAVER_PRODUCT_LOGIN_REDIRECT');
};

export interface ValidateProductDestinationOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  stabilityWindowMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  log?: (message: string) => void;
}

export const validateProductDestinationAfterNavigation = async <T extends Page | undefined>(
  page: T,
  waitForNavigationToSettle: (page: Page) => Promise<void>,
  options: ValidateProductDestinationOptions = {},
): Promise<T> => {
  if (!page) return page;
  await waitForNavigationToSettle(page);

  const maxWaitMs = options.maxWaitMs ?? 10000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const stabilityWindowMs = options.stabilityWindowMs ?? 500;
  const delay = options.delay ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const deadline = Date.now() + maxWaitMs;
  let stableUrl: string | undefined;
  let stableSince = 0;

  while (Date.now() <= deadline) {
    const currentUrl = page.url();
    if (isNaverProductLoginRedirect(currentUrl)) return validateProductDestination(page);

    if (isTransitionalProductDestination(currentUrl)) {
      stableUrl = undefined;
      stableSince = 0;
    } else if (currentUrl !== stableUrl) {
      stableUrl = currentUrl;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stabilityWindowMs) {
      return validateProductDestination(page);
    }

    if (Date.now() >= deadline) break;
    await delay(pollIntervalMs);
  }

  const lastUrl = page.url();
  if (isNaverProductLoginRedirect(lastUrl)) return validateProductDestination(page);
  if (!isTransitionalProductDestination(lastUrl)) {
    options.log?.(UNSTABLE_PRODUCT_DESTINATION_LOG);
    return page;
  }
  throw new Error('PRODUCT_DESTINATION_UNSETTLED');
};
