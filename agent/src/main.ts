import { app, Tray, Menu, nativeImage, shell, dialog, BrowserWindow, screen, ipcMain } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { startServer, type StartedServer } from './server';
import { DEFAULT_AGENT_PORT } from '@shared/api';

let isQuittingForUpdate = false;

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
  const w = 520;
  const h = 650;

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
    autoHideMenuBar: true,
    title: 'SHS_Traffic',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  loginWindow.setMenu(null);

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
  button{padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
  .primary{width:100%;background:#3182ce;color:#fff;margin-bottom:10px}
  .primary:hover{background:#2b6cb0}
  .primary:disabled{background:#a0aec0;cursor:not-allowed}
  .secondary{width:100%;background:#edf2f7;color:#4a5568;border:1px solid #e2e8f0}
  .secondary:hover{background:#e2e8f0}
  .status{margin-top:16px;padding:12px;border-radius:8px;font-size:13px;text-align:center;display:none}
  .status.success{display:block;background:#c6f6d5;color:#22543d}
  .status.error{display:block;background:#fed7d7;color:#9b2c2c}
  .status.info{display:block;background:#bee3f8;color:#2a4365}
  .divider{width:100%;border-top:1px solid #e2e8f0;margin:20px 0}
  .saved{font-size:12px;color:#718096;text-align:center;margin-top:8px}
  .status-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
  .badge{padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600}
  .badge.connected{background:#c6f6d5;color:#22543d}
  .badge.disconnected{background:#fed7d7;color:#9b2c2c}
  .badge.idle{background:#e2e8f0;color:#4a5568}
  .badge.running{background:#bee3f8;color:#2a4365}
  .badge.stopping{background:#fefcbf;color:#744210}
  .btn-start{padding:6px 16px;border:none;border-radius:6px;background:#38a169;color:#fff;font-size:12px;font-weight:600;cursor:pointer}
  .btn-stop{padding:6px 16px;border:none;border-radius:6px;background:#e53e3e;color:#fff;font-size:12px;font-weight:600;cursor:pointer}
  .btn-disconnect{padding:6px 12px;border:1px solid #cbd5e0;border-radius:6px;background:transparent;color:#4a5568;font-size:12px;cursor:pointer;margin-left:auto}
  .tabs{display:flex;gap:4px;margin-bottom:8px}
  .tab{padding:6px 14px;border:none;border-radius:6px 6px 0 0;background:#edf2f7;color:#4a5568;font-size:12px;cursor:pointer}
  .tab.active{background:#3182ce;color:#fff}
  .tab-content{border:1px solid #e2e8f0;border-radius:0 0 8px 8px;padding:8px}
  .log-line{padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
  .log-time{color:#718096;margin-right:8px}
  .log-warn{color:#ecc94b}
  .log-error{color:#fc8181}
  .log-success{color:#68d391}
  .log-info{color:#e0e0e0}
  .kw-header{display:flex;padding:6px 8px;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;color:#718096;background:#f7fafc}
  .kw-header span{flex:1}
  .kw-row{display:flex;padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px}
  .kw-row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .kw-keyword{font-weight:600;color:#2d3748}
  .kw-name{color:#4a5568}
  .kw-product{color:#718096}
  #dashboard-section{width:100%;max-width:460px}
</style></head>
<body>
  <h1>SHS_Traffic</h1>
  <p class="sub">호스트 서버에 연결하여 자동화 작업을 수행합니다</p>
  <p class="sub" id="version-text" style="font-size:11px;color:#718096;margin-top:-4px"></p>

  <div id="login-section">
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
  </div>

  <div id="dashboard-section" style="display:none">
    <div class="status-bar">
      <span id="conn-status" class="badge connected">연결됨</span>
      <span id="runner-badge" class="badge idle">대기 중</span>
      <span id="version-badge" style="font-size:10px;color:#a0aec0;margin-left:auto"></span>
      <button id="startBtn" class="btn-start" onclick="doStart()">작업 시작</button>
      <button id="stopBtn" class="btn-stop" onclick="doStop()" style="display:none">작업 중지</button>
      <button class="btn-disconnect" onclick="doDisconnect()">연결 해제</button>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('log', this)">로그</button>
      <button class="tab" onclick="switchTab('keywords', this)">키워드/상품</button>
    </div>

    <div id="tab-log" class="tab-content">
      <div id="log-container" style="height:300px;overflow-y:auto;font-size:12px;font-family:monospace;padding:8px;background:#1a1a2e;color:#e0e0e0;border-radius:8px">
      </div>
    </div>

    <div id="tab-keywords" class="tab-content" style="display:none">
      <div id="keyword-list" style="max-height:300px;overflow-y:auto">
      </div>
    </div>
  </div>

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

    // 버전 표시
    ipcRenderer.invoke('get-app-version').then(function(ver) {
      document.getElementById('version-text').textContent = 'v' + ver;
      var vb = document.getElementById('version-badge');
      if (vb) vb.textContent = 'v' + ver;
    }).catch(function() {});

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

    const logs = [];
    const MAX_LOGS = 500;

    ipcRenderer.on('worker:status', (_, data) => {
      const btn = document.getElementById('connectBtn');
      const conn = document.getElementById('conn-status');
      if (data.type === 'connected') {
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('dashboard-section').style.display = 'block';
        if (conn) { conn.className = 'badge connected'; conn.textContent = '연결됨'; }
      } else if (data.type === 'error') {
        showStatus('연결 실패: ' + data.message, 'error');
        btn.textContent = '호스트 서버에 연결';
        btn.disabled = false;
      } else if (data.type === 'disconnected') {
        if (conn) { conn.className = 'badge disconnected'; conn.textContent = '연결 끊김 (로컬 작업 계속)'; }
      }
    });

    var shoppingList = [];
    var crankList = [];
    function renderKeywordList() {
      var totalCount = shoppingList.length + crankList.length;
      var list = document.getElementById('keyword-list');
      var header = '<div class="kw-header"><span>키워드</span><span>상품명/카페명</span><span>상품번호/게시글</span></div>';
      var shoppingHtml = shoppingList.map(function(k) {
        return '<div class="kw-row"><span class="kw-keyword">' + escapeHtml(k.keyword) + '</span><span class="kw-name">' + escapeHtml(k.purchaseName || '-') + '</span><span class="kw-product">' + escapeHtml(k.itemName || '') + '</span></div>';
      }).join('');
      var crankHtml = crankList.map(function(k) {
        return '<div class="kw-row"><span class="kw-keyword">[C랭크] ' + escapeHtml(k.keyword) + '</span><span class="kw-name">' + escapeHtml(k.cafeName || '-') + '</span><span class="kw-product">' + escapeHtml(k.postTitle || '') + '</span></div>';
      }).join('');
      list.innerHTML = header + shoppingHtml + crankHtml;
      document.querySelectorAll('.tab')[1].textContent = '키워드/상품 (' + totalCount + ')';
    }
    ipcRenderer.on('worker:knowledges', (_, knowledges) => {
      shoppingList = knowledges || [];
      renderKeywordList();
    });
    ipcRenderer.on('worker:crank-knowledges', (_, cknowledges) => {
      crankList = cknowledges || [];
      renderKeywordList();
    });

    ipcRenderer.on('worker:log-entry', (_, entry) => {
      logs.push(entry);
      if (logs.length > MAX_LOGS) logs.shift();
      const container = document.getElementById('log-container');
      const levelClass = 'log-' + (entry.level || 'info');
      const time = new Date(entry.createdAt).toLocaleTimeString();
      container.innerHTML += '<div class="log-line"><span class="log-time">' + time + '</span><span class="' + levelClass + '">' + escapeHtml(entry.message) + '</span></div>';
      container.scrollTop = container.scrollHeight;
    });

    ipcRenderer.on('worker:runner-status', (_, status) => {
      const badge = document.getElementById('runner-badge');
      const startBtn = document.getElementById('startBtn');
      const stopBtn = document.getElementById('stopBtn');
      if (status === 'running') {
        badge.className = 'badge running'; badge.textContent = '실행 중';
        startBtn.style.display = 'none'; stopBtn.style.display = 'inline-block';
      } else if (status === 'stopping') {
        badge.className = 'badge stopping'; badge.textContent = '정지 중';
        startBtn.style.display = 'none'; stopBtn.style.display = 'none';
      } else {
        badge.className = 'badge idle'; badge.textContent = '대기 중';
        startBtn.style.display = 'inline-block'; stopBtn.style.display = 'none';
      }
    });

    function doStart() { ipcRenderer.send('worker:start'); }
    function doStop() { ipcRenderer.send('worker:stop'); }
    function doDisconnect() {
      ipcRenderer.send('worker:disconnect');
      document.getElementById('login-section').style.display = 'block';
      document.getElementById('dashboard-section').style.display = 'none';
      document.getElementById('log-container').innerHTML = '';
      logs.length = 0;
      const btn = document.getElementById('connectBtn');
      btn.textContent = '호스트 서버에 연결';
      btn.disabled = false;
    }

    function switchTab(tabName, el) {
      document.querySelectorAll('.tab-content').forEach(function(e) { e.style.display = 'none'; });
      document.querySelectorAll('.tab').forEach(function(e) { e.classList.remove('active'); });
      document.getElementById('tab-' + tabName).style.display = 'block';
      el.classList.add('active');
    }

    function escapeHtml(str) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(str));
      return div.innerHTML;
    }
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
  // electron-log 로 autoUpdater 동작을 파일에 남긴다.
  // 로그 위치 (Windows): %USERPROFILE%\AppData\Roaming\SHS_Traffic\logs\main.log
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
  (autoUpdater as any).logger = log;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  log.info(`[AutoUpdater] 시작. 현재 버전: ${app.getVersion()}`);

  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdater] 업데이트 확인 중...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info(`[AutoUpdater] 업데이트 발견: ${info.version}`);
    notifyStatus(`새 버전(${info.version})을 다운로드 중입니다...`);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[AutoUpdater] 최신 버전입니다.');
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[AutoUpdater] 다운로드 진행률: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[AutoUpdater] 업데이트 다운로드 완료: ${info.version}`);
    notifyStatus(`새 버전(${info.version}) 적용을 위해 5초 후 재시작합니다...`);
    setTimeout(() => {
      // 업데이트용 quit임을 표시 → before-quit 핸들러가 가로채지 않도록
      isQuittingForUpdate = true;
      (app as any).isQuittingForUpdate = true;
      (app as any).isQuitting = true;
      log.info('[AutoUpdater] quitAndInstall 호출');
      // isSilent=true, isForceRunAfter=true (NSIS oneClick:true 와 함께 사용)
      autoUpdater.quitAndInstall(true, true);
    }, 5000);
  });

  autoUpdater.on('error', (err) => {
    log.error('[AutoUpdater] 오류:', err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    log.error('[AutoUpdater] 업데이트 확인 실패:', err);
  });
}

// ─── 워커 클라이언트 로직 (IPC) ───

let workerClient: any = null;

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.on('worker:connect', async (_event, data: { serverUrl: string; loginId: string; loginPw: string }) => {
  try {
    const { WorkerClient } = await import('./worker-client-lib');
    if (workerClient) {
      workerClient.disconnect();
    }
    const serverUrl = data.serverUrl.replace(/\/+$/, '');
    const cacheDir = path.join(app.getPath('userData'), 'worker-cache');
    workerClient = new WorkerClient({
      serverUrl,
      loginId: data.loginId,
      loginPassword: data.loginPw,
      cacheDir,
    });

    workerClient.on('connected', () => {
      loginWindow?.webContents.send('worker:status', { type: 'connected' });
      loginWindow?.webContents.send('worker:knowledges', workerClient.getKnowledges());
      loginWindow?.webContents.send('worker:crank-knowledges', workerClient.getCrankKnowledges());
      notifyStatus('호스트 서버에 연결되었습니다.');
    });

    workerClient.on('disconnected', () => {
      loginWindow?.webContents.send('worker:status', { type: 'disconnected' });
    });

    workerClient.on('error', (msg: string) => {
      loginWindow?.webContents.send('worker:status', { type: 'error', message: msg });
    });

    workerClient.on('log', (msg: string, level: string) => {
      loginWindow?.webContents.send('worker:log-entry', { message: msg, level, createdAt: Date.now() });
    });

    workerClient.on('runner-status', (status: string) => {
      loginWindow?.webContents.send('worker:runner-status', status);
    });

    workerClient.on('knowledges', (knowledges: any[]) => {
      loginWindow?.webContents.send('worker:knowledges', knowledges);
      loginWindow?.webContents.send('worker:crank-knowledges', workerClient!.getCrankKnowledges());
    });

    workerClient.start();
  } catch (e: any) {
    loginWindow?.webContents.send('worker:status', { type: 'error', message: e.message });
  }
});

ipcMain.on('open-dashboard', () => {
  openDashboard();
});

ipcMain.on('worker:start', () => {
  workerClient?.requestStart();
});

ipcMain.on('worker:stop', () => {
  workerClient?.requestStop();
});

ipcMain.on('worker:disconnect', () => {
  if (workerClient) {
    workerClient.disconnect();
    workerClient = null;
  }
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
  // 업데이트 설치를 위한 quit이면 절대 막지 않는다 (electron-updater가 NSIS 실행 직전)
  if (isQuittingForUpdate) {
    log.info('[before-quit] 업데이트 설치를 위한 quit이라 그대로 진행합니다.');
    return;
  }
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
