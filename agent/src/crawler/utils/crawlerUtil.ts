import puppeteer, { type Browser, type Page, type ElementHandle } from 'puppeteer-core';
import { compact, sample, isEmpty, random } from 'lodash';
import UserAgent from 'user-agents';
import shell from 'shelljs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { BrowserType, Settings } from '@shared/types';
import {
  findBrowserPath,
  getBrowserProfileDirectory,
  getHeadlessLaunchOptions,
  getProfileKeepLabel,
  shouldResetBrowserProfile,
} from '../config/browserPolicy';
import { isClickedTargetBindingError, openLinkInBoundPage } from './clickedTargetBinding';

export type LogFn = (message: string) => void;

/**
 * 클릭 후 새로 열리는 첫 탭을 기다린다.
 * 팝업이 차단되거나 클릭이 무시되면 영원히 대기하게 되므로 반드시 시한을 둔다.
 */
export function openFirstTargetPageWithTimeout({
  browser,
  click,
  timeoutMs = 15000,
}: {
  browser: Browser;
  click: () => Promise<unknown>;
  timeoutMs?: number;
}): Promise<Page | undefined> {
  return new Promise<Page | undefined>((resolve, reject) => {
    let settled = false;
    let candidateSelected = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      browser.off('targetcreated', onTargetCreated);
      browser.off('disconnected', onBrowserDisconnected);
    };
    const settleResolve = (page?: Page) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(page);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onTargetCreated = async (target: any) => {
      if (candidateSelected || settled) return;
      candidateSelected = true;
      try {
        settleResolve((await target.page()) || undefined);
      } catch (error: any) {
        settleReject(error);
      }
    };
    const onBrowserDisconnected = () => settleReject(new Error('LEGACY_NEW_PAGE_BROWSER_DISCONNECTED'));

    browser.on('targetcreated', onTargetCreated);
    browser.on('disconnected', onBrowserDisconnected);
    timer = setTimeout(() => settleReject(new Error('LEGACY_NEW_PAGE_TIMEOUT')), timeoutMs);

    void Promise.resolve().then(click).catch(settleReject);
  });
}

class CrawlerUtil {
  private _log: LogFn = console.log;
  private isWaiting = false;
  private userDataDirPath = getBrowserProfileDirectory();

  setLogger(fn: LogFn) {
    this._log = fn;
  }

  log(message: string) {
    this._log(message);
  }

  /** 진단용 상세 로그. 작업 화면을 어지럽히지 않도록 파일/콘솔에만 남긴다. */
  fileLog(message: string) {
    try {
      const log = require('electron-log');
      (log.default || log).info(message);
    } catch {
      console.log(message);
    }
  }

  private killChromeProcessesUsingDir(userDataDirPath: string) {
    if (process.platform !== 'win32') return;
    try {
      execSync(
        `wmic process where "name='chrome.exe' and CommandLine like '%${userDataDirPath.replace(/\\/g, '\\\\')}%'" call terminate`,
        { stdio: 'ignore', timeout: 10000 },
      );
    } catch {
      /* ignore: wmic may not be available or no matching processes */
    }
  }

  private removeChromeLockFiles(userDataDirPath: string) {
    if (!fs.existsSync(userDataDirPath)) return;
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
    for (const lf of lockFiles) {
      const p = path.join(userDataDirPath, lf);
      try {
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /** 초기화에 성공했는지 돌려준다. 실패는 로그만 남기고 호출부가 판단한다. */
  async initializeUserDataDir(userDataDirPath: string = this.userDataDirPath): Promise<boolean> {
    try {
      this.log('인터넷 사용기록 폴더 세팅중..');
      this.killChromeProcessesUsingDir(userDataDirPath);
      await this.delay(1000);

      if (fs.existsSync(userDataDirPath)) {
        let deleted = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            fs.rmSync(userDataDirPath, { recursive: true, force: true });
            deleted = true;
            break;
          } catch {
            if (attempt < 4) {
              this.log(`폴더 삭제 재시도 (${attempt + 1}/5)...`);
              this.killChromeProcessesUsingDir(userDataDirPath);
              await this.delay(2000);
            }
          }
        }
        if (!deleted) {
          this.log('폴더 삭제 실패 - lock 파일만 제거하고 진행');
          this.removeChromeLockFiles(userDataDirPath);
        }
      }
      fs.mkdirSync(userDataDirPath, { recursive: true });
      this.log('인터넷 사용기록 폴더 세팅 완료');
      return true;
    } catch (e: any) {
      console.error('인터넷 사용기록 폴더 세팅 중 에러 발생 ' + e);
      this.removeChromeLockFiles(userDataDirPath);
      return false;
    }
  }

  async flushDns() {
    try {
      if (process.platform !== 'win32') return;
      this.log('DNS 초기화 중..');
      shell.exec('ipconfig /flushdns', { silent: true });
      this.log('DNS 초기화 완료');
    } catch (e) {
      console.error('DNS 초기화 실패: ' + e);
    }
  }

  getChromePath(browserType: BrowserType = 'chrome'): string {
    const p = findBrowserPath(browserType);
    const label = browserType === 'edge' ? 'Edge' : '크롬';
    if (!p) throw new Error(`${label}을 찾을 수 없습니다. ${label} 브라우저를 설치해주세요.`);
    this.log(`${label} 경로: ` + p);
    return p;
  }

  async createBrowserAndPage(
    setting: Partial<Settings>,
    chromePath: string,
    naverUserAgent?: string,
  ): Promise<{ browser: Browser; page: Page } | undefined> {
    try {
      const userDataDirPath = getBrowserProfileDirectory(setting.browserType);
      if (shouldResetBrowserProfile(setting)) {
        await this.initializeUserDataDir(userDataDirPath);
      } else {
        this.log(`[${getProfileKeepLabel(setting)}] 기존 브라우저 프로필과 쿠키를 유지합니다.`);
        fs.mkdirSync(userDataDirPath, { recursive: true });
      }
      await this.flushDns();

      const headlessOptions = getHeadlessLaunchOptions(setting);
      const browser = await puppeteer.launch({
        headless: headlessOptions.headless as any,
        devtools: false,
        userDataDir: path.resolve(userDataDirPath),
        executablePath: chromePath,
        args: compact([
          '--window-size=980,1020',
          '--enable-popup-blocking',
          '--no-first-run',
          '--no-default-browser-check',
          // 앱이 관리자 권한이면 크롬이 일반 권한으로 스스로 재시작해 puppeteer 연결이 끊긴다
          '--do-not-de-elevate',
          naverUserAgent ? `--user-agent=${naverUserAgent}` : null,
          `--blink-settings=imagesEnabled=${(setting as any).showImage !== 'N'}`,
          ...headlessOptions.args,
        ]) as string[],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: { width: 980, height: 900 },
      });
      const page = (await browser.pages())[0];

      // 모든 puppeteer 작업이 무한 대기에 빠지지 않도록 기본 timeout 적용.
      // (예: page.waitForSelector, page.click, page.type 등이 30초 안에 끝나야 함)
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(60000);

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        (window as any).chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
        const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
        (window.navigator.permissions as any).query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery(parameters);
      });

      return { browser, page };
    } catch (e: any) {
      console.error(e);
      this.log('크롤러 실행 중 에러가 발생했습니다.' + e.message);
      return undefined;
    }
  }

  async setUserAgent(page: Page, device: string) {
    const fakeUserAgent = new UserAgent({ deviceCategory: device } as any).toString();
    await page.evaluateOnNewDocument((ua: string) => {
      const open = window.open;
      (window as any).open = function (...args: any[]) {
        const newPage = open.apply(window, args as any);
        Object.defineProperty(newPage?.navigator, 'userAgent', { get: () => ua });
        return newPage;
      };
      (window as any).open.toString = () => 'function open() { [native code] }';
    }, fakeUserAgent);
    await page.setUserAgent(fakeUserAgent);
  }

  async focus(page: Page, selector: string) {
    try {
      const elementHandle = await this.$(page, selector);
      if (!elementHandle) return;
      await elementHandle.evaluate((elem: any) => elem.scrollIntoView()).catch(async () => {
        await elementHandle.focus();
      });
      await this.wait(page, 1);
      const halfHeight = await page.evaluate(() => window.innerHeight / 2);
      await page.evaluate((h: number) => window.scrollBy(0, -h), halfHeight);
    } catch (e) {
      console.error(`포커스 실패: "${selector}"`);
    }
  }

  async scrollTo(page: Page, position: 'top' | 'bottom' = 'bottom') {
    try {
      await page.evaluate((pos: string) => {
        const scrollHeight = document.body.scrollHeight;
        if (pos === 'bottom') window.scrollTo(0, scrollHeight);
        if (pos === 'top') window.scrollTo(0, 0);
      }, position);
    } catch (e) {
      this.log('스크롤 중 문제가 발생했습니다.');
    }
  }

  async scrollBy(page: Page, speed: string, diff = 700, count = 1, direction: 'up' | 'down' = 'down') {
    try {
      for (let i = 0; i < count; i++) {
        await page.evaluate(({ diff, direction }: any) => {
          if (direction === 'up') window.scrollBy(0, diff * -1);
          else window.scrollBy(0, diff);
        }, { diff, direction });
        const delay = speed === 'fast' ? 200 : speed === 'normal' ? 400 : 800;
        await this.delay(delay);
      }
    } catch (e) {
      this.log('스크롤 중 문제가 발생했습니다.');
    }
  }

  async $(page: Page, selector: string, timeout = 60000): Promise<ElementHandle<Element> | null> {
    await this.waitForSelector(page, selector, timeout);
    return page.$(selector);
  }

  async $$(page: Page, selector: string, timeout = 60000): Promise<ElementHandle<Element>[]> {
    await this.waitForSelector(page, selector, timeout);
    return page.$$(selector);
  }

  async autoScroll(page: Page, selector = '', delay = 300, distance = 700, maxScrollHeight = Number.MAX_SAFE_INTEGER) {
    try {
      if (selector) await page.waitForSelector(selector);
      await this.wait(page, 1);
      await page.evaluate(
        ({ delay, distance, selector, maxScrollHeight }: any) => {
          return new Promise<void>((resolve) => {
            let totalHeight = 0;
            const elem = selector ? document.querySelector(selector) : undefined;
            const timer = setInterval(() => {
              const scrollHeight = Math.min(
                (elem || document.body)?.scrollHeight || maxScrollHeight,
                maxScrollHeight,
              );
              elem ? elem.scrollBy(0, distance) : window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= scrollHeight) {
                clearInterval(timer);
                resolve();
              }
            }, delay);
          });
        },
        { delay, distance, selector, maxScrollHeight },
      );
      await this.wait(page, 1);
    } catch (e: any) {
      this.log('스크롤 중 문제가 발생했습니다.' + e.message);
    }
  }

  async scrollRandom(page: Page, totalDiff = 1400, totalCount = 4, minWaitTime = 2, maxWaitTime = 3) {
    await this.scrollTo(page, 'bottom');
    await this.scrollBy(page, 'normal', totalDiff / 2, 1, 'up');
    await this.wait(page, 1);
    for (let i = 0; i < totalCount; i++) {
      const randomDiff = Math.round(Math.random() * Math.min(totalDiff, 1080));
      const randomDelay = sample(['fast', 'normal', 'slow']) as string;
      const randomDirection: 'up' | 'down' = Math.round(Math.random() * 1) === 0 ? 'up' : 'down';
      await this.scrollBy(page, randomDelay, randomDiff, 1, randomDirection);
      await this.waitRandom(page, minWaitTime, maxWaitTime);
    }
  }

  async goto(page: Page, url: string) {
    this.log(`"${url}"로 이동`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await this.waitTillHTMLRendered(page, 3000);
  }

  async goBack(page: Page) {
    try {
      await page.goBack({ waitUntil: 'networkidle2', timeout: 60000 });
      await this.wait(page, 1);
    } catch (e) {
      this.log('뒤로가기 에러 발생: ' + e);
    }
  }

  getHostFromUrl(url: string): string {
    const matches = url.match(/(?:\w+\.)+\w+/);
    if (!matches || matches.length === 0) return '';
    return matches[0];
  }

  async clickByElemHandle(page: Page, elemHandle: ElementHandle<Element> | null, newTab = false) {
    if (!elemHandle) return;
    if (newTab) {
      await elemHandle.evaluate((elem: any) => elem?.setAttribute('target', '_blank'));
    } else {
      await elemHandle.evaluate((elem: any) => elem?.setAttribute('target', '_self'));
    }
    try {
      await Promise.all([elemHandle.click(), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })]);
      await this.wait(page, 1);
    } catch (e) {
      try {
        await Promise.all([
          elemHandle.evaluate((elem: any) => elem?.click()),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        ]);
        await this.wait(page, 1);
      } catch (e2) {
        this.log('링크를 클릭하여 페이지를 여는데 실패했습니다.: ' + e2);
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
      }
    }
  }

  async clickBySelector(page: Page, selector: string, newTab = false) {
    if (newTab) {
      await page.$eval(selector, (elem: any) => elem.setAttribute('target', '_blank'));
    } else {
      await page.$eval(selector, (elem: any) => elem.setAttribute('target', '_self'));
    }
    await page.waitForSelector(selector);
    await Promise.all([page.click(selector), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })]);
    await this.wait(page, 3);
  }

  async getNewPageByClick(params: {
    browser: Browser;
    page: Page;
    selector?: string;
    linkElement?: ElementHandle<Element> | null;
    setting?: any;
    /** 상품 링크일 때 켠다. 새 탭이 정말 이 링크의 결과인지 검증한다. */
    requireProductTargetBinding?: boolean;
    expectedProductId?: string;
  }): Promise<Page | undefined> {
    const { browser, page, selector, linkElement, requireProductTargetBinding = false, expectedProductId } = params;
    try {
      let link = linkElement;
      if (selector) {
        await page.waitForSelector(selector);
        link = await page.$(selector);
      }
      if (!link) {
        this.log('링크를 찾지 못했습니다. ' + selector);
        return undefined;
      }

      let newPage: Page | undefined;
      if (requireProductTargetBinding) {
        const waitingLogTimer = setTimeout(
          () => this.log('새 탭이 선택한 상품인지 확인하는 중입니다. 최대 1분까지 기다립니다.'),
          10000,
        );
        try {
          newPage = (
            await openLinkInBoundPage({
              browser,
              sourcePage: page,
              link,
              expectedProductId,
              diagnosticWriter: (message) => this.fileLog(message),
            })
          ).page;
        } finally {
          clearTimeout(waitingLogTimer);
        }
      } else {
        await page.evaluateHandle((el: any) => { el.target = '_blank'; }, link);
        const clickTarget = link;
        newPage = await openFirstTargetPageWithTimeout({ browser, click: () => clickTarget.click() });
      }

      if (!newPage) {
        this.log('새로운 페이지를 열지 못했습니다. 기존 페이지: ' + page.url());
        return undefined;
      }

      await newPage.bringToFront();
      if (requireProductTargetBinding) {
        this.fileLog('선택한 상품 링크와 새 페이지 결합을 확인했습니다.');
      } else {
        this.fileLog('새로운 페이지 URL: ' + newPage.url());
      }
      newPage.on('dialog', async (dialog) => {
        if (dialog.message().includes('로그인')) return;
        this.log('얼럿창이 닫혔습니다. 메시지: ' + dialog.message());
        await dialog.dismiss();
      });
      return newPage;
    } catch (e: any) {
      if (isClickedTargetBindingError(e)) {
        this.log('클릭으로 열린 페이지를 선택한 링크와 결합하지 못했습니다.');
        throw new Error('PRODUCT_DESTINATION_UNSETTLED');
      }
      this.log('링크를 클릭해서 새로운 탭을 열지 못했습니다.\n\n에러 메세지: ' + e?.message);
      return undefined;
    }
  }

  async waitForSelector(page: Page, selector: string, timeout = 60000) {
    try {
      await page.waitForSelector(selector, { timeout });
    } catch (e) {
      this.log(`선택자 "${selector}"를 찾지 못했습니다.`);
      await this.delay(timeout / 10);
    }
  }

  async waitTillHTMLRendered(page: Page, timeout = 15000) {
    const checkDurationMsecs = 1000;
    const maxChecks = timeout / checkDurationMsecs;
    let lastHTMLSize = 0;
    let checkCounts = 1;
    let countStableSizeIterations = 0;
    const minStableSizeIterations = 3;
    try {
      while (checkCounts++ <= maxChecks) {
        const html = await page.content();
        const currentHTMLSize = html.length;
        if (lastHTMLSize !== 0 && currentHTMLSize === lastHTMLSize) countStableSizeIterations++;
        else countStableSizeIterations = 0;
        if (countStableSizeIterations >= minStableSizeIterations) break;
        lastHTMLSize = currentHTMLSize;
        await this.delay(checkDurationMsecs);
      }
    } catch (_) {}
  }

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async wait(page: Page, seconds = 1) {
    this.isWaiting = true;
    await this.delay(seconds * 1000);
    this.isWaiting = false;
  }

  async waitRandom(page: Page, min = 0, max = 1) {
    if (process.env.NODE_ENV === 'development') return;
    const randomSeconds = Math.round(Math.random() * (max - min) + min);
    this.log(`랜덤시간 ${randomSeconds}초 만큼 기다리겠습니다.`);
    this.isWaiting = true;
    await this.delay(randomSeconds * 1000);
    this.isWaiting = false;
  }

  getRandomNumber(min = 0, max = 1): number {
    return Math.round(Math.random() * (max - min) + min);
  }

  getScrollValue(scrollSpeed?: string): { distance: number; delay: number } {
    if (scrollSpeed === 'slow') return { distance: 10, delay: 25 };
    if (scrollSpeed === 'fast') return { distance: 40, delay: 25 };
    return { distance: 25, delay: 25 };
  }

  async scrollToSelector(page: Page, selector: string) {
    try {
      const exists = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); return true; }
        return false;
      }, selector);
      if (!exists) this.log('Selector에 해당하는 요소를 찾을 수 없습니다: ' + selector);
      await this.waitRandom(page, 1, 2);
    } catch (e: any) {
      this.log(e.message);
    }
  }

  async 페이지랜덤높이까지스크롤(params: {
    page: Page; minRepeatCount: number; maxRepeatCount: number;
    minWaitTime: number; maxWaitTime: number; setting: any; heights: number[];
  }) {
    const { page, minRepeatCount, maxRepeatCount, minWaitTime, maxWaitTime, setting, heights } = params;
    await this.scrollTo(page, 'top');
    const randomNumber = this.getRandomNumber(minRepeatCount, maxRepeatCount);
    for (let j = 0; j < randomNumber; j++) {
      const height = sample(heights)!;
      const scrollSpeed = this.getScrollValue(setting.scrollSpeed);
      await this.autoScroll(page, '', scrollSpeed.delay, scrollSpeed.distance, height);
      await this.waitRandom(page, minWaitTime, maxWaitTime);
    }
  }

  async 키워드위치로포커스이동(page: Page, keyword: string) {
    try {
      await this.waitTillHTMLRendered(page, 1000);
      const xPath = `//*[contains(text(), '${keyword?.trim()}')]`;
      await page.waitForSelector(`::-p-xpath(${xPath})`, { timeout: 1000 }).catch(() => {});
      const items = await page.$$(`::-p-xpath(${xPath})`);
      for (let i = 0; i < Math.max(20, items?.length); i++) {
        const randomIndex = random(Math.floor((items?.length) / 2) || 0, (items?.length) || 0);
        const beforeY = await page.evaluate(() => window.scrollY);
        const item = items[randomIndex];
        if (item) {
          await item.evaluate((elem: any) => {
            elem.scrollIntoView();
            window.scrollBy(0, -window.innerHeight / 2);
          });
        }
        const afterY = await page.evaluate(() => window.scrollY);
        if (Math.abs(beforeY - afterY) >= 10) {
          this.log(`문서 전체에서 키워드 "${keyword}"의 ${randomIndex}번째 위치로 이동했습니다.`);
          return;
        }
      }
    } catch (e: any) {
      this.log(`키워드 "${keyword}" 위치로 이동하지 못했습니다.`);
    }
  }
}

export const crawlerUtil = new CrawlerUtil();
