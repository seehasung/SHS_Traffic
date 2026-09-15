import { screen, mouse, keyboard, imageResource, centerOf, sleep, Key } from '@nut-tree-fork/nut-js';
import path from 'path';
import { isEmpty } from 'lodash';
import { crawlerUtil } from '../utils/crawlerUtil';
import { getPublicIp } from '../utils/ipUtil';
import { focusVpnWindow, listTopLevelWindows, sendHotkeyAltP } from '../utils/win32Util';

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

  /**
   * nut-js 로 Alt+P 를 보낸다.
   *
   * 주의할 점:
   *  - Alt 를 누른 상태로 최소 수십 ms 는 유지해야 프로그램이 조합키로 인식한다.
   *  - 뗄 때는 반드시 P → Alt 순서여야 한다. Alt 를 먼저 떼면 조합이 깨진다.
   *  - 이전 실행에서 Alt 가 눌린 채로 남아 있을 수 있어 먼저 정리한다.
   */
  private async sendAltPViaNut(): Promise<void> {
    try {
      await keyboard.releaseKey(Key.P);
      await keyboard.releaseKey(Key.LeftAlt);
    } catch { /* 눌려있지 않았다면 무시 */ }

    await keyboard.pressKey(Key.LeftAlt);
    await sleep(80);
    await keyboard.pressKey(Key.P);
    await sleep(120);
    await keyboard.releaseKey(Key.P);
    await sleep(80);
    await keyboard.releaseKey(Key.LeftAlt);
  }

  async 핫키로IP변경(_userMe: any): Promise<string> {
    const MAX_TRY = 10;

    // VPN 창을 포그라운드로 올려둔다.
    // 핫키가 전역 등록이 아니거나, Chromium/Electron 창이 Alt 조합을 먼저 삼키는 경우
    // 이 과정이 없으면 핫키가 VPN 프로그램에 영영 도달하지 않는다.
    const focused = await focusVpnWindow();
    if (focused) {
      crawlerUtil.log(`[VPN] 아이피 변경 프로그램 창을 활성화했습니다: ${focused}`);
      await crawlerUtil.delay(500);
    } else {
      const windows = await listTopLevelWindows();
      crawlerUtil.log(
        '[VPN] 아이피 변경 프로그램 창을 찾지 못했습니다. 핫키가 전달되지 않을 수 있습니다.',
      );
      if (windows.length > 0) {
        crawlerUtil.log(`[VPN] 현재 열린 창 목록: ${windows.join(' / ')}`);
      }
    }

    for (let i = 0; i < MAX_TRY; i++) {
      crawlerUtil.log('아이피를 변경중입니다.');

      const prevIp = await this.getIp();
      crawlerUtil.log(`[디버그] 변경 전 IP: ${prevIp}`);

      // 1~2회차는 nut-js, 3회차부터는 Windows 네이티브 SendKeys 도 함께 시도한다.
      // 두 방식은 입력 주입 경로가 달라서, 한쪽이 막혀도 다른 쪽이 통하는 경우가 있다.
      await this.sendAltPViaNut();
      if (i >= 2) {
        const sent = await sendHotkeyAltP();
        crawlerUtil.log(`[VPN] SendKeys 보조 핫키 전송 ${sent ? '성공' : '실패'}`);
      }

      // VPN 프로그램이 새 IP 로 라우팅을 완전히 전환할 때까지 대기.
      // 초기 5초 대기 후, IP 가 아직 안 바뀐 것 같으면 추가로 2초씩 4번까지 더 기다리며 재확인.
      // (IP 자체는 바뀌었지만 ipify 응답이 옛 라우팅으로 잡혔을 때 회복하기 위한 보조 로직)
      await crawlerUtil.delay(5000);

      let newIp = await this.getIp();
      crawlerUtil.log(`[디버그] 변경 후 IP: ${newIp}`);

      for (let sub = 0; sub < 4 && (isEmpty(newIp) || prevIp === newIp); sub++) {
        await crawlerUtil.delay(2000);
        newIp = await this.getIp();
        crawlerUtil.log(`[디버그] 변경 후 IP 재확인 ${sub + 1}: ${newIp}`);
      }

      console.log(`prevIP: ${prevIp} -> newIP: ${newIp}`);

      if (!isEmpty(newIp) && prevIp !== newIp) {
        crawlerUtil.log(`아이피 변경 완료: ${prevIp} -> ${newIp}`);
        this.currentIp = newIp;
        return newIp;
      }

      crawlerUtil.log(`아이피 변경 재시도 횟수: ${i + 1}회`);

      // 핫키를 쉬지 않고 연타하면 VPN 프로그램이 "변경 중" 상태에서 입력을 무시한다.
      // 재시도 간격을 점점 늘려 프로그램이 이전 요청을 마칠 시간을 준다.
      await crawlerUtil.delay(Math.min(2000 + i * 1000, 8000));

      // 중간에 다른 창이 포커스를 가져갔을 수 있으므로 주기적으로 다시 올린다.
      if (i % 3 === 2) await focusVpnWindow();
    }

    crawlerUtil.log(
      '아이피 변경에 실패했습니다. 아이피 변경 프로그램의 핫키 설정과 IP목록의 선택이 잘 되어있는지 확인해주세요. 핫키는 Alt + P로 설정해주세요.',
    );
    throw new Error('IP CHANGE FAIL');
  }
}

export const vpnService = new VpnService();
