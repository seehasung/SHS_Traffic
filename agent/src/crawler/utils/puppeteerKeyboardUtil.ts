import type { Page, KeyInput } from 'puppeteer-core';
import { crawlerUtil } from './crawlerUtil';

class PuppeteerKeyboardUtil {
  async type(page: Page, selector: string, text: string, delay = 100, focus = false) {
    await crawlerUtil.waitForSelector(page, selector);
    if (focus) await crawlerUtil.focus(page, selector).catch(console.error);
    await page.type(selector, text, { delay });
  }

  async press(page: Page, selector: string, key: KeyInput, focus = false) {
    await crawlerUtil.waitForSelector(page, selector);
    if (focus) await crawlerUtil.focus(page, selector).catch(console.error);
    await page.keyboard.press(key);
  }

  async clearInput(page: Page, selector: string) {
    try {
      const inputElement = await crawlerUtil.$(page, selector);
      if (!inputElement) return;
      const text = String(await inputElement.evaluate((x: any) => x.value));
      await inputElement.focus();
      await inputElement.click();
      await page.keyboard.press('End');
      for (let i = 0; i < text?.length; i++) {
        await page.keyboard.press('Backspace', { delay: 50 });
      }
    } catch (e) {
      crawlerUtil.log('clearInput 실패: ' + e);
    }
  }

  async typeAndWaitNetworkIdle(page: Page, _selector: string, key: KeyInput, timeout = 30000) {
    try {
      await Promise.all([
        page.keyboard.press(key),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout }),
      ]);
      await crawlerUtil.waitTillHTMLRendered(page);
    } catch (e) {
      console.log('typeAndWaitNetworkIdle 에러 발생 ' + e);
    }
  }

  async types(page: Page, selector: string, texts: string[], delimiter: KeyInput = 'Enter', delay = 50) {
    await crawlerUtil.waitForSelector(page, selector);
    for (const text of texts) {
      const trimmedText = text.trim();
      await crawlerUtil.focus(page, selector);
      await this.type(page, selector, trimmedText, delay);
      await page.keyboard.press(delimiter, { delay });
    }
  }

  async selectAll(page: Page) {
    await page.evaluate(() => {
      const isMac = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform);
      (document.activeElement as any).dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: isMac ? 'Meta' : 'Control',
        code: isMac ? 'MetaLeft' : 'ControlLeft',
        location: window.KeyboardEvent.DOM_KEY_LOCATION_LEFT,
        ctrlKey: !isMac,
        metaKey: isMac,
        charCode: 0,
        keyCode: isMac ? 93 : 17,
        which: isMac ? 93 : 17,
      } as any));
      const preventableEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'a',
        code: 'KeyA',
        location: window.KeyboardEvent.DOM_KEY_LOCATION_STANDARD,
        ctrlKey: !isMac,
        metaKey: isMac,
        charCode: 0,
        keyCode: 65,
        which: 65,
      } as any);
      const wasPrevented = !(document.activeElement as any).dispatchEvent(preventableEvent) || preventableEvent?.defaultPrevented;
      if (!wasPrevented) {
        document.execCommand('selectall', false, undefined);
      }
      (document.activeElement as any).dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: isMac ? 'Meta' : 'Control',
        code: isMac ? 'MetaLeft' : 'ControlLeft',
        location: window.KeyboardEvent.DOM_KEY_LOCATION_LEFT,
        charCode: 0,
        keyCode: isMac ? 93 : 17,
        which: isMac ? 93 : 17,
      } as any));
    });
  }
}

export const puppeteerKeyboardUtil = new PuppeteerKeyboardUtil();
