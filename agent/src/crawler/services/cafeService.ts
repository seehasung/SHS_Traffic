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

    // 카페 탭 클릭: .lnb_nav_area 내부 a.tab 중 텍스트가 "카페"인 것
    const cafeTabClicked = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.lnb_nav_area a.tab, .lnb_nav a.tab');
      for (const tab of tabs) {
        const text = (tab as HTMLElement).textContent?.trim() ?? '';
        if (text === '카페') {
          (tab as HTMLElement).click();
          return true;
        }
      }
      // 폴백: role="tab"인 모든 a 태그에서 "카페" 텍스트 찾기
      const allTabs = document.querySelectorAll('a[role="tab"]');
      for (const tab of allTabs) {
        const text = (tab as HTMLElement).textContent?.trim() ?? '';
        if (text === '카페') {
          (tab as HTMLElement).click();
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
    // 실제 DOM: section.sp_ncafe ul.lst_view > li.bx
    //   카페명: .user_info a.name
    //   제목: .title_area a.title_link
    let foundIndex = -1;
    let attempts = 0;
    const maxScrollAttempts = 30;

    while (foundIndex === -1 && attempts < maxScrollAttempts) {
      const result = await page.evaluate((cn: string, pt: string, mr: number) => {
        const allResults: { cafeText: string; titleText: string; idx: number }[] = [];

        // 카페 탭 검색 결과: section.sp_ncafe .lst_view > li.bx
        const resultBlocks = document.querySelectorAll('section.sp_ncafe .lst_view > li.bx, section._sp_ncafe .lst_view > li.bx');

        if (resultBlocks.length > 0) {
          resultBlocks.forEach((block, i) => {
            const titleEl = block.querySelector('.title_area a.title_link');
            const cafeEl = block.querySelector('.user_info a.name');
            allResults.push({
              cafeText: cafeEl?.textContent?.trim() ?? '',
              titleText: titleEl?.textContent?.trim() ?? '',
              idx: i + 1,
            });
          });
        } else {
          // 폴백: 일반적인 카페 검색 결과 구조
          const fallbackBlocks = document.querySelectorAll('.lst_view > li.bx, .api_subject_bx > ul > li.bx');
          fallbackBlocks.forEach((block, i) => {
            const titleEl = block.querySelector('.title_area a, a.title_link, a[class*="title"]');
            const cafeEl = block.querySelector('.user_info a.name, a.name');
            allResults.push({
              cafeText: cafeEl?.textContent?.trim() ?? '',
              titleText: titleEl?.textContent?.trim() ?? '',
              idx: i + 1,
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

    // 해당 게시글 클릭: title_link를 target="_blank"로 열기 때문에 새 탭에서 열림
    const clicked = await page.evaluate((cn: string, pt: string) => {
      const blocks = document.querySelectorAll('section.sp_ncafe .lst_view > li.bx, section._sp_ncafe .lst_view > li.bx, .lst_view > li.bx');
      for (const block of blocks) {
        const titleEl = block.querySelector('.title_area a.title_link') as HTMLElement | null;
        const cafeEl = block.querySelector('.user_info a.name');
        const titleText = titleEl?.textContent?.trim() ?? '';
        const cafeText = cafeEl?.textContent?.trim() ?? '';
        const cafeMatch = cafeText.includes(cn) || cn.includes(cafeText);
        const titleMatch = titleText.includes(pt) || pt.includes(titleText);
        if (cafeMatch && titleMatch && titleEl) {
          titleEl.click();
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
    const minW2 = Number(settings.minWaitTime2) || 5;
    const maxW2 = Number(settings.maxWaitTime2) || 15;

    crawlerUtil.log('카페 게시글 체류 시작');

    // 페이지 높이 측정
    const { distance, delay } = crawlerUtil.getScrollValue(settings.scrollSpeed);
    await crawlerUtil.waitTillHTMLRendered(page, 5000);
    await crawlerUtil.scrollTo(page, 'top');
    await crawlerUtil.autoScroll(page, '', delay, distance).catch(() => {});
    await crawlerUtil.waitTillHTMLRendered(page, 5000);
    await crawlerUtil.scrollTo(page, 'top');
    const totalScrollHeight = Math.round(await page.evaluate(() => document.body.scrollHeight));

    // 1차: 천천히 내리면서 읽기 + 랜덤 스크롤 (올렸다 내렸다)
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);
    crawlerUtil.log(`[1차 체류] ${minW1}~${maxW1}초 랜덤 대기`);
    await crawlerUtil.waitRandom(page, minW1, maxW1);

    // 2차: 다시 랜덤 스크롤 + 대기
    await crawlerUtil.scrollRandom(page, totalScrollHeight, 4, 3, 5);
    crawlerUtil.log(`[2차 체류] ${minW2}~${maxW2}초 랜덤 대기`);
    await crawlerUtil.waitRandom(page, minW2, maxW2);

    // 카페 내부 게시판 링크 클릭
    // 실제 DOM: #cafe-menu ul.cafe-menu-list li a.gm-tcol-c[href*="ArticleList"]
    for (let i = 0; i < cafeInternalClicks; i++) {
      const clicked = await page.evaluate(() => {
        const validLinks: HTMLAnchorElement[] = [];

        // 1순위: 카페 사이드 메뉴의 게시판 링크만 (ico-link 외부링크 제외)
        const menuLinks = document.querySelectorAll('#cafe-menu ul.cafe-menu-list > li');
        menuLinks.forEach((li) => {
          const hasLinkIcon = li.querySelector('img.ico-link');
          if (hasLinkIcon) return;
          const anchor = li.querySelector('a.gm-tcol-c') as HTMLAnchorElement | null;
          if (!anchor) return;
          const onclick = anchor.getAttribute('onclick') || '';
          if (onclick.includes('mnu.link')) return;
          const href = anchor.href || anchor.getAttribute('href') || '';
          if (href.includes('ArticleList') && !href.includes('javascript:')) {
            const ul = li.closest('ul.cafe-menu-list') as HTMLElement | null;
            const isVisible = ul ? ul.style.display !== 'none' : true;
            if (isVisible) validLinks.push(anchor);
          }
        });

        // 2순위: 카페 본문 영역의 게시글 링크
        if (validLinks.length === 0) {
          const articleLinks = document.querySelectorAll(
            '#cafe_main a[href*="ArticleRead"], ' +
            'iframe#cafe_main, ' +
            '.article-board a[href], ' +
            'a[href*="/ArticleRead.nhn"], ' +
            'a[href*="/ArticleList.nhn"]'
          );
          articleLinks.forEach((a) => {
            if (a.tagName === 'A') {
              const href = (a as HTMLAnchorElement).href;
              if (href && !href.includes('javascript:')) {
                validLinks.push(a as HTMLAnchorElement);
              }
            }
          });
        }

        // 3순위: 일반적인 카페 내부 링크
        if (validLinks.length === 0) {
          const fallbackLinks = document.querySelectorAll('a[href*="cafe.naver.com"]');
          fallbackLinks.forEach((a) => {
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
        crawlerUtil.log(`카페 내부 ${i + 1}/${cafeInternalClicks}번째 게시판 클릭`);
        await crawlerUtil.waitRandom(page, 2, 4);
        await crawlerUtil.waitTillHTMLRendered(page, 3000);

        const innerHeight = Math.round(await page.evaluate(() => document.body.scrollHeight));
        await crawlerUtil.scrollRandom(page, innerHeight, 3, 2, 3);
        await crawlerUtil.waitRandom(page, random(3, 8), random(8, 15));
      } else {
        crawlerUtil.log(`카페 내부 클릭 가능한 링크가 없어서 스킵합니다.`);
        break;
      }
    }

    crawlerUtil.log('카페 체류 완료');
  }
}

export const cafeService = new CafeService();
