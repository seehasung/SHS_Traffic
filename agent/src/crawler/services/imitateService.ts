import type { Browser, Page, ElementHandle } from 'puppeteer-core';
import { sample, isEmpty, random } from 'lodash';
import { NAVER_URL } from '../constants/urls';
import { crawlerUtil } from '../utils/crawlerUtil';
import WORDS from '../constants/words';
import { puppeteerMouseUtil } from '../utils/puppeteerMouseUtil';
import { puppeteerKeyboardUtil } from '../utils/puppeteerKeyboardUtil';

class ImitateService {
  private async _removeLayer({ page }: { page: Page }) {
    try {
      await page.evaluate(() => {
        const layer = document.querySelector('.layer_search_tutorial');
        if (layer) layer.remove();
      });
    } catch (e) {
      console.error(e);
    }
  }

  async goToShoppingPageIfNotShoppingPage({ page, isMobile, keyword }: { page: Page; isMobile: boolean; keyword: string }) {
    const isCurrentShoppingPage = page?.url()?.includes('search.shopping.naver.com');
    if (!isCurrentShoppingPage) {
      const baseURL = !isMobile ? NAVER_URL.SHOPPING_SEARCH_MAIN : NAVER_URL.SHOPPING_SEARCH_MAIN_MOBILE;
      const shoppingURL = `${baseURL}/search/all?query=${keyword}&frm=NVSHATC`;
      await crawlerUtil.goto(page, shoppingURL);
    }
    await crawlerUtil.waitTillHTMLRendered(page);
  }

  async randomSearch(params: {
    browser: Browser; page: Page; isMobile: boolean;
    minWaitTime?: number; maxWaitTime?: number;
    minWorkCount?: number; maxWorkCount?: number;
    isGoBack?: boolean;
  }) {
    const { browser, page, isMobile, minWaitTime = 1, maxWaitTime = 1, minWorkCount = 1, maxWorkCount = 1, isGoBack = true } = params;
    try {
      await crawlerUtil.goto(page, isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN);
      const repeatCount = Math.round(Math.random() * (maxWorkCount - minWorkCount) + minWorkCount);
      crawlerUtil.log(`랜덤 검색을 총 "${repeatCount}"회 시작하겠습니다.`);
      await page.waitForSelector('#query');

      for (let i = 0; i < repeatCount; i++) {
        const randomWord = sample(WORDS)!;
        crawlerUtil.log(`"${randomWord}"를 검색하겠습니다.`);

        if (isMobile) {
          await this._removeLayer({ page });
          const fakeSearchInput = await page.$('#MM_SEARCH_FAKE');
          if (fakeSearchInput) await fakeSearchInput.click();
          await page.waitForSelector('header #query', { visible: true }).catch(() => {});
          await page.type('header #query', randomWord, { delay: 100 });
          await crawlerUtil.delay(500);
          await page.keyboard.press('Enter');
          await crawlerUtil.waitTillHTMLRendered(page);
        } else {
          await page.waitForSelector('#query');
          await page.type('#query', randomWord, { delay: 100 });
          await page.waitForSelector('#search-btn');
          const searchBtn = await page.$('#search-btn');
          await crawlerUtil.clickByElemHandle(page, searchBtn);
        }

        await crawlerUtil.waitRandom(page, minWaitTime, maxWaitTime);
        if (isGoBack) await crawlerUtil.goBack(page);
      }
    } catch (e) {
      console.error(e);
      await crawlerUtil.goto(page, isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN);
    }
  }

  async searchShoppingKeyword({ page, isMobile, keyword }: { page: Page; isMobile: boolean; keyword: string }) {
    const gnbInputSelector = "*[class*='N=a:gnb.input']";
    const inputSelector = isMobile ? '#input_text' : 'input[class*=searchInput_search]';
    if (isMobile) {
      await puppeteerMouseUtil.clickBySelector(page, gnbInputSelector);
      await crawlerUtil.delay(1000);
    }
    await puppeteerKeyboardUtil.clearInput(page, inputSelector);
    await puppeteerKeyboardUtil.type(page, inputSelector, keyword);
    await puppeteerKeyboardUtil.typeAndWaitNetworkIdle(page, inputSelector, 'Enter');
    await crawlerUtil.waitRandom(page, 1, 3);
  }

  async searchRandomShopping({ page, userMe, isMobile }: { page: Page; userMe: any; isMobile: boolean }) {
    if (userMe?.shoppingRandomSearch !== 'Y') return;
    const randomCount = random(1, 3);
    crawlerUtil.log(`쇼핑 랜덤검색을 총 ${randomCount}회 진행하겠습니다.`);
    for (let i = 0; i < randomCount; i++) {
      const randomWord = sample(WORDS)!;
      crawlerUtil.log(`${randomWord} 키워드 쇼핑 랜덤 검색 시작`);
      await this.goToShoppingPageIfNotShoppingPage({ page, isMobile, keyword: randomWord });
      await this.searchShoppingKeyword({ page, keyword: randomWord, isMobile });
      crawlerUtil.log(`${randomWord} 키워드 쇼핑 랜덤 검색 완료`);
    }
  }

  async clickRandomNewsInSearchResultPage({ browser, page, setting }: { browser: Browser; page: Page; setting: any }) {
    try {
      const selector = '.lnb_menu li a[href*=news]';
      await page.waitForSelector(selector);
      await crawlerUtil.clickBySelector(page, selector);
      await crawlerUtil.autoScroll(page);
      const randomNewsLink = sample(await page.$$('.list_news .news_tit'));
      if (!isEmpty(randomNewsLink)) {
        const newPage = await crawlerUtil.getNewPageByClick({ browser, page, linkElement: randomNewsLink! });
        if (!newPage) return crawlerUtil.log('clickRandomNewsInSearchResultPage, 새로운페이지를 가져오지 못했습니다.');
        await newPage?.bringToFront();
        await crawlerUtil.autoScroll(newPage);
        await crawlerUtil.waitRandom(newPage, 3, 5);
        await newPage?.close();
        await crawlerUtil.wait(page, 1);
        await crawlerUtil.goBack(page);
      }
      await crawlerUtil.goBack(page);
      await crawlerUtil.goBack(page);
    } catch (e) {
      console.error(e);
    }
  }

  private async _randomClickMenu(page: Page, setting: any) {
    try {
      const url = page.url();
      const isMobile = setting.pageType === 'mobile';
      if (url !== 'https://www.naver.com' && url !== 'https://m.naver.com') {
        await crawlerUtil.goto(page, isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN);
      }
      if (isMobile) await this._removeLayer({ page });

      const selector = isMobile
        ? '.chm_menu li a'
        : 'a.link_service[target*=blank]:not(:has(.ico_ad))';

      await page.waitForSelector(selector, { visible: true });
      const menuElements = await page.$$(selector);
      const filteredMenus = await Promise.all(
        menuElements.map(async (el) => {
          const href = await page.evaluate((e: any) => e.getAttribute('href'), el);
          if (href && !href.includes('map.naver') && !href.includes('veta.naver') && !href.includes('chzzk') && !href.includes('book')) return el;
          return null;
        }),
      );
      const validMenus = filteredMenus.filter(Boolean) as ElementHandle<Element>[];
      const randomMenu = sample(validMenus);
      if (!randomMenu) return crawlerUtil.log('네이버 메인에서 임의의 메뉴를 추출하지 못했습니다.');

      const randomMenuName = await randomMenu.evaluate((node: any) => node.innerText);
      crawlerUtil.log(`"${randomMenuName}" 메뉴를 클릭하겠습니다.`);
      await crawlerUtil.clickByElemHandle(page, randomMenu);
    } catch (e) {
      console.error(e);
    }
  }

  async randomClickMenuWithScroll(params: {
    page: Page; setting: any;
    minWaitTimeBeforeScroll?: number; maxWaitTimeBeforeScroll?: number;
    minWaitTimeAfterScroll?: number; maxWaitTimeAfterScroll?: number;
  }) {
    const { page, setting, minWaitTimeBeforeScroll = 1, maxWaitTimeBeforeScroll = 2,
      minWaitTimeAfterScroll = 2, maxWaitTimeAfterScroll = 4 } = params;
    try {
      crawlerUtil.log('\n[랜덤 카테고리 클릭 후 스크롤]\n');
      await this._randomClickMenu(page, setting);
      await crawlerUtil.waitRandom(page, minWaitTimeBeforeScroll, maxWaitTimeBeforeScroll);
      await crawlerUtil.waitTillHTMLRendered(page, 3000);
      await crawlerUtil.autoScroll(page);
      await crawlerUtil.waitRandom(page, minWaitTimeAfterScroll, maxWaitTimeAfterScroll);
      await crawlerUtil.goBack(page);
    } catch (e: any) {
      console.error(e);
      crawlerUtil.log('\n[랜덤클릭메뉴 후 스크롤 에러]\n' + e.message);
    }
  }

  async randomClickMenu({ page, setting, minWaitTime = 2, maxWaitTime = 3 }: {
    page: Page; setting: any; minWaitTime?: number; maxWaitTime?: number;
  }) {
    try {
      const isMobile = setting.pageType === 'mobile';
      await crawlerUtil.goto(page, isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN);
      crawlerUtil.log('\n[랜덤 메뉴 클릭]\n');
      await this._randomClickMenu(page, setting);
      await crawlerUtil.waitRandom(page, minWaitTime, maxWaitTime);
      await crawlerUtil.goBack(page);
    } catch (e: any) {
      console.error(e);
      crawlerUtil.log('\n[랜덤 메뉴 클릭 에러]\n' + e.message);
    }
  }

  async removeNaverNewsNotice(page: Page) {
    try {
      const selector = '*[href*=ombudsman]';
      const elementHandles = await page.$$(selector);
      await Promise.all(elementHandles.map((x) => x.evaluate((elem: any) => elem.remove())));
    } catch (e) {
      console.error(e);
    }
  }

  async randomClickNews(params: {
    browser: Browser; page: Page; userMe: any; setting: any;
    minWaitTimeAfter: number; maxWaitTimeAfter: number;
    minWaitTimeBefore?: number; maxWaitTimeBefore?: number;
  }) {
    const { browser, page, userMe, setting, minWaitTimeAfter, maxWaitTimeAfter,
      minWaitTimeBefore, maxWaitTimeBefore } = params;

    if (userMe.logicType === 'clean') return;

    try {
      crawlerUtil.log('\n[랜덤 뉴스 클릭]\n');
      const isPc = setting.pageType === 'pc';
      const isMobile = setting.pageType === 'mobile';
      const url = isMobile ? NAVER_URL.MOBILE_NEWS : NAVER_URL.NEWS;
      await crawlerUtil.goto(page, url);

      const pageUrl = page.url();
      await crawlerUtil.waitTillHTMLRendered(page, 5000);

      const isSectionPage = pageUrl?.includes('news.naver.com/section');
      const selector = isSectionPage ? '.sa_text_strong' : '.cnf_news_item';

      await page.waitForSelector(selector).catch(() => {});
      const newsElements = await page.$$(selector);
      const randomNews = sample(newsElements?.slice(0, 3));

      if (!randomNews) return crawlerUtil.log('랜덤 뉴스를 가져오는데 실패했습니다.');
      const randomNewsTitle = await page.evaluate((news: any) => news.innerText, randomNews);
      await this.removeNaverNewsNotice(page);

      if (isPc) {
        await crawlerUtil.clickByElemHandle(page, randomNews, false);
        crawlerUtil.log(`클릭 된 랜덤 뉴스 타이틀 "${randomNewsTitle}"`);
        if ((minWaitTimeBefore as number) > 0 || (maxWaitTimeBefore as number) > 0) await crawlerUtil.waitRandom(page, minWaitTimeBefore as number, maxWaitTimeBefore as number);
        await crawlerUtil.autoScroll(page);
        if (minWaitTimeAfter > 0 || maxWaitTimeAfter > 0) await crawlerUtil.waitRandom(page, minWaitTimeAfter, maxWaitTimeAfter);
        await crawlerUtil.goBack(page);
        await crawlerUtil.goBack(page);
        return;
      } else if (isMobile) {
        await crawlerUtil.clickByElemHandle(page, randomNews, false);
        crawlerUtil.log(`클릭 된 랜덤 뉴스 타이틀 "${randomNewsTitle}"`);
        await crawlerUtil.waitTillHTMLRendered(page, 3000);
        await crawlerUtil.waitForSelector(page, '.newsct_body');
        await crawlerUtil.delay(1000);
        if ((minWaitTimeBefore as number) > 0 || (maxWaitTimeBefore as number) > 0) await crawlerUtil.waitRandom(page, minWaitTimeBefore as number, maxWaitTimeBefore as number);
        await crawlerUtil.autoScroll(page);
        if (minWaitTimeAfter > 0 || maxWaitTimeAfter > 0) await crawlerUtil.waitRandom(page, minWaitTimeAfter, maxWaitTimeAfter);
        await crawlerUtil.goBack(page);
        return;
      }
    } catch (e: any) {
      console.log(e);
      crawlerUtil.log('\n[랜덤 뉴스 클릭 에러]\n' + e.message);
    }
  }

  async closeModalBanner({ page, promotionSelector, modalLayerSelector }: {
    page: Page; promotionSelector: string; modalLayerSelector: string;
  }) {
    try {
      const promotionBanner = await page.$(promotionSelector);
      const modalLayer = await page.$(modalLayerSelector);
      if (promotionBanner && modalLayer) {
        crawlerUtil.log('프로모션 배너를 닫겠습니다.');
        await modalLayer.evaluate((elem: any) => elem.click());
      }
    } catch (e: any) {
      console.error('프로모션 닫기에 실패하였습니다.: ' + e.message);
    }
  }

  async closeLayerBanner({ page, closeButtonSelector }: { page: Page; closeButtonSelector: string }) {
    try {
      const closeButton = await page.$(closeButtonSelector);
      if (closeButton) {
        crawlerUtil.log('팝업레이어 배너를 닫겠습니다.');
        await closeButton.click();
      }
    } catch (e: any) {
      console.error('팝업레이어 닫기에 실패하였습니다.: ' + e.message);
    }
  }

  async clickNewsTitle(page: Page, setting: any) {
    try {
      const url = page.url();
      const isMobile = setting.pageType === 'mobile';
      if (url !== 'https://www.naver.com' && url !== 'https://m.naver.com') {
        await crawlerUtil.goto(page, isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN);
      }

      let newsElement;
      if (isMobile) {
        newsElement = await page.$('.cjs_news_a');
      } else {
        newsElement = await page.$('[class*="module__news_box"] a');
      }

      if (newsElement) {
        const newsTitle = await newsElement.evaluate((elem: any) => elem.innerText);
        const newsUrl = await newsElement.evaluate((elem: any) => elem.href);
        crawlerUtil.log(`"${newsTitle}"를 클릭하겠습니다.`);
        await crawlerUtil.goto(page, newsUrl);
        await crawlerUtil.autoScroll(page);
        await crawlerUtil.goBack(page);
      } else {
        crawlerUtil.log('네이버 메인에서 뉴스 타이틀 클릭 실패');
      }
    } catch (e: any) {
      console.error(e);
      crawlerUtil.log('네이버 메인에 있는 뉴스 타이틀 클릭에 실패했습니다.' + e.message);
    }
  }
}

export const imitateService = new ImitateService();
