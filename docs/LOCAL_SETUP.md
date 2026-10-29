# 실제 연결 준비 안내

지금 구조는 이렇습니다.

- 로컬 Node의 NestJS 서버(`src/*.ts`를 빌드한 `dist/main.js`, 포트 4185)가 GAS 웹앱을 부릅니다.
- 웹앱은 "모든 사용자" 접근으로 배포하고, 로컬 서버는 웹앱 URL만으로 부릅니다. 그래서 URL을 비밀값처럼 다룹니다.
- GAS 웹앱은 검사 기록을 Google Sheets에, 사진을 Drive에 저장합니다.

이 저장소는 수업에서 만드는 텀블러 공장 앱을 따라하기 28번(Google 저장)까지 만든 상태입니다. 실제 연결에 쓰는 Google 계정은 수업 안내를 따릅니다.

GAS를 준비하는 경로는 두 가지입니다.

- **clasp(기본)**: Antigravity가 터미널 명령으로 프로젝트를 만들고, 코드를 올리고, 배포합니다. 9단계이고, 웹에서 하는 일은 Apps Script API 켜기, 로그인 허용, 첫 권한 승인, 배포 접근 확인입니다.
- **편집기 붙여넣기(대안)**: 묶음 파일 하나를 Apps Script 편집기에 붙여 넣고 편집기에서 배포합니다. 7단계입니다.

## 저장소 스위치

`.env`의 `STORAGE_MODE`로 저장소를 고릅니다.

| 이름 | 값 | 기본값 |
|---|---|---|
| `STORAGE_MODE` | `live`, `mock` | `mock`. `live`에는 `GAS_WEBAPP_URL`이 필요합니다 |

- `live` 저장소는 GAS 웹앱(실제 Sheets·Drive), `mock` 저장소는 로컬 모의 저장소(`runtime/local-gas-state.json`)입니다.
- 값은 소문자 그대로만 받습니다. 값이 틀리면 서버가 시작하지 않고 이유와 고칠 방법을 한 줄로 알립니다.
- 옛 이름 `GAS_TRANSPORT_MODE`(`oauth`는 `live`로 읽고 경고, `mock`은 `mock`)도 읽습니다. 새 이름과 함께 넣으면 값이 같아야 합니다.
- 서버는 시작할 때 `연동 상태: 저장소=mock(로컬 파일)`처럼 한 줄을 냅니다.

## 읽기 전에

- **Google 로그인과 권한 승인은 사용자가 직접 합니다. 에이전트가 대신하지 않습니다.**
- **에이전트에게 `.env`를 읽히지 않습니다.** 웹앱 URL이 대화 기록에 남습니다.
- 명령은 Windows PowerShell 기준(`npm.cmd`)으로 먼저 적고, macOS는 괄호로 덧붙였습니다.
- 명령은 모두 저장소 폴더에서 실행합니다.
- Node.js 22.12 이상이 필요합니다.
- 웹앱 URL은 `.env`에 둡니다. `.env`는 Git에서 제외됩니다(`.gitignore`).
- `.env`는 UTF-8(BOM 없음)로 저장합니다. BOM이 붙어 있으면 `npm.cmd start`와 `npm.cmd run gas:init`이 안내를 내고 멈춥니다.
- Google 화면의 메뉴 이름은 바뀔 수 있습니다. 이 문서의 화면 이름은 코드로 확인한 것이 아닙니다.
- 단계마다 **할 곳**을 적었습니다.
  - 터미널(Antigravity): 저장소 폴더의 터미널 명령으로 끝납니다. Antigravity에 시켜도 됩니다.
  - 웹(클릭): Google 웹 화면에서 본인이 누릅니다. 명령 뒤에 브라우저가 열리는 단계는 「터미널(Antigravity), 이어서 웹(클릭)」으로 적었습니다.
  - 사용자 직접(.env 편집): 본인이 메모장(macOS: 텍스트 편집기)으로 고칩니다. 에이전트에게 `.env`를 열게 하지 않습니다.
- 「확인:」 줄 끝의 표시는 이렇게 읽습니다.
  - `(로컬 실행으로 확인)`: 이 문서를 고칠 때(2026-10-16) 이 저장소에서 실제로 실행해 본 출력입니다.
  - `(실제 배포로 확인)`: 2026-10-16에 강사용 GAS를 macOS에서 clasp 경로로 실제 배포하며 본 출력과 화면입니다. Google Workspace 계정으로 했습니다.
  - `미확인(실계정 필요)`: Google 계정과 실제 GAS가 있어야 해서 실행하지 못한 단계입니다. 코드에 적힌 문구를 옮겼습니다.
  - `미확인(Windows)`: macOS에서만 실행해 본 동작입니다. Windows 명령 조립은 시험 코드로만 확인했습니다.
  - `미확인(개인 Gmail)`: Workspace 계정으로만 확인한 동작입니다. 개인 Gmail 계정에서는 해 보지 않았습니다.
  - `미확인`: 실제 배포에서도 아직 해 보지 않은 동작입니다(예: 배포 갱신 뒤의 접근 설정).

**Windows에서 명령 입력하기**
- 창의 줄 맨 앞이 `C:\...>`로 시작하면 명령 프롬프트, `PS C:\...>`로 시작하면 PowerShell입니다.
- 명령 프롬프트에서는 안내한 명령을 그대로 칩니다. 예: `npm start`
- PowerShell에서는 `npm`을 `npm.cmd`로, `npx`를 `npx.cmd`로 바꿔 칩니다. 예: `npm.cmd start`
- PowerShell에서 `.cmd` 없이 쳤다가 "이 시스템에서 스크립트를 실행할 수 없으므로 … npm.ps1 파일을 로드할 수 없습니다" 오류가 나면 `npm.cmd`로 다시 칩니다.
- 매번 바꿔 치기 번거로우면 PowerShell에서 아래 명령을 한 번만 실행합니다. 확인을 물으면 `Y`를 누르고, PowerShell 창을 닫았다가 새로 엽니다. 지금 로그인한 사용자 계정에만 적용되고, 그 뒤로는 `npm`을 그대로 쳐도 됩니다.
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
- 학교·회사 PC에서 이 명령이 "더 구체적인 범위에서 정의된 정책" 같은 문구로 적용되지 않으면 관리자 정책 때문입니다. 그때는 계속 `npm.cmd`로 칩니다.

### 기존 GAS·시트·Drive와 섞지 않기

- 이 안내는 **새 Apps Script 프로젝트**를 만듭니다. 대표가 쓰던 기존 GAS 프로젝트와 배포, Sheets, Drive 폴더는 쓰지 않습니다.
- 기존 프로젝트에 묶음 파일을 붙여 넣거나 `npm.cmd run gas:push`로 올리지 않습니다. 둘 다 그 프로젝트의 코드를 덮어씁니다.
- 기존 배포를 새 버전으로 바꾸지 않습니다. 그 배포를 쓰는 서버가 새 코드로 바뀝니다.
- 스크립트 속성의 `SPREADSHEET_ID`와 `DRIVE_FOLDER_ID`를 다른 사람의 값으로 바꾸지 않습니다. `setupTumblerResources`가 새 시트와 폴더를 만들어 적습니다.
- 다른 사람의 `.clasp.json`이나 `.env`를 이 저장소로 복사하지 않습니다.

### 웹앱 URL을 두는 곳

웹앱 URL은 `.env`에만 둡니다. 문서, 채팅, Git에 적지 않습니다.

- **웹앱 URL을 아는 사람은 누구나 시트·사진을 읽고 쓸 수 있습니다.** 공유 비밀값 없이 URL만으로 부르는 구조입니다.
  URL은 `.env`에만 두고 화면 공유, 채팅, 문서에 올리지 않습니다.

`.env`가 Git에서 빠지는지 먼저 확인합니다.

```powershell
git check-ignore -v .env
```

확인: `.gitignore:4:.env` 뒤에 탭과 `.env`가 이어진 한 줄(`.gitignore:4:.env	.env`)이 나옵니다. (로컬 실행으로 확인) 아무것도 나오지 않으면 `.env`를 만들지 말고 `.gitignore`부터 확인합니다.

### 자격증명과 설정 값

| 위치 | 넣는 쪽 | 내용 |
|---|---|---|
| `.env`의 `GAS_WEBAPP_URL`, `STORAGE_MODE=live` | `npm.cmd run gas:deploy` | 웹앱 주소와 저장소 스위치. 붙여넣기 경로에서는 사용자가 적습니다 |
| 스크립트 속성 `SPREADSHEET_ID`, `DRIVE_FOLDER_ID` | `npm.cmd run gas:init` 또는 편집기의 `setupTumblerResources` | 시트와 Drive 사진 폴더 ID |
| `build/` | `npm.cmd run gas:bundle`, `npm.cmd run gas:build` | 올릴 GAS 코드. Git 제외 |
| `.clasp.json` | `npm.cmd run gas:create`(clasp 경로) | GAS 프로젝트 ID와 올릴 폴더. Git 제외 |
| 홈 폴더의 `.clasprc.json` | `npm.cmd run gas:login`(clasp 경로) | clasp 로그인 자격. 다른 사람과 나누지 않습니다 |

- 스크립트 속성은 편집기의 프로젝트 설정에 있습니다.
- 스크립트 속성은 명령과 함수가 씁니다. 직접 넣을 것은 없습니다.

## 0단계. 모의 실행

설정 없이 먼저 띄웁니다.

```powershell
npm.cmd ci
npm.cmd start
```

(macOS: `npm ci`, `npm start`)

- `npm.cmd start`는 서버를 띄우기 전에 `npm.cmd run build`로 `src/`를 `dist/`에 빌드합니다. 빌드에 개발 의존성인 TypeScript가 쓰여서 `--omit=dev` 없이 설치합니다. `--omit=dev`로 설치하면 `tsc: command not found`로 멈춥니다. (로컬 실행으로 확인, 2026-10-22)
- `.env`가 없으면 `.env not found. Continuing without it.`가 나옵니다. 정상입니다.
- `.env`에 BOM이 있으면 서버가 안내를 내고 종료합니다.
- 실행하면 `runtime/` 폴더가 생깁니다.

할 곳: 터미널(Antigravity)

확인: 터미널에 `GAS 품질 대시보드 서버 실행 중: http://127.0.0.1:4185`와 `연동 상태: 저장소=mock(로컬 파일)`이 나옵니다. (로컬 실행으로 확인)

이어서 설정 파일을 만듭니다. 그대로 두면 모두 주석이라 모의 단계 그대로입니다.

```powershell
Copy-Item .env.example .env
```

(macOS: `cp .env.example .env`)

확인: 저장소 폴더에 `.env`가 생깁니다. (로컬 실행으로 확인)

## 이미지 준비

1. 이미지 저장소를 앱 저장소 바로 바깥 폴더로 clone합니다. 명령은 앱 저장소 폴더에서 실행합니다.

```powershell
git clone https://github.com/startup-life/manufacturing-quality-student-images.git ../manufacturing-quality-student-images
```

2. 사진을 복사합니다.

```powershell
node scripts/fetch-images.mjs --from ../manufacturing-quality-student-images
```

3. 복사한 사진을 확인합니다.

```powershell
node scripts/check-assets.mjs
```

- 명령은 macOS 터미널에서도 같습니다.
- 사진은 `runtime/images/`에, 확인 기록은 `runtime/image-verification.json`에 저장됩니다.
- `runtime/images/`는 화면의 학습 사진으로 쓰입니다.

할 곳: 터미널(Antigravity)

확인: 2에서 `Images verified: 128`이 나오고, 3에서 `{"unique_images":128,"counts":{"val":64,"train":64},`로 시작하는 한 줄이 나옵니다. (로컬 실행으로 확인) Windows에서는 사진 크기 확인을 건너뛰어 3의 한 줄 앞에 `Dimension check unavailable`로 시작하는 줄이 먼저 나옵니다. 미확인(Windows).

## clasp 경로(기본)

Antigravity가 터미널 명령으로 프로젝트를 만들고, 코드를 올리고, 배포합니다.

- clasp는 `npm.cmd run gas:*` 명령이 `npx`로 3.4.1을 받아 실행합니다. 따로 설치하지 않습니다.
- PowerShell에서는 `npm` 대신 `npm.cmd`로 칩니다. clasp를 직접 칠 때는 같은 이유로 `clasp.cmd`가 필요할 수 있습니다.
- `npm.cmd run gas:push`는 편집기의 코드와 매니페스트를 로컬 내용으로 덮어씁니다(`--force`). 편집기에서 고친 것은 사라집니다.
- `gas:deploy`, `gas:redeploy`, `gas:open`은 `scripts/gas-clasp.mjs`(래퍼)를 부릅니다. 래퍼는 clasp(`npx --yes @google/clasp@3.4.1 …`)와 브라우저 열기(Windows `start`, macOS `open`)를 셸 명령 한 줄로 실행합니다. Windows에서는 셸이 `npx.cmd`를 찾습니다. Windows에서 실행하지 않았고 시험 코드로도 확인하지 않았습니다. 미확인(Windows).
- 래퍼는 clasp의 출력을 그대로 화면에 보여 줍니다. 종료 코드가 아니라 그 출력으로 성공을 판단합니다(5단계, 「다시 배포할 때」).
- `gas:editor`는 래퍼를 거치지 않고 clasp의 `open-script`를 바로 부릅니다.

Antigravity에 맡길 때는 이렇게 짧게 지시합니다. 명령이 끝나면 터미널 결과를 확인합니다.

```text
이 저장소 폴더에서 npm.cmd run gas:create를 실행하고 결과만 알려 줘. .env는 열지 마.
npm.cmd run gas:push와 npm.cmd run gas:deploy를 차례로 실행해 줘. 출력에 나온 다음 할 일만 알려 줘.
npm.cmd run gas:init을 실행하고, 실패하면 터미널에 나온 한 줄을 그대로 보여 줘.
```

| 단계 | 할 일 | 할 곳 | 명령·화면 |
|---|---|---|---|
| 1 | Apps Script API 켜기 | 웹(클릭) | script.google.com/home/usersettings |
| 2 | clasp 로그인 | 터미널(Antigravity), 이어서 웹(클릭) | `npm.cmd run gas:login` |
| 3 | GAS 프로젝트 만들기 | 터미널(Antigravity) | `npm.cmd run gas:create` |
| 4 | 코드 올리기 | 터미널(Antigravity) | `npm.cmd run gas:push` |
| 5 | 웹앱 배포 | 터미널(Antigravity) | `npm.cmd run gas:deploy` |
| 6 | 첫 권한 승인 | 터미널(Antigravity), 이어서 웹(클릭) | `npm.cmd run gas:open` |
| 7 | 배포 접근 확인 | 웹(클릭) | 편집기의 배포 관리 |
| 8 | 초기화 | 터미널(Antigravity) | `npm.cmd run gas:init` |
| 9 | 실행과 등록 1건 확인 | 터미널(Antigravity), 이어서 앱 화면 | `npm.cmd start` |

### 1. Apps Script API 켜기

할 곳: 웹(클릭)

script.google.com/home/usersettings에서 Google Apps Script API를 켭니다. 기본값은 꺼져 있습니다.

확인: 그 화면의 Google Apps Script API가 켜져 있습니다. 미확인(실계정 필요).

### 2. clasp 로그인

할 곳: 터미널(Antigravity), 이어서 웹(클릭)

```powershell
npm.cmd run gas:login
```

(macOS: `npm run gas:login`)

- 브라우저가 열리면 본인 계정을 고르고, 요청한 권한을 모두 선택해 허용합니다.
- 로그인 자격은 홈 폴더의 `.clasprc.json`에 저장됩니다. 다른 사람과 나누지 않습니다.

확인: 명령이 오류 없이 끝나고 홈 폴더에 `.clasprc.json`이 생깁니다. 미확인(실계정 필요).

### 3. GAS 프로젝트 만들기

할 곳: 터미널(Antigravity)

```powershell
npm.cmd run gas:create
```

(macOS: `npm run gas:create`)

- 코드를 `build/gas`에 모은 뒤 standalone 프로젝트를 만듭니다.
- 저장소 폴더에 `.clasp.json`이 생깁니다. 사람마다 프로젝트 ID가 달라 Git에서 제외합니다.
- 프로젝트를 만든 뒤 clasp가 원격의 기본 `appsscript.json`을 `build/gas`로 받아 옵니다. 터미널에 `Cloned one file..`이 나옵니다. (실제 배포로 확인) 이 기본 매니페스트는 4단계에서 우리 매니페스트로 덮어씁니다.

확인: `.clasp.json`이 생기고 그 안의 `rootDir`가 `build/gas`입니다. 다르면 `build/gas`로 고칩니다. 미확인(실계정 필요). 앞부분의 `gas:build`는 로컬에서 실행해 `build/gas`에 4개 파일(`Code.gs`, `Live.gs`, `Setup.gs`, `appsscript.json`)이 생기는 것을 확인했습니다.

### 4. 코드 올리기

할 곳: 터미널(Antigravity)

```powershell
npm.cmd run gas:push
```

(macOS: `npm run gas:push`)

- 먼저 `build/gas`를 새로 만들고 그 내용을 올립니다.
- 3단계에서 받아 온 기본 매니페스트를 우리 매니페스트로 덮어쓰도록 `--force`를 붙여 올립니다. `--force`가 없으면 clasp가 덮어쓸지 묻는데, 입력을 받지 않는 터미널(에이전트가 실행하는 터미널)에서는 "아니오"로 처리되어 `Skipping push.`만 나오고 아무 파일도 올라가지 않습니다.

확인: 명령이 오류 없이 끝나고 터미널에 올린 파일 4개가 나옵니다. 파일 7개를 올린 이전 구성으로는 실제 배포로 확인했고, 지금 구성은 미확인(실계정 필요). 미확인(Windows).

### 5. 웹앱 배포

할 곳: 터미널(Antigravity)

```powershell
npm.cmd run gas:deploy
```

(macOS: `npm run gas:deploy`)

- clasp로 웹앱 배포를 만들고, 출력에서 배포 ID(`AKfyc`로 시작)를 찾아 `.env`에 `GAS_WEBAPP_URL=https://script.google.com/macros/s/<배포 ID>/exec`를 적습니다.
- 주석이 아닌 `GAS_WEBAPP_URL=` 줄이 있으면 그 줄을 바꾸고, 없으면 끝에 더합니다. 주석이 아닌 `STORAGE_MODE=` 줄이 없으면 끝에 `STORAGE_MODE=live`도 더합니다. 다른 줄은 그대로 둡니다. `.env`가 없으면 `.env.example`을 복사해 만듭니다.
- `STORAGE_MODE=mock`이 적혀 있으면 바꾸지 않습니다. 옛 이름 `GAS_TRANSPORT_MODE`는 보지 않습니다. `GAS_TRANSPORT_MODE=mock`만 있는 `.env`에서는 `STORAGE_MODE=live`가 더해져 `npm.cmd start`가 두 값이 다르다며 멈춥니다. 그때는 `GAS_TRANSPORT_MODE` 줄을 지웁니다.
- `.env`에 웹앱 주소가 이미 있으면 새 배포를 만들지 않습니다. 같은 주소로 갱신은 「다시 배포할 때」를 따릅니다.
- clasp 출력에 배포 ID가 그대로 나오고, `gas:open`은 웹앱 주소를 터미널에 출력합니다. 배포 ID를 알면 웹앱 주소를 만들 수 있으니 이 터미널 화면도 공유하지 않습니다.

- **웹앱 URL을 아는 사람은 누구나 시트·사진을 읽고 쓸 수 있습니다.** 공유 비밀값 없이 URL만으로 부르는 구조입니다.
  URL은 `.env`에만 두고 화면 공유, 채팅, 문서에 올리지 않습니다.

확인: 터미널에 clasp 출력(`Deployed <배포 ID> @<버전>`)에 이어 `.env에 GAS_WEBAPP_URL을 적었습니다.`와 `다음: npm.cmd run gas:init(macOS: npm run gas:init)`이 나옵니다. 2026-10-16 실제 배포에서는 그때의 래퍼가 clasp 3.4.1의 출력에서 배포 ID를 찾아 `.env`에 주소를 적었습니다. 지금 래퍼로는 실제 배포를 하지 않았습니다. 미확인(실계정 필요) 미확인(Windows).

- `.env`에 주소가 이미 있으면 clasp를 부르지 않고 `이미 배포 주소가 있습니다. npm.cmd run gas:redeploy(macOS: npm run gas:redeploy)로 갱신하세요.`를 낸 뒤 종료 코드 1로 끝납니다. 2026-10-20에 macOS에서 실행해 확인했습니다.
- 출력에서 배포 ID를 하나로 찾지 못하면 `.env`를 고치지 않고 `clasp 출력에서 배포 ID를 찾지 못했습니다. 위 출력을 확인하고, 로그인이 만료됐으면 npm.cmd run gas:login(macOS: npm run gas:login)을 다시 실행하세요.`가 나옵니다(종료 코드 1). 2026-10-20에 macOS에서 clasp 대신 가짜 `npx`를 두고 실행해 확인했습니다. 배포는 만들어졌는데 ID만 찾지 못했으면 7단계에서 편집기의 배포 관리를 열어 웹앱 URL을 복사해 `.env`에 직접 넣습니다.

### 6. 첫 권한 승인

할 곳: 터미널(Antigravity), 이어서 웹(클릭)

```powershell
npm.cmd run gas:open
```

(macOS: `npm run gas:open`)

- `.env`의 웹앱 주소를 기본 브라우저로 엽니다(Windows `start`, macOS `open`). 열기 전에 터미널에 `브라우저로 엽니다. 권한 승인 화면이 나오면 허용하세요.`와 웹앱 주소를 출력합니다.
- 배포한 계정으로 열면 승인 화면이 나옵니다. 2026-10-16 실제 배포에서는 이 순서였습니다. (실제 배포로 확인)
  1. "Authorization needed" 화면에서 REVIEW PERMISSIONS를 누릅니다.
  2. 배포한 계정을 고릅니다.
  3. 확인되지 않은 앱이라는 경고가 나오면 "고급"을 누르고 "텀블러 품질 대시보드(으)로 이동(안전하지 않음)"을 누릅니다. 본인이 만든 프로젝트라 이 경고가 나옵니다.
  4. 요청한 권한을 보고 허용합니다.
- 주소를 여는 것만으로 승인이 끝납니다. 승인 전에는 로그인 정보 없는 요청이 403 "액세스 거부됨"을 받고, 승인 뒤에는 같은 요청이 doGet 문구를 받습니다. (실제 배포로 확인)
- 그래도 안 되면 `npm.cmd run gas:editor`(macOS: `npm run gas:editor`)로 편집기를 열고, 함수 목록에서 `setupTumblerResources`를 골라 한 번 실행해 허용합니다.

**브라우저에 Google 계정이 여러 개 로그인돼 있을 때**

- `gas:open`이 여는 웹앱 기본 주소(`https://script.google.com/macros/s/<배포 ID>/exec`)는 배포한 계정이 아닌 기본 계정으로 열릴 수 있습니다. 그러면 승인 화면 대신 "액세스 거부됨"과 Drive 액세스 권한이 필요하다는 화면이 나오고, 로그인된 계정에 다른 계정이 보입니다. (실제 배포로 확인)
- `gas:open`은 `.env`의 주소를 기본 브라우저로 열기만 합니다. 이때는 본인이 주소를 직접 열어야 합니다.
- 배포한 계정 하나만 로그인된 창에서 주소를 엽니다. 예를 들어 시크릿 창을 열고 그 계정으로만 로그인한 뒤 주소를 붙여 넣습니다.
- Google Workspace 계정이면 주소를 `https://script.google.com/a/macros/<회사 도메인>/s/<배포 ID>/exec` 꼴로 고쳐 열면 배포한 계정으로 열리고 승인 화면이 나옵니다. (실제 배포로 확인)
- 개인 Gmail 계정에서 어떻게 되는지는 해 보지 않았습니다. 미확인(개인 Gmail).
- 주소를 고쳐 여는 것은 승인할 때만입니다. `.env`의 `GAS_WEBAPP_URL`은 그대로 둡니다.

확인: 허용한 뒤 브라우저에 `권한 승인이 끝났습니다. 이 창을 닫고 터미널로 돌아가세요.`가 보입니다. (실제 배포로 확인) 지금 래퍼의 `gas:open`이 브라우저를 여는 것은 실행해 보지 않았습니다. 터미널 문구는 코드에서 옮겼습니다. 미확인 미확인(Windows).

### 7. 배포 접근 확인

할 곳: 웹(클릭)

clasp로 만든 배포에 매니페스트의 웹앱 접근 설정이 빠질 수 있다는 보고가 있습니다(clasp 이슈 #1115). 2026-10-16 실제 배포에서는 빠지지 않았습니다. 첫 승인 뒤 로그인 정보 없이 웹앱 주소를 부르자 doGet 문구가 돌아왔습니다. `gas:deploy`(clasp 3.4.1 `create-deployment`)가 `appsscript.json`의 "모든 사용자" 접근 설정을 반영한다는 뜻입니다. (실제 배포로 확인) Workspace 계정으로만 확인했습니다. 미확인(개인 Gmail).

개인 Gmail 계정이거나 8단계에서 `GAS_HTTP_403`이 나오면 아래를 봅니다.

1. `npm.cmd run gas:editor`(macOS: `npm run gas:editor`)로 편집기를 열고 배포, 배포 관리를 엽니다.
2. 5단계에서 만든 배포가 웹 앱이고, 실행 사용자가 "나", 액세스 권한이 있는 사용자가 "모든 사용자"인지 봅니다.
3. 다르면 편집해서 고치고 새 버전으로 배포합니다. 주소는 그대로입니다.

확인: 배포 관리에 보이는 설정이 웹 앱, 나, 모든 사용자입니다. 실제 배포에서는 배포 관리 화면을 열지 않고, 로그인 정보 없는 요청이 doGet 문구를 받는 것으로 접근 설정을 확인했습니다. 미확인(개인 Gmail).

### 8. 초기화

할 곳: 터미널(Antigravity)

```powershell
npm.cmd run gas:init
```

(macOS: `npm run gas:init`)

- 맨 먼저 시트와 Drive 사진 폴더를 만듭니다. 이미 있으면 그대로 씁니다.
- 이어서 제품 3종과 불량 코드 4개(D01~D04)를 보냅니다. 다시 실행해도 같은 행을 더 만들지 않습니다.

확인: 터미널에 아래 한 줄이 나옵니다. 미확인(실계정 필요) 미확인(Windows).

```text
Sheets와 Drive 사진 폴더를 준비하고 제품·불량 코드를 보냈습니다.
```

- 첫 권한 승인 전이면 `GAS 요청에 실패했습니다(GAS_HTTP_403). GAS 웹앱이 요청을 거절했습니다(HTTP 403). 배포한 계정으로 웹앱 주소를 한 번 열어 권한을 승인했는지(npm.cmd run gas:open, macOS: npm run gas:open), 웹앱 액세스가 '모든 사용자'인지 확인하세요.`가 나옵니다. 6단계를 하고, 그래도 같으면 7단계를 봅니다.
  승인 전에 로그인 정보 없는 GET 요청이 403을 받는 것은 실제 배포로 확인했습니다. `gas:init`이 보내는 POST도 403을 받는지는 미확인입니다.
- `GAS 요청에 실패했습니다(GAS_NOT_JSON). GAS 웹앱이 JSON이 아닌 응답을 돌려줬습니다. …`는 웹앱이 200으로 답했지만 본문이 JSON이 아닐 때입니다(편집기 경로에서 승인하지 않은 경우, Google의 오류 화면 등). 문구의 안내대로 주소를 열어 허용하거나 편집기에서 `setupTumblerResources`를 한 번 실행합니다.
- 설정이 틀리면 웹앱에 아무것도 보내지 않고 한 줄로 멈춥니다(종료 코드 1). 「로컬에서 실행해 확인한 것」에 실제 출력이 있습니다.

### 9. 실행과 등록 1건 확인

할 곳: 터미널(Antigravity), 이어서 앱 화면

```powershell
npm.cmd start
```

(macOS: `npm start`)

- 서버는 포트를 열기 전에 GAS 연결을 확인합니다. 실패하면 모의 단계로 바꾸지 않고 종료합니다.
- 로그인하고 검사를 등록합니다.
- 등록 한 번에 GAS 웹앱을 차례로 `사진 수 + 2`번 부릅니다(사진마다 저장 1번, 검사 저장, 검사 조회). 그동안 화면에 `사진 업로드 및 검사 등록을 처리 중입니다...`가 그대로 있어도 멈춘 것이 아니니 기다립니다.
- 화면을 열 때도 GAS 웹앱을 부르므로 몇 초 걸립니다. 홈은 웹앱 1번(집계)과 카드 목록 1번, 검사 목록과 검사 상세는 각각 1번입니다. 여러 요청이 겹쳐 30초 안에 차례가 오지 않으면 `서버가 현재 다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.`가 나오니 잠시 뒤 다시 엽니다.

확인: 터미널에 `연동 상태: 저장소=live(GAS 웹앱)`이 나옵니다. 등록한 검사가 시트의 `inspections` 탭에, 사진이 Drive의 "텀블러 공장 품질검사 사진" 폴더에 들어가고, 로그인한 브라우저에서 `/api/health`를 열면 `"provider":"gas"`가 보입니다. 미확인(실계정 필요).

## 편집기 붙여넣기 경로(대안)

clasp를 쓸 수 없을 때 Apps Script 편집기에서 직접 만들고 배포합니다.

| 단계 | 할 일 | 할 곳 |
|---|---|---|
| 1 | 묶음 파일 만들기 | 터미널(Antigravity) |
| 2 | 편집기에 붙여 넣기 | 웹(클릭) |
| 3 | 권한 승인과 자원 만들기 | 웹(클릭) |
| 4 | 웹앱으로 배포 | 웹(클릭) |
| 5 | 로컬 설정 | 사용자 직접(.env 편집) |
| 6 | 초기화 | 터미널(Antigravity) |
| 7 | 실행과 등록 1건 확인 | 터미널(Antigravity), 이어서 앱 화면 |

### 1. 묶음 파일 만들기

할 곳: 터미널(Antigravity)

```powershell
npm.cmd run gas:bundle
```

(macOS: `npm run gas:bundle`)

- `gas/`의 코드를 한 파일 `build/gas-bundle.js`로 묶습니다.
- 파일끼리 최상위 이름이 겹치면 만들지 않고 멈춥니다.

확인: 터미널에 `build/gas-bundle.js`(Windows는 `build\gas-bundle.js`)와 `Apps Script 편집기의 코드 파일 하나에 이 파일 전체를 붙여 넣습니다.`가 나옵니다. (로컬 실행으로 확인)

### 2. 편집기에 붙여 넣기

할 곳: 웹(클릭)

1. script.google.com에서 새 프로젝트를 만듭니다. 이름은 자유입니다(예: 텀블러 품질 대시보드).
2. `build/gas-bundle.js`를 메모장(macOS: 텍스트 편집기)으로 열어 전체를 복사합니다.
3. 편집기에 기본으로 있는 `Code.gs`의 내용을 모두 지우고 붙여 넣은 뒤 저장합니다.
4. 프로젝트 설정에서 "편집기에서 'appsscript.json' 매니페스트 파일 표시"를 켭니다.
5. 편집기에 나타난 `appsscript.json`의 내용을 모두 지우고 `gas/appsscript.json`의 내용을 붙여 넣은 뒤 저장합니다.

- 매니페스트에는 시간대(Asia/Seoul), 권한 범위(Sheets, Drive, 외부 요청), 웹앱 접근 설정이 들어 있습니다.

확인: 편집기 파일 목록에 `Code.gs`와 `appsscript.json`이 있고, 저장할 때 오류가 나지 않습니다. 미확인(실계정 필요).

### 3. 권한 승인과 자원 만들기

할 곳: 웹(클릭)

1. 편집기 위쪽의 함수 목록에서 `setupTumblerResources`를 고르고 실행합니다.
2. 권한 검토 창이 뜨면 본인 계정을 고릅니다.
3. "확인되지 않은 앱" 경고가 나오면 고급을 누르고 프로젝트로 이동해 허용합니다. 본인이 만든 프로젝트라 이 경고가 나옵니다.

- 이 함수는 시트와 Drive 사진 폴더를 한 번 만들고 그 ID를 스크립트 속성에 저장합니다. 다시 실행하면 있는 것을 그대로 씁니다. 6단계의 초기화도 같은 일을 하므로 겹쳐도 됩니다.

확인: 실행 로그에 `Sheets와 Drive 사진 폴더를 준비했습니다.`가 나옵니다. 미확인(실계정 필요).

### 4. 웹앱으로 배포

할 곳: 웹(클릭)

1. 편집기에서 배포, 새 배포를 고르고 유형을 웹 앱으로 정합니다.
2. 실행 사용자는 "나", 액세스 권한이 있는 사용자는 "모든 사용자"로 고릅니다. "Google 계정이 있는 모든 사용자"를 고르면 로컬 서버가 부를 수 없습니다.
3. 배포한 뒤 웹앱 URL을 복사합니다. `https://script.google.com/macros/s/`로 시작하고 `/exec`로 끝납니다.
   Google Workspace 계정이면 `https://script.google.com/a/macros/<도메인>/s/`로 시작할 수 있습니다. 서버는 이 꼴도 받습니다.

- **웹앱 URL을 아는 사람은 누구나 시트·사진을 읽고 쓸 수 있습니다.** 공유 비밀값 없이 URL만으로 부르는 구조입니다.
  URL은 `.env`에만 두고 화면 공유, 채팅, 문서에 올리지 않습니다.
- `/dev`로 끝나는 테스트 배포 주소는 쓰지 않습니다. 서버가 받지 않습니다.

확인: 배포 관리에 웹 앱 배포가 하나 있고, 복사한 URL이 `/exec`로 끝납니다. 미확인(실계정 필요).

### 5. 로컬 설정

할 곳: 사용자 직접(.env 편집)

`.env`에서 두 줄의 주석을 풀고 값을 넣습니다.

```text
STORAGE_MODE=live
GAS_WEBAPP_URL=<4단계의 웹앱 URL>
```

- `.env`는 직접 엽니다. 에이전트에게 읽히지 않습니다.

확인: `.env`에 `STORAGE_MODE=live`와 `GAS_WEBAPP_URL=`로 시작하는 줄이 주석 없이 있습니다.

### 6. 초기화

clasp 경로 8단계와 같습니다.

### 7. 실행과 등록 1건 확인

clasp 경로 9단계와 같습니다.

## 다시 배포할 때

`gas/`의 코드가 바뀌었을 때입니다. **코드를 먼저 올리고 초기화를 그다음에 합니다.** 순서를 바꾸면 옛 코드로 초기화됩니다.

**같은 웹앱 URL을 유지합니다.** 새 배포를 만들면 URL이 바뀌고, `.env`의 `GAS_WEBAPP_URL`도 바꿔야 합니다.

clasp 경로는 이렇게 합니다.

```powershell
npm.cmd run gas:push
npm.cmd run gas:redeploy
npm.cmd run gas:init
```

(macOS: `npm run gas:push`, `npm run gas:redeploy`, `npm run gas:init`)

- `gas:redeploy`는 `.env`의 `GAS_WEBAPP_URL`에서 배포 ID를 읽어 같은 배포를 새 버전으로 바꿉니다. 배포 ID를 손으로 넣지 않습니다.
- 터미널에 clasp 출력(`Redeployed <배포 ID> @<버전>`)에 이어 `같은 배포를 새 버전으로 갱신했습니다. 주소는 그대로입니다.`가 나옵니다. `.env`는 바뀌지 않습니다. (실제 배포로 확인, 2026-10-20 macOS, 5초)
- 이 줄은 clasp 출력에 `Redeployed <배포 ID> @`가 있을 때만 나옵니다. clasp 3.4.1은 로그인이 만료됐을 때 갱신하지 않고도 종료 코드 0으로 끝난 적이 있어(2026-10-20), 그 줄이 없으면 `clasp 출력에서 배포 ID를 찾지 못했습니다. 위 출력을 확인하고, 로그인이 만료됐으면 npm.cmd run gas:login(macOS: npm run gas:login)을 다시 실행하세요.`로 알립니다(종료 코드 1). (실제 배포로 확인) 2026-10-20 macOS에서 clasp 로그인이 만료된 채 실행하자 바로 위에 `{"error":"invalid_grant",…"error_subtype":"invalid_rapt"}`가 나오고 이 줄로 끝났습니다. `npm run gas:login` 뒤 다시 실행해 갱신됐습니다.
- `.env`에 주소가 없거나, 주소가 `https://`로 시작하지 않거나, 주소에 배포 ID(`AKfyc…`)가 없으면 `.env에 GAS_WEBAPP_URL이 없습니다. 먼저 npm.cmd run gas:deploy(macOS: npm run gas:deploy)를 실행하세요.`가 나옵니다. 2026-10-20에 macOS에서 실행해 확인했습니다.
- `npm.cmd run gas:deploy`는 `.env`에 주소가 있으면 새 배포를 만들지 않습니다. 갱신에는 `gas:redeploy`를 씁니다.
- `gas:redeploy` 뒤에 편집기의 배포 관리에서 그 배포의 실행 사용자가 "나", 액세스 권한이 있는 사용자가 "모든 사용자"인지 다시 봅니다. 새 배포(`create-deployment`)에는 매니페스트의 접근 설정이 들어갔지만(clasp 경로 7단계), 갱신(`update-deployment`)에도 그런지는 미확인입니다(clasp 이슈 #1115).

편집기 붙여넣기 경로는 이렇게 합니다.

1. `npm.cmd run gas:bundle`(macOS: `npm run gas:bundle`)로 묶음 파일을 다시 만듭니다.
2. 편집기의 `Code.gs` 내용을 새 묶음 파일로 모두 바꾸고 저장합니다. `gas/appsscript.json`이 바뀌었으면 매니페스트도 같이 바꿉니다.
3. 배포, 배포 관리에서 기존 웹 앱 배포를 편집합니다. 버전을 새 버전으로 골라 배포합니다.
4. `npm.cmd run gas:init`을 합니다.

두 경로 모두 끝나면 `npm.cmd start`를 다시 실행합니다.

- 초기화는 빠진 제품과 불량 코드를 채웁니다. 있는 행은 덮어쓰지 않습니다.

확인: `npm.cmd run gas:init`이 다시 성공합니다. 미확인(실계정 필요).

## 연결이 안 될 때

오류는 code와 문구로 나옵니다. 보이는 곳은 이렇습니다.

- `npm.cmd start`가 포트를 열기 전에 GAS 연결을 확인하다 실패하면 터미널에 `GAS 연결 확인에 실패했습니다(<code>). <문구>` 한 줄이 나오고 서버가 종료됩니다.
- `npm.cmd run gas:init`이 실패하면 터미널에 `GAS 요청에 실패했습니다(<code>). <문구>` 한 줄이 나옵니다(종료 코드 1).
- 서버가 뜬 뒤 화면에서 요청이 실패하면 화면에는 문구만 나옵니다. 상태가 500 이상이면 터미널에도 `"error_code":"<code>"`가 든 JSON 한 줄이 남습니다.

| code | 문구(앞부분) | 보이는 곳 | 확인할 것 |
|---|---|---|---|
| `GAS_HTTP_403` | `GAS 웹앱이 요청을 거절했습니다(HTTP 403). 배포한 계정으로 웹앱 주소를 한 번 열어 권한을 승인했는지(npm.cmd run gas:open, macOS: npm run gas:open), 웹앱 액세스가 '모든 사용자'인지 확인하세요.` | 터미널, 화면(503) | 첫 권한 승인(clasp 경로 6단계), 배포 접근 설정(7단계). 승인 전 403은 GET으로만 확인했고 POST는 미확인 |
| `GAS_HTTP_<상태>` | `GAS 웹앱 HTTP 오류 (<상태>).` | 터미널, 화면(503) | 403 밖의 상태. `GAS_WEBAPP_URL`이 배포 관리의 웹앱 URL과 같은지 |
| `GAS_NOT_JSON` | `GAS 웹앱이 JSON이 아닌 응답을 돌려줬습니다. 웹앱 주소를 브라우저에서 한 번 열어 허용하세요(npm.cmd run gas:open, macOS: npm run gas:open).` | 터미널, 화면(503) | 웹앱이 200으로 답했지만 JSON이 아닌 경우(편집기 경로의 승인 전, Google 오류 화면 등). 주소를 열어 허용하거나 `npm.cmd run gas:editor`(macOS: `npm run gas:editor`)로 편집기를 열고 `setupTumblerResources`를 한 번 실행. 검사 등록 중에 나면 바로 아래 행의 문구가 나옵니다 |
| `GAS_NOT_JSON`·`GAS_TIMEOUT`·`GAS_UNREACHABLE`·`GAS_HTTP_<5xx 상태>`(검사 등록 중) | `등록 응답을 받지 못해 저장됐는지 확인하지 못했습니다. 이 화면은 그대로 두고 새 탭에서 검사 목록을 열어 이 검사가 있는지 먼저 확인하세요.` | 터미널, 화면(503) | 응답만 받지 못했을 뿐 GAS는 사진과 검사를 이미 저장했을 수 있습니다. 새 탭의 검사 목록에서 먼저 확인하고, 목록에 있으면 다시 등록하지 않습니다. 없을 때만 등록 화면에서 내용을 바꾸지 않고 다시 등록합니다. 같은 내용으로 다시 보내면 같은 요청 ID로 가서 한 번만 저장됩니다. 등록 화면을 벗어났다 돌아오면 새 요청이 되므로 목록 확인은 새 탭에서 합니다 |
| `SETUP_REQUIRED` | `npm.cmd run gas:init(macOS: npm run gas:init)을 실행하세요(또는 편집기에서 setupTumblerResources를 한 번 실행하세요).` | 터미널, 화면(503) | 초기화(clasp 경로 8단계) |
| `VALIDATION` | `실측 중량을 확인하세요.` 등 입력 오류 | 화면(400) | 입력값 |
| `GAS_UNREACHABLE` | `Google Apps Script에 연결하지 못했습니다. 네트워크 연결을 확인하세요.` | 터미널, 화면(503) | 네트워크 |
| `GAS_TIMEOUT` | `Google Apps Script 응답 시간이 초과되었습니다.` | 터미널, 화면(503) | 처리 결과를 화면에서 확인한 뒤 다시 시도 |
| (`gas:deploy`·`gas:redeploy`) | `clasp 출력에서 배포 ID를 찾지 못했습니다. 위 출력을 확인하고, 로그인이 만료됐으면 npm.cmd run gas:login(macOS: npm run gas:login)을 다시 실행하세요.` | 터미널(바로 위에 clasp 출력 그대로, 종료 코드 1) | 위의 clasp 출력을 봅니다. `invalid_grant`가 있으면 로그인이 만료된 것이니 `npm.cmd run gas:login`(macOS: `npm run gas:login`)으로 다시 로그인한 뒤 같은 명령을 다시 합니다. 그 밖이면 clasp 로그인(2단계), Apps Script API(1단계)를 봅니다. clasp 3.4.1의 `update-deployment`는 로그인이 만료돼도 종료 코드 0으로 끝나므로(2026-10-20 확인) 종료 코드가 아니라 clasp 출력으로 판정합니다. `gas:deploy`에서 배포는 만들어졌는데 ID만 찾지 못했으면 편집기의 배포 관리에서 웹앱 URL을 복사해 `.env`의 `GAS_WEBAPP_URL`에 넣습니다 |
| (`gas:redeploy`·`gas:open`) | `.env에 GAS_WEBAPP_URL이 없습니다. 먼저 npm.cmd run gas:deploy(macOS: npm run gas:deploy)를 실행하세요.` | 터미널 | 웹앱 배포(5단계) |
| (`gas:push`·`gas:create`·`gas:editor`) | `{"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)",…}` | 터미널(clasp 출력 그대로, 종료 코드 1) | clasp 로그인이 만료됐거나 계정의 재인증 정책에 걸렸습니다. `npm.cmd run gas:login`(macOS: `npm run gas:login`)으로 다시 로그인한 뒤 같은 명령을 다시 합니다. 이 세 명령은 clasp를 바로 부르므로 문구를 바꾸지 않고 clasp 출력이 그대로 나옵니다. 2026-10-20에 회사 Workspace 계정에서 `clasp push --force`가 이 출력으로 종료 코드 1을 낸 것을 확인했습니다 |

- `GAS_NOT_JSON`, `GAS_HTTP_<상태>`, `GAS_UNREACHABLE`, `GAS_TIMEOUT`은 로컬 서버가 붙이는 code이고, 나머지는 GAS가 붙입니다.
- 표의 문구는 코드(`src/gas-transport.ts`, `src/integrations.ts`, `src/inspections.controller.ts`, `gas/*.gs`, `scripts/*.mjs`)에서 옮겼습니다. 실제 GAS에서 나는 것을 본 것은 아닙니다. 미확인(실계정 필요).
- `npx tsc`만 실행하고 `node dist/main.js`로 띄우면 `ReferenceError: exports is not defined in ES module scope`로 시작하지 못합니다. CommonJS 표시 파일 `dist/package.json`은 `npm.cmd run build`가 써 넣기 때문입니다. 빌드는 늘 `npm.cmd run build`(macOS: `npm run build`)로 합니다. (로컬 실행으로 확인, 2026-10-22)

## 로컬에서 실행해 확인한 것

2026-10-16에 macOS의 이 저장소에서 Google에 요청을 보내지 않는 단계만 실행했습니다. 설정은 명령 앞에 환경 변수로 주거나 시험용 `.env`(가짜 주소)를 잠깐 만들었습니다. Windows에서는 실행하지 않았습니다. `gas:deploy`와 `gas:redeploy` 행은 2026-10-20에 지금 래퍼로 다시 실행했습니다.

| 명령 | 결과 |
|---|---|
| `npm run gas:bundle` | `build/gas-bundle.js`와 `Apps Script 편집기의 코드 파일 하나에 이 파일 전체를 붙여 넣습니다.` |
| `npm run gas:deploy`(`.env`에 주소 있음) | `이미 배포 주소가 있습니다. npm.cmd run gas:redeploy(macOS: npm run gas:redeploy)로 갱신하세요.`(종료 코드 1) clasp를 부르지 않습니다 |
| `npm run gas:redeploy`(`.env` 없음) | `.env에 GAS_WEBAPP_URL이 없습니다. 먼저 npm.cmd run gas:deploy(macOS: npm run gas:deploy)를 실행하세요.` |
| `npm run gas:redeploy`(주소가 `https://`가 아니거나 배포 ID 없음) | `.env에 GAS_WEBAPP_URL이 없습니다. 먼저 npm.cmd run gas:deploy(macOS: npm run gas:deploy)를 실행하세요.` |
| `npm run gas:build` | `build/gas`에 `Code.gs`, `Live.gs`, `Setup.gs`, `appsscript.json` |
| `npm start`(설정 없음) | `GAS 품질 대시보드 서버 실행 중: http://127.0.0.1:<포트>`, `연동 상태: 저장소=mock(로컬 파일)` |

아래 설정 검사는 `npm run gas:init`과 `npm start`가 같은 문구로 멈춥니다(종료 코드 1). 웹앱에는 아무것도 보내지 않습니다.

| 설정 | 터미널 출력 |
|---|---|
| `STORAGE_MODE` 없음(`npm run gas:init`만) | `initialize는 .env에 STORAGE_MODE=live와 GAS_WEBAPP_URL을 넣은 뒤 실행합니다.` `npm start`는 모의 저장소로 뜹니다 |
| `STORAGE_MODE=live`인데 URL 없음 | `STORAGE_MODE=live에는 GAS_WEBAPP_URL이 필요합니다. docs/LOCAL_SETUP.md를 보세요.` |
| URL 꼴이 틀림 | `GAS_WEBAPP_URL은 https://script.google.com/macros/s/<배포 ID>/exec 꼴이어야 합니다. 편집기의 배포 관리에서 웹앱 URL을 복사해 넣으세요.` |
| `/dev` 주소 | `GAS_WEBAPP_URL이 /dev 주소입니다. /dev는 로그인한 브라우저에서만 열려 서버가 부를 수 없습니다. 배포 관리의 웹앱 URL(/exec로 끝남)을 넣으세요.` |

- `.env`가 없으면 위 출력 앞에 `.env not found. Continuing without it.`가 나옵니다.
