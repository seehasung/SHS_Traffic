import { execSync } from 'child_process';

/**
 * Windows에서 시스템 전체에 핫키 Alt+P 를 전송한다.
 *
 * nut-js 가 다음과 같은 환경에서 키를 VPN 프로그램에 전달 못 하는 경우가 있다.
 *  1) VPN 프로그램이 관리자 권한, SHS_Traffic 은 일반 권한 → Windows UIPI 차단
 *  2) nut-js fork 의 일부 버전에서 글로벌 핫키 합성이 누락되는 경우
 *
 * PowerShell 의 WScript.Shell COM 객체 SendKeys 는 OS 의 표준 키 합성 API 를 쓰므로
 * nut-js 와는 다른 경로로 키를 전달한다. 둘을 모두 시도하면 어느 쪽이든 통할 확률이 매우 높다.
 *
 * SendKeys 구문:
 *  - %  → Alt
 *  - ^  → Ctrl
 *  - +  → Shift
 *  - 글자/숫자는 그대로
 *  예: Alt+P → '%p'
 */
export function sendAltPViaPowerShell(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    // SendKeys 의 % 는 Alt 의미. ' 안에 그대로 넣으면 됨.
    // 안전을 위해 -EncodedCommand 사용 (따옴표 escape 문제 회피).
    const ps = `[void][Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait('%p')`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    execSync(`powershell -NoProfile -WindowStyle Hidden -EncodedCommand ${encoded}`, {
      windowsHide: true,
      timeout: 5000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}
