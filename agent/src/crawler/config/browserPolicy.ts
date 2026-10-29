import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BrowserProfilePolicy, BrowserType, HeadlessMode, Settings, YN } from '@shared/types';

/**
 * 브라우저 실행 경로 · 헤드리스 방식 · 프로필 유지 여부를 한곳에서 결정한다.
 * 기본값은 모두 비어 있어서, 설정하지 않으면 기존 동작과 똑같이 움직인다.
 */

// 측정 결과로 기본값을 정하기 전까지 비워 둔다.
export const DEFAULT_HEADLESS_MODE: HeadlessMode | undefined = undefined;
export const DEFAULT_BROWSER_PROFILE_POLICY: BrowserProfilePolicy | undefined = undefined;

export function getBrowserExecutableCandidates(
  browserType: BrowserType = 'chrome',
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'win32') {
    if (browserType === 'edge') {
      return [
        environment['PROGRAMFILES(X86)'] && path.win32.join(environment['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        environment.PROGRAMFILES && path.win32.join(environment.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        environment.LOCALAPPDATA && path.win32.join(environment.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ].filter(Boolean) as string[];
    }
    return [
      environment.PROGRAMFILES && path.win32.join(environment.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      environment['PROGRAMFILES(X86)'] && path.win32.join(environment['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      environment.LOCALAPPDATA && path.win32.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean) as string[];
  }
  if (platform === 'darwin') {
    return [
      browserType === 'edge'
        ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
  }
  return browserType === 'edge'
    ? ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
}

export function findBrowserPath(browserType: BrowserType = 'chrome'): string | null {
  for (const candidate of getBrowserExecutableCandidates(browserType)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export interface HeadlessLaunchOptions {
  headless: boolean;
  args: string[];
}

export function getHeadlessLaunchOptions(setting?: Partial<Settings>): HeadlessLaunchOptions {
  const mode = setting?.headlessMode ?? DEFAULT_HEADLESS_MODE;
  // puppeteer 의 headless 옵션은 구 방식만 켜므로 새 방식은 실행 인자로 켠다
  if (mode === 'new') return { headless: false, args: ['--headless=new'] };
  if (mode === 'old') return { headless: true, args: [] };
  if (mode === 'visible') return { headless: false, args: [] };
  return { headless: setting?.showBrowser === 'N', args: [] };
}

export const shouldResetBrowserState = (testMode?: YN): boolean => testMode !== 'Y';

export function shouldResetBrowserProfile(setting?: Partial<Settings>): boolean {
  const policy = setting?.browserProfilePolicy ?? DEFAULT_BROWSER_PROFILE_POLICY;
  if (policy === 'fresh') return true;
  if (policy === 'keep') return false;
  return shouldResetBrowserState(setting?.testMode);
}

/** 프로필 유지 모드에서 쓰는 안내 문구. */
export const getProfileKeepLabel = (setting?: Partial<Settings>): string =>
  setting?.testMode === 'Y' ? '테스트모드' : '프로필 유지';

export function getBrowserProfileDirectory(browserType: BrowserType = 'chrome'): string {
  const folder = browserType === 'edge' ? 'myUserDataDir-edge' : 'myUserDataDir';
  try {
    const electron = require('electron');
    const appObj = electron.app || electron.remote?.app;
    if (appObj) return path.join(appObj.getPath('userData'), folder);
  } catch {
    /* electron 밖에서 실행 중 */
  }
  return path.join(os.tmpdir(), `shs_traffic_${folder}`);
}
