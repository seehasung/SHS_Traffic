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
      if (fakeInput) await fakeInput.click();
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

      // page.evaluate로 XPath + CSS 셀렉터 모두 사용하여 링크 정보 추출 ($x 미지원 대비)
      const results: { href: string; title: string; index: number }[] = await page.evaluate((mobile: boolean) => {
        const cssSelector = mobile
          ? '.sds-comps-text-type-headline1 a, a .sds-comps-text-type-headline1'
          : 'a:has(span.sds-comps-text-type-headline1), a span.sds-comps-text-type-headline1';
        let anchors: HTMLAnchorElement[] = [];
        // CSS 방식 먼저 시도
        const elems = document.querySelectorAll(cssSelector);
        elems.forEach((el) => {
          const a = el.tagName === 'A' ? el as HTMLAnchorElement : el.closest('a') as HTMLAnchorElement;
          if (a && !anchors.includes(a)) anchors.push(a);
        });
        // 실패 시 모든 검색결과 링크를 수집
        if (anchors.length === 0) {
          const allLinks = document.querySelectorAll('.lst_total .bx a.total_tit, .api_txt_lines a.api_txt_lines, .total_wrap a, .sp_website a') as NodeListOf<HTMLAnchorElement>;
          allLinks.forEach((a) => { if (!anchors.includes(a)) anchors.push(a); });
        }
        // 그래도 없으면 결과 영역의 모든 a 태그
        if (anchors.length === 0) {
          const genericLinks = document.querySelectorAll('#main_pack a[href], .content_root a[href]') as NodeListOf<HTMLAnchorElement>;
          genericLinks.forEach((a) => {
            if (a.href && !a.href.includes('naver.com/search') && !anchors.includes(a)) {
              anchors.push(a);
            }
          });
        }
        return anchors.map((a, idx) => ({
          href: a.href || '',
          title: (a.innerText || '').trim(),
          index: idx,
        }));
      }, isMobile);

      crawlerUtil.log(
        `[${pagesScanned}/${MAX_PAGES}페이지] 검색 결과 ${results.length}개 발견, "${siteUrl}" 매칭 검색 중`,
      );

      const target = siteUrl.trim();
      for (let j = 0; j < results.length; j++) {
        const { href, title } = results[j];
        // URL 매칭 또는 제목 매칭 — 입력값이 URL이면 href에서, 제목이면 title에서 찾음
        const hrefMatch = href?.trim().includes(target);
        const titleMatch = title?.trim().includes(target);
        if (hrefMatch || titleMatch) {
          crawlerUtil.log(`포스트를 찾았습니다! ${hrefMatch ? `URL: "${href.trim()}"` : `제목: "${title}"`}`);
          if (isMobile) {
            await crawlerUtil.delay(1000);
            await page.$eval('#_sch', (elem: any) => elem.setAttribute('hidden', 'true')).catch(() => {});
            await crawlerUtil.delay(1000);
          }
          // 해당 링크 요소를 다시 찾아서 클릭
          const linkElem = await page.evaluateHandle((idx: number, mobile: boolean) => {
            const cssSelector = mobile
              ? '.sds-comps-text-type-headline1 a, a .sds-comps-text-type-headline1'
              : 'a:has(span.sds-comps-text-type-headline1), a span.sds-comps-text-type-headline1';
            let anchors: HTMLAnchorElement[] = [];
            const elems = document.querySelectorAll(cssSelector);
            elems.forEach((el) => {
              const a = el.tagName === 'A' ? el as HTMLAnchorElement : el.closest('a') as HTMLAnchorElement;
              if (a && !anchors.includes(a)) anchors.push(a);
            });
            if (anchors.length === 0) {
              const allLinks = document.querySelectorAll('.lst_total .bx a.total_tit, .api_txt_lines a.api_txt_lines, .total_wrap a, .sp_website a') as NodeListOf<HTMLAnchorElement>;
              allLinks.forEach((a) => { if (!anchors.includes(a)) anchors.push(a); });
            }
            if (anchors.length === 0) {
              const genericLinks = document.querySelectorAll('#main_pack a[href], .content_root a[href]') as NodeListOf<HTMLAnchorElement>;
              genericLinks.forEach((a) => {
                if (a.href && !a.href.includes('naver.com/search') && !anchors.includes(a)) anchors.push(a);
              });
            }
            return anchors[idx] ?? null;
          }, j, isMobile);

          const postPage = await crawlerUtil.getNewPageByClick({
            browser,
            page,
            linkElement: linkElem as ElementHandle<Element>,
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
