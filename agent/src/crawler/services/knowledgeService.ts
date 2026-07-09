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
      const fakeSearchInput = await page.$('#MM_SEARCH_FAKE');
      if (fakeSearchInput) await fakeSearchInput.click();
      await page.waitForSelector('header #query', { visible: true }).catch(() => {});
      await page.type('header #query', keyword, { delay: 100 });
      await crawlerUtil.delay(500);
      await page.keyboard.press('Enter');
      await crawlerUtil.waitTillHTMLRendered(page);
    } else {
      await page.type('input[name="query"]', keyword, { delay: 100 });
      const searchBtn = await page.$('#search-btn');
      await crawlerUtil.clickByElemHandle(page, searchBtn);
    }
  }

  private async _searchResultKeyword(page: Page, keyword: string) {
    crawlerUtil.log(`"${keyword}" 검색`);
    const searchInput = await page.$('[class*="searchInput_has_keyword"] input,#input_text');
    await crawlerUtil.clickByElemHandle(page, searchInput);
    await crawlerUtil.waitRandom(page, 1, 2);
    await crawlerUtil.clickByElemHandle(page, searchInput);
    await page.type('[class*="searchInput_has_keyword"] input,#input_text', keyword, { delay: 100 });
    await page.keyboard.press('Enter');
    await crawlerUtil.waitRandom(page, 1, 2);
    await crawlerUtil.clickByElemHandle(page, searchInput);
  }

  async extractProductRankByElementHandle(elementHandle: ElementHandle<Element> | null): Promise<string> {
    if (!elementHandle) return '';
    return await elementHandle.evaluate((el: any) => {
      const dataRank = el.getAttribute('data-shp-contents-rank');
      if (dataRank) {
        const matches = dataRank.match(/\d+/g);
        if (matches) return matches[0];
      }
      return '';
    });
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
        // adProduct 가 클래스명에 포함되면 광고 상품 (adProduct_item__XXXXX)
        const className = el.className || '';
        if (/adProduct/i.test(className)) return true;

        // 부모 중 adProduct 클래스가 포함된 요소가 있으면 광고
        const closestAd = el.closest('[class*="adProduct"]');
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
    const targetId = String(targetProductId).trim();

    for (let i = 0; i < items?.length; i++) {
      const itemElement = items[i];

      // 광고 상품 (adProduct 클래스) 제외
      const isAd = await this.isAdvertiseProduct(itemElement);
      if (isAd && !isIncludeAds) {
        continue;
      }

      // 0순위: 모바일 id 속성으로 매칭 (예: id="_sr_lst_89498698283")
      const elemId = await itemElement.evaluate((el: any) => el.id || '');
      if (elemId && elemId.includes(targetId)) {
        const linkEl = await itemElement.$('a[data-shp-contents-id]') || await itemElement.$('a[href]');
        if (linkEl) {
          const rank = await itemElement.evaluate((el: any) => {
            const a = el.querySelector('[data-shp-contents-rank]');
            return a ? Number(a.getAttribute('data-shp-contents-rank')) : null;
          });
          crawlerUtil.log(`상품번호 "${targetId}" 발견 (${i + 1}번째 아이템, 모바일 ID 매칭)`);
          await linkEl.evaluate((x: any) => x.setAttribute('target', '_blank'));
          return { itemLinkElement: linkEl, itemElement, itemTotalCount: items?.length, itemIndex: i + 1, rankPosition: rank ?? (i + 1) };
        }
      }

      // 1순위: data-ap-skuid 속성으로 매칭 (가장 정확)
      const skuId = await itemElement.evaluate((el: any) => el.getAttribute('data-ap-skuid') || '');
      if (String(skuId).trim() === targetId) {
        // data-ap-index-ori 에서 순위 추출
        const oriIndex = await itemElement.evaluate((el: any) => {
          const idx = el.getAttribute('data-ap-index-ori');
          return idx != null ? Number(idx) + 1 : null;
        });
        const rankInfo = oriIndex != null ? ` (노출순위: ${oriIndex}위)` : '';

        // 클릭 가능한 링크 찾기
        let foundLink: ElementHandle<Element> | null = null;
        const titleLink = await itemElement.$('a[class*="product_link"], a[class*="thumbnail_thumb"]');
        if (titleLink) {
          foundLink = titleLink;
        } else {
          const idLinks = await itemElement.$$('[data-shp-contents-id]');
          for (const link of idLinks) {
            const contentId = await link.evaluate((el: any) => el.getAttribute('data-shp-contents-id') || '');
            if (String(contentId).trim() === targetId) {
              foundLink = link;
              break;
            }
          }
        }
        if (!foundLink) {
          const fallbackLink = await itemElement.$('a[href]');
          if (fallbackLink) foundLink = fallbackLink;
        }

        if (foundLink) {
          crawlerUtil.log(`상품번호 "${targetId}" 발견 (${i + 1}번째 아이템)${rankInfo}`);
          await foundLink.evaluate((x: any) => x.setAttribute('target', '_blank'));
          return { itemLinkElement: foundLink, itemElement, itemTotalCount: items?.length, itemIndex: i + 1, rankPosition: oriIndex ?? (i + 1) };
        }
      }

      // 2순위: data-shp-contents-id 속성으로 매칭 (폴백)
      const idLinks = await itemElement.$$(`[data-shp-contents-id="${targetId}"]`);
      if (idLinks.length > 0) {
        const foundLink = idLinks[0];
        const oriIdx = await itemElement.evaluate((el: any) => {
          const idx = el.getAttribute('data-ap-index-ori');
          return idx != null ? Number(idx) + 1 : null;
        });
        crawlerUtil.log(`상품번호 "${targetId}" 발견 (${i + 1}번째 아이템, contents-id 매칭)`);
        await foundLink.evaluate((x: any) => x.setAttribute('target', '_blank'));
        return { itemLinkElement: foundLink, itemElement, itemTotalCount: items?.length, itemIndex: i + 1, rankPosition: oriIdx ?? (i + 1) };
      }

      // 3순위: 링크 href에 상품번호가 포함된 경우 (모바일 폴백)
      const allLinks = await itemElement.$$('a[href]');
      for (const link of allLinks) {
        const href = await link.evaluate((el: any) => el.href || '');
        if (href.includes(targetId)) {
          crawlerUtil.log(`상품번호 "${targetId}" 발견 (${i + 1}번째 아이템, href 매칭)`);
          await link.evaluate((x: any) => x.setAttribute('target', '_blank'));
          return { itemLinkElement: link, itemElement, itemTotalCount: items?.length, itemIndex: i + 1, rankPosition: i + 1 };
        }
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
      await crawlerUtil.waitRandom(page, 0, 1);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await crawlerUtil.delay(500);

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

  private async _handleServiceUnavailable(
    browser: Browser, page: Page, shoppingResultPage: Page,
    itemLinkElement: ElementHandle<Element>,
  ): Promise<Page | undefined> {
    let purchaseDetailPage: Page | undefined = page;

    if (!purchaseDetailPage?.url().includes('cr.shopping.naver.')) {
      await crawlerUtil.log('자사몰 스토어로 이동중입니다. 추가 대기하겠습니다.');
      await crawlerUtil.waitRandom(purchaseDetailPage!, 3, 5);
    }

    await crawlerUtil.scrollBy(purchaseDetailPage!, 'normal', 50, 1, 'down');

    const isServiceUnavailable = await purchaseDetailPage?.evaluate(
      () => document.body.innerText.includes('현재 서비스 접속이 불가합니다')
    ).catch(() => false);

    if (isServiceUnavailable) {
      await crawlerUtil.log('서비스 접속이 불가합니다. 페이지 닫기 후 재접속하겠습니다.');
      await purchaseDetailPage?.close();
      await shoppingResultPage?.bringToFront();
      purchaseDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage, linkElement: itemLinkElement });
    }

    const isProductNotExist = await purchaseDetailPage?.evaluate(
      () => document.body.innerText.includes('상품이 존재하지 않습니다')
    ).catch(() => false);

    if (isProductNotExist) {
      await crawlerUtil.log('상품 미존재 메시지가 발생했습니다. 캐시 무시 후 새로고침합니다.');
      await purchaseDetailPage!.setCacheEnabled(false);
      await purchaseDetailPage!.reload({ waitUntil: ['networkidle0'] as any });
      await purchaseDetailPage!.setCacheEnabled(true);
      await crawlerUtil.waitTillHTMLRendered(purchaseDetailPage!);
    }

    return purchaseDetailPage;
  }

  private async _findPurchaseItemByMobile(
    browser: Browser, shoppingDetailPage: Page, purchaseName: string, setting: any,
  ): Promise<{ shoppingDetailPage?: Page; purchaseDetailPage?: Page; totalShoppingDetailPage?: Page } | null> {
    crawlerUtil.log('판매처 찾기를 시작합니다.');
    await crawlerUtil.autoScroll(shoppingDetailPage, '', 200, 1200);
    await crawlerUtil.waitRandom(shoppingDetailPage, 4, 8);

    let isExistMoreBtn = false;
    const moreButtonSelector = 'a[class*=main_link_more__]';
    try {
      const moreButton = await shoppingDetailPage.waitForSelector(moreButtonSelector, { timeout: 3000 });
      isExistMoreBtn = !isEmpty(moreButton);
    } catch {
      isExistMoreBtn = false;
    }

    if (!isExistMoreBtn) {
      crawlerUtil.log('더보기 버튼이 없는 CASE');
      const linkSelector = '*[class*=productPerMall_link_seller__]';
      await shoppingDetailPage.waitForSelector(linkSelector).catch(() => {});
      const productNumbers = await this.extractProductNumbersBySelector(shoppingDetailPage, linkSelector);
      const linkIndex = productNumbers?.findIndex(x => x == purchaseName);
      const linkElemHandles = await shoppingDetailPage.$$(linkSelector);

      if (linkIndex === -1) {
        crawlerUtil.log(`총 상품 ${linkElemHandles.length}개 중 판매처 "${purchaseName}"를 찾지 못했습니다.`);
        return null;
      }

      const linkElemHandle = linkElemHandles[linkIndex];
      if (!linkElemHandle) {
        crawlerUtil.log(`총 상품 ${linkElemHandles.length}개 중 ${linkIndex}번째 항목의 판매처 "${purchaseName}"에 대한 링크를 찾지 못했습니다.`);
      }

      const purchaseDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingDetailPage, linkElement: linkElemHandle });
      if (!purchaseDetailPage) crawlerUtil.log('판매처 상세 페이지를 얻지 못했습니다.');
      await purchaseDetailPage?.bringToFront();
      await crawlerUtil.wait(shoppingDetailPage, 3);
      return { shoppingDetailPage, purchaseDetailPage };
    }

    crawlerUtil.log('더보기 버튼이 있는 CASE');
    const totalShoppingDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingDetailPage, selector: moreButtonSelector, setting });
    if (!totalShoppingDetailPage) throw new Error('전체 판매처 목록 페이지로 이동하지 못했습니다.');
    console.log('판매처 전체 목록 페이지로 진입 완료: ' + await totalShoppingDetailPage.url());

    await crawlerUtil.waitRandom(totalShoppingDetailPage, 1, 3);
    await crawlerUtil.autoScroll(totalShoppingDetailPage, '', 300, 800);
    await crawlerUtil.waitRandom(totalShoppingDetailPage, 4, 8);

    const linkSelector = 'a[class*=productContent_link_seller__]';
    const productNumbers = await this.extractProductNumbersBySelector(totalShoppingDetailPage, linkSelector);
    const linkIndex = productNumbers?.findIndex(x => x == purchaseName);
    const linkElemHandles = await totalShoppingDetailPage.$$(linkSelector);

    if (linkIndex === -1) {
      crawlerUtil.log(`총 상품 ${linkElemHandles.length}개 중 판매처 "${purchaseName}"를 찾지 못했습니다.`);
      return null;
    }

    const linkElemHandle = linkElemHandles[linkIndex];
    const purchaseDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: totalShoppingDetailPage, linkElement: linkElemHandle });
    await purchaseDetailPage?.bringToFront();
    await crawlerUtil.wait(totalShoppingDetailPage, 3);
    return { totalShoppingDetailPage, purchaseDetailPage };
  }

  async findPages(
    browser: Browser, page: Page, userMe: any, setting: any,
    keyword: string, itemName: string, purchaseName?: string,
  ): Promise<{
    shoppingResultPage?: Page; shoppingDetailPage?: Page;
    purchaseDetailPage?: Page; totalShoppingDetailPage?: Page;
    failed?: { pagesScanned: number; reason: string };
    rankInfo?: { pageNumber: number; rankPosition: number };
  }> {
    let isPc = setting.pageType === 'pc';
    let isMobile = setting.pageType === 'mobile';
    const url = isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN;
    const isPlus = setting.storeType === 'plus';
    const isSpecial = setting.storeType === 'special';
    let searchKeyword = isSpecial ? '네이버 가격비교' : keyword;

    try {
      await crawlerUtil.goto(page, url);
      await this._searchKeyword(page, searchKeyword, setting);
    } catch (e) {
      console.error(e);
    }

    await crawlerUtil.waitRandom(page, 1, 2);

    let shoppingTabSelector = isPc
      ? 'a[role=tab][href*="search.shopping.naver.com/search"]'
      : 'a[role=tab][href*="msearch.shopping.naver.com/search"]';
    if (isSpecial) {
      shoppingTabSelector = '.sds-comps-text';
    }

    await page.waitForSelector(shoppingTabSelector).catch(() => {});
    const shoppingTabElement = await page.$(shoppingTabSelector);
    if (!shoppingTabElement) throw new Error('쇼핑탭을 찾지 못했습니다.');

    let shoppingResultPage = await crawlerUtil.getNewPageByClick({ browser, page, linkElement: shoppingTabElement });
    if (isEmpty(shoppingResultPage)) return {};

    // 스페셜(가격비교) 전용: 결과 페이지 내에서 실제 키워드로 재검색
    if (isSpecial) {
      try {
        await this._searchResultKeyword(shoppingResultPage!, keyword);
        await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);
      } catch (e) {
        console.error(e);
      }
    }

    await crawlerUtil.log('검색 결과 페이지 URL: ' + shoppingResultPage!.url());
    if (!shoppingResultPage!.url().includes('msearch')) { isPc = true; isMobile = false; }

    await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);
    const pageContent = await shoppingResultPage!.content();

    if (isPc) {
      await shoppingResultPage!.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      await crawlerUtil.log('새로고침하고 계속 진행하겠습니다.');
      await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);
    }

    const isNonSearched = pageContent.includes('검색 결과가 없습니다.');
    if (isNonSearched) {
      await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);
      await shoppingResultPage!.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      crawlerUtil.log('검색결과 미노출 에러입니다. 새로고침을 1회 더 진행하겠습니다.');
    }

    // 일시적 제한 처리
    const isLimit = pageContent.includes('일시적으로 제한');
    if (isLimit) {
      await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);
      await crawlerUtil.log('페이지 일시적 제한입니다. 대기 후 진행합니다.');
      await shoppingResultPage!.reload({ waitUntil: 'networkidle2', timeout: 60000 * 5 });
      await page.bringToFront();
      await crawlerUtil.autoScroll(page, '', 200, 200, 3000).catch(console.error);
      shoppingResultPage = await crawlerUtil.getNewPageByClick({ browser, page, linkElement: shoppingTabElement });
      await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);
    }

    let shoppingDetailPage: Page | undefined;
    let purchaseDetailPage: Page | undefined;
    let totalShoppingDetailPage: Page | undefined;

    // ============================================================
    // 플러스스토어 전용 흐름: 쇼핑 결과에서 N+스토어 버튼 클릭 → 무한 스크롤
    // ============================================================
    if (isPlus) {
      await crawlerUtil.log('플러스스토어 검색으로 진입합니다. N+스토어 검색에서 더보기 버튼을 찾습니다.');

      // N+스토어 "검색에서 더보기" 버튼 찾기
      const plusStoreSelectors = [
        'a[class*="_gnbContent_link_search"]',
        'a[href*="search.shopping.naver.com/ns/search"]',
        'a[href*="msearch.shopping.naver.com/ns/search"]',
      ];

      let plusStoreLink: ElementHandle<Element> | null = null;
      for (const sel of plusStoreSelectors) {
        plusStoreLink = await shoppingResultPage!.$(sel);
        if (plusStoreLink) {
          crawlerUtil.log(`N+스토어 버튼 발견 (셀렉터: ${sel})`);
          break;
        }
      }

      if (!plusStoreLink) {
        crawlerUtil.log('N+스토어 검색에서 더보기 버튼을 찾지 못했습니다. 일반 검색으로 진행합니다.');
      } else {
        // N+스토어 페이지로 이동
        let plusStorePage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage!, linkElement: plusStoreLink });
        if (!plusStorePage) {
          await plusStoreLink.click();
          await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);
          plusStorePage = shoppingResultPage!;
        }
        await crawlerUtil.waitTillHTMLRendered(plusStorePage);
        await crawlerUtil.log('N+스토어 검색 결과 페이지 URL: ' + plusStorePage.url());

        const plusMaxScroll = Number(setting.plusMaxScroll) || 20;
        crawlerUtil.log(`N+스토어에서 최대 ${plusMaxScroll}회 스크롤하여 상품을 찾겠습니다.`);
        for (let i = 0; i < plusMaxScroll; i++) {
          await crawlerUtil.autoScroll(plusStorePage, '', 200, 200, 3000).catch(console.error);

          const itemsSelector = '*[class*=basicProductCard_basic_product_card]';
          const items = await plusStorePage.$$(itemsSelector);
          const findResult = await this.findTargetInProductList(items, isMobile, itemName, setting?.isIncludeAds === 'Y', isPlus);
          const { itemLinkElement, itemElement } = findResult;
          const isFoundTarget = !isEmpty(itemElement);

          if (!isFoundTarget) {
            crawlerUtil.log('플러스 스토어에서 상품을 찾지 못하여 계속 스크롤하겠습니다.');
            continue;
          }

          if (isFoundTarget && !purchaseName) {
            const itemRank = await this.extractProductRankByElementHandle(itemLinkElement);
            crawlerUtil.log(`[플러스 스토어에서 타겟상품을 찾았습니다.] ${itemRank}번째 상품입니다.`);
            await crawlerUtil.waitRandom(plusStorePage, 10, 13);
            purchaseDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: plusStorePage, linkElement: itemLinkElement });
            await purchaseDetailPage?.bringToFront();
            await crawlerUtil.waitTillHTMLRendered(purchaseDetailPage!);

            purchaseDetailPage = await this._handleServiceUnavailable(browser, page, plusStorePage, itemLinkElement);
            return { shoppingResultPage, purchaseDetailPage };
          }
        }
        return { shoppingResultPage };
      }
    }

    // ============================================================
    // 일반 흐름 (non-plus): 페이지네이션
    // ============================================================
    const MAX_PAGES = Number(setting.maxPages) || 100;
    let pagesScanned = 0;
    let failReason: string | null = null;

    for (let i = 0; i < MAX_PAGES; i++) {
      pagesScanned = i + 1;
      await crawlerUtil.waitRandom(shoppingResultPage!, 5, 10).catch(console.error);
      await crawlerUtil.autoScroll(shoppingResultPage!, '', 200, 200).catch(console.error);
      await crawlerUtil.waitTillHTMLRendered(shoppingResultPage!);

      const pcSelector = '*[class*=basicList_list_basis] > div > div';
      const mobileSelectors = [
        'div[class*=product_list_item]',
        'div[id^=_sr_lst_]',
        '*[class*=product_list] > li',
        '*[class*=productList] > li',
      ];

      let items: ElementHandle<Element>[] = await shoppingResultPage!.$$(pcSelector);
      if (items.length === 0 && isMobile) {
        for (const sel of mobileSelectors) {
          items = await shoppingResultPage!.$$(sel);
          if (items.length > 0) {
            crawlerUtil.log(`[모바일] 셀렉터 "${sel}"로 아이템 발견`);
            break;
          }
        }
        if (items.length === 0) {
          items = await shoppingResultPage!.$$('[data-ap-skuid]');
          if (items.length === 0) {
            const allItems = await shoppingResultPage!.$$('li, div[class*=product]');
            const skuItems: ElementHandle<Element>[] = [];
            for (const el of allItems) {
              const hasId = await el.evaluate((e: any) =>
                e.getAttribute('data-ap-skuid') || e.querySelector('[data-shp-contents-id]') != null
              );
              if (hasId) skuItems.push(el);
            }
            items = skuItems;
          }
        }
      }

      crawlerUtil.log(`[${i + 1}/${MAX_PAGES}페이지] 검색 결과 아이템 ${items.length}개 발견, 상품번호 "${itemName}" 검색 중`);
      const findResult = await this.findTargetInProductList(items, isMobile, itemName, setting?.isIncludeAds === 'Y', isPlus);
      const { itemLinkElement, itemElement, itemTotalCount, itemIndex } = findResult;

      const isFoundTarget = !isEmpty(itemElement);

      if (!isFoundTarget) {
        crawlerUtil.log('상품을 찾지 못해서 다음 페이지로 넘어가겠습니다.');
        try {
          await this._clickNextPageInShoppingResultPage(shoppingResultPage!, setting);
        } catch {
          crawlerUtil.log('더 이상 다음 페이지가 없습니다. 다음 상품으로 넘어갑니다.');
          failReason = `${pagesScanned}페이지에서 다음 페이지 없음`;
          break;
        }
        continue;
      }

      const rankInfo = isFoundTarget ? { pageNumber: i + 1, rankPosition: findResult.rankPosition ?? itemIndex } : undefined;

      // 타겟 찾음 & 판매처 없음
      if (isFoundTarget && !purchaseName) {
        crawlerUtil.log(`[타겟상품을 찾았습니다.] ${i + 1}번 페이지의 ${itemTotalCount}개의 상품 중 ${itemIndex}번째 상품입니다.`);
        await crawlerUtil.waitRandom(shoppingResultPage!, 10, 13);
        purchaseDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage!, linkElement: itemLinkElement });
        await purchaseDetailPage?.bringToFront();
        await crawlerUtil.waitTillHTMLRendered(purchaseDetailPage!);

        purchaseDetailPage = await this._handleServiceUnavailable(browser, page, shoppingResultPage!, itemLinkElement);
        return { shoppingResultPage, purchaseDetailPage, rankInfo };
      }

      // 타겟 찾음 & 판매처 있음
      if (isFoundTarget && purchaseName) {
        crawlerUtil.log(`[타겟상품을 찾았습니다.] ${i + 1}번 페이지의 ${itemTotalCount}개의 상품 중 ${itemIndex}번째 상품입니다.`);
        await crawlerUtil.waitRandom(shoppingResultPage!, 10, 13);

        try {
          if (userMe.logicType === 'clean' || userMe.logicType === 'hidden') {
            shoppingDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage!, linkElement: itemLinkElement });
          }
          if (userMe.logicType === 'detail') {
            const thumbnailSelector = isPc ? 'a[class^=thumbnail_thumb__]' : '*[class*=_img_area__] img';
            const thumbnailElement = await itemElement?.$(thumbnailSelector);
            shoppingDetailPage = await crawlerUtil.getNewPageByClick({ browser, page: shoppingResultPage!, linkElement: thumbnailElement });
          }

          if (isPc && shoppingDetailPage) {
            await crawlerUtil.log('쇼핑 상세 페이지: ' + await shoppingDetailPage.url());
            purchaseDetailPage = await this._findPurchaseItemByPc(browser, shoppingDetailPage, purchaseName, setting) || undefined;
            if (!purchaseDetailPage) crawlerUtil.log('판매처 상세페이지를 찾지 못했습니다.');

            if (purchaseDetailPage) {
              await purchaseDetailPage.bringToFront();

              if (!purchaseDetailPage.url().includes('cr.shopping.naver.')) {
                await crawlerUtil.log('자사몰 스토어로 이동중입니다. 추가 대기하겠습니다.');
                await crawlerUtil.waitRandom(purchaseDetailPage, 5, 10);
              }

              await crawlerUtil.waitTillHTMLRendered(purchaseDetailPage);
              await crawlerUtil.scrollBy(purchaseDetailPage, 'normal', 50, 1, 'down');

              const isServiceUnavailable = await purchaseDetailPage.evaluate(
                () => document.body.innerText.includes('현재 서비스 접속이 불가합니다')
              ).catch(() => false);
              if (isServiceUnavailable) {
                await crawlerUtil.log('서비스 접속이 불가합니다. 페이지 닫기 후 재접속하겠습니다.');
                await purchaseDetailPage.close();
                await shoppingDetailPage?.bringToFront();
                purchaseDetailPage = await this._findPurchaseItemByPc(browser, shoppingDetailPage!, purchaseName, setting) || undefined;
              }

              const isProductNotExist = await purchaseDetailPage?.evaluate(
                () => document.body.innerText.includes('상품이 존재하지 않습니다')
              ).catch(() => false);
              if (isProductNotExist) {
                await crawlerUtil.log('상품 미존재 메시지가 발생했습니다. 캐시 무시 후 새로고침합니다.');
                await purchaseDetailPage!.setCacheEnabled(false);
                await purchaseDetailPage!.reload({ waitUntil: ['networkidle0'] as any });
                await purchaseDetailPage!.setCacheEnabled(true);
                await crawlerUtil.waitTillHTMLRendered(purchaseDetailPage!);
              }
            }

            return { shoppingResultPage, shoppingDetailPage, purchaseDetailPage, rankInfo };
          }

          if (isMobile && shoppingDetailPage) {
            const mobilePages = await this._findPurchaseItemByMobile(browser, shoppingDetailPage, purchaseName, setting);
            purchaseDetailPage = mobilePages?.purchaseDetailPage;
            totalShoppingDetailPage = mobilePages?.totalShoppingDetailPage;
            return { shoppingResultPage, shoppingDetailPage, purchaseDetailPage, totalShoppingDetailPage, rankInfo };
          }

          if (!isPc && !isMobile) {
            throw new Error('판매처가 입력 되었으나, 페이지 세팅값(PC/MOBILE)이 제대로 설정되어 있지 않습니다.');
          }
        } catch (e) {
          console.error(e);
        }
        throw new Error('판매처 이름이 올바르게 입력되지 않아서 작동을 중지합니다.');
      }
    }

    return {
      shoppingResultPage,
      failed: { pagesScanned, reason: failReason ?? '상품을 찾지 못함' },
    };
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
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 2, 3);

    crawlerUtil.log(`[1차 반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime1, maxWaitTime1);

    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 2, 3);

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
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 2, 3);

    crawlerUtil.log(`[1차 반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime1, maxWaitTime1);

    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 2, 3);

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
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 2, 3);

    crawlerUtil.log(`[1차 반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류`);
    await crawlerUtil.waitRandom(page, minWaitTime1, maxWaitTime1);

    await this._clickProductMenuRandom({ page, isMobile, scrollHeight: oneThirdScrollHeight });
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 2, 3);

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
