# manufacturing-quality-dashboard-student

텀블러 공장 품질관리 사이트입니다.
한 사용자가 사진과 측정값을 등록하고 AI 초안을 확인합니다.
검사기준을 대조한 뒤 자신의 판단과 조치를 기록합니다.

## 사이트에서 하는 일

1. 품질 현황에서 검사일별 건수(전체·NG·HOLD·검토 대기)와 그날의 검사 카드를 봅니다.
2. 사진 등록에서 제품·검사일시·측정값을 입력합니다.
3. 저장한 검사의 AI 결과와 적용 기준을 확인합니다.
4. NotebookLM 출처를 원문과 대조합니다.
5. 내 판단과 조치·사유를 저장하고 이력을 조회합니다.

검사번호는 자동으로 생성합니다.
같은 텀블러의 여러 각도 사진은 한 검사에 첨부합니다.

중량을 모르면 미측정으로 남깁니다.
사진에서 중량·누수·읽을 수 없는 문구를 추정하지 않습니다.

AI 초안과 사용자 판단은 별도로 저장합니다.
출처 대조 기록은 제품 출하 승인이 아닙니다.

## 설치와 실행

Node.js 22.12 이상을 사용합니다.
서버는 TypeScript(NestJS)로 `src/`에 있고, 화면은 `public/`에 있습니다.

```powershell
npm.cmd ci
npm.cmd start
```

(macOS: `npm ci`, `npm start`)

`npm start`는 서버를 띄우기 전에 `npm run build`로 `dist/`를 만듭니다. 빌드에 개발 의존성인 TypeScript가 쓰여서 `--omit=dev` 없이 설치합니다.

`.env` 파일이 없으면 `.env not found. Continuing without it.`라는 영어 한 줄이 나옵니다. 정상이며 서버는 그대로 실행됩니다.
서버가 뜨면 터미널에 나온 주소(기본 `http://127.0.0.1:4185`)를 브라우저로 엽니다. 포트는 `.env`의 `PORT`로 바꿉니다.

교육용 계정은 세 개입니다. 비밀번호는 실제 접근 제한용이 아니며, 로그인 화면에 앞의 두 개가 안내됩니다.

| 계정 | 비밀번호 | 화면 표시 |
|---|---|---|
| `writer` | `writer1234!` | 작성자 |
| `reviewer` | `reviewer1234!` | 검토자 |
| `factory-user` | `factory1234!` | 품질관리 |

**Windows에서 명령 입력하기**
- 창의 줄 맨 앞이 `C:\...>`로 시작하면 명령 프롬프트, `PS C:\...>`로 시작하면 PowerShell입니다.
- 명령 프롬프트에서는 안내한 명령을 그대로 칩니다. 예: `npm start`
- PowerShell에서는 `npm`을 `npm.cmd`로, `npx`를 `npx.cmd`로 바꿔 칩니다. 예: `npm.cmd start`
- PowerShell에서 `.cmd` 없이 쳤다가 "이 시스템에서 스크립트를 실행할 수 없으므로 … npm.ps1 파일을 로드할 수 없습니다" 오류가 나면 `npm.cmd`로 다시 칩니다.

## 사진 받기

화면의 학습 사진은 수강생용 사진 저장소에서 받아 `runtime/images/`에 둡니다. 명령은 이 저장소 폴더에서 실행합니다.

```powershell
git clone https://github.com/startup-life/manufacturing-quality-student-images.git ../manufacturing-quality-student-images
node scripts/fetch-images.mjs --from ../manufacturing-quality-student-images
node scripts/check-assets.mjs
```

- 받을 사진과 해시는 `assets/image-lock.json`에 고정되어 있습니다.
- 두 번째 명령이 `Images verified: 128`을 출력하면 됩니다.
- 사진 저장소는 Git LFS를 쓰지 않으므로 `git clone`만으로 받습니다.

## 연동 스위치

`.env`의 세 스위치로 저장소, Gemini 판독, NotebookLM 근거 대조를 따로 켭니다. `.env`가 없으면 모두 기본값입니다.
설정 예시는 `.env.example`에 있습니다.

| 이름 | 값 | 기본값 | 막는 조합 |
|---|---|---|---|
| `STORAGE_MODE` | `live`, `mock` | `mock` | 없음. `live`에는 `GAS_WEBAPP_URL`이 필요합니다 |
| `GEMINI_MODE` | `off`, `mock`, `live` | mock 저장소에서 `off`, live 저장소에서 `live` | live 저장소에 `mock`, mock 저장소에 `live` |
| `NOTEBOOKLM_MODE` | `off`, `mock`, `live` | mock 저장소에서 `mock`, live 저장소에서 `off` | live 저장소에 `mock` |

- `live` 저장소는 GAS 웹앱(실제 Sheets·Drive), `mock` 저장소는 로컬 모의 저장소(`runtime/local-gas-state.json`)입니다.
- 막는 조합이거나 값이 틀리면 서버가 시작하지 않고 이유와 고칠 방법을 한 줄로 알립니다.
- 서버는 시작할 때 `연동 상태: 저장소=mock(로컬 파일) · Gemini=off(사람이 직접 판정) · NotebookLM=mock(모의 응답)`처럼 한 줄을 냅니다.

수업에서 쓰는 조합입니다.

| 단계 | `STORAGE_MODE` | `GEMINI_MODE` | `NOTEBOOKLM_MODE` |
|---|---|---|---|
| 0 처음 실행 | `mock` | `off`(기본) | `mock`(기본) |
| NotebookLM 먼저 | `mock` | `mock` | `live` |
| Gemini 연결 | `live` | `live`(기본) | `off`(기본) |
| 둘 다 실제 | `live` | `live` | `live` |

실제 GAS·Gemini·NotebookLM 연결은 아래 문서를 따릅니다.

- [실제 연결 준비 안내](docs/LOCAL_SETUP.md)
- [GAS 구조와 연결](docs/GAS_ARCHITECTURE.md)
- [NotebookLM MCP 연결](docs/NOTEBOOKLM_MCP.md)

웹앱 URL을 아는 사람은 누구나 시트·사진을 읽고 쓰고 판독을 요청할 수 있습니다. URL과 API 키는 `.env`에만 두고 화면 공유, 채팅, 문서에 올리지 않습니다.
에이전트에게 `.env`를 읽히지 않습니다.

## 라이선스

콘텐츠는 CC BY-SA 4.0([CONTENT_LICENSE.md](CONTENT_LICENSE.md)), 코드는 MIT([LICENSE](LICENSE))를 따릅니다.
