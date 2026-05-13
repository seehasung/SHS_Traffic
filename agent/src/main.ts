import { app, Tray, Menu, nativeImage, shell, dialog, BrowserWindow, screen, ipcMain } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { startServer, type StartedServer } from './server';
import { DEFAULT_AGENT_PORT } from '@shared/api';

let tray: Tray | null = null;
let server: StartedServer | null = null;
let statusWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;

const isDev = process.env.AGENT_DEV === '1';
const dashboardUrl = () =>
  isDev ? 'http://localhost:5173' : `http://127.0.0.1:${server?.port ?? DEFAULT_AGENT_PORT}`;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function buildTrayIcon() {
  const img = nativeImage.createEmpty();
  return img;
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('SHS_Traffic');
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
    { label: '설정 창 보기', click: () => showLoginWindow() },
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

function showLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const w = 480;
  const h = 520;

  loginWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((display.workAreaSize.width - w) / 2),
    y: Math.round((display.workAreaSize.height - h) / 2),
    show: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'SHS_Traffic',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>SHS_Traffic</title>
<style>
  :root{color-scheme:light;font-family:'Segoe UI',system-ui,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;padding:30px;background:#f8f9fa;color:#1a1a1a;display:flex;flex-direction:column;align-items:center}
  h1{font-size:18px;margin:0 0 6px;color:#2d3748}
  .sub{font-size:12px;color:#718096;margin-bottom:24px}
  form{width:100%;max-width:380px}
  label{display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#4a5568}
  input{width:100%;padding:10px 14px;border:1px solid #cbd5e0;border-radius:8px;font-size:14px;margin-bottom:16px;outline:none;transition:border .15s}
  input:focus{border-color:#3182ce;box-shadow:0 0 0 3px rgba(49,130,206,.15)}
  button{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
  .primary{background:#3182ce;color:#fff;margin-bottom:10px}
  .primary:hover{background:#2b6cb0}
  .primary:disabled{background:#a0aec0;cursor:not-allowed}
  .secondary{background:#edf2f7;color:#4a5568;border:1px solid #e2e8f0}
  .secondary:hover{background:#e2e8f0}
  .status{margin-top:16px;padding:12px;border-radius:8px;font-size:13px;text-align:center;display:none}
  .status.success{display:block;background:#c6f6d5;color:#22543d}
  .status.error{display:block;background:#fed7d7;color:#9b2c2c}
  .status.info{display:block;background:#bee3f8;color:#2a4365}
  .divider{width:100%;border-top:1px solid #e2e8f0;margin:20px 0}
  .saved{font-size:12px;color:#718096;text-align:center;margin-top:8px}
</style></head>
<body>
  <h1>SHS_Traffic</h1>
  <p class="sub">호스트 서버에 연결하여 자동화 작업을 수행합니다</p>

  <form id="form" onsubmit="return false">
    <label>호스트 서버 주소</label>
    <input id="serverUrl" placeholder="https://your-server.onrender.com" />

    <label>워커 로그인 ID</label>
    <input id="loginId" placeholder="worker1" />

    <label>워커 비밀번호</label>
    <input id="loginPw" type="password" placeholder="password" />

    <button class="primary" id="connectBtn" onclick="doConnect()">호스트 서버에 연결</button>
    <button class="secondary" onclick="openDash()">로컬 대시보드 열기</button>

    <div id="status" class="status"></div>
  </form>

  <div class="divider"></div>
  <div class="saved" id="savedInfo"></div>

  <script>
    const { ipcRenderer } = require('electron');
    const fs = require('fs');
    const path = require('path');

    const configPath = path.join(
      process.env.APPDATA || path.join(require('os').homedir(), '.config'),
      'knowledge-shopping-worker.json'
    );

    function loadConfig() {
      try {
        if (fs.existsSync(configPath)) {
          return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
      } catch {}
      return {};
    }
    function saveConfig(cfg) {
      try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      } catch {}
    }

    const cfg = loadConfig();
    if (cfg.serverUrl) document.getElementById('serverUrl').value = cfg.serverUrl;
    if (cfg.loginId) document.getElementById('loginId').value = cfg.loginId;
    if (cfg.loginPw) document.getElementById('loginPw').value = cfg.loginPw;
    if (cfg.serverUrl) {
      document.getElementById('savedInfo').textContent = '이전 설정이 로드되었습니다: ' + cfg.serverUrl;
    }

    function showStatus(msg, type) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status ' + type;
    }

    async function doConnect() {
      const serverUrl = document.getElementById('serverUrl').value.trim();
      const loginId = document.getElementById('loginId').value.trim();
      const loginPw = document.getElementById('loginPw').value.trim();

      if (!serverUrl || !loginId || !loginPw) {
        showStatus('모든 필드를 입력해주세요.', 'error');
        return;
      }

      const btn = document.getElementById('connectBtn');
      btn.disabled = true;
      btn.textContent = '연결 중...';
      showStatus('호스트 서버에 연결을 시도합니다...', 'info');

      saveConfig({ serverUrl, loginId, loginPw });

      ipcRenderer.send('worker:connect', { serverUrl, loginId, loginPw });
    }

    function openDash() {
      ipcRenderer.send('open-dashboard');
    }

    ipcRenderer.on('worker:status', (_, data) => {
      const btn = document.getElementById('connectBtn');
      if (data.type === 'connected') {
        showStatus('호스트 서버에 성공적으로 연결되었습니다!', 'success');
        btn.textContent = '연결됨 ✓';
        btn.disabled = true;
      } else if (data.type === 'error') {
        showStatus('연결 실패: ' + data.message, 'error');
        btn.textContent = '호스트 서버에 연결';
        btn.disabled = false;
      } else if (data.type === 'disconnected') {
        showStatus('연결이 끊어졌습니다. 자동 재연결 시도 중...', 'info');
        btn.textContent = '재연결 중...';
        btn.disabled = true;
      }
    });
  </script>
</body></html>`;

  loginWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  loginWindow.once('ready-to-show', () => loginWindow?.show());
  loginWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault();
      loginWindow?.hide();
    }
  });
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
    title: 'SHS_Traffic',
  });
  const html = `
    <!doctype html><html lang="ko"><head><meta charset="utf-8"><title>SHS_Traffic</title>
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
      <h1>SHS_Traffic</h1>
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

// ─── 워커 클라이언트 로직 (IPC) ───

let workerClient: any = null;

ipcMain.on('worker:connect', async (_event, data: { serverUrl: string; loginId: string; loginPw: string }) => {
  try {
    const { WorkerClient } = await import('./worker-client-lib');
    if (workerClient) {
      workerClient.disconnect();
    }
    const serverUrl = data.serverUrl.replace(/\/+$/, '');
    workerClient = new WorkerClient({
      serverUrl,
      loginId: data.loginId,
      loginPassword: data.loginPw,
    });

    workerClient.on('connected', () => {
      loginWindow?.webContents.send('worker:status', { type: 'connected' });
      notifyStatus('호스트 서버에 연결되었습니다.');
    });

    workerClient.on('disconnected', () => {
      loginWindow?.webContents.send('worker:status', { type: 'disconnected' });
    });

    workerClient.on('error', (msg: string) => {
      loginWindow?.webContents.send('worker:status', { type: 'error', message: msg });
    });

    workerClient.start();
  } catch (e: any) {
    loginWindow?.webContents.send('worker:status', { type: 'error', message: e.message });
  }
});

ipcMain.on('open-dashboard', () => {
  openDashboard();
});

// ─── 앱 시작 ───

app.whenReady().then(async () => {
  createTray();
  await bootServer();
  showLoginWindow();
  initAutoUpdater();
});

app.on('second-instance', () => showLoginWindow());

app.on('window-all-closed', () => {
  // 트레이 모드: 모든 창이 닫혀도 앱은 살아남는다.
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
  console.error('uncaughtException', e);
});
