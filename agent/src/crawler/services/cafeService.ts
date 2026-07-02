import type { Browser, Page } from 'puppeteer-core';
import { random } from 'lodash';
import { crawlerUtil } from '../utils/crawlerUtil';
import { NAVER_URL } from '../constants/urls';

export interface CafeSearchResult {
  postPage: Page | null;
  rankPosition: number | null;
  found: boolean;
  failed?: { reason: string };
}

class CafeService {
  async findCafePost(
    browser: Browser,
    page: Page,
    settings: any,
    keyword: string,
    cafeName: string,
    postTitle: string,
    maxRank: number,
  ): Promise<CafeSearchResult> {
    const isMobile = settings.pageType === 'mobile';
    const url = isMobile ? NAVER_URL.MOBILE_MAIN : NAVER_URL.MAIN;

    await crawlerUtil.goto(page, url);
    await crawlerUtil.waitRandom(page, 1, 2);

    crawlerUtil.log(`카페 검색: "${keyword}" → 카페명="${cafeName}", 제목="${postTitle}"`);

    if (isMobile) {
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

    await crawlerUtil.waitRandom(page, 2, 4);
    await crawlerUtil.waitTillHTMLRendered(page, 5000);

    // 카페 탭 클릭
    const cafeTabClicked = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.flick_bx a, .tab_list a, a[role="tab"]');
      for (const tab of tabs) {
        const text = (tab as HTMLElement).textContent?.trim() ?? '';
        if (text === '카페' || text.includes('카페')) {
          (tab as HTMLElement).click();
          return true;
        }
      }
      const links = document.querySelectorAll('a[href*="where=article"], a[href*="cafe"]');
      for (const link of links) {
        const text = (link as HTMLElement).textContent?.trim() ?? '';
        if (text === '카페' || text.includes('카페')) {
          (link as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (!cafeTabClicked) {
      crawlerUtil.log('카페 탭을 찾지 못했습니다.');
      return { postPage: null, rankPosition: null, found: false, failed: { reason: '카페 탭을 찾지 못함' } };
    }

    await crawlerUtil.waitRandom(page, 2, 4);
    await crawlerUtil.waitTillHTMLRendered(page, 5000);

    // 무한 스크롤하며 카페명 + 제목 매칭
    let foundIndex = -1;
    let attempts = 0;
    const maxScrollAttempts = 30;

    while (foundIndex === -1 && attempts < maxScrollAttempts) {
      const result = await page.evaluate((cn: string, pt: string, mr: number) => {
        const items = document.querySelectorAll('.cafe_info, .sub_txt, .total_sub, .item_info, .api_txt_lines');
        const allResults: { cafeText: string; titleText: string; idx: number }[] = [];

        const resultBlocks = document.querySelectorAll('.lst_total .bx, .api_subject_bx, .cafe_list_wrap .item, [class*="cafetotal"] li, .search_list .item');
        let idx = 0;
        resultBlocks.forEach((block) => {
          idx++;
          const titleEl = block.querySelector('a.total_tit, a.api_txt_lines, .title_area a, a[class*="title"], .tit_area a');
          const cafeEl = block.querySelector('.cafe_name, .sub_txt .name, .cafe_info .name, .detail_box .name, [class*="cafe_name"]');
          const titleText = titleEl?.textContent?.trim() ?? '';
          const cafeText = cafeEl?.textContent?.trim() ?? '';
          allResults.push({ cafeText, titleText, idx });
        });

        if (allResults.length === 0) {
          const genericBlocks = document.querySelectorAll('#main_pack .sp_ntotal > li, .content_root li, .lst_view > li');
          genericBlocks.forEach((block) => {
            idx++;
            const titleEl = block.querySelector('a');
            const cafeEl = block.querySelector('.sub_txt, .info_area .name, span[class*="name"]');
            allResults.push({
              cafeText: cafeEl?.textContent?.trim() ?? '',
              titleText: titleEl?.textContent?.trim() ?? '',
              idx,
            });
          });
        }

        for (const item of allResults) {
          if (item.idx > mr) break;
          const cafeMatch = item.cafeText.includes(cn) || cn.includes(item.cafeText);
          const titleMatch = item.titleText.includes(pt) || pt.includes(item.titleText);
          if (cafeMatch && titleMatch) {
            return { foundIdx: item.idx, total: allResults.length };
          }
        }
        return { foundIdx: -1, total: allResults.length };
      }, cafeName, postTitle, maxRank);

      if (result.foundIdx > 0) {
        foundIndex = result.foundIdx;
        break;
      }

      if (result.total >= maxRank) {
        crawlerUtil.log(`${maxRank}위까지 검색했으나 매칭되는 카페 게시글을 찾지 못했습니다.`);
        return { postPage: null, rankPosition: null, found: false, failed: { reason: `${maxRank}위까지 미발견` } };
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await crawlerUtil.waitRandom(page, 1, 2);
      await crawlerUtil.waitTillHTMLRendered(page, 3000);
      attempts++;
    }

    if (foundIndex === -1) {
      crawlerUtil.log(`카페 게시글을 찾지 못했습니다 (스크롤 ${attempts}회).`);
      return { postPage: null, rankPosition: null, found: false, failed: { reason: `스크롤 ${attempts}회 후 미발견` } };
    }

    crawlerUtil.log(`카페 게시글 발견! 순위: ${foundIndex}위`);

    // 해당 게시글 클릭
    const clicked = await page.evaluate((cn: string, pt: string) => {
      const blocks = document.querySelectorAll('.lst_total .bx, .api_subject_bx, .cafe_list_wrap .item, [class*="cafetotal"] li, .search_list .item, #main_pack .sp_ntotal > li, .content_root li, .lst_view > li');
      for (const block of blocks) {
        const titleEl = block.querySelector('a.total_tit, a.api_txt_lines, .title_area a, a[class*="title"], .tit_area a, a');
        const cafeEl = block.querySelector('.cafe_name, .sub_txt .name, .cafe_info .name, .detail_box .name, [class*="cafe_name"], .sub_txt, .info_area .name, span[class*="name"]');
        const titleText = titleEl?.textContent?.trim() ?? '';
        const cafeText = cafeEl?.textContent?.trim() ?? '';
        const cafeMatch = cafeText.includes(cn) || cn.includes(cafeText);
        const titleMatch = titleText.includes(pt) || pt.includes(titleText);
        if (cafeMatch && titleMatch && titleEl) {
          (titleEl as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, cafeName, postTitle);

    if (!clicked) {
      crawlerUtil.log('매칭된 게시글을 클릭하지 못했습니다.');
      return { postPage: null, rankPosition: foundIndex, found: true, failed: { reason: '클릭 실패' } };
    }

    await crawlerUtil.waitRandom(page, 2, 4);

    const pages = await browser.pages();
    const postPage = pages[pages.length - 1];

    if (postPage && postPage !== page) {
      return { postPage, rankPosition: foundIndex, found: true };
    }

    return { postPage: page, rankPosition: foundIndex, found: true };
  }

  async dwellInCafe(page: Page, settings: any, cafeInternalClicks: number) {
    const minW1 = Number(settings.minWaitTime1) || 10;
    const maxW1 = Number(settings.maxWaitTime1) || 30;

    crawlerUtil.log('카페 게시글 체류 시작');

    await crawlerUtil.autoScroll(page, '', 200, 300, 5000).catch(() => {});
    await crawlerUtil.waitRandom(page, minW1, maxW1);

    // 카페 내부 게시판 링크 클릭
    for (let i = 0; i < cafeInternalClicks; i++) {
      const clicked = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="cafe.naver.com"]');
        const validLinks: HTMLAnchorElement[] = [];
        links.forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          if (href && !href.includes('javascript:') && href.includes('/ArticleRead') || href.includes('/ArticleList')) {
            validLinks.push(a as HTMLAnchorElement);
          }
        });

        if (validLinks.length === 0) {
          const allLinks = document.querySelectorAll('#app a[href], .article_wrap a[href], .ArticleContentBox a[href]');
          allLinks.forEach((a) => {
            const href = (a as HTMLAnchorElement).href;
            if (href && !href.includes('javascript:') && href !== window.location.href) {
              validLinks.push(a as HTMLAnchorElement);
            }
          });
        }

        if (validLinks.length === 0) return false;
        const randomLink = validLinks[Math.floor(Math.random() * validLinks.length)];
        randomLink.click();
        return true;
      });

      if (clicked) {
        crawlerUtil.log(`카페 내부 ${i + 1}/${cafeInternalClicks}번째 링크 클릭`);
        await crawlerUtil.waitRandom(page, 3, 6);
        await crawlerUtil.autoScroll(page, '', 200, 300, 3000).catch(() => {});
        await crawlerUtil.waitRandom(page, random(5, 15), random(15, 25));
      } else {
        crawlerUtil.log(`카페 내부 클릭 가능한 링크가 없어서 스킵합니다.`);
        break;
      }
    }

    crawlerUtil.log('카페 체류 완료');
  }
}

export const cafeService = new CafeService();
