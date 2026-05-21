import type { Browser, Page, ElementHandle } from 'puppeteer-core';
import { crawlerUtil } from '../utils/crawlerUtil';
import { NAVER_URL } from '../constants/urls';

const MAX_PAGES = 10;

class BlogService {
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
      const fakeInput = await page.$('#MM_SEARCH_FAKE');
      fakeInput?.click();
      await page.waitForSelector('header #query', { visible: true }).catch(() => {});
      await page.type('header #query', keyword, { delay: 100 });
      const searchBtn = await page.$('.sch_btn_search');
      await crawlerUtil.clickByElemHandle(page, searchBtn);
    } else {
      await page.type('input[name="query"]', keyword, { delay: 100 });
      const searchBtn = await page.$('#search-btn');
      await crawlerUtil.clickByElemHandle(page, searchBtn);
    }
  }

  private async _clickViewMore(page: Page) {
    const elem = await page.$('a[href*="nso=&page=2"]');
    if (!elem) return crawlerUtil.log('사이트 더보기 클릭 실패');
    await crawlerUtil.clickByElemHandle(page, elem);
  }

  private async _findPost({
    browser,
    page,
    siteUrl,
    setting,
  }: {
    browser: Browser;
    page: Page;
    siteUrl: string;
    setting: any;
  }): Promise<{ postPage: Page | null; failed?: { pagesScanned: number; reason: string } }> {
    const isMobile = setting.pageType === 'mobile';
    let pagesScanned = 0;

    for (let i = 2; i < 2 + MAX_PAGES; i++) {
      pagesScanned++;
      await crawlerUtil.waitTillHTMLRendered(page, 5000);
      await crawlerUtil.autoScroll(page, '', 250, 1200);
      await crawlerUtil.waitTillHTMLRendered(page, 5000);

      const linkXpath = isMobile
        ? '//*[contains(@class, "sds-comps-text-type-headline1")]//a'
        : '//span[contains(@class, "sds-comps-text-type-headline1")]/ancestor::a[1]';

      const elemHandles = (await (page as any).$x(linkXpath)) as ElementHandle<Element>[];
      const results = await Promise.all(
        elemHandles.map((el) =>
          el.evaluate((a: any) => ({
            href: a.href || '',
            title: (a.innerText || '').trim(),
          })),
        ),
      );

      crawlerUtil.log(
        `[${pagesScanned}/${MAX_PAGES}페이지] 검색 결과 ${results.length}개 발견, "${siteUrl}" 매칭 검색 중`,
      );

      for (let j = 0; j < results.length; j++) {
        const { href, title } = results[j];
        const found =
          href?.trim().includes(siteUrl?.trim()) ||
          title?.trim().includes(siteUrl?.trim());
        if (found) {
          crawlerUtil.log(`포스트를 찾았습니다. 주소: "${href.trim()}"`);
          if (isMobile) {
            await crawlerUtil.delay(1000);
            await page.$eval('#_sch', (elem: any) => elem.setAttribute('hidden', 'true')).catch(() => {});
            await crawlerUtil.delay(1000);
          }
          const postPage = await crawlerUtil.getNewPageByClick({
            browser,
            page,
            linkElement: elemHandles[j],
          });
          return { postPage: postPage ?? null };
        }
      }

      if (isMobile) {
        await crawlerUtil.waitRandom(page, 2, 3);
      }

      const nextSelector = isMobile
        ? '.sp_page .pgn.now~a'
        : '.sc_page_inner a[aria-pressed="true"]~a';
      const nextBtn = await page.$(nextSelector);
      if (!nextBtn) {
        crawlerUtil.log('더 이상 다음 페이지가 없습니다. 포스트를 찾지 못했습니다.');
        return {
          postPage: null,
          failed: { pagesScanned, reason: `${pagesScanned}페이지에서 다음 페이지 없음` },
        };
      }
      await crawlerUtil.clickByElemHandle(page, nextBtn);
    }

    crawlerUtil.log(`${MAX_PAGES}페이지까지 포스트를 찾지 못했습니다. 다음 키워드로 넘어갑니다.`);
    return {
      postPage: null,
      failed: { pagesScanned, reason: `${MAX_PAGES}페이지까지 포스트를 찾지 못함` },
    };
  }

  async findBlog(
    browser: Browser,
    page: Page,
    setting: any,
    keyword: string,
    siteUrl: string,
  ): Promise<{ postPage: Page | null; failed?: { pagesScanned: number; reason: string } }> {
    const isMobile = setting.pageType === 'mobile';
    const url = isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN;

    await crawlerUtil.goto(page, url);
    await this._searchKeyword(page, keyword, setting);

    if (isMobile) {
      await crawlerUtil.waitRandom(page, 2, 3);
    } else {
      await crawlerUtil.wait(page, 1);
    }

    await this._clickViewMore(page);

    if (isMobile) {
      await crawlerUtil.waitRandom(page, 2, 3);
    }

    return this._findPost({ browser, page, siteUrl, setting });
  }
}

export const blogService = new BlogService();
