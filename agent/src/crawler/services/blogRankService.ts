import type { Page, Frame } from 'puppeteer-core';
import { random } from 'lodash';
import { crawlerUtil } from '../utils/crawlerUtil';

interface BlogRankParams {
  page: Page;
  setting: any;
  isTestMode: boolean;
  minWaitTime1: number;
  maxWaitTime1: number;
  minWaitTime2: number;
  maxWaitTime2: number;
  keyword?: string;
}

class BlogRankService {
  private async getFrame(page: Page): Promise<Frame | null> {
    try {
      await page.waitForSelector('#mainFrame', { timeout: 5000 });
      const frameHandle = await page.$('#mainFrame');
      return (await frameHandle?.contentFrame()) ?? null;
    } catch (e: any) {
      console.error('프레임을 얻어오는데 실패했습니다.' + e.message);
      return null;
    }
  }

  private async _clickVideo(page: Page | Frame, setting: any) {
    try {
      const muteSelector = '.u_volume_button_area .u_rmc_btn';
      const muteBtn = await (page as any).waitForSelector(muteSelector, { timeout: 1000 }).catch(() => null);
      if (muteBtn) {
        await muteBtn.evaluate((el: any) => el.scrollIntoView());
        await muteBtn.click();
      }

      const playSelector =
        setting.pageType === 'pc'
          ? '.u_rmc_btn_play .u_rmc_play_ic'
          : '.u_rmc_play_ic[aria-label="play"]';
      const playBtn = await (page as any).waitForSelector(playSelector, { timeout: 1000 }).catch(() => null);
      if (playBtn) {
        await playBtn.evaluate((el: any) => {
          el.scrollIntoView();
          el.click();
        });
        crawlerUtil.log('동영상 재생버튼을 클릭했습니다.');
        await crawlerUtil.delay(5000);
      }
    } catch {
      // 동영상 없음 — 무시
    }
  }

  async 클린로직(params: BlogRankParams) {
    const { page: postPage, setting, isTestMode, minWaitTime1, maxWaitTime1, minWaitTime2, maxWaitTime2 } = params;
    crawlerUtil.log('블로그 클린로직을 실행하겠습니다.');

    let targetPage: Page | Frame = postPage;
    await postPage.bringToFront();

    if (setting.pageType === 'pc') {
      const url = postPage.url();
      if (url?.includes('blog.naver.com')) {
        const frame = await this.getFrame(postPage);
        if (!frame) return crawlerUtil.log('프레임을 얻어오는데 실패했습니다.');
        targetPage = frame;
      }
    }

    await crawlerUtil.waitTillHTMLRendered(targetPage as any);
    await crawlerUtil.scrollBy(targetPage as any, setting.scrollSpeed || 'normal', 700, 1, 'down');
    await crawlerUtil.wait(postPage, 1);

    crawlerUtil.log(`[1차반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류 진행하겠습니다.`);
    if (isTestMode) {
      await crawlerUtil.waitRandom(targetPage as any, 1, 5);
    } else {
      await crawlerUtil.waitRandom(targetPage as any, minWaitTime1, maxWaitTime1);
    }

    // 블로그 본문 내 랜덤 링크 클릭 (없어도 무시)
    try {
      const links = await (targetPage as any).$$('a[href]');
      if (links && links.length > 0) {
        const idx = random(0, links.length - 1);
        await links[idx].evaluate((el: any) => el.scrollIntoView());
        crawlerUtil.log('본문 내 랜덤 링크를 클릭하겠습니다.');
      }
    } catch { /* 무시 */ }

    await crawlerUtil.scrollBy(targetPage as any, setting.scrollSpeed || 'normal', 700, 1, 'down');
    await crawlerUtil.wait(postPage, 1);

    await postPage.bringToFront();
    crawlerUtil.log('사이트탭으로 전환');
    await crawlerUtil.scrollBy(targetPage as any, setting.scrollSpeed || 'normal', 700, 1, 'down');
    await crawlerUtil.wait(targetPage as any, 1);

    crawlerUtil.log(`[2차반영] ${minWaitTime2}~${maxWaitTime2}초 랜덤체류 진행하겠습니다.`);
    if (isTestMode) {
      await crawlerUtil.waitRandom(targetPage as any, 2, 6);
    } else {
      await crawlerUtil.waitRandom(targetPage as any, minWaitTime2, maxWaitTime2);
    }

    try {
      crawlerUtil.log('홈으로 이동하는 로고버튼을 찾겠습니다.');
      await (targetPage as any).waitForSelector('a[href="/"]', { timeout: 5000 });
      const homeHandle = await (targetPage as any).$('a[href="/"]');
      await crawlerUtil.clickByElemHandle(targetPage as any, homeHandle);
      crawlerUtil.log('로고버튼 클릭 후 대기하겠습니다.');
      await crawlerUtil.waitRandom(targetPage as any, 8, 15);
    } catch {
      crawlerUtil.log('로고버튼을 찾는데 실패했습니다.');
    }

    crawlerUtil.log('블로그 클린로직 실행이 성공적으로 완료되었습니다.');
  }

  async 정밀로직(params: BlogRankParams) {
    const { page: postPage, setting, isTestMode, minWaitTime1, maxWaitTime1, minWaitTime2, maxWaitTime2, keyword } = params;
    crawlerUtil.log('블로그 정밀로직을 실행하겠습니다.');

    let targetPage: Page | Frame = postPage;

    if (setting.pageType === 'pc') {
      const url = postPage.url();
      if (url?.includes('naver.com')) {
        const frame = await this.getFrame(postPage);
        if (!frame) return crawlerUtil.log('프레임을 얻어오는데 실패했습니다.');
        targetPage = frame;
      }
    }

    crawlerUtil.log('0. 페이지 전체 높이를 측정하겠습니다.');
    await crawlerUtil.waitTillHTMLRendered(targetPage as any, 5000);
    await crawlerUtil.scrollTo(targetPage as any, 'top');
    await crawlerUtil.autoScroll(targetPage as any, '', 50, isTestMode ? 1200 : 50);
    await crawlerUtil.waitTillHTMLRendered(targetPage as any, 5000);
    await crawlerUtil.scrollTo(targetPage as any, 'bottom');
    await crawlerUtil.scrollTo(targetPage as any, 'top');

    const totalScrollHeight = Math.round(
      await (targetPage as any).evaluate(() => document.body.scrollHeight),
    );
    const oneHalf = Math.round(totalScrollHeight / 2);
    const oneThird = Math.round(totalScrollHeight / 3);
    crawlerUtil.log(
      `0. 페이지 전체 높이를 측정했습니다. 전체: ${totalScrollHeight}px, 1/2: ${oneHalf}px, 1/3: ${oneThird}px`,
    );

    crawlerUtil.log('1. 스크롤을 위, 아래로 랜덤하게 4회 진행하겠습니다.');
    await crawlerUtil.scrollRandom(targetPage as any, totalScrollHeight, 4, 1, 3);

    if (keyword) {
      crawlerUtil.log('2. 본문 내 타겟 키워드 후반부 랜덤 위치로 이동하겠습니다.');
      await this._scrollToKeyword(targetPage as any, keyword);
      await crawlerUtil.waitRandom(targetPage as any, 2, 3);
    }

    crawlerUtil.log(`3. [1차반영] ${minWaitTime1}~${maxWaitTime1}초 랜덤체류 진행하겠습니다.`);
    if (isTestMode) {
      await crawlerUtil.waitRandom(targetPage as any, 1, 5);
    } else {
      await crawlerUtil.waitRandom(targetPage as any, minWaitTime1, maxWaitTime1);
    }

    crawlerUtil.log('4. 본문 높이(전체, 1/2, 1/3) * 3~5회 랜덤 스크롤');
    const randomCount = random(3, 5);
    for (let i = 0; i < randomCount; i++) {
      const pick = random(0, 2);
      const heights = [totalScrollHeight, oneHalf, oneThird];
      const labels = ['전체', '1/2', '1/3'];
      crawlerUtil.log(`4-${pick + 1}. 본문 ${labels[pick]} 스크롤`);
      await crawlerUtil.scrollTo(targetPage as any, 'top');
      await crawlerUtil.autoScroll(
        targetPage as any, '', 50, isTestMode ? 1200 : 50, heights[pick],
      );
    }

    crawlerUtil.log('5. 스크롤을 위, 아래로 랜덤하게 4회 진행하겠습니다.');
    await crawlerUtil.scrollRandom(targetPage as any, totalScrollHeight, 4, 1, 3);

    crawlerUtil.log(`6. [2차반영] ${minWaitTime2}~${maxWaitTime2}초 랜덤체류 진행하겠습니다.`);
    if (isTestMode) {
      await crawlerUtil.waitRandom(targetPage as any, 2, 6);
    } else {
      await crawlerUtil.waitRandom(targetPage as any, minWaitTime2, maxWaitTime2);
    }

    try {
      crawlerUtil.log('7. 홈으로 이동하는 로고버튼을 찾겠습니다.');
      await (targetPage as any).waitForSelector('a[href="/"]', { timeout: 5000 });
      const homeHandle = await (targetPage as any).$('a[href="/"]');
      await crawlerUtil.clickByElemHandle(targetPage as any, homeHandle);
      crawlerUtil.log('8. 로고버튼 클릭 후 대기하겠습니다.');
      await crawlerUtil.waitRandom(targetPage as any, 8, 15);
    } catch {
      crawlerUtil.log('7. 로고버튼을 찾는데 실패했습니다.');
    }

    crawlerUtil.log('블로그 정밀로직 실행이 성공적으로 완료되었습니다.');
  }

  private async _scrollToKeyword(page: Page | Frame, keyword: string) {
    try {
      await crawlerUtil.waitTillHTMLRendered(page as any);
      const kw = keyword.trim();

      // page.evaluate로 키워드 포함 요소 수 파악
      const itemCount: number = await (page as any).evaluate((text: string) => {
        const xp = `//*[contains(text(), '${text}')]`;
        const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return snap.snapshotLength;
      }, kw);

      for (let i = 0; i < Math.max(20, itemCount); i++) {
        const randomIndex = random(Math.floor(itemCount / 2), itemCount);
        const beforeY = await (page as any).evaluate(() => (window as any).scrollY);
        // 특정 인덱스의 요소로 스크롤
        await (page as any).evaluate((text: string, idx: number) => {
          const xp = `//*[contains(text(), '${text}')]`;
          const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const el = snap.snapshotItem(idx) as HTMLElement | null;
          if (el) el.scrollIntoView();
        }, kw, randomIndex);
        const afterY = await (page as any).evaluate(() => (window as any).scrollY);
        if (Math.abs(beforeY - afterY) >= 10) {
          crawlerUtil.log(
            `문서 전체에서 키워드 "${keyword}"의 ${randomIndex}번째 위치로 이동했습니다.`,
          );
          return;
        }
      }
    } catch (e: any) {
      crawlerUtil.log(`키워드 "${keyword}" 위치로 이동하지 못했습니다.`);
    }
  }
}

export const blogRankService = new BlogRankService();
