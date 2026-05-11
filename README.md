# 지식쇼핑 상위노출 — 독립 실행판 (Firebase 없음)

기존 Electron 단일 데스크톱 앱을 두 덩어리로 나누되, **외부 클라우드 의존을 모두 제거**했습니다.
모든 데이터는 사용자 PC 의 SQLite 에 저장되고, 인증은 로컬 bcrypt + JWT 쿠키입니다.

```
프로젝트 루트/
├─ shared/   # 도메인 타입과 API 경로 정의 (단일 출처)
├─ web/      # 사용자가 브라우저로 보는 콘솔 (Vite + React + Chakra)
└─ agent/    # PC 트레이 앱 (Electron + Express + WebSocket + better-sqlite3)
```

`vscode_project/` 폴더는 기존(원본) 앱이며 참고용으로 남아있습니다.

## 동작 흐름

```
사용자 PC 한 대 안에서 모두 동작
┌──────────────────────────────────────────────────┐
│ 에이전트 (Electron, 트레이 상주)                 │
│  ├ 내장 Express 서버  (127.0.0.1:17321)          │
│  ├ WebSocket /ws      (실시간 로그·상태)         │
│  ├ 정적 파일 서빙      (web/dist 배포 시)        │
│  ├ SQLite (data.db)   (모든 데이터 로컬 저장)    │
│  └ 크롤러 엔진         (Puppeteer/ADB/VPN — 추후) │
└──────────────────────┬───────────────────────────┘
                       │ http://127.0.0.1:17321
                       ▼
   사용자가 평소 쓰는 브라우저 (Chrome/Edge)
```

- **외부 서버 없음 · Firebase 없음 · 인터넷 없어도 동작** (네이버 자동화 시에만 인터넷 필요)
- 데이터 위치: `%APPDATA%/KnowledgeShoppingAgent/data.db` (윈도우)
- 외부에서 접속 불가 — 에이전트는 `127.0.0.1` 만 바인딩합니다

## 처음 실행하기

### 1. 의존성 설치

```powershell
# 1) 에이전트
cd agent
npm install

# 2) 웹
cd ../web
npm install
```

### 2. 개발 모드 실행

서로 다른 터미널 두 개에서 띄웁니다.

```powershell
# 터미널 A — 에이전트 (Electron + Express + WS, 포트 17321)
cd agent
npm run dev

# 터미널 B — 웹 (Vite, 포트 5173, /api·/ws 는 17321 로 프록시)
cd web
npm run dev
```

### 3. 사용

1. 브라우저에서 http://localhost:5173 접속.
2. 첫 실행이면 **최초 관리자 계정** 만들기 화면이 뜸 → 이메일·비밀번호 입력.
3. 대시보드에서 ▶ **시작** 누르면 모의 작업이 단계별로 실행되고, 실시간 로그가 흐릅니다.

### 4. 운영 모드 (배포)

```powershell
# 웹을 빌드하고 산출물을 에이전트의 web-dist 로 복사 후 에이전트도 빌드
cd web && npm run build
mkdir ../agent/web-dist -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force dist/* ../agent/web-dist/
cd ../agent && npm run build
npm start
```

운영 모드에서는 트레이 메뉴 → "대시보드 열기" 가 바로 `http://127.0.0.1:17321` 을 기본 브라우저로 엽니다 (vite 가 끼어들지 않음).

## 다음 단계 (모의 작업 → 실제 자동화)

`agent/src/runner.ts` 의 `runMock()` 자리에 `vscode_project/electron/crawler/controller/crawlerController.js` 의 `start()` 와 `_startTopExposureLogic()` 를 옮겨 끼우면 됩니다. 이때 ADB / VPN / Puppeteer 모듈은 모두 에이전트 프로세스에서 그대로 동작합니다 (브라우저는 절대 접근 불가).

## 데이터 모델

| Firestore (이전) | SQLite 테이블 (지금) |
|---|---|
| `users/{uid}` | `users` (bcrypt 해시 저장) |
| `users/{uid}/knowledges/*` | `knowledges` |
| `users/{uid}/naverAccounts/*` | `naver_accounts` |
| 사용자 setting 필드 | `settings` (단일 행 JSON) |
| 로그 (없었음) | `logs` |
