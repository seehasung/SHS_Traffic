import type { Browser, Page } from 'puppeteer-core';
import { sample, random, shuffle, sampleSize } from 'lodash';
import { crawlerUtil, type LogFn } from './utils/crawlerUtil';
import { crawlerService } from './services/crawlerService';
import { imitateService } from './services/imitateService';
import { knowledgeService } from './services/knowledgeService';
import { blogService } from './services/blogService';
import { blogRankService } from './services/blogRankService';
import { NAVER_URL } from './constants/urls';
import type { Knowledge, NaverAccount, Settings } from '@shared/types';

export interface FailedKeywordInfo {
  knowledgeId: string;
  keyword: string;
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  pagesScanned: number;
  reason: string;
}

export interface CrawlJobParams {
  settings: Settings;
  knowledges: Knowledge[];
  naverAccounts: NaverAccount[];
  logFn: LogFn;
  shouldStop: () => boolean;
  /** 50페이지까지 못 찾고 다음 상품으로 넘어간 키워드를 외부에 알리는 콜백. */
  onFailedKeyword?: (info: FailedKeywordInfo) => void;
}

class CrawlerController {
  private browser?: Browser;
  private page?: Page;
  private chromePath?: string;
  private setting?: Partial<Settings>;
  private shoppingResultPage?: Page;
  private shoppingDetailPage?: Page;
  private purchaseDetailPage?: Page;
  private postPage?: Page;

  private onFailedKeyword?: (info: FailedKeywordInfo) => void;

  async run(params: CrawlJobParams): Promise<void> {
    const { settings, knowledges, naverAccounts, logFn, shouldStop } = params;
    crawlerUtil.setLogger(logFn);
    this.onFailedKeyword = params.onFailedKeyword;

    if (!knowledges.length) {
      logFn('작업할 키워드가 없습니다. 키워드를 추가해주세요.');
      return;
    }

    this.chromePath = crawlerUtil.getChromePath();

    // 사이클 시작 시 항상 새로 셔플 → 한 사이클 안에서는 셔플된 순서대로 모든 키워드를 한 번씩 실행.
    // run() 은 한 사이클 단위로 호출되므로 (첫 실행 / 다음 사이클 / 정지 후 재시작 모두)
    // 매번 자동으로 새 셔플 순서가 사용된다.
    // 안전망: 혹시 서버에서 비활성화 키워드가 같이 왔거나 로컬에서 isActive=false 로 표시된 키워드가 있으면 제외.
    const activeKnowledges = knowledges.filter((k) => (k as any).isActive !== false);
    const shuffledKnowledges = shuffle(activeKnowledges);
    // 테스트 모드에서는 일부만 실행 (셔플된 앞쪽 N 개).
    const runList =
      settings.testMode === 'Y'
        ? shuffledKnowledges.slice(0, Math.min(random(1, 3, false), shuffledKnowledges.length))
        : shuffledKnowledges;
    const totalCount = runList.length;
    logFn(`\n할당된 키워드 ${knowledges.length}개를 랜덤 순서로 섞었습니다. 총 "${totalCount}"번 상위로직을 실행하겠습니다.\n`);

    for (let i = 0; i < totalCount; i++) {
      if (shouldStop()) return;

      const item = runList[i];
      const effectiveSetting = { ...settings };
      if (effectiveSetting.pageType === 'random') {
        (effectiveSetting as any).pageType = sample(['pc', 'mobile']);
      }

      const modeLabel = (item.mode ?? 'shopping') === 'blog' ? '블로그' : '쇼핑';
      logFn(`\n[${i + 1}/${totalCount}번째 ${modeLabel} 상위로직 실행] ${item.keyword}, ${item.itemName}, ${item.purchaseName || ''}\n`);

      try {
        await this._startTopExposureLogic(effectiveSetting, item, naverAccounts, i + 1, shouldStop);
      } catch (e: any) {
        await this.close().catch(() => {});
        if (e.message === 'CANCELLED' || e.message === 'VPN_CONNECTION_FAILED') throw e;
        logFn(`[상위로직 ${i + 1}번째에서 오류 발생 — 다음 사이클로 넘어갑니다] ${e.message}`);
      } finally {
        if (shouldStop()) return;
      }
    }

    logFn('\n[공통로직 실행]\n');
    const lastItem = runList[runList.length - 1] ?? sample(shuffledKnowledges)!;
    const effectiveSetting = { ...settings };
    if (effectiveSetting.pageType === 'random') {
      (effectiveSetting as any).pageType = sample(['pc', 'mobile']);
    }

    try {
      await this._startCommonExposureLogic(effectiveSetting, lastItem, naverAccounts, totalCount, shouldStop);
    } catch (e: any) {
      await this.close().catch(() => {});
      if (e.message === 'CANCELLED') throw e;
      logFn('[공통로직에서 오류가 발생했지만 무시하고 계속 진행하겠습니다] ' + e.message);
    }
  }

  private async _openBrowser() {
    if (!this.setting || !this.chromePath) {
      crawlerUtil.log('세팅값이 없어서 브라우저를 열지 못했습니다.');
      return;
    }
    const result = await crawlerUtil.createBrowserAndPage(this.setting, this.chromePath);
    if (!result?.browser || !result?.page) {
      crawlerUtil.log('브라우저와 페이지 초기화에 실패했습니다.');
      throw new Error('NOT OPEN BROWSER');
    }
    this.browser = result.browser;
    this.page = result.page;
    this.page.on('dialog', (dialog) => {
      crawlerUtil.log('얼럿창이 닫혔습니다.');
      dialog.dismiss();
    });
  }

  private async _naverLogin(setting: Partial<Settings>, naverAccounts: NaverAccount[], progressCount: number, repeatCount = 0) {
    if (repeatCount >= naverAccounts?.length) return;

    crawlerUtil.log('유저에이전트 변경을 위해 브라우저를 재시작하겠습니다.');
    await this.close();
    const loginBrowserSet = await crawlerService.로그인브라우저갱신(setting as Settings, naverAccounts, progressCount, this.chromePath!, repeatCount);
    const { browser, page, naverId, naverPassword } = loginBrowserSet || {};
    if (!browser || !page) {
      crawlerUtil.log('로그인브라우저갱신 브라우저와 페이지 초기화에 실패했습니다.');
      return;
    }

    this.setting = setting;
    this.browser = browser;
    this.page = page;
    this.page.on('dialog', (dialog) => {
      crawlerUtil.log('얼럿창이 닫혔습니다.');
      dialog.dismiss();
    });

    const result = await crawlerService.네이버로그인(this.page, naverId!, naverPassword!);
    if (!result) {
      crawlerUtil.log('네이버 로그인에 실패했습니다. 다른 계정으로 재시도하겠습니다.');
      await this._naverLogin(setting, naverAccounts, progressCount, repeatCount + 1);
    }
  }

  private async _imitate(shouldStop: () => boolean) {
    if (!this.page || !this.setting || !this.browser) return;
    const isMobile = this.setting.pageType === 'mobile';
    const url = isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN;
    await crawlerUtil.goto(this.page, url);

    await imitateService.closeLayerBanner({ page: this.page, closeButtonSelector: '.lst_btn_close' });
    await imitateService.closeModalBanner({ page: this.page, promotionSelector: '.lm_wrap', modalLayerSelector: '.layer_modal' });

    if (shouldStop()) throw new Error('CANCELLED');

    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 2, maxWorkCount: 3, minWaitTime: 2, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 4, maxWaitTimeAfterScroll: 8 });
    if (shouldStop()) throw new Error('CANCELLED');

    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 2, isGoBack: false });
    if (shouldStop()) throw new Error('CANCELLED');

    await imitateService.clickNewsTitle(this.page, this.setting);
    if (shouldStop()) throw new Error('CANCELLED');

    await imitateService.randomClickNews({ browser: this.browser, page: this.page, userMe: this.setting, setting: this.setting, minWaitTimeAfter: 8, maxWaitTimeAfter: 15 });
    if (shouldStop()) throw new Error('CANCELLED');

    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 2, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 1, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 1, maxWaitTimeAfterScroll: 3 });
  }

  private shuffleKeyword(keyword: string): string {
    const splitted = keyword.trim().split(/\s+/);
    const shuffled = shuffle(splitted);
    const arrayLength = Math.max(shuffled.length - random(1, 2), 1);
    return sampleSize(shuffled, arrayLength).join(' ');
  }

  private async _crawl(knowledge: Knowledge, settings: Partial<Settings>, shouldStop: () => boolean) {
    if (!this.page || !this.browser) return false;

    const mode = knowledge.mode ?? 'shopping';

    if (mode === 'blog') {
      return this._crawlBlog(knowledge, settings, shouldStop);
    }

    return this._crawlShopping(knowledge, settings, shouldStop);
  }

  private async _crawlShopping(knowledge: Knowledge, settings: Partial<Settings>, shouldStop: () => boolean) {
    if (!this.page || !this.browser) return false;

    let keyword = knowledge.keyword;
    if ((settings as any).keywordShuffleControlRole === 'Y') {
      keyword = this.shuffleKeyword(keyword);
    }

    crawlerUtil.log(`"${keyword}"키워드로 검색하여 상품번호: "${knowledge.itemName}"${knowledge.purchaseName ? ', 판매처명: ' + knowledge.purchaseName : ''}을 찾겠습니다.`);

    if (shouldStop()) throw new Error('CANCELLED');

    const result = await knowledgeService.findPages(this.browser, this.page, settings, settings, keyword, knowledge.itemName, knowledge.purchaseName);
    if (!result) return false;

    if (result.failed) {
      try {
        this.onFailedKeyword?.({
          knowledgeId: knowledge.id,
          keyword: knowledge.keyword,
          itemName: knowledge.itemName,
          purchaseName: knowledge.purchaseName,
          groupName: knowledge.groupName,
          pagesScanned: result.failed.pagesScanned,
          reason: result.failed.reason,
        });
      } catch (e) {
        console.error('[crawler] onFailedKeyword 콜백 오류:', e);
      }
      return false;
    }

    const { shoppingResultPage, shoppingDetailPage, purchaseDetailPage } = result;
    this.shoppingResultPage = shoppingResultPage;
    this.shoppingDetailPage = shoppingDetailPage;
    this.purchaseDetailPage = purchaseDetailPage;

    if (shouldStop()) throw new Error('CANCELLED');

    const targetPage = purchaseDetailPage ?? shoppingDetailPage;
    if (targetPage) {
      const targetUrl = targetPage.url();
      const isMobilePurchase = targetUrl.includes('m.brand') || targetUrl.includes('m.smartstore') || targetUrl.includes('m.search');
      const minW1 = Number(settings.minWaitTime1) || 10;
      const maxW1 = Number(settings.maxWaitTime1) || 30;
      const minW2 = Number(settings.minWaitTime2) || 180;
      const maxW2 = Number(settings.maxWaitTime2) || 250;

      crawlerUtil.log('\n*** [상품랭킹 상승 로직] ***');
      crawlerUtil.log(`설정값 — 1차 반영: ${minW1}~${maxW1}초, 2차 반영: ${minW2}~${maxW2}초\n`);

      const logicParams = {
        page: targetPage,
        url: targetUrl,
        setting: settings,
        isTestMode: settings.testMode === 'Y',
        isMobile: isMobilePurchase,
        minWaitTime1: minW1,
        maxWaitTime1: maxW1,
        minWaitTime2: minW2,
        maxWaitTime2: maxW2,
      };

      if (settings.logicType === 'clean') {
        await knowledgeService.클린로직(logicParams);
      } else if (settings.logicType === 'detail') {
        await crawlerUtil.scrollRandom(targetPage);
        await knowledgeService.정밀로직(logicParams);
      } else if (settings.logicType === 'hidden') {
        await knowledgeService.히든로직({ ...logicParams, browser: this.browser!, keyword: knowledge.keyword });
      }
      return true;
    }

    crawlerUtil.log('[주의] 타겟 상품 상세 페이지를 열지 못해서 랭킹 로직을 실행하지 못했습니다.');
    return false;
  }

  private async _crawlBlog(knowledge: Knowledge, settings: Partial<Settings>, shouldStop: () => boolean) {
    if (!this.page || !this.browser) return false;

    const siteUrl = knowledge.siteUrl || knowledge.itemName;
    let keyword = knowledge.keyword;
    if ((settings as any).keywordShuffleControlRole === 'Y') {
      keyword = this.shuffleKeyword(keyword);
    }

    crawlerUtil.log(`"${keyword}"키워드로 검색하여 URL 또는 제목에 "${siteUrl}"가 포함된 사이트를 찾겠습니다.`);

    if (shouldStop()) throw new Error('CANCELLED');

    const result = await blogService.findBlog(this.browser, this.page, settings, keyword, siteUrl);

    if (result.failed) {
      try {
        this.onFailedKeyword?.({
          knowledgeId: knowledge.id,
          keyword: knowledge.keyword,
          itemName: knowledge.itemName,
          purchaseName: knowledge.purchaseName,
          groupName: knowledge.groupName,
          pagesScanned: result.failed.pagesScanned,
          reason: result.failed.reason,
        });
      } catch (e) {
        console.error('[crawler] onFailedKeyword 콜백 오류:', e);
      }
      return false;
    }

    this.postPage = result.postPage ?? undefined;
    if (!this.postPage) {
      crawlerUtil.log(`키워드: "${keyword}", 사이트: "${siteUrl}"에 해당하는 포스트를 찾지 못했습니다.`);
      return false;
    }

    if (shouldStop()) throw new Error('CANCELLED');

    const minW1 = Number(settings.minWaitTime1) || 10;
    const maxW1 = Number(settings.maxWaitTime1) || 30;
    const minW2 = Number(settings.minWaitTime2) || 180;
    const maxW2 = Number(settings.maxWaitTime2) || 250;

    crawlerUtil.log('\n*** [블로그 랭킹 상승 로직] ***');
    crawlerUtil.log(`설정값 — 1차 반영: ${minW1}~${maxW1}초, 2차 반영: ${minW2}~${maxW2}초\n`);

    const blogRankParams = {
      page: this.postPage,
      setting: settings,
      isTestMode: settings.testMode === 'Y',
      minWaitTime1: minW1,
      maxWaitTime1: maxW1,
      minWaitTime2: minW2,
      maxWaitTime2: maxW2,
      keyword: knowledge.keyword,
    };

    if (settings.logicType === 'detail') {
      await blogRankService.정밀로직(blogRankParams);
    } else {
      await blogRankService.클린로직(blogRankParams);
    }

    return true;
  }

  private async _startTopExposureLogic(
    setting: Partial<Settings>, knowledge: Knowledge,
    naverAccounts: NaverAccount[], progressCount: number,
    shouldStop: () => boolean,
  ) {
    this.setting = setting;
    crawlerService.init(setting as Settings);

    try {
      await crawlerService.changeIpAndMacAddress({ setting, userMe: setting });
      if (shouldStop()) throw new Error('CANCELLED');

      await this._openBrowser();
      if (shouldStop()) throw new Error('CANCELLED');

      if (setting.naverLoginType !== 'no' && naverAccounts.length > 0) {
        await this._naverLogin(setting, naverAccounts, progressCount);
      }
      if (shouldStop()) throw new Error('CANCELLED');

      await this._imitate(shouldStop);
    } catch (e: any) {
      if (e.message === 'CANCELLED' || e.message === 'NOT OPEN BROWSER' || e.message === 'IP CHANGE FAIL' || e.message === 'VPN_CONNECTION_FAILED') throw e;
      crawlerUtil.log('랜덤 서핑 과정에서 오류가 발생했습니다. ' + e.message);
      crawlerUtil.log('랜덤 서핑 과정에서의 오류를 무시하고 계속 진행하겠습니다.');
    } finally {
      if (shouldStop()) return;
    }

    try {
      await this._crawl(knowledge, setting, shouldStop);
    } catch (e: any) {
      if (e.message === 'CANCELLED') throw e;
      crawlerUtil.log('크롤링 도중 에러 발생: ' + e.message);
    } finally {
      if (shouldStop()) return;
    }

    // 블로그 모드: postPage 정리
    if (this.postPage) {
      crawlerUtil.log('사이트 페이지를 닫겠습니다.');
      await this.postPage.bringToFront().catch(() => {});
      await crawlerUtil.autoScroll(this.postPage, '', 200, 200, 3000).catch(() => {});
      await crawlerUtil.waitRandom(this.postPage, 5, 10).catch(() => {});
      await this.postPage.close().catch(() => {});
      this.postPage = undefined;
    }

    // 쇼핑 모드: 기존 페이지 정리
    if (this.purchaseDetailPage) {
      crawlerUtil.log('구매상세 페이지를 닫겠습니다.');
      await this.purchaseDetailPage.bringToFront().catch(() => {});
      await this.purchaseDetailPage.close().catch(() => {});
    }

    if (this.shoppingDetailPage) {
      crawlerUtil.log('쇼핑상세 페이지를 닫겠습니다.');
      await this.shoppingDetailPage.bringToFront().catch(() => {});
      await crawlerUtil.autoScroll(this.shoppingDetailPage, '', 200, 200, 3000).catch(() => {});
      await crawlerUtil.waitRandom(this.shoppingDetailPage, 5, 10).catch(() => {});
      await this.shoppingDetailPage.close().catch(() => {});
    }

    if (this.shoppingResultPage) {
      crawlerUtil.log('쇼핑결과 페이지를 닫겠습니다.');
      await this.shoppingResultPage.bringToFront().catch(() => {});
      await crawlerUtil.autoScroll(this.shoppingResultPage, '', 200, 200, 3000).catch(() => {});
      await crawlerUtil.waitRandom(this.shoppingResultPage, 5, 10).catch(() => {});
      await this.shoppingResultPage.close().catch(() => {});
    }

    if (this.page) {
      await this.page.bringToFront().catch(() => {});
      await crawlerUtil.autoScroll(this.page).catch(() => {});
      await crawlerUtil.waitRandom(this.page, 5, 10).catch(() => {});
    }

    try {
      await this._lastImitate(shouldStop);
    } catch (e: any) {
      if (e.message === 'CANCELLED') throw e;
      crawlerUtil.log('마지막 서핑 과정에서 오류가 발생했습니다. ' + e.message);
    }

    if (this.page) await crawlerService.removeCookie(this.page);
    await this.close();
  }

  private async _lastImitate(shouldStop: () => boolean) {
    if (!this.page || !this.setting || !this.browser) return;
    const isMobile = this.setting.pageType === 'mobile';
    const url = isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN;

    await crawlerUtil.goto(this.page, url);
    await imitateService.closeModalBanner({ page: this.page, promotionSelector: '.lm_wrap', modalLayerSelector: '.layer_modal' });

    if (isMobile) {
      await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: true, minWorkCount: 2, maxWorkCount: 3, minWaitTime: 1, maxWaitTime: 3 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: true, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 3 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 1, maxWaitTimeBeforeScroll: 2, minWaitTimeAfterScroll: 1, maxWaitTimeAfterScroll: 2 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: true, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 3 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 1, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 1, maxWaitTimeAfterScroll: 1 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomClickNews({ browser: this.browser, page: this.page, userMe: this.setting, setting: this.setting, minWaitTimeAfter: 8, maxWaitTimeAfter: 15 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: true, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 3 });
    } else {
      await imitateService.randomClickNews({ browser: this.browser, page: this.page, userMe: this.setting, setting: this.setting, minWaitTimeAfter: 8, maxWaitTimeAfter: 15 });
      if (shouldStop()) throw new Error('CANCELLED');

      await crawlerUtil.waitRandom(this.page, 1, 3);
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: false, minWorkCount: 2, maxWorkCount: 3, minWaitTime: 1, maxWaitTime: 3 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 1, maxWaitTimeBeforeScroll: 2, minWaitTimeAfterScroll: 1, maxWaitTimeAfterScroll: 2 });
      if (shouldStop()) throw new Error('CANCELLED');

      await crawlerUtil.waitRandom(this.page, 1, 2);
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: false, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 3 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 1, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 1, maxWaitTimeAfterScroll: 1 });
      if (shouldStop()) throw new Error('CANCELLED');

      await imitateService.randomClickNews({ browser: this.browser, page: this.page, userMe: this.setting, setting: this.setting, minWaitTimeAfter: 15, maxWaitTimeAfter: 25 });
    }
  }

  private async _startCommonExposureLogic(
    setting: Partial<Settings>, knowledge: Knowledge,
    naverAccounts: NaverAccount[], progressCount: number,
    shouldStop: () => boolean,
  ) {
    this.setting = setting;
    crawlerService.init(setting as Settings);

    await crawlerService.changeIpAndMacAddress({ setting, userMe: setting });
    if (shouldStop()) throw new Error('CANCELLED');

    await this._openBrowser();
    if (shouldStop()) throw new Error('CANCELLED');

    if (setting.naverLoginType !== 'no' && naverAccounts.length > 0) {
      await this._naverLogin(setting, naverAccounts, progressCount);
    }
    if (shouldStop()) throw new Error('CANCELLED');

    await this._imitateByCommon(shouldStop);
    if (this.page) await crawlerService.removeCookie(this.page);
    await this.close();
  }

  private async _imitateByCommon(shouldStop: () => boolean) {
    if (!this.page || !this.setting || !this.browser) return;
    const isMobile = this.setting.pageType === 'mobile';
    const url = isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN;
    const isTest = this.setting.testMode === 'Y';

    // 1. goto naver main
    await crawlerUtil.goto(this.page, url);
    // 2. closeModalBanner
    await imitateService.closeModalBanner({ page: this.page, promotionSelector: '.lm_wrap', modalLayerSelector: '.layer_modal' });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직5
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 3, minWaitTime: 1, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직7
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 4, maxWaitTimeAfterScroll: 8 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직6
    await imitateService.randomClickNews({ browser: this.browser, page: this.page, userMe: this.setting, setting: this.setting, minWaitTimeAfter: 8, maxWaitTimeAfter: 15 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직8
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 2, minWaitTime: 1, maxWaitTime: 2 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직9
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 3, maxWaitTimeAfterScroll: 8 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직11
    await crawlerUtil.waitRandom(this.page, 1, 3);
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직12
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 2 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직13
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 2, maxWaitTimeAfterScroll: 4 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직15
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 2, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직16
    await imitateService.randomClickMenu({ page: this.page, setting: this.setting, minWaitTime: 1, maxWaitTime: 2 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직17/18
    await imitateService.randomClickNews({ browser: this.browser, page: this.page, userMe: this.setting, setting: this.setting, minWaitTimeBefore: 2, maxWaitTimeBefore: 3, minWaitTimeAfter: isTest ? 1 : 20, maxWaitTimeAfter: isTest ? 2 : 40 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직19
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 2, maxWaitTimeAfterScroll: 4 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직21
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 2, maxWaitTimeAfterScroll: 4 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직23
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 3, maxWorkCount: 3, minWaitTime: 1, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직25
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 2, maxWaitTimeAfterScroll: 4 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직26
    await crawlerUtil.waitRandom(this.page, 1, 3);
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직27
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직29
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직30
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 2, maxWaitTimeAfterScroll: 4 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직32
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 2, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직33
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 2, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 2, maxWaitTimeAfterScroll: 4 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직34
    await crawlerUtil.waitRandom(this.page, 1, 3);
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직35
    await imitateService.randomClickNews({ browser: this.browser, page: this.page, userMe: this.setting, setting: this.setting, minWaitTimeAfter: 8, maxWaitTimeAfter: 15 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직37
    await imitateService.randomSearch({ browser: this.browser, page: this.page, isMobile: !!isMobile, minWorkCount: 1, maxWorkCount: 1, minWaitTime: 1, maxWaitTime: 3 });
    if (shouldStop()) throw new Error('CANCELLED');

    // 공통로직38
    await imitateService.randomClickMenuWithScroll({ page: this.page, setting: this.setting, minWaitTimeBeforeScroll: 1, maxWaitTimeBeforeScroll: 3, minWaitTimeAfterScroll: 1, maxWaitTimeAfterScroll: 3 });
  }

  async close() {
    try {
      crawlerUtil.log('모든 페이지를 닫겠습니다.');
      const pages = await this.browser?.pages().catch(() => []);
      if (pages) {
        for (const p of pages) {
          await p.close().catch(() => {});
        }
      }

      const browserProcess = this.browser?.process();
      await this.browser?.close().catch(console.error);
      try { this.browser?.disconnect(); } catch { /* ignore */ }

      if (browserProcess && !browserProcess.killed) {
        await crawlerUtil.delay(2000);
        if (!browserProcess.killed) {
          try { browserProcess.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.page = undefined;
      this.postPage = undefined;
      this.shoppingDetailPage = undefined;
      this.shoppingResultPage = undefined;
      this.purchaseDetailPage = undefined;
      this.browser = undefined;
      await crawlerUtil.delay(5000);
      crawlerUtil.log('모든 페이지를 닫았습니다. 다음 사이클을 준비합니다.');
    }
  }
}

export const crawlerController = new CrawlerController();
