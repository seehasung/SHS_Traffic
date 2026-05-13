import type { Browser, Page } from 'puppeteer-core';
import { random } from 'lodash';
import { NAVER_URL } from '../constants/urls';
import { crawlerUtil } from '../utils/crawlerUtil';
import { adbService } from './adbService';
import type { Settings, NaverAccount } from '@shared/types';

class CrawlerService {
  private setting: Partial<Settings> | null = null;

  init(setting: Partial<Settings>) {
    this.setting = setting;
  }

  async naverLogin(page: Page, id: string, password: string): Promise<boolean> {
    const email = `${id}@naver.com`;
    crawlerUtil.log('네이버 로그인 진행중..');

    if (!id || !password) {
      crawlerUtil.log(`아이디 또는 비밀번호가 올바르지 않습니다. 아이디: ${email}`);
      return false;
    }

    const idSelector = 'input[name="id"]';
    const passwordSelector = 'input[name="pw"]';

    await page.goto(NAVER_URL.LOGIN, { waitUntil: 'networkidle2' });
    await page.click('#loinid');
    await crawlerUtil.delay(1000);
    await page.waitForSelector(idSelector);
    await page.$eval(idSelector, (elem: any) => {
      elem.setAttribute('autocomplete', 'off');
      elem.removeAttribute('readonly');
    });
    await page.type(idSelector, email, { delay: 300 });
    await crawlerUtil.delay(1000);
    await page.type(passwordSelector, password, { delay: 300 });
    await page.$eval(passwordSelector, (elem: any) => {
      elem.setAttribute('autocomplete', 'off');
      elem.removeAttribute('readonly');
    });
    await crawlerUtil.delay(1000);
    await page.click('#keep');
    await crawlerUtil.delay(1000);

    await Promise.all([
      page.click("*[type='submit']"),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    const url = page.url();
    if (url.includes('nid.naver.com')) {
      const isLoginFail = await page.evaluate(() => {
        return (document.querySelector('#err_common') as HTMLElement | null)?.innerText?.includes('잘못');
      });
      if (isLoginFail) {
        crawlerUtil.log('로그인 실패! 로그인 정보를 정확히 입력해주세요.');
        return false;
      }
      const loginButton = await page.$('.btn_login');
      if (loginButton) return false;
    }

    crawlerUtil.log('네이버 로그인 완료');
    return true;
  }

  async 로그인브라우저갱신(
    setting: Partial<Settings>,
    naverAccounts: NaverAccount[],
    progressCount: number,
    chromePath: string,
    repeatCount = 0,
  ) {
    if (progressCount < 1) progressCount = 1;
    let index = Math.max(progressCount - 1 + repeatCount, 0);
    const accountLength = naverAccounts?.length || 0;

    if (setting.naverLoginType === 'inOrder') {
      const blockLen = Math.max(accountLength - 1, 1);
      const blockNo = Math.floor(index / blockLen);
      if (blockNo % 2 === 0) {
        index = index % blockLen;
      } else {
        index = blockLen - (index % blockLen);
      }
    } else if (setting.naverLoginType === 'random') {
      index = random(0, Math.max(accountLength - 1, 0));
    }

    const naverAccount = naverAccounts[index];
    const naverId = naverAccount?.naverId?.trim();
    const naverPassword = naverAccount?.naverPassword?.trim();
    const naverUserAgent = naverAccount?.userAgent?.trim();

    const newBrowserSet = await crawlerUtil.createBrowserAndPage(setting, chromePath, naverUserAgent);
    const { browser, page } = newBrowserSet || {};
    return { browser, page, repeatCount, naverId, naverPassword };
  }

  async 네이버로그인(page: Page, naverId: string, naverPassword: string) {
    if (!naverId) return crawlerUtil.log('네이버 아이디가 비어있어서 네이버 로그인을 진행하지 않겠습니다.');
    if (!naverPassword) return crawlerUtil.log('네이버 비밀번호가 비어있어서 네이버 로그인을 진행하지 않겠습니다.');
    return await this.naverLogin(page, naverId, naverPassword);
  }

  async removeCookie(page: Page) {
    try {
      if (!page) return;
      const client = await (page as any).target().createCDPSession();
      await client.send('Network.clearBrowserCookies');
      await client.send('Network.clearBrowserCache');
      crawlerUtil.log('쿠키 삭제');
    } catch (e) {
      console.error(e);
    }
  }

  async changeIpAndMacAddress({ setting, userMe }: { setting: Partial<Settings>; userMe: any }) {
    if (setting.testMode === 'Y') {
      crawlerUtil.log('테스트모드 ON: IP변경 X');
      return;
    }

    if (setting.ipChangeType === 'phone') {
      crawlerUtil.log('ADB를 통한 IP 변경을 시작합니다.');
      try {
        await adbService.init();
        const newIp = await adbService.getChangedIp();
        if (newIp) {
          crawlerUtil.log(`IP 변경 완료: ${newIp}`);
        } else {
          crawlerUtil.log('IP 변경에 실패했습니다.');
        }
      } catch (e: any) {
        crawlerUtil.log('ADB IP 변경 중 오류: ' + e.message);
      }
    } else if (setting.ipChangeType === 'vpn') {
      const vpnType = (setting as any).vpnType || 'hi';
      const 서비스번호 = (setting as any).서비스번호 ?? 1;
      const 상품번호 = (setting as any).상품번호 ?? 1;

      crawlerUtil.log(`VPN(${vpnType})을 통한 IP 변경을 시작합니다.`);
      try {
        if (setting.macAddressChange === 'Y') {
          crawlerUtil.log('MAC 주소 변경은 Technitium UI 자동화가 필요합니다. (미구현 - 스킵)');
        }

        const { vpnService } = await import('./vpnService');
        await vpnService.VPN접속해제(vpnType);
        const newIp = await vpnService.VPN접속({ vpnType, userMe, 서비스번호, 상품번호 });
        if (newIp) {
          crawlerUtil.log(`VPN IP 변경 완료: ${newIp}`);
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        crawlerUtil.log('VPN IP 변경 중 오류: ' + msg);
        crawlerUtil.log('VPN 연결에 실패하여 작업을 중단합니다. VPN 프로그램이 실행 중인지 확인해주세요.');
        throw new Error('VPN_CONNECTION_FAILED');
      }
    }
  }
}

export const crawlerService = new CrawlerService();
