import { screen, mouse, keyboard, imageResource, centerOf, sleep, Key } from '@nut-tree-fork/nut-js';
import path from 'path';
import { isEmpty } from 'lodash';
import { crawlerUtil } from '../utils/crawlerUtil';
import { getPublicIp } from '../utils/ipUtil';

export type VpnType = 'hi' | 'cool' | 'momo';

interface VpnConnectParams {
  vpnType: VpnType;
  userMe: any;
  서비스번호: number;
  상품번호: number;
}

class VpnService {
  currentIp = '';

  private getIp = async (): Promise<string> => {
    return getPublicIp();
  };

  checkReady(): boolean {
    crawlerUtil.log('VPN 프로그램을 확인하겠습니다.');
    return true;
  }

  이미지디렉토리설정(vpnType: VpnType): void {
    const isPackaged = !!(process as any).resourcesPath && process.env.AGENT_DEV !== '1';

    if (isPackaged) {
      screen.config.resourceDirectory = path.join((process as any).resourcesPath, vpnType);
    } else {
      screen.config.resourceDirectory = path.join(__dirname, '..', '..', '..', '..', '..', 'resources', vpnType);
    }
    crawlerUtil.log(
      `[VPN] 이미지 리소스 디렉토리: ${screen.config.resourceDirectory}`,
    );
  }

  // ---------------------------------------------------------------------------
  //  모모아이피
  // ---------------------------------------------------------------------------

  async 모모아이피접속(userMe: any): Promise<string> {
    await screen.waitFor(imageResource('login.png'), 10000, 500, { confidence: 0.95 });
    await mouse.setPosition(await centerOf(screen.find(imageResource('login.png'), { confidence: 0.95 })));
    await mouse.leftClick();
    crawlerUtil.log('VPN 프로그램 로그인 버튼을 클릭했습니다.');

    try {
      await screen.waitFor(imageResource('already-login.png'), 3000, 500, { confidence: 0.95 });
      await screen.waitFor(imageResource('already-login-yes.png'), 10000, 500, { confidence: 0.95 });
      await mouse.setPosition(
        await centerOf(screen.find(imageResource('already-login-yes.png'), { confidence: 0.95 })),
      );
      await mouse.leftClick();
      crawlerUtil.log('VPN 프로그램 로그인 버튼을 클릭했습니다.');
    } catch (e) {
      console.error(e);
    }

    await screen.waitFor(imageResource('wait-after-enter.png'), 10000, 500, { confidence: 0.95 });
    crawlerUtil.log('VPN 프로그램 상품에 완전히 접속할때까지 기다렸습니다.');

    try {
      await screen.waitFor(imageResource('all-check.png'), 3000, 500, { confidence: 0.99 });
      const position = await centerOf(screen.find(imageResource('all-check.png'), { confidence: 0.99 }));
      await mouse.setPosition({ x: position.x - 5, y: position.y });
      await sleep(500);
      await mouse.leftClick();
      await sleep(500);
    } catch (e) {
      console.error(e);
    }

    crawlerUtil.log('VPN 프로그램에서 IP목록을 전체 체크했습니다.');
    return await this.핫키로IP변경(userMe);
  }

  async 모모아이피접속해제(): Promise<void> {
    try {
      await screen.waitFor(imageResource('logout-after.png'), 2000, 500, { confidence: 0.95 });
      crawlerUtil.log('이미 VPN 접속 해제 되어 있습니다.');
      return;
    } catch (e) {
      console.error(e);
    }

    await screen.waitFor(imageResource('logout.png'), 10000, 500, { confidence: 0.95 });
    await mouse.setPosition(await centerOf(screen.find(imageResource('logout.png'), { confidence: 0.95 })));
    await mouse.leftClick();
    crawlerUtil.log('VPN 프로그램의 로그아웃 버튼을 클릭했습니다.');

    await screen.waitFor(imageResource('logout-after.png'), 10000, 500, { confidence: 0.95 });
    crawlerUtil.log('VPN 프로그램의 로그인 화면으로 이동되었습니다.');
  }

  // ---------------------------------------------------------------------------
  //  쿨아이피
  // ---------------------------------------------------------------------------

  async 쿨아이피접속(userMe: any): Promise<string> {
    await screen.waitFor(imageResource('login.png'), 10000, 500, { confidence: 0.95 });
    await mouse.setPosition(await centerOf(screen.find(imageResource('login.png'), { confidence: 0.95 })));
    await mouse.leftClick();
    crawlerUtil.log('VPN 프로그램 로그인 버튼을 클릭했습니다.');

    try {
      await screen.waitFor(imageResource('caution-after-login.png'), 3000, 500, { confidence: 0.95 });
      await mouse.setPosition(
        await centerOf(screen.find(imageResource('caution-ok.png'), { confidence: 0.95 })),
      );
      await mouse.leftClick();
    } catch (e) {
      console.error(e);
    }

    try {
      await screen.waitFor(imageResource('error-after-login.png'), 3000, 500, { confidence: 0.95 });
      await mouse.setPosition(
        await centerOf(screen.find(imageResource('caution-ok.png'), { confidence: 0.95 })),
      );
      await mouse.leftClick();
      return await this.쿨아이피접속(userMe);
    } catch (e) {
      console.error(e);
    }

    await screen.waitFor(imageResource('wait-after-enter.png'), 10000, 500, { confidence: 0.95 });
    crawlerUtil.log('VPN 프로그램 상품에 완전히 접속할때까지 기다렸습니다.');

    try {
      await screen.waitFor(imageResource('all-check.png'), 3000, 500, { confidence: 0.99 });
      const position = await centerOf(screen.find(imageResource('all-check.png'), { confidence: 0.99 }));
      await mouse.setPosition({ x: position.x - 5, y: position.y });
      await sleep(500);
      await mouse.leftClick();
      await sleep(500);
    } catch (e) {
      console.error(e);
    }

    crawlerUtil.log('VPN 프로그램에서 IP목록을 전체 체크했습니다.');
    return await this.핫키로IP변경(userMe);
  }

  async 쿨아이피접속해제(): Promise<void> {
    try {
      await screen.waitFor(imageResource('logout-after.png'), 3000, 500, { confidence: 0.95 });
      crawlerUtil.log('이미 VPN 접속 해제 되어 있습니다.');
      return;
    } catch (e) {
      console.error(e);
    }

    await screen.waitFor(imageResource('logout.png'), 10000, 500, { confidence: 0.95 });
    await mouse.setPosition(await centerOf(screen.find(imageResource('logout.png'), { confidence: 0.95 })));
    await mouse.leftClick();
    crawlerUtil.log('VPN 프로그램의 로그아웃 버튼을 클릭했습니다.');

    try {
      await screen.waitFor(imageResource('error-after-login.png'), 3000, 500, { confidence: 0.95 });
      await mouse.setPosition(
        await centerOf(screen.find(imageResource('caution-ok.png'), { confidence: 0.95 })),
      );
      await mouse.leftClick();
    } catch (e) {
      console.error(e);
    }

    await screen.waitFor(imageResource('logout-after.png'), 10000, 500, { confidence: 0.95 });
    crawlerUtil.log('VPN 프로그램의 로그인 화면으로 이동되었습니다.');
  }

  // ---------------------------------------------------------------------------
  //  하이아이피 helpers
  // ---------------------------------------------------------------------------

  async 하이아이피예아니오클릭(): Promise<void> {
    try {
      await screen.waitFor(imageResource('yes.png'), 3000, 500, { confidence: 0.98 });
      await mouse.setPosition(await centerOf(screen.find(imageResource('yes.png'), { confidence: 0.98 })));
      await mouse.leftClick();
      crawlerUtil.log('VPN 프로그램의 알림 창에서 "예"를 클릭했습니다.');
    } catch (e) {
      console.error(e);
    }
  }

  async 하이아이피확인알림클릭(): Promise<void> {
    try {
      await screen.waitFor(imageResource('ok.png'), 3000, 500, { confidence: 0.98 });
      await mouse.setPosition(await centerOf(screen.find(imageResource('ok.png'), { confidence: 0.98 })));
      await mouse.leftClick();
      crawlerUtil.log('VPN 프로그램의 알림 창에서 확인 버튼을 클릭했습니다.');
    } catch (e) {
      console.error(e);
    }
  }

  // ---------------------------------------------------------------------------
  //  하이아이피 접속 / 접속해제
  // ---------------------------------------------------------------------------

  async 하이아이피접속({ 서비스번호, 상품번호, userMe }: { 서비스번호: number; 상품번호: number; userMe: any }): Promise<string> {
    await screen.waitFor(imageResource('chat.png'), 10000, 500, { confidence: 0.95 });
    const chatPosition = await centerOf(screen.find(imageResource('chat.png'), { confidence: 0.95 }));

    await mouse.setPosition({ x: chatPosition.x, y: chatPosition.y + 80 });
    await mouse.leftClick();
    await sleep(1000);

    await mouse.setPosition({ x: chatPosition.x, y: chatPosition.y + 90 });
    let position = await mouse.getPosition();
    position = { x: position.x, y: position.y + 서비스번호 * 15 };
    await mouse.setPosition(position);
    await sleep(500);
    await mouse.leftClick();
    await sleep(500);

    if (상품번호 > 11) {
      crawlerUtil.log('상품번호는 최대 11번째 까지만 선택 가능합니다.');
      throw new Error('상품번호 초과');
    }

    await screen.waitFor(imageResource('option.png'), 10000, 500, { confidence: 0.95 });
    const optionPosition = await centerOf(screen.find(imageResource('option.png'), { confidence: 0.95 }));
    position = { x: optionPosition.x, y: optionPosition.y + 110 };

    if (!isEmpty(position)) {
      position.y = position.y + 25 * 상품번호;
      await mouse.setPosition(position);
      await sleep(1000);
      await mouse.leftClick();
      crawlerUtil.log('VPN 프로그램의 상품 접속하기 버튼을 클릭했습니다.');
    }

    try {
      await screen.waitFor(imageResource('error.png'), 3000, 500, { confidence: 0.95 });
      const errPos = await centerOf(screen.find(imageResource('error.png'), { confidence: 0.95 }));
      await mouse.setPosition({ x: errPos.x + 60, y: errPos.y + 60 });
      await mouse.leftClick();
      crawlerUtil.log('VPN 프로그램에서 오류가 발생해서 확인버튼을 눌렀습니다.');
    } catch (e) {
      console.error(e);
    }

    await screen.waitFor(imageResource('wait-after-enter.png'), 10000, 500, { confidence: 0.95 });
    crawlerUtil.log('VPN 프로그램 상품에 완전히 접속할때까지 기다렸습니다.');

    await screen.waitFor(imageResource('check.png'), 10000, 500, { confidence: 0.95 });
    await mouse.setPosition(await centerOf(screen.find(imageResource('check.png'), { confidence: 0.95 })));
    await mouse.leftClick();
    crawlerUtil.log('VPN 프로그램에서 IP목록을 전체 체크했습니다.');

    return await this.핫키로IP변경(userMe);
  }

  async 하이아이피접속해제(): Promise<void> {
    try {
      await screen.waitFor(imageResource('logout.png'), 2000, 500, { confidence: 0.95 });
      crawlerUtil.log('이미 VPN 접속 해제 되어 있습니다.');
      return;
    } catch (e) {
      console.error(e);
    }

    await screen.waitFor(imageResource('close.png'), 10000, 500, { confidence: 0.95 });
    await mouse.setPosition(await centerOf(screen.find(imageResource('close.png'), { confidence: 0.95 })));
    await mouse.leftClick();
    crawlerUtil.log('VPN 프로그램 연결해제 버튼을 클릭했습니다.');

    await screen.waitFor(imageResource('close-ok.png'), 10000, 500, { confidence: 0.95 });
    const closeOkPos = await centerOf(screen.find(imageResource('close-ok.png'), { confidence: 0.95 }));
    await mouse.setPosition({ x: closeOkPos.x + 60, y: closeOkPos.y + 60 });
    await mouse.leftClick();
    crawlerUtil.log('VPN 프로그램 연결해제 확인버튼을 클릭했습니다.');

    await screen.waitFor(imageResource('logout.png'), 10000, 500, { confidence: 0.95 });
    crawlerUtil.log('VPN 프로그램 상품 선택창으로 돌아왔습니다.');
  }

  // ---------------------------------------------------------------------------
  //  VPN 프로그램 썸네일 클릭 (Alt+Tab)
  // ---------------------------------------------------------------------------

  async VPN프로그램썸네일클릭(vpnType: VpnType): Promise<void> {
    this.이미지디렉토리설정(vpnType);

    await keyboard.pressKey(Key.LeftAlt, Key.Tab);
    try {
      await screen.waitFor(imageResource('thumbnail.png'), 10000, 500, { confidence: 0.95 });
      const position = await centerOf(screen.find(imageResource('thumbnail.png'), { confidence: 0.95 }));
      await mouse.setPosition({ x: position.x + 50, y: position.y + 50 });
      await sleep(1000);
      await mouse.leftClick();
    } finally {
      await keyboard.releaseKey(Key.LeftAlt, Key.Tab);
    }

    crawlerUtil.log('VPN 프로그램 썸네일을 클릭했습니다.');
  }

  // ---------------------------------------------------------------------------
  //  VPN 접속 / 접속해제 (디스패처)
  // ---------------------------------------------------------------------------

  async VPN접속해제(vpnType: VpnType): Promise<void> {
    this.이미지디렉토리설정(vpnType);
    crawlerUtil.log('VPN 접속을 해제하겠습니다. 키보드나 마우스를 건드리지 마세요.');

    await this.VPN프로그램썸네일클릭(vpnType);

    if (vpnType === 'hi') return await this.하이아이피접속해제();
    if (vpnType === 'cool') return await this.쿨아이피접속해제();
    if (vpnType === 'momo') return await this.모모아이피접속해제();
  }

  async VPN접속({ vpnType, userMe, 서비스번호, 상품번호 }: VpnConnectParams): Promise<string | void> {
    this.이미지디렉토리설정(vpnType);

    const 프로그램이름 =
      vpnType === 'hi' ? '하이아이피' : vpnType === 'cool' ? '쿨아이피' : vpnType === 'momo' ? '모모아이피' : '알수없음';

    crawlerUtil.log('VPN 프로그램에 접속하겠습니다.');
    if (프로그램이름 === '하이아이피') {
      crawlerUtil.log(`${프로그램이름}의 ${서비스번호}번째 서비스의 ${상품번호}번째 상품에 접속하겠습니다.`);
    }

    await this.VPN프로그램썸네일클릭(vpnType);

    if (vpnType === 'hi') return await this.하이아이피접속({ 서비스번호, 상품번호, userMe });
    if (vpnType === 'cool') return await this.쿨아이피접속(userMe);
    if (vpnType === 'momo') return await this.모모아이피접속(userMe);
  }

  // ---------------------------------------------------------------------------
  //  핫키로 IP 변경 (Alt + P)
  // ---------------------------------------------------------------------------

  async 핫키로IP변경(_userMe: any): Promise<string> {
    for (let i = 0; i < 10; i++) {
      crawlerUtil.log('아이피를 변경중입니다.');

      const prevIp = await this.getIp();
      crawlerUtil.log(`[디버그] 변경 전 IP: ${prevIp}`);

      await keyboard.releaseKey(Key.LeftAlt, Key.P);
      await keyboard.pressKey(Key.LeftAlt, Key.P);
      await keyboard.releaseKey(Key.LeftAlt, Key.P);

      // VPN 프로그램이 새 IP로 라우팅을 완전히 전환할 때까지 대기.
      // 3초로는 ipify 요청이 아직 옛 경로로 나가 옛 IP가 잡히는 경우가 있어 5초로 늘림.
      await crawlerUtil.delay(5000);

      const newIp = await this.getIp();
      crawlerUtil.log(`[디버그] 변경 후 IP: ${newIp}`);
      console.log(`prevIP: ${prevIp} -> newIP: ${newIp}`);

      if (!isEmpty(newIp) && prevIp !== newIp) {
        crawlerUtil.log(`아이피 변경 완료: ${prevIp} -> ${newIp}`);
        this.currentIp = newIp;
        return newIp;
      } else {
        crawlerUtil.log(`아이피 변경 재시도 횟수: ${i + 1}회`);
      }
    }

    crawlerUtil.log(
      '아이피 변경에 실패했습니다. 아이피 변경 프로그램의 핫키 설정과 IP목록의 선택이 잘 되어있는지 확인해주세요. 핫키는 Alt + P로 설정해주세요.',
    );
    throw new Error('IP CHANGE FAIL');
  }
}

export const vpnService = new VpnService();
