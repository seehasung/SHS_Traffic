import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { rankChecksRepo, knowledgesRepo } from './repos';
import type { RankCheck, Knowledge } from '@shared/types';

const MAX_PAGES = 50;
const ITEMS_PER_PAGE = 40;

let checking = false;

function findChromePath(): string {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH || '',
  ];
  const fs = require('fs');
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return '';
}

async function checkRankForKeyword(
  browser: Browser,
  keyword: string,
  itemName: string,
  purchaseName?: string,
  groupName?: string,
): Promise<Omit<RankCheck, 'id'>> {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);

  try {
    const searchUrl = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}&cat_id=&frm=NVSHATC`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('[class*="basicList_list_basis"]', { timeout: 10000 }).catch(() => {});

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      await new Promise((r) => setTimeout(r, 1500));

      // 스크롤하여 모든 아이템 로드
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 500));

      const result = await page.evaluate((targetId: string) => {
        const items = document.querySelectorAll('[class*="basicList_list_basis"] > div > div[data-ap-skuid]');
        for (let i = 0; i < items.length; i++) {
          const el = items[i];
          const skuId = el.getAttribute('data-ap-skuid') || '';
          if (skuId === targetId) {
            // adProduct 클래스 확인
            const className = el.className || '';
            if (/adProduct/i.test(className)) continue;
            const oriIndex = el.getAttribute('data-ap-index-ori');
            return {
              found: true,
              rankPosition: oriIndex != null ? Number(oriIndex) + 1 : i + 1,
            };
          }
        }
        // data-shp-contents-id 폴백
        const allItems = document.querySelectorAll('[class*="basicList_list_basis"] > div > div');
        for (let i = 0; i < allItems.length; i++) {
          const el = allItems[i];
          const className = el.className || '';
          if (/adProduct/i.test(className)) continue;
          const contentEl = el.querySelector(`[data-shp-contents-id="${targetId}"]`);
          if (contentEl) {
            const oriIndex = el.getAttribute('data-ap-index-ori');
            return {
              found: true,
              rankPosition: oriIndex != null ? Number(oriIndex) + 1 : i + 1,
            };
          }
        }
        return { found: false, rankPosition: null };
      }, itemName);

      if (result.found) {
        await page.close().catch(() => {});
        return {
          keyword, itemName, purchaseName, groupName,
          rankPosition: result.rankPosition,
          pageNumber: pageNum,
          found: true,
          checkedAt: Date.now(),
        };
      }

      // 다음 페이지
      if (pageNum < MAX_PAGES) {
        const hasNext = await page.evaluate(() => {
          const active = document.querySelector('[class*="pagination_btn_page"][class*="active"]');
          if (!active) return false;
          const next = active.nextElementSibling as HTMLElement | null;
          if (next && next.tagName === 'A') {
            next.click();
            return true;
          }
          return false;
        });
        if (!hasNext) break;
        await new Promise((r) => setTimeout(r, 2000));
        await page.waitForSelector('[class*="basicList_list_basis"]', { timeout: 10000 }).catch(() => {});
      }
    }

    await page.close().catch(() => {});
    return {
      keyword, itemName, purchaseName, groupName,
      rankPosition: null, pageNumber: null,
      found: false, checkedAt: Date.now(),
    };
  } catch (e) {
    await page.close().catch(() => {});
    return {
      keyword, itemName, purchaseName, groupName,
      rankPosition: null, pageNumber: null,
      found: false, checkedAt: Date.now(),
    };
  }
}

export async function runRankCheck(
  knowledgeIds?: string[],
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<RankCheck[]> {
  if (checking) throw new Error('이미 순위 조회가 진행 중입니다.');
  checking = true;

  const chromePath = findChromePath();
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath || undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    let knowledges = knowledgesRepo.list().filter((k) => (k.mode ?? 'shopping') === 'shopping' && k.isActive !== false);
    if (knowledgeIds && knowledgeIds.length > 0) {
      knowledges = knowledges.filter((k) => knowledgeIds.includes(k.id));
    }

    const results: RankCheck[] = [];
    const total = knowledges.length;

    for (let i = 0; i < knowledges.length; i++) {
      const k = knowledges[i];
      onProgress?.(i, total, `${k.keyword} / ${k.itemName}`);

      const result = await checkRankForKeyword(browser, k.keyword, k.itemName, k.purchaseName, k.groupName);
      const saved = rankChecksRepo.save(result);
      results.push(saved);
    }

    onProgress?.(total, total, '완료');
    return results;
  } finally {
    checking = false;
    if (browser) await browser.close().catch(() => {});
  }
}

export function isRankChecking(): boolean {
  return checking;
}
