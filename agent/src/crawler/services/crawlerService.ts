import type { Browser, Page } from 'puppeteer-core';
import { random } from 'lodash';
import path from 'path';
import { NAVER_URL } from '../constants/urls';
import { crawlerUtil } from '../utils/crawlerUtil';
import { adbService } from './adbService';
import type { Settings, NaverAccount } from '@shared/types';

class CrawlerService {
  private setting: Partial<Settings> | null = null;

  init(setting: Partial<Settings>) {
    this.setting = setting;
  }

  async changeMacAddress(setting: Partial<Settings>): Promise<void> {
    if (process.platform === 'darwin') {
      crawlerUtil.log('MAC에서는 맥주소 변경을 건너뛰겠습니다.');
      return;
    }
    if (setting.testMode === 'Y') {
      crawlerUtil.log('[테스트모드] 맥주소 변경을 건너뛰겠습니다.');
      return;
    }

    const nutjs: any = await import('@nut-tree-fork/nut-js');
    await import('@nut-tree-fork/template-matcher' as any);
    const { screen, mouse, keyboard, imageResource, centerOf, sleep, Key } = nutjs;

    const isPackaged = !!(process as any).resourcesPath && process.env.AGENT_DEV !== '1';
    screen.config.resourceDirectory = isPackaged
      ? path.join((process as any).resourcesPath, 'mac-address')
      : path.join(__dirname, '..', '..', '..', '..', '..', 'resources', 'mac-address');

    crawlerUtil.log('맥주소 변경을 진행합니다. 마우스나 키보드를 건드리지 말고 기다려주세요.');

    await screen.waitFor(imageResource('technitium-icon.png'), 10000, 500, { confidence: 0.95, searchMultipleScales: true } as any);
    await mouse.setPosition(await centerOf(screen.find(imageResource('technitium-icon.png'), { confidence: 0.95, searchMultipleScales: true } as any)));
    await sleep(1000);
    await mouse.leftClick();

    try {
      await screen.waitFor(imageResource('ok.png'), 1000, 500, { confidence: 0.95, searchMultipleScales: true } as any);
      await mouse.setPosition(await centerOf(screen.find(imageResource('ok.png'), { confidence: 0.95, searchMultipleScales: true } as any)));
      await mouse.leftClick();
    } catch (e) {
      console.log(e);
    }

    await screen.waitFor(imageResource('thumbnail.png'), 10000, 500, { confidence: 0.95, searchMultipleScales: true } as any);
    await mouse.setPosition(await centerOf(screen.find(imageResource('thumbnail.png'), { confidence: 0.95, searchMultipleScales: true } as any)));
    await keyboard.pressKey(Key.Tab);

    await screen.waitFor(imageResource('arrow-down.png'), 10000, 500, { confidence: 0.95, searchMultipleScales: true } as any);
    const arrowDownPosition = await centerOf(screen.find(imageResource('arrow-down.png'), { confidence: 0.95, searchMultipleScales: true } as any));

    await mouse.setPosition({ x: arrowDownPosition.x - 80, y: arrowDownPosition.y - 30 });
    await mouse.leftClick();
    await sleep(1000);

    await mouse.setPosition({ x: arrowDownPosition.x - 260, y: arrowDownPosition.y + 55 });
    await mouse.leftClick();
    await sleep(1000);

    await mouse.setPosition({ x: arrowDownPosition.x - 260, y: arrowDownPosition.y + 80 });
    await mouse.leftClick();

    await screen.waitFor(imageResource('ok.png'), 10000, 500, { confidence: 0.9, searchMultipleScales: true } as any);
    await mouse.setPosition(await centerOf(screen.find(imageResource('ok.png'), { confidence: 0.9, searchMultipleScales: true } as any)));
    await mouse.leftClick();

    crawlerUtil.log('맥 주소 변경 후 인터넷이 연결될때까지 대기하겠습니다.');
    const checkInternetConnected = (await import('check-internet-connected' as any)).default;

    for (let i = 0; i < 180; i++) {
      try {
        await checkInternetConnected();
        break;
      } catch {
        console.error('인터넷 연결 안됨');
      }

      if (i === 179) throw new Error('맥 주소 변경 후 인터넷 연결에 실패했습니다.');
      await crawlerUtil.delay(1000);
      console.log(`${i + 1}번째 인터넷 연결 재시도`);
    }

    await keyboard.pressKey(Key.LeftSuper, Key.Down);
    await keyboard.releaseKey(Key.LeftSuper, Key.Down);
    crawlerUtil.log('MAC 주소가 변경되었습니다.');
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
    await page.type(idSelector, email, { delay: 100 });
    await crawlerUtil.delay(500);
    await page.type(passwordSelector, password, { delay: 100 });
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
      crawlerUtil.log('IP변경(테더링)');
      try {
        if (setting.macAddressChange === 'Y') {
          await this.changeMacAddress(setting);
        }
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

      try {
        const { vpnService } = await import('./vpnService');

        if (setting.macAddressChange === 'Y') {
          crawlerUtil.log(`IP변경(VPN) > Mac 주소 변경 진행하겠습니다.`);
          await vpnService.VPN접속해제(vpnType);
          await this.changeMacAddress(setting);
          const newIp = await vpnService.VPN접속({ vpnType, userMe, 서비스번호, 상품번호 });
          if (newIp) crawlerUtil.log(`VPN IP 변경 완료: ${newIp}`);
        } else {
          crawlerUtil.log('IP변경(VPN) 진행하겠습니다.');
          const newIp = await vpnService.핫키로IP변경(userMe);
          if (newIp) crawlerUtil.log(`VPN IP 변경 완료: ${newIp}`);
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
