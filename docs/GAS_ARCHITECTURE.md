# GAS 기반 제조품질 대시보드 아키텍처

설계일: 2026-10-01. 이 문서는 사용자 승인 계획을 구현하기 위한 기준입니다. 설계 완료와 Google 리소스 생성·실제 호출 완료는 다릅니다.

## 목표와 데이터 흐름

**Sheets는 업무 기록의 정본이고 Drive는 비공개 사진 저장소입니다.** 로컬 Node.js(NestJS 서버, `src/*.ts`)는 인증·입력 검증·GAS 중계·화면 제공을 담당합니다. 기록 저장소는 GAS 하나이며 같은 기록을 다른 저장소에 함께 쓰지 않습니다.

```text
브라우저 → 로컬 Node.js → GAS 웹앱 doPost(자원 설정 확인) → dispatch
                                        ├─ Sheets: 관계별 기록·버전·이력
                                        ├─ Drive: 사진
                                        └─ Gemini API: 이미지 바이트+기준+측정값
브라우저 ← 로컬 Node.js ← 실행 결과 / 실행 상태 조회

대시보드 ‘근거 확인’ → 로컬 Node.js MCP 클라이언트
                          → Antigravity와 동일 MCP 서버 설정·인증 프로필
                          → 지정 NotebookLM 노트북 → 답변·실제 출처
사용자 → 조회 근거 대조 → 최종 판단 저장 (AI 초안과 별개)
```

검사 담당자와 관리자 권한을 단일 `factory-user` 역할로 통합합니다. **대시보드의 ‘근거 확인’ 버튼을 누르면 로컬 서버가 Antigravity와 동일한 NotebookLM MCP 서버·인증 프로필을 사용합니다.** 이는 GAS/Gemini 연결과 별개의 로컬 MCP 클라이언트 연결이며, Antigravity 대화 자체에 질문을 보내는 방식이 아닙니다. 인증 쿠키를 GAS·브라우저·배포 서버로 옮기거나 근거 조회를 사람의 최종 확인으로 표현하지 않습니다.

## 실행·인증 경계

- 저장소는 GAS 하나입니다. 저장소를 고르는 `STORAGE_PROVIDER` 설정과 MySQL 교육 모드는 지웠습니다. 서버는 DB 설치 없이 시작합니다. 연결 전에는 로컬 모의 저장소(`STORAGE_MODE=mock`)로 뜨고, 화면은 모의임을 표시합니다. 샘플을 실데이터로 표현하지 않습니다.
- 검수는 로컬 loopback 서버(127.0.0.1)를 사용합니다. 검수 연결은 모의임을 표시하고 실제 웹앱 연결과 혼동하지 않습니다.
- GAS는 웹앱(실행 사용자: 배포한 사용자, 액세스: 모든 사용자)으로 배포하고 로컬 Node가 `POST`로 `doPost`를 부릅니다. 공유 비밀값은 두지 않습니다. 웹앱 URL을 아는 사람은 누구나 시트·사진을 읽고 쓰고 판독을 요청할 수 있으므로 URL은 `.env`에만 두고 로그·오류 문구·화면에 내지 않습니다.
- 시트·폴더 ID 확인은 스크립트 잠금과 시트 읽기 전에 합니다. ID가 없으면 웹 요청이 시트를 새로 만들지 않고, 편집기에서 `setupTumblerResources`를 실행하라고 답합니다.
- 웹앱은 늘 HTTP 200으로 답합니다. 결과는 본문 봉투로만 판단하고, `doPost` 밖으로 나간 예외도 JSON 오류로 바꿉니다. Google은 POST에 302로 결과 주소를 주고 Node는 그 주소를 GET으로 받습니다. 첫 권한 승인 전이거나 접근 설정이 맞지 않으면 Google이 HTTP 403으로 거절하고, 로컬 서버는 이를 `GAS_HTTP_403`(503)으로 바꿔 승인과 접근 설정을 확인하라고 안내합니다(승인 전 403은 GET으로 확인했고 POST는 미확인). 그 밖의 2xx가 아닌 응답은 `GAS_HTTP_<상태>`, 200이지만 JSON이 아닌 응답(Google 오류 화면 등)은 `GAS_NOT_JSON`이며 둘 다 503입니다.
- 화면 로그인은 로컬 서버의 기본 계정을 쓰고 DB 사용자/세션 테이블을 요구하지 않습니다. Google 권한 승인은 GAS 소유자가 한 번 합니다. clasp 경로에서는 배포한 계정으로 웹앱 주소를 처음 열 때, 편집기 붙여넣기 경로에서는 편집기에서 setup 함수를 처음 실행할 때입니다. 이 승인과 공장 역할 권한을 같은 개념으로 설명하지 않습니다.
- Gemini 키는 GAS Script Properties에만 둡니다. 키는 `.env`의 `GEMINI_API_KEY`를 `gas:init`이 `init.configure`로 보내 Script Properties에 넣습니다. 편집기 붙여넣기 경로에서는 편집기의 스크립트 속성에 직접 넣을 수도 있습니다. 키 값은 응답·문구에 내지 않습니다. 판독 준비는 키가 있는지만 봅니다. 앱은 호출 수 상한을 두지 않고, Google이 429나 할당량 오류로 거절하면 판독 실행을 실패로 기록하고 안내 문구를 남깁니다. 유료 키의 비용은 Google Cloud 콘솔의 예산과 할당량으로 관리합니다. Google AI Pro 구독은 API 사용권으로 계산하지 않습니다. 유료 전환·결제 연결·키 발급·공개 배포는 실행자 범위 밖입니다.
- Drive 파일은 anyone/public 공유를 하지 않습니다. 인증된 Node 이미지 경로가 GAS에서 base64로 받은 검증된 JPEG를 내려줍니다. 임의 URL 프록시나 사용자가 지정한 임의 Drive ID 조회는 금지합니다.
- 로컬 서버가 호출 결과를 가져옵니다. GAS가 인터넷에서 localhost로 callback을 보낸다고 설명하지 않습니다.

## 저장 구조

전용 스프레드시트의 관계별 탭은 다음과 같습니다. UUID 계열 문자열 키, ISO-8601 시간, 명시적 enum/수치 검증을 사용합니다. 기존 API 응답의 필드·집계 의미는 유지하거나 브라우저 호출과 함께 호환합니다.

| 탭 | 목적 |
|---|---|
| products | 제품ID·제품명·색상·용량 |
| inspections | 검사ID·제품ID·검사일시·최초 측정·최초 판단·내용 버전 |
| inspection_images | 이미지ID·검사ID·인증된 image_url·Drive file_id·SHA-256·활성 상태 |
| defect_codes / inspection_defects | 불량 사전 및 검사와 불량의 관계 |
| inspection_records / record_defects | 사용자가 남긴 판단·측정·메모·조치의 변경 이력 |
| standards | 기준ID·버전·기준 원문·rules_json·해시 |
| ai_runs | 실행ID·요청ID·검사ID·내용/기준 버전·상태·오류 종류·시간 |
| ai_drafts | 실행ID·입력 스냅샷·6항목 결과·기준ID/해시·모델·생성 시각 |
| evidence_links / review_events | 사용자 출처 기록, 인용 위치, 확인 메모, 검토 상태·확인 시각 |
| evidence_queries | MCP 조회ID·검사/초안ID·내용/기준 버전·노트북ID·출처ID·상태·조회 시각 |
| requests | 요청ID·action·내용 해시·결과(같은 요청 중복 방지) |
| photos | 사진ID·Drive file_id·SHA-256·형식(비공개 Drive 사진) |
| inspection_updates | 검사 정보 수정 이력(제품·검사일시·중량·메모·변경 사유·내용 버전) |
| prompt_versions | 지시문 버전ID·종류·기반 버전·원문·해시·기본 여부 |

Sheets에 외래키나 SQL 트랜잭션이 있다고 표현하지 않습니다. GAS가 참조·자료형·필수값을 검사하고 ScriptLock으로 경쟁 쓰기를 직렬화합니다. Drive와 Sheets 사이에는 원자적 트랜잭션이 없으므로 업로드 단계를 기록하고 일부 실패/소속 미연결 파일을 복구 목록에 남깁니다. 재시도로 같은 요청의 사진을 중복 생성하지 않습니다. 원본·실패 파일을 자동 영구 삭제하지 않습니다.

**숫자로 시작하는 문자열은 텍스트로 쓰고, 이미 날짜 셀이 된 값은 읽을 때 쓴 텍스트로 되돌립니다.** Sheets는 `2026-10-19 08:30:00` 같은 날짜 모양 텍스트를 날짜 셀로 바꾸고 `getValues`는 그 셀을 Date로 돌려줍니다. 그래서 2026-10-19 실제 웹앱에서 홈 집계일이 `Mon Oct 19`로 나왔습니다. 쓸 때 `sanitize`는 수식 문자(`=` `+` `-` `@`)와 숫자로 시작하는 문자열(검사일시, 날짜나 숫자 같은 메모·변경 사유) 앞에 `'`를 붙여 텍스트로 남기고, `desanitize`는 읽은 값에 `'`가 남아 있으면 뗍니다. 이 규칙 전에 날짜 셀로 저장된 값은 `getRows`가 `sheetDateText`로 되돌립니다. `inspected_at`은 스프레드시트 시간대(`getSpreadsheetTimeZone`)의 `yyyy-MM-dd HH:mm:ss`로 바꿉니다. Sheets가 그 시간대로 텍스트를 읽어 날짜 셀을 만들었으므로 같은 시간대로 되돌리면 쓴 텍스트가 나옵니다. 나머지 시각 열(`created_at`, `recorded_at` 등)은 `toISOString()` 텍스트이고, Date 셀이면 같은 순간의 ISO 텍스트로 읽습니다.

**시트는 탭마다 한 번에 읽고, 목록·홈은 메모리에서 묶습니다.** `getRows`는 `getDataRange().getValues()` 한 번으로 머리글과 행을 읽습니다. 상세·목록·홈은 `readInspections`가 검사 관련 탭을 한 번씩 읽어 검사별로 묶은 결과를 씁니다. 검사 수가 늘어도 읽는 탭 수는 그대로입니다. 쓰기는 `appendRow`(머리글을 읽고 한 행 추가)와 `updateLiveRow`(바뀐 칸만 씀)이고, 스크립트 속성은 필요할 때 `getProperty`로 읽습니다. 모든 action은 스크립트 잠금을 30초까지 기다리고, 못 잡으면 `CONFLICT`(「서버가 현재 다른 작업을 처리 중입니다」)로 답합니다. 화면은 이 응답을 그대로 보여 줍니다.

**읽기 시에도 키 중복·끊어진 참조·필수 열 누락을 검증합니다.** 오류가 있으면 데이터 무결성 오류를 알리고 임의로 행을 버리거나 0건으로 집계하지 않습니다. 원본 시트의 임의 직접 편집을 웹의 버전/변경 이력과 자동 동기화한다고 주장하지 않습니다. 이번 런타임 변경은 대시보드와 명시적 import 경로를 사용합니다.

셀 기록은 사용자 입력의 `=`, `+`, `-`, `@` 수식 주입을 막는 명시적인 안전한 쓰기 방식을 사용합니다. ID·수치와 문자열 처리를 구분하고 내보내기에서도 수식 주입을 방어합니다.

## API와 실행 계약

기존 `/api/home`, `/api/products`, `/api/inspections`, 검사 상세·사진·AI 실행·사용자 기록·근거 API를 GAS 저장소로 지원합니다. 설정 화면은 저장소·Gemini·NotebookLM 연동 상태를 보여 줍니다(`GET /api/operations`의 `integrations`).

`POST /api/inspections/:id/evidence-queries`는 현재 초안ID·expected_version·request_id를 받고 서버에 고정한 노트북·출처 대응표로 MCP 질의를 실행합니다. `GET /api/inspections/:id/evidence-queries`로 상태·답변·실제 반환 출처를 조회합니다. 브라우저에서 임의 MCP command/args/env, 인증 프로필 경로, 임의 노트북ID를 넘기지 못합니다. `/api/notebooklm/status`에는 준비/인증/버전·출처 매핑 상태만 노출하고 비밀값을 노출하지 않습니다.

GAS는 명시적 action allowlist를 가진 `dispatch(request)` 함수 하나를 제공합니다. 웹앱 진입점 `doPost`는 본문과 자원 설정을 확인한 뒤 요청을 이 함수에 넘깁니다. 외부 함수 이름을 사용자 입력으로 받아 임의 호출하지 않습니다.

```json
{
  "schema_version": 1,
  "action": "inspections.createBatch",
  "request_id": "uuid",
  "expected_version": 0,
  "payload": {}
}
```

성공에는 result와 요청ID, 실패에는 고정 error code·안전한 message·재시도 가능 여부를 반환합니다. `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `QUOTA_EXCEEDED`, `SETUP_REQUIRED`, `UPSTREAM_FAILED`를 구분합니다. `success:false` 봉투를 HTTP 200이라는 이유로 성공으로 취급하지 않습니다. 로컬 Node는 code를 HTTP 상태로 바꿉니다(`VALIDATION` 400, `NOT_FOUND` 404, `CONFLICT` 409, `QUOTA_EXCEEDED` 429, `SETUP_REQUIRED` 503). `UPSTREAM_FAILED`와 code가 없는 오류는 문구를 숨긴 500입니다.

변경 요청은 요청ID를 재사용해 중복을 방지합니다. 같은 요청ID와 다른 payload는 충돌 처리합니다. `expected_version`이 최신 버전과 다르면 409이고 덮어쓰지 않습니다. 수정과 판단 저장은 내용 버전을 올립니다. 기존 초안은 AI가 본 제품·중량·사진이 바뀐 경우에만 stale/재판독 필요입니다(gas/Code.gs `draftOutdated`, 모의 저장소 `_draftOutdated`).

## AI와 사람이 하는 일

1. 사진 저장과 관계 연결 성공 후 자동 판독을 요청합니다. 한도/설정 미준비이면 검사 저장 성공과 미판독을 함께 표시합니다. 사진 없이 성공 판독을 만들지 않습니다.
2. GAS에서 실행 기록을 만든 뒤 잠금을 풀고 Gemini에 실제 이미지 바이트·측정값·동일 버전 기준 텍스트를 전달합니다. 모델명은 설정으로 분리하고 호출 실패를 다른 유료 모델로 우회하지 않습니다.
3. 결과는 `판정`, `불량유형`, `관찰·수치 근거`, `적용 기준과 출처`, `권고 조치`, `사람 승인 필요 여부` 6항목을 검증합니다. 실제 근거 부족은 HOLD이며 HTTP 오류·한도·파싱 실패는 판독 실패입니다.
4. 서버가 종료되거나 응답이 유실되면 실행ID로 상태를 조회합니다. 진행 중/불명 상태에서 자동 재호출하지 않습니다. 사용자 재시도도 이전 실행 확인 뒤 명시적으로 새 요청을 만듭니다. 무한 폴링·자동 트리거는 설치하지 않습니다.
5. 동일 기준 원문·버전·해시로 NotebookLM 등록 파일을 내보내고 노트북/출처ID 대응을 로컬 비밀 제외 설정에 명시합니다. ‘근거 확인’은 고정 MCP query 도구에 검사 관찰·적용 기준 질의를 전달하고 답변·출처ID·원문 인용 위치·조회 시각을 표시합니다. 문서가 도구 실행 지시를 내리더라도 추가 도구를 실행하지 않습니다. 출처를 반환하지 않았거나 기준 버전 대응을 확인할 수 없으면 ‘근거 미확인’이며 인용을 만들어내지 않습니다.
6. 사용자는 반환 근거를 대조하고 확인 사실을 별도로 기록합니다. 자동 조회 완료를 사람 검토 완료로 바꾸지 않습니다. 기준/검사값 변경 또는 다른 검사로 이동한 동안의 늦은 조회 결과는 원래 버전에 귀속되며 현재 화면/확인 상태를 덮어쓰지 않습니다.
7. 사용자 판단과 조치가 별도 기록에 쌓입니다. AI 결과가 최초 기록/최신 사용자 판단을 덮어쓰지 않습니다. 사진 OK는 출하 승인이나 누수·라벨 내용 적합성을 보증하지 않습니다.

### 동일 MCP 서버·인증 프로필의 의미

- 실제 활성 Antigravity 서버 항목의 transport·실행 패키지 버전·profile 선택·환경 설정을 확인해 재사용합니다. 인증 파일 내용을 앱 저장소에 복사하거나 새 default profile로 조용히 대체하지 않습니다.
- stdio면 동일 설정으로 별도의 MCP 클라이언트 프로세스를 연결합니다. Antigravity가 점유한 stdin/stdout을 가로채지 않습니다. 로컬 HTTP transport면 같은 검증된 endpoint에 별도 MCP 세션으로 연결합니다. 임의 인터넷 endpoint로 인증정보를 전송하지 않습니다.
- tools/list와 허용 query/출처 읽기 도구의 스키마를 확인합니다. 생성·삭제·공유·연구·오디오/영상 생성 등 다른 도구를 웹 버튼에 연결하지 않습니다. 질의 자체가 노트북 대화 이력에 남을 수 있음을 안내합니다.
- 인증 만료·서버 미실행·동시 프로필 사용 충돌·서비스 한도·도구 변경은 각각 표시하고 재로그인을 우회하거나 자동으로 다른 프로필을 만들지 않습니다. 동시 사용이 검증되지 않으면 명확한 busy 오류/재시도 안내를 제공합니다.
- 구현 테스트에는 fake MCP transport를 쓰되 실제 MCP 호출 성공으로 표시하지 않습니다. 실제 연결 검수는 지정된 교육 노트북과 동일 프로필이 확인된 뒤 소량 질의로 진행합니다.
- MCP 설정 파일 위치는 두 곳입니다. 앱은 `~/.gemini/config/mcp_config.json`을 먼저 보고 `~/.gemini/antigravity/mcp_config.json`을 다음에 봅니다. 순서와 근거는 [NotebookLM MCP 연결](NOTEBOOKLM_MCP.md)에 있습니다.
- 2026-10-01 탐색에서 강사 PC의 `~/.gemini/config/mcp_config.json`은 0바이트이고 확인한 전역 구성에는 NotebookLM 항목이 없습니다. 현재 동일 연결·로그인·교재 노트북은 실증되지 않았습니다. 활성 plugin 서버/설정이 추가로 발견되면 확인해 사용하고, 없으면 연결 준비 필요로 남깁니다. 설치·로그인·프로필 준비 완료를 추정하지 않습니다.

홈 수치는 최근 저장 검사일 기준입니다. 검사ID를 한 번만 집계하며 NG/HOLD는 최신 사용자 판단(없으면 최초 판단)을 사용합니다. 보고서 없는 검사는 보고서 검토 대기가 아닙니다. 보고서 검토는 3번 탭의 출처 대조 저장입니다. 최신 초안에 저장된 마지막 출처 대조가 '일치'이면 검토 완료(reviewed), '검토 필요'이면 needs_check, 없으면 pending입니다. 초안은 AI가 본 입력(제품·중량·사진, `input_snapshot`)이 지금 검사와 다를 때만 stale입니다. 판단 저장은 내용 버전을 올리지만 초안을 stale로 만들지 않습니다. needs_check·pending·stale이 대기입니다. 모의 저장소와 GAS가 같은 규칙을 씁니다(`review_events` 탭은 데이터 보존을 위해 남기지만 판정에 쓰지 않습니다). 조회 실패를 0건으로 표시하지 않습니다.

## 반입·운영·완료 기준

- MySQL 데이터를 Sheets로 옮기던 반입 스크립트는 MySQL 경로와 함께 지웠습니다. 필요하면 git 이력(커밋 df43d90)의 `scripts/migrate-to-sheets.mjs`를 봅니다.
- 교육 이미지는 공개 저장소 `startup-life/manufacturing-quality-student-images`에서 lockfile의 고정 커밋/해시로 가져옵니다. 그 저장소에는 train/val 128장만 있고 평가용 사진과 강사 자료는 들어 있지 않습니다.
- 시트와 Drive 폴더는 편집기에서 `setupTumblerResources`를 실행할 때만 만들고, 다시 실행하면 같은 자원을 씁니다. 웹앱 요청으로는 폴더·시트가 자동 생성되지 않습니다.
- 개인 Google 계정의 GAS 실행/서비스 할당량과 Gemini API의 실제 한도는 별도 확인합니다. 앱은 호출 수를 따로 제한하지 않습니다. 더미 교육 데이터만 전송합니다.
- 전체 단위/계약 테스트와 모의 GAS 실패 시험을 실행합니다. 실제 인증·Drive/Sheets 저장·Gemini 호출·NotebookLM 대조는 각각 별도 실증을 남깁니다.
- 실인증이 없는 상태에서는 정상 코드와 모의 실행을 제출할 수 있지만, 실제 Google 리소스/실제 AI/MCP 완료로 보고하지 않습니다. 외부 미완료 목록·다음 사용자 행동을 명시합니다.

규모가 커지면 Sheets의 조회 성능·동시 쓰기·무결성 한계 때문에 DB 정본으로 재설계해야 합니다. 이번 버전은 단일 사용자 역할의 소규모 교육용이며 생산 공장용 SLA나 완전 ACID 저장을 주장하지 않습니다.

## 공식 근거

- [Apps Script 웹앱](https://developers.google.com/apps-script/guides/web): `doPost` 진입점과 배포 접근 설정.
- [Apps Script 할당량](https://developers.google.com/apps-script/guides/services/quotas): 실행 시간과 서비스별 한도.
- [Gemini API 결제](https://ai.google.dev/gemini-api/docs/billing): 구독과 별도 API 결제/무료 등급.
- [Gemini 이미지 입력](https://ai.google.dev/gemini-api/docs/image-understanding): 이미지 바이트 입력과 실제 멀티모달 호출.
- [NotebookLM 커뮤니티 MCP](https://github.com/jacob-bd/gemini-notebook-mcp-cli): MCP query·출처 조회와 프로필 기반 인증. 공식 Enterprise API 무료 할당량이나 유료 Gemini API 호출로 설명하지 않습니다.
