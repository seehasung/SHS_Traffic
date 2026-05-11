import type { Page } from 'puppeteer-core';
import { crawlerUtil } from './crawlerUtil';

class PuppeteerMouseUtil {
  async clickBySelector(page: Page, selector: string, timeout = 60000, focus = false) {
    await page.waitForSelector(selector, { timeout });
    if (focus) await crawlerUtil.focus(page, selector);
    await page.click(selector);
  }
}

export const puppeteerMouseUtil = new PuppeteerMouseUtil();
