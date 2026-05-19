import type { Browser, Page, ElementHandle } from 'puppeteer-core';
import { isEmpty, shuffle } from 'lodash';
import { crawlerUtil } from '../utils/crawlerUtil';
import { NAVER_URL } from '../constants/urls';

class KnowledgeService {
  private async _removeLayer({ page }: { page: Page }) {
    await page.evaluate(() => {
      const layer = document.querySelector('.layer_search_tutorial');
      if (layer) layer.remove();
    }).catch(() => {});
  }

  private async _searchKeyword(page: Page, keyword: string, setting: any) {
    const isMobile = setting.pageType === 'mobile';
    crawlerUtil.log(`"${keyword}" 검색`);

    if (isMobile) {
      await this._removeLayer({ page });
      await page.waitForSelector('header #query').catch(() => {});
      await page.type('header #query', keyword, { delay: 100 });
      const searchBtn = await page.$('.sch_btn_search');
      await crawlerUtil.clickByElemHandle(page, searchBtn);
    } else {
      await page.type('input[name="query"]', keyword, { delay: 100 });
      const searchBtn = await page.$('#search-btn');
      await crawlerUtil.clickByElemHandle(page, searchBtn);
    }
  }

  async extractProductIdFromElement(element: ElementHandle<Element> | null): Promise<string> {
    if (!element) return '';
    try {
      const id = await element.evaluate((el: any) => {
        const shpId = el.getAttribute('data-shp-contents-id');
        if (shpId) return shpId;
        const dataI = el.getAttribute('data-i');
        if (dataI) return dataI;
        const href = el.href || '';
        const match = String(href).match(/(\d{8,})/);
        return match ? match[1] : '';
      });
      return String(id).trim();
    } catch {
      return '';
    }
  }

  async extractProductNumbersBySelector(page: Page, selector: string): Promise<string[]> {
    const elements = await page.$$(selector);
    const results: string[] = [];
    for (const elem of elements) {
      const text = await elem.evaluate((el: any) => el.innerText || el.textContent || '').catch(() => '');
      results.push(String(text).trim());
    }
    return results;
  }

  async isAdvertiseProduct(itemElement: ElementHandle<Element>): Promise<boolean> {
    try {
      const isAd = await itemElement.evaluate((el: any) => {
        const contentsType = el.getAttribute('data-shp-contents-type');
        if (contentsType === 'AD' || contentsType === 'ad') return true;

        const adLink = el.querySelector('[data-shp-contents-type="AD"]');
        if (adLink) return true;

        const text = el.innerText || '';
        if (text.includes('광고')) return true;

        const adBadge = el.querySelector('[class*="ad_"], [class*="_ad"], [class*="adArea"]');
        if (adBadge) return true;

        const closestAd = el.closest('[class*="ad_"], [class*="_ad"], [data-shp-area-type="ad"]');
        if (closestAd) return true;

        return false;
      });
      return isAd;
    } catch {
      return false;
    }
  }

  async findTargetInProductList(
    items: ElementHandle<Element>[],
    isMobile: boolean,
    targetProductId: string,
    isIncludeAds: boolean,
    isPlus: boolean,
  ) {
    for (let i = 0; i < items?.length; i++) {
      const itemElement = items[i];

      const isAd = await this.isAdvertiseProduct(itemElement);
      if (isAd) {
        continue;
      }

      const idLinks = await itemElement.$$('[data-shp-contents-id]');
      let foundLink: ElementHandle<Element> | null = null;

      for (const link of idLinks) {
        const contentId = await link.evaluate((el: any) => el.getAttribute('data-shp-contents-id') || '');
        if (String(contentId).trim() === String(targetProductId).trim()) {
          foundLink = link;
          break;
        }
      }

      if (!foundLink) {
        let itemLinkSelector = !isMobile ? 'a[class*=link__]' : 'a[data-i]';
        if (isPlus) itemLinkSelector = 'a[data-shp-contents-id]';
        const itemLinkElement = await itemElement?.$(itemLinkSelector);
        const dataI = await this.extractProductIdFromElement(itemLinkElement);
        if (String(dataI) === String(targetProductId).trim()) {
          foundLink = itemLinkElement;
        }
      }

      if (foundLink) {
        crawlerUtil.log(`[일반 영역] 상품번호 "${targetProductId}" 발견 (${i + 1}번째 아이템)`);
        await foundLink.evaluate((x: any) => x.setAttribute('target', '_blank'));
        return { itemLinkElement: foundLink, itemElement, itemTotalCount: items?.length, itemIndex: i + 1 };
      }
    }
    return {} as any;
  }

  private async _clickNextPageInShoppingResultPage(page: Page, setting: any) {
    try {
      const isPc = !page.url().includes('msearch');
      const nextPageSelector = isPc
        ? '[class*="pagination_btn_page"][class*="active"] + a'
        : '*[class*=paginator] a[class*=active] + *';
      await crawlerUtil.waitRandom(page, 1, 2);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await crawlerUtil.delay(1000);

      await page.waitForSelector(nextPageSelector, { timeout: 5000 });

      const itemsSelector = '*[class*=basicList_list_basis] > div > div';
      const firstItemBefore = await page.evaluate((sel: string) => {
        const items = document.querySelectorAll(sel);
        return items[0]?.outerHTML?.substring(0, 200) || '';
      }, itemsSelector);

      await page.click(nextPageSelector);
      crawlerUtil.log('다음페이지 버튼 클릭');

      await page.waitForFunction(
        (sel: string, before: string) => {
          const items = document.querySelectorAll(sel);
          const firstNow = items[0]?.outerHTML?.substring(0, 200) || '';
          return items.length > 0 && firstNow !== before;
        },
        { timeout: 15000 },
        itemsSelector,
        firstItemBefore,
      ).catch(() => {});

      await crawlerUtil.waitTillHTMLRendered(page);

      if (!isPc) {
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      }
    } catch (e: any) {
      crawlerUtil.log('다음페이지 버튼 클릭 실패');
      console.error(e);
      throw e;
    }
  }

  private async _findPurchaseItemByPc(browser: Browser, shoppingDetailPage: Page, purchaseName: string, setting: any) {
    for (let i = 0; i < 500; i++) {
      const linkSelector = '*[class*=productList_list_seller] *[class^=productList_title__]';
      await shoppingDetailPage.waitForSelector(linkSelector).catch(() => {});
      const productNumbers = await this.extractProductNumbersBySelector(shoppingDetailPage, linkSelector);
      const linkIndex = productNumbers?.findIndex((x) => x === purchaseName);

      if (linkIndex === -1) {
        await crawlerUtil.scrollBy(shoppingDetailPage, 'normal', 200, 5, 'down');
        await crawlerUtil.wait(shoppingDetailPage, 1);
        try {
          const purchaseNextPageSelector = '*[class*=productList_seller] *[class*=pagination_now__] + a';
          await shoppingDetailPage.waitForSelector(purchaseNextPageSelector);
          await shoppingDetailPage.click(purchaseNextPageSelector);
        } catch {
          crawlerUtil.log(`판매처 "${purchaseName}"를 찾지 못했습니다.`);
          return null;
        }
        continue;
      }

      const linkElemHandle = (await shoppingDetailPage.$$(linkSelector))[linkIndex];
      const purchaseDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingDetailPage, linkElement: linkElemHandle });
      await purchaseDetailPage?.bringToFront();
      await crawlerUtil.wait(shoppingDetailPage, 3);
      return purchaseDetailPage;
    }
    return null;
  }

  async findPages(
    browser: Browser, page: Page, userMe: any, setting: any,
    keyword: string, itemName: string, purchaseName?: string,
  ): Promise<{
    shoppingResultPage?: Page; shoppingDetailPage?: Page;
    purchaseDetailPage?: Page; totalShoppingDetailPage?: Page;
  }> {
    let isPc = setting.pageType === 'pc';
    let isMobile = setting.pageType === 'mobile';
    const url = isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN;
    const isPlus = setting.storeType === 'plus';
    const isSpecial = setting.storeType === 'special';
    let searchKeyword = isSpecial ? '네이버 가격비교' : keyword;
    searchKeyword = isPlus ? '네이버 플러스스토어' : searchKeyword;

    try {
      await crawlerUtil.goto(page, url);
      await this._searchKeyword(page, searchKeyword, setting);
    } catch (e) {
      console.error(e);
    }

    await crawlerUtil.waitRandom(page, 1, 2);
    const shoppingTabSelector = isPc
      ? 'a[role=tab][href*="search.shopping.naver.com/search"]'
      : 'a[role=tab][href*="msearch.shopping.naver.com/search"]';

    await page.waitForSelector(shoppingTabSelector).catch(() => {});
    const shoppingTabElement = await page.$(shoppingTabSelector);
    if (!shoppingTabElement) throw new Error('쇼핑탭을 찾지 못했습니다.');

    let shoppingResultPage = await crawlerUtil.getNewPageByClick({ browser, page, linkElement: shoppingTabElement });
    if (!shoppingResultPage) return {};

    await crawlerUtil.log('검색 결과 페이지 URL: ' + shoppingResultPage.url());
    if (!shoppingResultPage.url().includes('msearch')) { isPc = true; isMobile = false; }

    await crawlerUtil.waitTillHTMLRendered(shoppingResultPage);
    const pageContent = await shoppingResultPage.content();

    if (isPc) {
      await shoppingResultPage.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      await crawlerUtil.waitTillHTMLRendered(shoppingResultPage);
    }

    if (pageContent.includes('검색 결과가 없습니다.')) {
      await shoppingResultPage.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      crawlerUtil.log('검색결과 미노출 에러입니다. 새로고침을 1회 더 진행하겠습니다.');
    }

    let shoppingDetailPage: Page | undefined;
    let purchaseDetailPage: Page | undefined;
    let totalShoppingDetailPage: Page | undefined;

    const MAX_PAGES = 50;
    for (let i = 0; i < MAX_PAGES; i++) {
      if (i === 0) {
        await crawlerUtil.waitRandom(shoppingResultPage, 5, 10).catch(console.error);
      } else {
        await crawlerUtil.waitRandom(shoppingResultPage, 1, 3).catch(console.error);
      }
      await crawlerUtil.autoScroll(shoppingResultPage, '', 200, 200).catch(console.error);
      await crawlerUtil.waitTillHTMLRendered(shoppingResultPage);

      const itemsSelector = '*[class*=basicList_list_basis] > div > div';
      const items = await shoppingResultPage.$$(itemsSelector);
      crawlerUtil.log(`[${i + 1}/${MAX_PAGES}페이지] 검색 결과 아이템 ${items.length}개 발견, 상품번호 "${itemName}"을 일반 영역에서 검색합니다.`);
      const { itemLinkElement, itemElement, itemTotalCount, itemIndex } =
        await this.findTargetInProductList(items, isMobile, itemName, false, isPlus);

      const isFoundTarget = !isEmpty(itemElement);

      if (!isFoundTarget) {
        if (i >= MAX_PAGES - 1) {
          crawlerUtil.log(`${MAX_PAGES}페이지까지 상품을 찾지 못했습니다. 다음 상품으로 넘어갑니다.`);
          break;
        }
        crawlerUtil.log('상품을 찾지 못해서 다음 페이지로 넘어가겠습니다.');
        try {
          await this._clickNextPageInShoppingResultPage(shoppingResultPage, setting);
        } catch {
          crawlerUtil.log('더 이상 다음 페이지가 없습니다. 다음 상품으로 넘어갑니다.');
          break;
        }
        continue;
      }

      if (isFoundTarget && !purchaseName) {
        crawlerUtil.log(`[타겟상품을 찾았습니다.] ${i + 1}번 페이지의 ${itemTotalCount}개의 상품 중 ${itemIndex}번째 상품입니다.`);
        await crawlerUtil.waitRandom(shoppingResultPage, 10, 13);
        purchaseDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage, linkElement: itemLinkElement });
        await purchaseDetailPage?.bringToFront();
        await crawlerUtil.waitTillHTMLRendered(purchaseDetailPage!);
        return { shoppingResultPage, purchaseDetailPage };
      }

      if (isFoundTarget && purchaseName) {
        crawlerUtil.log(`[타겟상품을 찾았습니다.] ${i + 1}번 페이지의 ${itemTotalCount}개의 상품 중 ${itemIndex}번째 상품입니다.`);
        await crawlerUtil.waitRandom(shoppingResultPage, 10, 13);

        try {
          if (userMe.logicType === 'clean' || userMe.logicType === 'hidden') {
            shoppingDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage, linkElement: itemLinkElement });
          }
          if (userMe.logicType === 'detail') {
            const thumbnailSelector = isPc ? 'a[class^=thumbnail_thumb__]' : '*[class*=_img_area__] img';
            const thumbnailElement = await itemElement?.$(thumbnailSelector);
            shoppingDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage, linkElement: thumbnailElement });
          }

          if (isPc && shoppingDetailPage) {
            purchaseDetailPage = await this._findPurchaseItemByPc(browser, shoppingDetailPage, purchaseName, setting) || undefined;
          }
          return { shoppingResultPage, shoppingDetailPage, purchaseDetailPage, totalShoppingDetailPage };
        } catch (e) {
          console.error(e);
        }
      }
    }

    return { shoppingResultPage };
  }

  async 클린로직(params: {
    page: Page; url: string; setting: any; isTestMode: boolean;
    isMobile: boolean; minWaitTime1: number; maxWaitTime1: number;
    minWaitTime2: number; maxWaitTime2: number;
  }) {
    const { page, setting, isTestMode, minWaitTime1, maxWaitTime1, minWaitTime2, maxWaitTime2 } = params;
    crawlerUtil.log('[클린로직실행]');
    await page.bringToFront();

    const { totalScrollHeight, oneHalfScrollHeight } = await this._measurePageHeight(page, setting, isTestMode);
    await crawlerUtil.scrollBy(page, 'normal', oneHalfScrollHeight, 1, 'down');
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);

    crawlerUtil.log(`[1차 반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime1, maxWaitTime1);

    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);

    crawlerUtil.log(`[2차 반영] ${minWaitTime2}~${maxWaitTime2}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime2, maxWaitTime2);
  }

  async 정밀로직(params: {
    page: Page; url: string; setting: any; isTestMode: boolean;
    isMobile: boolean; minWaitTime1: number; maxWaitTime1: number;
    minWaitTime2: number; maxWaitTime2: number;
  }) {
    const { page, setting, isTestMode, isMobile, minWaitTime1, maxWaitTime1, minWaitTime2, maxWaitTime2 } = params;
    crawlerUtil.log('[정밀로직실행]');
    await page.bringToFront();

    await this._clickSmartStoreMoreButton(page);
    const { totalScrollHeight, oneHalfScrollHeight, oneThirdScrollHeight } = await this._measurePageHeight(page, setting, isTestMode);

    await this._clickProductMenuRandom({ page, isMobile, scrollHeight: oneThirdScrollHeight });
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);

    crawlerUtil.log(`[1차 반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime1, maxWaitTime1);

    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);

    crawlerUtil.log(`[2차 반영] ${minWaitTime2}~${maxWaitTime2}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime2, maxWaitTime2);
  }

  async 히든로직(params: {
    browser: Browser; page: Page; url: string; keyword: string;
    isTestMode: boolean; isMobile: boolean; setting: any;
    minWaitTime1: number; maxWaitTime1: number;
    minWaitTime2: number; maxWaitTime2: number;
  }) {
    const { page, keyword, setting, isTestMode, isMobile, minWaitTime1, maxWaitTime1, minWaitTime2, maxWaitTime2 } = params;
    crawlerUtil.log('[히든로직실행]');
    await page.bringToFront();

    await this._clickSmartStoreMoreButton(page);
    const { totalScrollHeight, oneHalfScrollHeight, oneThirdScrollHeight } = await this._measurePageHeight(page, setting, isTestMode);

    await crawlerUtil.키워드위치로포커스이동(page, keyword);
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);

    crawlerUtil.log(`[1차 반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime1, maxWaitTime1);

    await this._clickProductMenuRandom({ page, isMobile, scrollHeight: oneThirdScrollHeight });
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);

    crawlerUtil.log(`[2차 반영] ${minWaitTime2}~${maxWaitTime2}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime2, maxWaitTime2);
  }

  private async _measurePageHeight(page: Page, setting: any, isTestMode: boolean) {
    const { distance, delay } = crawlerUtil.getScrollValue(setting.scrollSpeed);
    await crawlerUtil.waitTillHTMLRendered(page, 5000);
    await crawlerUtil.scrollTo(page, 'top');
    await crawlerUtil.autoScroll(page, '', delay, isTestMode ? 1200 : distance);
    await crawlerUtil.waitTillHTMLRendered(page, 5000);
    await crawlerUtil.scrollTo(page, 'bottom');
    await crawlerUtil.scrollTo(page, 'top');
    const totalScrollHeight = Math.round(await page.evaluate(() => document.body.scrollHeight));
    const oneHalfScrollHeight = Math.round(totalScrollHeight / 2);
    const oneThirdScrollHeight = Math.round(totalScrollHeight / 3);
    crawlerUtil.log(`[페이지 높이 측정 완료] 전체: ${totalScrollHeight}px`);
    return { totalScrollHeight, oneHalfScrollHeight, oneThirdScrollHeight };
  }

  private async _clickProductMenuRandom({ page, isMobile, scrollHeight }: { page: Page; isMobile: boolean; scrollHeight: number }) {
    const menuSelector = isMobile
      ? '#_productTabContainer li[role*=presentation] a'
      : '#_productTabContainer *[role*="menubar"] li';
    const menuItems = shuffle(await page.$$(menuSelector));
    for (const menuItem of menuItems) {
      const menuItemText = await menuItem.evaluate((elem: any) => elem.innerText);
      await crawlerUtil.scrollBy(page, 'normal', scrollHeight, 1, 'down');
      crawlerUtil.log(`스마트스토어 ${menuItemText} 메뉴 클릭`);
      await menuItem.focus();
      await menuItem.click().catch(console.error);
      await crawlerUtil.delay(500);
    }
  }

  private async _clickSmartStoreMoreButton(page: Page) {
    try {
      const isSmartStore = page.url()?.includes('smartstore.naver.com');
      if (isSmartStore) {
        const moreButtonSelector = 'button[data-shp-area="detailitm.more"]';
        await page.waitForSelector(moreButtonSelector, { timeout: 3000 });
        await crawlerUtil.focus(page, moreButtonSelector);
        await page.click(moreButtonSelector);
        crawlerUtil.log('상세페이지 펼쳐보기 버튼을 눌렀습니다.');
      }
    } catch {
      // 더보기 버튼 없으면 무시
    }
  }
}

export const knowledgeService = new KnowledgeService();
