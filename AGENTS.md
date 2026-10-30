# 프로젝트 규칙

> 이 브랜치의 코드는 강사가 만든 완성본에서 그 회차까지의 기능만 남긴 것입니다. 아래 약속의 이름(파일·데이터 주소·Google 쪽 일과 탭 이름)이 코드와 다르면 코드에 있는 것을 따르고, 코드를 약속에 맞춰 고치지 마세요.

## 일하는 방식
- 병렬·서브 에이전트를 사용하지 말고 현재 에이전트가 순서대로 직접 수행하세요.
- 사용자는 코딩을 모르는 분입니다. 설명은 짧고 쉬운 한국어로 하고, 전문 용어를 쓰지 마세요.
- 한 번에 요청한 일만 하고, 요청하지 않은 파일은 고치지 마세요.
- 프롬프트 안의 "---- 아래 글 그대로 ----" 줄은 표시일 뿐이니 파일에 넣지 말고, 그 아래 글만 그대로 쓰세요.
- 이미 있는 코드의 방식을 새 기능에도 그대로 따르세요. 예를 들어 쓰기 요청에 보안 확인 값을 붙이는 코드가 이미 있으면 새 요청에도 붙입니다.
- 일을 마치면 사용자가 화면에서 무엇을 보면 되는지 한 줄로 알려 주세요.
- .env 파일은 열지 말고, 내용을 화면에 출력하지 마세요.
- 터미널 명령은 Windows PowerShell 기준으로 npm.cmd, npx.cmd를 씁니다.
- 서버 켜기(npm.cmd start)는 사용자가 직접 합니다. 실행하지 마세요. 서버 코드를 고쳤으면 npm.cmd run build로 빌드만 해서 오류가 없는지 확인하세요.
- 브라우저를 열어 확인하지 마세요. 화면 확인은 사용자가 직접 합니다.
- 요청에 없는 패키지는 더하지 말고 버전을 바꾸지 마세요. npm audit fix도 실행하지 마세요.

## 앱의 기본 약속
- 텀블러 공장 품질관리 웹앱입니다. 서버는 NestJS(TypeScript)로 src 폴더에, 화면은 HTML·CSS·JavaScript로 public 폴더에 둡니다.
- npm.cmd start는 빌드한 뒤 dist/main.js로 서버를 켭니다. 서버는 이 PC 안(127.0.0.1)에서만 열리고 포트는 4185입니다(PORT 설정이 있으면 그 값).
- 서버가 켜지면 터미널에 "품질 대시보드 서버 실행 중: http://127.0.0.1:4185"를 보여 줍니다.
- 화면은 public/index.html 한 페이지입니다. /api 로 시작하지 않는 주소는 public 폴더에 그 파일이 있으면 그 파일을, 없으면 index.html을 보냅니다. 어느 화면을 보일지는 화면 쪽이 주소를 보고 정합니다.
- 화면이 쓰는 데이터 주소는 /api 로 시작합니다. 오류는 {"error": "한국어 문장"} 모양으로 답하고, 화면은 그 문장을 그대로 보여 줍니다.
- 없는 /api 주소만 "요청한 주소를 찾을 수 없습니다."로 답하고, 코드가 일부러 낸 오류 문장(예: "검사를 찾을 수 없습니다.")은 바꾸지 않고 그대로 보냅니다. 예상하지 못한 오류만 한국어 한 줄로 바꿉니다. 모두 같은 {"error": "한국어 문장"} 모양입니다.
- 화면 글은 모두 한국어입니다. 화면 주소는 / 품질 현황(홈), /inspections/new 검사 등록, /inspections/(검사번호) 검사 상세, /settings 설정입니다.
- 로그인 상태는 express-session으로 서버 메모리에 기억합니다. 서버를 다시 켜면 로그인이 풀려도 됩니다.
- 로그인 데이터 주소는 GET /api/session(로그인 상태, 로그인 전이면 {"user": null}), POST /api/login, POST /api/logout 입니다. 로그인 요청은 {"username": 계정, "password": 비밀번호}를 보냅니다. 이 셋 말고 /api 주소는 로그인한 사람에게만 답합니다.
- 교육용 계정은 writer / writer1234!(작성자), reviewer / reviewer1234!(검토자), factory-user / factory1234!(품질관리)입니다. 역할 값은 계정 이름과 같고, 화면에는 괄호 안 한국어로 보입니다.

## 2회차 약속

### 저장
- 검사 기록은 앱 폴더의 runtime 폴더 안 파일 하나(runtime/local-state.json)에 저장합니다. 서버를 껐다 켜도 남아야 합니다.
- 등록한 사진은 runtime/uploads 폴더에 파일로 저장하고, 화면은 /uploads/(파일 이름) 주소로 봅니다. 로그인한 사람만 볼 수 있습니다.
- runtime 폴더는 .gitignore에 넣어 Git에 올리지 않습니다(이미 있으면 그대로 둡니다).
- 서버가 켜질 때 서버 창에 "저장소: 내 컴퓨터(runtime/local-state.json)" 한 줄을 보여 줍니다.
- writer, reviewer, factory-user 세 계정 모두 검사를 등록하고 고칠 수 있습니다.

### 제품과 검사기준
- 제품은 세 가지입니다(제품 번호 / 제품 이름 / 색 / 화면 선택 글).
  - P-SILVER / 텀블러 실버 / 은색 / 은색 텀블러
  - P-WHITE / 텀블러 화이트 / 흰색 / 흰색 텀블러
  - P-BLACK / 텀블러 블랙 / 검정 / 검정 텀블러
- 검사기준은 standards 폴더의 Rev.A.json, Rev.B.json에 둡니다. 둘 다 제목 "교육용 텀블러 검사기준", 범위 "가상 훈련 기준; 실제 제조 규격이 아님"입니다.
- 중량 범위(g, 양 끝 포함)
  - Rev.A: P-SILVER 345~355, P-WHITE 445~455, P-BLACK 545~555
  - Rev.B: P-SILVER 345~354, P-WHITE 445~455, P-BLACK 545~555 (은색 상한만 다릅니다)
- 등록 화면의 기준은 처음에 Rev.A로 골라 둡니다.

### 검사 한 건
- 검사번호는 서버가 만듭니다. 모양은 INSP-YYYYMMDD-xxxxxxxx 입니다(날짜는 등록한 날, x는 0~9·a~f 8글자). 예: INSP-20261029-3fa9c1d2
- 항목 이름은 inspection_id, product_id, inspected_at, revision, weight_g, memo, decision, content_version, images(사진 주소 목록, 고른 순서)입니다.
- inspected_at은 한국 시각 "YYYY-MM-DD HH:MM:SS"(초까지) 글입니다. weight_g는 숫자이고 비우면 null이며 화면에는 "미측정"으로 보입니다.
- decision은 처음에 null이고 나중 회차에서 OK·NG·HOLD가 들어갑니다. 화면 글은 OK 정상, NG 불량, HOLD 보류, null 미판정입니다.
- content_version은 0에서 시작하고, 상세 1번 탭에서 고쳐 저장할 때마다 1 오릅니다. 화면에는 "검사 기록 버전: N"으로 보입니다.

### 사진 올리기
- 화면은 고른 사진을 FileReader로 읽어 data 주소(data:image/...)로 미리 보여 줍니다. 이 사이트의 보안 설정이 blob 주소를 막으므로 blob 주소는 쓰지 않습니다.
- 등록할 때 사진들을 그 data 주소 글로 다른 입력과 함께 한 번에 보냅니다. 사진 여러 장(8장 안팎)을 한 번에 보내도 등록되도록 서버가 받는 요청 크기 한도를 50mb로 올립니다(이 PC에서만 쓰는 앱이라 모든 요청에 걸어도 됩니다).
- 이미 한도를 거는 코드가 있으면 그 값만 50mb로 바꿉니다. 없으면 NestJS의 app.useBodyParser('json', { limit: '50mb' })를 쓰고, express.json()을 app.use로 따로 더하지 않습니다.
- 요청이 너무 크면 "사진이 너무 큽니다. 장수를 줄여 다시 해 주세요."라고 알려 줍니다.
- 사진 크기 줄이기나 형식 바꾸기는 하지 않아도 됩니다. 이를 위해 새 패키지를 더하지 않습니다.

### 화면
- 검사 상세 화면의 탭 이름은 "① 사진·측정값", "② AI 결과 확인", "③ 검사기준과 비교하기", "④ 내 판단 기록"입니다. 처음엔 1번 탭이 보입니다.
- 홈은 로그인하면 현황을 불러오고, 로그아웃하면 숫자와 카드를 지웁니다. 다른 화면에서 홈으로 돌아와도 다시 불러옵니다.

### 데이터 주소
- GET /api/products 제품 목록, GET /api/standards/Rev.A (또는 Rev.B) 검사기준
- POST /api/inspections 검사 등록(사진 포함), GET /api/inspections/(검사번호) 검사 한 건
- PATCH /api/inspections/(검사번호) 제품·검사일시·중량 고치기
- GET /api/inspections?date=YYYY-MM-DD&decision=NG&review=pending 검사 목록(검사일시 늦은 것부터, 거르기 값은 빼도 됩니다)
- GET /api/home?date=YYYY-MM-DD 하루 현황. 날짜를 비우면 가장 최근 검사일입니다. 검사 건수, NG 건수, HOLD 건수, 보고서 검토 대기 건수(지금은 늘 0)를 셉니다. 기록이 하나도 없으면 날짜는 비우고 모두 0입니다.
- GET /api/operations 지금 저장 방식(2회차는 내 컴퓨터)

## 3회차 약속
- 저장 방식은 .env의 STORAGE_MODE로 고릅니다. mock은 내 컴퓨터(runtime 폴더), live는 Google(시트와 드라이브)입니다. 값이 없거나 다른 값이면 mock입니다.
- 서버가 켜질 때 서버 창에 "저장소: 내 컴퓨터(mock)" 또는 "저장소: Google 시트·드라이브(live)" 한 줄을 보여 줍니다. 2회차에 만든 서버 창의 저장소 한 줄은 이 문장으로 바꿉니다. 설정 화면의 저장소 줄도 같은 문장입니다.
- live일 때 서버는 .env의 GAS_WEBAPP_URL(Google 웹앱 주소)로 Google 쪽 코드에 일을 시킵니다. mock일 때는 2회차와 똑같이 동작합니다.
- 웹앱 주소, AKfyc로 시작하는 웹앱 번호, 시트·폴더 주소, Google 계정 메일은 채팅에 옮겨 적지 않습니다. 화면·서버 창·안내 문장에도 웹앱 주소를 넣지 않습니다.
- Google 로그인과 권한 승인은 사용자가 브라우저에서 직접 합니다. 브라우저를 대신 조작하지 않습니다.
- .env와 .clasp.json은 열지 않고 Git에 올리지 않습니다(.gitignore에 없으면 더합니다).

Google 쪽 코드(Apps Script)
- gas 폴더에 둡니다(코드 파일과 appsscript.json). Google에서 돌아가므로 require, import, export, process.env를 쓰지 않습니다.
- appsscript.json: "timeZone": "Asia/Seoul", "runtimeVersion": "V8", "oauthScopes"는 https://www.googleapis.com/auth/spreadsheets, https://www.googleapis.com/auth/drive, https://www.googleapis.com/auth/script.external_request 세 개, "webapp": {"access": "ANYONE_ANONYMOUS", "executeAs": "USER_DEPLOYING"}.
- 브라우저로 웹앱 주소를 열면(doGet) "권한 승인이 끝났습니다. 이 창을 닫고 터미널로 돌아가세요." 글자만 보입니다.
- 서버의 요청(doPost) 본문은 {"action": "일 이름", ...그 일에 쓰는 값} 모양의 JSON입니다. 답은 늘 JSON으로, 성공은 {"ok": true, "data": 결과}, 실패는 {"ok": false, "error": "한국어 문장"}입니다. 어떤 오류든 잡아서 이 모양으로 답하고, 예상 못 한 오류는 "알 수 없는 오류가 났습니다."로 답합니다.
- 일 이름은 아래 여섯 가지입니다. 나중 회차에서 더할 수 있습니다.
  - setup(시트 만들기): 스프레드시트 "텀블러 공장 품질관리 데이터베이스"와 드라이브 폴더 "텀블러 공장 품질검사 사진"을 만들고(이미 있으면 그것을 씀) 스크립트 속성에 기억합니다. inspections, images 탭을 만들고 1행에 머리글을 쓰며, 처음 생긴 빈 기본 탭은 지웁니다. 다시 실행하면 빠진 탭과, 이미 있는 탭에 빠진 머리글 칸을 끝에 더합니다. 시트 주소와 폴더 주소를 돌려줍니다.
  - read(시트 읽기) {"tabs": [탭 이름들]}: 탭마다 1행 머리글을 이름으로 쓴 줄 목록을 돌려줍니다. 없는 탭은 빈 목록이고, 날짜로 읽힌 칸은 "2026-10-27 19:05:30" 꼴 글자로 바꿉니다.
  - append(줄 더하기) {"rows": {"탭 이름": [줄들]}}: 여러 탭의 여러 줄을 머리글 순서대로 맨 아래에 한 번에 더합니다.
  - update(줄 고치기) {"tab", "key", "value", "changes"}: key 칸 값이 value인 줄에서 changes에 있는 칸만 바꿉니다. 그 줄이 없으면 "수정할 기록이 없습니다."로 답합니다.
  - savePhoto(사진 저장) {"name", "mimeType", "base64"}: 사진 폴더에 저장하고 파일 ID를 돌려줍니다. 공유 설정은 바꾸지 않습니다(나만 봄).
  - getPhoto(사진 꺼내기) {"id"}: 사진 폴더 안의 그 파일을 {"mimeType", "base64"}로 돌려줍니다. 없으면 "등록된 사진이 없습니다."로 답합니다.
- setup 말고 다른 일은 시트나 사진 폴더가 아직 없으면 하지 않고 "시트와 사진 폴더가 아직 없습니다. npm.cmd run gas:init을 실행하세요."로 답합니다.
- 시트에 쓸 때 숫자는 숫자로, 빈 값은 빈칸으로, 그 밖의 글은 앞에 작은따옴표(')를 붙여 씁니다. 날짜나 수식으로 바뀌지 않고 쓴 글자 그대로 남게 하려는 것입니다.

서버가 Google을 쓰는 법
- live일 때 검사는 inspections 탭(한 건에 한 줄), 사진은 images 탭(한 장에 한 줄)에 둡니다. 칸 이름은 내 컴퓨터 저장 파일의 이름과 같게 하고, 읽은 값은 내 컴퓨터 저장 때와 같은 모양(숫자 칸은 숫자, 빈칸은 값 없음)으로 맞춥니다.
- 검사 기록과 사진을 읽고 쓰는 코드는 한 파일(저장 담당)로 모으고, 화면 요청을 받는 코드는 그 파일만 부릅니다.
- 어느 저장 방식을 쓸지는 서버의 한 곳에서만 고릅니다. 목록·홈 숫자 계산은 두 저장 방식이 같은 코드를 함께 씁니다.
- 등록은 이 순서로 합니다. 1) 입력 검사를 모두 마칩니다. 2) 통과한 뒤에만 사진(고른 사진 그대로)을 savePhoto로 올립니다. 3) 검사 줄과 사진 줄을 append 한 번으로 함께 저장합니다. 사진 없는 검사나 검사 없는 사진 줄이 남지 않게 하려는 것입니다.
- 드라이브 사진은 공개하지 않습니다. images 탭의 사진 주소 칸(예: image_url)에는 드라이브 파일 ID를 /api/drive/(파일 ID) 꼴로 적고, 로그인한 사람이 사진을 열면 서버가 그 주소를 getPhoto로 풀어 받아 보여 줍니다.
- 웹앱이 다른 주소로 넘겨 주면 따라갑니다. 연결하지 못했거나 JSON이 아닌 답(권한 승인 전 화면 등)이 오면 "Google에 연결하지 못했습니다. 인터넷 연결과 권한 승인(npm.cmd run gas:open)을 확인하세요." 한 줄을 보여 줍니다. {"ok": false}면 그 error 문장을 그대로 보여 줍니다.

수강생이 치는 명령(package.json의 npm.cmd run gas:…)
- clasp는 npx --yes @google/clasp@3.4.1 로 부릅니다. 묻는 질문 없이 끝나게 만듭니다(AI의 터미널은 질문에 답하지 못합니다). 스크립트 파일에서 clasp를 부를 때는 Windows에서도 되게 셸 명령 한 줄로 부릅니다.
- 스크립트 파일은 .env 내용을 출력하지 않고 node --env-file-if-exists=.env 로 값만 읽습니다(gas:deploy는 .env에 줄을 적기만 합니다).
- gas:login: Google 로그인.
- gas:create: 내 계정에 "tumbler-factory" Apps Script 프로젝트를 만들고 gas 폴더와 연결합니다(.clasp.json이 생깁니다). .clasp.json이 이미 있으면 실행하지 않습니다.
- gas:push: gas 폴더의 코드를 Google에 덮어써 올립니다(--force).
- gas:deploy: 웹앱을 새로 배포합니다. clasp는 실패해도 성공처럼 끝날 수 있으니, 출력에서 AKfyc로 시작하는 번호를 딱 하나 찾았을 때만 성공입니다. 성공하면 .env에 GAS_WEBAPP_URL=https://script.google.com/macros/s/(그 번호)/exec 와 STORAGE_MODE=live를 적습니다(같은 이름 줄은 바꾸고 다른 줄은 그대로, .env가 없으면 만듦). 마지막 두 줄은 ".env에 웹앱 주소를 적었습니다."와 "다음: npm.cmd run gas:open"입니다.
- gas:deploy는 .env에 웹앱 주소가 이미 있으면 배포하지 않고 "이미 웹앱 주소가 있습니다. npm.cmd run gas:redeploy를 쓰세요."로, 번호를 못 찾으면 .env를 건드리지 않고 "웹앱 번호를 찾지 못했습니다. 로그인이 만료됐으면 npm.cmd run gas:login을 다시 하세요."로 끝냅니다.
- gas:redeploy: .env 주소의 번호로 같은 웹앱을 새 버전으로 바꿉니다(주소는 그대로). 마지막 줄은 "같은 웹앱을 새 버전으로 바꿨습니다. 주소는 그대로입니다."입니다. Google 쪽 코드를 고친 뒤에는 gas:push, gas:redeploy를 차례로 실행합니다.
- gas:open: .env의 웹앱 주소를 기본 브라우저로 엽니다. 주소는 출력하지 않습니다.
- gas:init: 서버를 켜지 않고 Google에 setup을 시킵니다. 성공하면 "시트와 사진 폴더를 준비했습니다." 한 줄과 그 아래에 시트 주소와 폴더 주소를 보여 줍니다. 실패하면 서버와 같은 한 줄 안내로 끝냅니다.
- gas:redeploy, gas:open, gas:init은 .env에 웹앱 주소가 없으면 ".env에 웹앱 주소가 없습니다. 먼저 npm.cmd run gas:deploy를 실행하세요."로 끝냅니다.

## 4회차 약속
- 판독 방식은 .env의 GEMINI_MODE로 고릅니다. off는 판독하지 않음(사람이 직접 판단), mock은 연습용 판독, live는 실제 Gemini 판독입니다.
- GEMINI_MODE가 없으면 STORAGE_MODE=mock일 때 off, STORAGE_MODE=live일 때 live로 봅니다. off·mock·live가 아닌 값, 또는 STORAGE_MODE=mock에 live나 STORAGE_MODE=live에 mock을 적었으면 서버를 켜지 말고 고칠 방법을 한 줄로 알려 줍니다.
- 검사기준 원문은 standards 폴더의 notebooklm-Rev.A.md, notebooklm-Rev.B.md입니다.
- Gemini 지시문 원문은 prompts 폴더의 gemini-v1.md, gemini-v2.md, gemini-v3.md, NotebookLM 질문 원문은 같은 폴더의 notebooklm-v1.md, notebooklm-v2.md, notebooklm-v3.md입니다. 이 여섯 파일은 "기본 원문"이며 앱이 고치지 않습니다.
- 지시문을 따로 고르지 않으면 gemini-v3.md를 씁니다. 설정에서 고친 글은 기본 원문을 덮어쓰지 않고 "v3 · 수정본 10-30 14:05"처럼 새 버전으로 쌓습니다. 수정본은 저장 방식과 상관없이 내 컴퓨터 runtime 폴더에 둡니다.
- 판독 결과는 6항목이고 JSON 키는 한글 항목 이름 "판정", "불량유형", "관찰·수치 근거", "적용 기준과 출처", "권고 조치", "사람 승인 필요 여부"를 그대로 씁니다. 값은 모두 문자열이고 "판정"은 OK, NG, HOLD 중 하나입니다.
- 판독 결과마다 판독할 때의 제품·중량·사진 목록, 검사기준 버전, 지시문 버전 이름과 글, 판독 방식(mock·live), 만든 시각을 함께 저장합니다.
- 판독 결과는 검사와 같은 곳에 저장합니다. 내 컴퓨터 저장(STORAGE_MODE=mock)이면 runtime 폴더, Google 저장(STORAGE_MODE=live)이면 Google 시트의 gemini_results 탭입니다. 이 탭과 머리글은 Google 쪽 시트 만들기(setup) 목록에 더해, npm.cmd run gas:init을 다시 실행하면 빠진 탭·칸이 생기게 합니다(이미 있으면 그대로). Google 쪽 저장 담당 코드가 쓸 수 있는 탭·칸이 정해져 있으면 이 탭과 칸도 쓸 수 있게 넓힙니다.
- Google 쪽 코드에 더하는 일은 saveGeminiResult(판독 결과 저장), listGeminiResults(검사의 판독 결과 읽기), runGemini(Gemini 불러 판독), setGeminiKey(키 넣기) 네 가지입니다. 3회차 코드의 일 이름·탭 이름에 기대지 말고, Google 쪽 코드에 이미 있는 요청·답 방식을 그대로 따라 일을 더합니다.
- mock 판독은 Gemini를 부르지 않고 만듭니다. 화면에 "판독 중"이 보이도록 1~2초 뒤에 끝나게 합니다. "판정"은 늘 HOLD이고, 다른 항목에는 "[모의 테스트 초안]"과 지금 중량(없으면 미측정)을 넣습니다.
- live 판독은 Google 쪽 코드(Apps Script)가 UrlFetchApp으로 Gemini API generateContent를 부릅니다. 모델은 gemini-3.8-flash입니다. 고른 지시문, 검사 정보(제품 이름 또는 "제품 미지정", 중량 "352g" 또는 "미측정", 적용 검사기준 버전), 검사기준 원문, 드라이브에 있는 그 검사의 사진을 함께 보내고 6항목 JSON으로만 답하게 합니다. 보낼 사진 합계가 15MB를 넘으면 부르지 않고 "사진이 너무 커서 판독할 수 없습니다."로 판독 실패를 남깁니다.
- Gemini 답에 6항목이 모두 문자열로 있고 "판정"이 OK·NG·HOLD 중 하나면 통과이며, 그 밖의 키는 버립니다. 그렇지 않으면 결과로 쓰지 않고 "판독 실패"와 이유를 남깁니다. 실패해도 저절로 다시 부르지 않습니다.
- 판독은 서버가 뒤에서 진행합니다. 진행 상태("판독 중", "판독 실패")는 서버가 검사마다 기억하고, 2번 탭은 열 때 그 상태를 묻고 판독 중이면 3초마다 다시 물어 끝나면 결과를 보여 줍니다. 판독 한 번은 1~3분 걸릴 수 있으니 Google 쪽을 부를 때 그보다 짧게 끊지 않습니다. 서버를 다시 켜면 진행 중이던 "판독 중"·"판독 실패" 표시는 사라져도 됩니다(저장된 판독 결과는 남습니다).
- Gemini를 부르는 동안 다른 요청을 막지 않습니다. Google 쪽 코드에 잠금(LockService 등)이 있으면 Gemini 부르기는 잠금 밖에서 하고, 그동안에도 2번 탭 상태 확인·홈·목록 요청은 바로 답합니다.
- Gemini 키(GEMINI_API_KEY)는 .env와 Google 쪽 설정(Apps Script 스크립트 속성 GEMINI_API_KEY)에만 둡니다. npm.cmd run gas:init이 하던 일을 마친 뒤 setGeminiKey로 .env의 키를 Google 쪽 설정에 넣습니다. 키 값은 화면, 터미널, 채팅, 로그 어디에도 내보내지 않습니다.
- 서버와 Google 쪽이 함께 쓰는 코드는 한 파일로 두고, Google 쪽에 올릴 파일을 모으는 단계가 있으면 거기에 그 파일을 더합니다. 그런 단계가 없으면 npm.cmd run gas:push가 그 파일을 gas 폴더로 복사한 뒤 올리게 하고, 복사본은 Git에 올리지 않습니다(.gitignore). 새로 만든 Google 쪽 파일도 올릴 때 빠지지 않게 합니다. Google 쪽 권한 설정(appsscript.json)은 바꾸지 않습니다(외부 연결 권한은 3회차에 넣었습니다).
- "다시 판독 필요": 판독 결과에 남긴 제품·중량·사진 목록이 지금 검사와 하나라도 다르면 그 결과는 "다시 판독 필요"입니다. 판단, 메모, 검사일시만 바뀐 것은 해당하지 않습니다.
- Google 저장일 때 홈 숫자나 카드 목록을 Google 쪽 코드가 계산하는 구조면, 그 계산도 시트의 판독 결과를 읽어 아래 "검토 대기" 기준을 따릅니다.
- "검토 대기"(홈 "보고서 검토 대기"): 성공한 판독 결과가 있고 아직 사람이 확인을 마치지 않은 검사입니다. 판독 결과가 없거나 실패만 한 검사는 세지 않습니다. 4회차에는 판독 결과가 있으면 모두 셉니다. 5회차에 출처 대조 기록이 생기면, 가장 최근 판독 결과가 "다시 판독 필요"가 아니고 그 결과의 마지막 대조 기록이 "일치"인 검사만 세지 않습니다.
