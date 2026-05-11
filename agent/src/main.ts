import { app, Tray, Menu, nativeImage, shell, dialog, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { startServer, type StartedServer } from './server';
import { DEFAULT_AGENT_PORT } from '@shared/api';

let tray: Tray | null = null;
let server: StartedServer | null = null;
let statusWindow: BrowserWindow | null = null;

const isDev = process.env.AGENT_DEV === '1';
// 개발 중에는 web 의 vite dev 서버(5173)로, 운영에서는 에이전트가 직접 서빙(17321)으로 연결.
const dashboardUrl = () =>
  isDev ? 'http://localhost:5173' : `http://127.0.0.1:${server?.port ?? DEFAULT_AGENT_PORT}`;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function buildTrayIcon() {
  // 임시: 빈 16x16 PNG. 추후 실제 아이콘 파일 추가 시 여기서 로드.
  const img = nativeImage.createEmpty();
  return img;
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('지식쇼핑 에이전트');
  rebuildMenu();
  tray.on('double-click', () => openDashboard());
}

function rebuildMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: server ? `대시보드 열기 (포트 ${server.port})` : '대시보드 열기',
      click: () => openDashboard(),
    },
    { label: '상태창 보기', click: () => createStatusWindow() },
    { type: 'separator' },
    {
      label: server ? '서버 중지' : '서버 시작',
      click: () => (server ? stopServer() : bootServer()),
    },
    { type: 'separator' },
    { label: '종료', click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
}

async function bootServer() {
  if (server) return;
  try {
    server = await startServer({ port: DEFAULT_AGENT_PORT });
    rebuildMenu();
    notifyStatus(`에이전트 서버가 시작되었습니다.\nhttp://127.0.0.1:${server.port}`);
  } catch (e: any) {
    dialog.showErrorBox('서버 시작 실패', String(e?.message ?? e));
  }
}

async function stopServer() {
  if (!server) return;
  await server.close().catch(() => {});
  server = null;
  rebuildMenu();
  notifyStatus('에이전트 서버가 중지되었습니다.');
}

function openDashboard() {
  shell.openExternal(dashboardUrl());
}

function notifyStatus(text: string) {
  statusWindow?.webContents.send('status', text);
}

function createStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.show();
    statusWindow.focus();
    return;
  }
  const display = screen.getPrimaryDisplay();
  const w = 380;
  const h = 280;
  statusWindow = new BrowserWindow({
    width: w,
    height: h,
    x: display.workAreaSize.width - w - 20,
    y: display.workAreaSize.height - h - 60,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: '지식쇼핑 에이전트',
  });
  // 인라인 HTML — 별도 빌드 필요 없음.
  const html = `
    <!doctype html><html lang="ko"><head><meta charset="utf-8"><title>지식쇼핑 에이전트</title>
    <style>
      :root{color-scheme:light dark;font-family:'Segoe UI',system-ui,sans-serif}
      body{margin:0;padding:18px;background:#f5f5f7;color:#111}
      @media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#f5f5f7}}
      h1{font-size:14px;margin:0 0 8px}
      p{font-size:12px;opacity:.7;margin:0 0 14px;line-height:1.5}
      button{display:block;width:100%;padding:10px;border:none;border-radius:8px;background:#0066ff;color:#fff;font-size:13px;cursor:pointer;margin-bottom:8px}
      button.alt{background:transparent;border:1px solid rgba(127,127,127,.4);color:inherit}
      code{background:rgba(127,127,127,.18);padding:2px 6px;border-radius:4px;font-size:11px}
    </style></head>
    <body>
      <h1>지식쇼핑 에이전트</h1>
      <p>이 PC에서 자동화 작업과 데이터 저장을 담당합니다.<br/>
        대시보드는 평소 쓰는 브라우저로 열립니다.</p>
      <p>주소: <code id="addr">${dashboardUrl()}</code></p>
      <button onclick="open('${dashboardUrl()}','_blank')">대시보드 열기</button>
      <button class="alt" onclick="window.close()">창 닫기 (백그라운드 유지)</button>
    </body></html>
  `;
  statusWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  statusWindow.once('ready-to-show', () => statusWindow?.show());
  statusWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault();
      statusWindow?.hide();
    }
  });
}

function quitApp() {
  (app as any).isQuitting = true;
  app.quit();
}

function initAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] 업데이트 확인 중...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] 업데이트 발견:', info.version);
    notifyStatus(`새 버전(${info.version})을 다운로드 중입니다...`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] 최신 버전입니다.');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] 다운로드 진행률: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] 업데이트 다운로드 완료:', info.version);
    dialog
      .showMessageBox({
        type: 'info',
        title: '업데이트 완료',
        message: `새 버전(${info.version})이 준비되었습니다.\n지금 재시작하시겠습니까?`,
        buttons: ['재시작', '종료'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        } else {
          quitApp();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] 오류:', err.message);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdater] 업데이트 확인 실패:', err.message);
  });
}

app.whenReady().then(async () => {
  createTray();
  await bootServer();
  createStatusWindow();
  initAutoUpdater();
});

app.on('second-instance', () => createStatusWindow());

app.on('window-all-closed', () => {
  // 트레이 모드: 모든 창이 닫혀도 앱은 살아남는다. 종료는 트레이 메뉴에서만.
});

app.on('before-quit', async (e) => {
  if (server) {
    e.preventDefault();
    (app as any).isQuitting = true;
    await stopServer();
    app.quit();
  }
});

process.on('uncaughtException', (e) => {
  // eslint-disable-next-line no-console
  console.error('uncaughtException', e);
});
