import { execFile } from 'child_process';

/**
 * Windows 전용 보조 유틸.
 *
 * VPN(아이피 변경) 프로그램은 대부분 Alt+P 같은 핫키로 IP 를 바꾼다.
 * 그런데 nut-js 가 보내는 합성(synthetic) 키 입력은 아래 이유로 무시되는 경우가 많다.
 *  - VPN 창이 포그라운드가 아니라서 (핫키가 전역 등록이 아닌 경우)
 *  - Chromium/Electron 창이 Alt 조합을 메뉴 가속키로 먼저 삼켜버리는 경우
 *
 * 그래서 (1) VPN 창을 먼저 포그라운드로 올리고, (2) nut-js 가 실패하면
 * Windows 네이티브 SendKeys 로 한 번 더 시도하는 경로를 제공한다.
 */

const IS_WINDOWS = process.platform === 'win32';

function runPowerShell(script: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.toString().trim() || err.message));
          return;
        }
        resolve(stdout.toString().trim());
      },
    );
  });
}

/** 현재 떠 있는 최상위 창들의 "프로세스명|창제목" 목록. 진단용. */
export async function listTopLevelWindows(): Promise<string[]> {
  if (!IS_WINDOWS) return [];
  const script = `
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |
  ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)" }
`;
  try {
    const out = await runPowerShell(script);
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 크롤러가 띄운 브라우저/워커 자신을 제외한 창 중에서 VPN 프로그램으로 보이는 창을
 * 찾아 포그라운드로 올린다.
 *
 * @returns 활성화한 창의 "프로세스명|창제목", 못 찾으면 null
 */
export async function focusVpnWindow(extraKeywords: string[] = []): Promise<string | null> {
  if (!IS_WINDOWS) return null;

  // 아이피 변경 프로그램들이 흔히 쓰는 이름 조각 (하이아이피 / 쿨아이피 / 모모아이피)
  const keywords = [
    'ip', '아이피', 'vpn', 'hi', 'cool', 'momo', 'proxy',
    ...extraKeywords,
  ].map((k) => k.toLowerCase());

  // 명백히 VPN 이 아닌 것들
  const excluded = ['chrome', 'msedge', 'firefox', 'electron', 'explorer', 'code',
    'powershell', 'cmd', 'windowsterminal', 'shs_traffic', 'knowledge-shopping-top'];

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
$kw = @(${keywords.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')})
$ex = @(${excluded.map((k) => `'${k}'`).join(',')})
$cands = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' -and
  ($ex -notcontains $_.ProcessName.ToLower())
}
$match = $cands | Where-Object {
  $n = ($_.ProcessName + ' ' + $_.MainWindowTitle).ToLower()
  $hit = $false
  foreach ($k in $kw) { if ($n.Contains($k)) { $hit = $true; break } }
  $hit
} | Select-Object -First 1
if ($match) {
  if ([W]::IsIconic($match.MainWindowHandle)) { [W]::ShowWindow($match.MainWindowHandle, 9) | Out-Null }
  [W]::SetForegroundWindow($match.MainWindowHandle) | Out-Null
  "$($match.ProcessName)|$($match.MainWindowTitle)"
}
`;

  try {
    const out = await runPowerShell(script);
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Windows 네이티브 SendKeys 로 Alt+P 를 보낸다.
 * nut-js(libnut) 가 보낸 입력이 먹히지 않을 때의 2차 경로.
 */
export async function sendHotkeyAltP(): Promise<boolean> {
  if (!IS_WINDOWS) return false;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('%p')
Start-Sleep -Milliseconds 150
'OK'
`;
  try {
    const out = await runPowerShell(script);
    return out.includes('OK');
  } catch {
    return false;
  }
}
