# GAS 기반 제조품질 대시보드 아키텍처

설계일: 2026-10-01. 이 문서는 사용자 승인 계획을 구현하기 위한 기준입니다. 설계 완료와 Google 리소스 생성·실제 호출 완료는 다릅니다.

## 목표와 데이터 흐름

**Sheets는 업무 기록의 정본이고 Drive는 비공개 사진 저장소입니다.** 로컬 Node.js(NestJS 서버, `src/*.ts`)는 인증·입력 검증·GAS 중계·화면 제공을 담당합니다. 기록 저장소는 GAS 하나이며 같은 기록을 다른 저장소에 함께 쓰지 않습니다.

```text
브라우저 → 로컬 Node.js → GAS 웹앱 doPost(자원 설정 확인) → dispatch
                                        ├─ Sheets: 관계별 기록·버전·이력
                                        └─ Drive: 사진
브라우저 ← 로컬 Node.js ← 실행 결과
```

검사 담당자와 관리자 권한을 단일 `factory-user` 역할로 통합합니다.

## 실행·인증 경계

- 저장소는 GAS 하나입니다. 저장소를 고르는 `STORAGE_PROVIDER` 설정과 MySQL 교육 모드는 지웠습니다. 서버는 DB 설치 없이 시작합니다. 연결 전에는 로컬 모의 저장소(`STORAGE_MODE=mock`)로 뜨고, 화면은 모의임을 표시합니다. 샘플을 실데이터로 표현하지 않습니다.
- 검수는 로컬 loopback 서버(127.0.0.1)를 사용합니다. 검수 연결은 모의임을 표시하고 실제 웹앱 연결과 혼동하지 않습니다.
- GAS는 웹앱(실행 사용자: 배포한 사용자, 액세스: 모든 사용자)으로 배포하고 로컬 Node가 `POST`로 `doPost`를 부릅니다. 공유 비밀값은 두지 않습니다. 웹앱 URL을 아는 사람은 누구나 시트·사진을 읽고 쓸 수 있으므로 URL은 `.env`에만 두고 로그·오류 문구·화면에 내지 않습니다.
- 시트·폴더 ID 확인은 스크립트 잠금과 시트 읽기 전에 합니다. ID가 없으면 웹 요청이 시트를 새로 만들지 않고, 편집기에서 `setupTumblerResources`를 실행하라고 답합니다.
- 웹앱은 늘 HTTP 200으로 답합니다. 결과는 본문 봉투로만 판단하고, `doPost` 밖으로 나간 예외도 JSON 오류로 바꿉니다. Google은 POST에 302로 결과 주소를 주고 Node는 그 주소를 GET으로 받습니다. 첫 권한 승인 전이거나 접근 설정이 맞지 않으면 Google이 HTTP 403으로 거절하고, 로컬 서버는 이를 `GAS_HTTP_403`(503)으로 바꿔 승인과 접근 설정을 확인하라고 안내합니다(승인 전 403은 GET으로 확인했고 POST는 미확인). 그 밖의 2xx가 아닌 응답은 `GAS_HTTP_<상태>`, 200이지만 JSON이 아닌 응답(Google 오류 화면 등)은 `GAS_NOT_JSON`이며 둘 다 503입니다.
- 화면 로그인은 로컬 서버의 기본 계정을 쓰고 DB 사용자/세션 테이블을 요구하지 않습니다. Google 권한 승인은 GAS 소유자가 한 번 합니다. clasp 경로에서는 배포한 계정으로 웹앱 주소를 처음 열 때, 편집기 붙여넣기 경로에서는 편집기에서 setup 함수를 처음 실행할 때입니다. 이 승인과 공장 역할 권한을 같은 개념으로 설명하지 않습니다.
- Drive 파일은 anyone/public 공유를 하지 않습니다. 인증된 Node 이미지 경로가 GAS에서 base64로 받은 검증된 JPEG를 내려줍니다. 임의 URL 프록시나 사용자가 지정한 임의 Drive ID 조회는 금지합니다.
- 로컬 서버가 호출 결과를 가져옵니다. GAS가 인터넷에서 localhost로 callback을 보낸다고 설명하지 않습니다.

## 저장 구조

전용 스프레드시트의 관계별 탭은 다음과 같습니다. 초기화가 탭을 한꺼번에 만들어 두며, 지금 서버가 쓰는 탭은 products, inspections, inspection_images, requests, photos, inspection_updates입니다. 나머지는 이후 단계에서 씁니다. UUID 계열 문자열 키, ISO-8601 시간, 명시적 enum/수치 검증을 사용합니다. 기존 API 응답의 필드·집계 의미는 유지하거나 브라우저 호출과 함께 호환합니다.

| 탭 | 목적 |
|---|---|
| products | 제품ID·제품명·색상·용량 |
| inspections | 검사ID·제품ID·검사일시·최초 측정·최초 판단·내용 버전 |
| inspection_images | 이미지ID·검사ID·인증된 image_url·Drive file_id·SHA-256·활성 상태 |
| inspection_records / record_defects | 사용자가 남긴 판단·측정·메모·조치의 변경 이력 |
| standards | 기준ID·버전·기준 원문·rules_json·해시 |
| ai_runs | 실행ID·요청ID·검사ID·내용/기준 버전·상태·오류 종류·시간 |
| ai_drafts | 실행ID·입력 스냅샷·6항목 결과·기준ID/해시·모델·생성 시각 |
| evidence_links / review_events | 사용자 출처 기록, 인용 위치, 확인 메모, 검토 상태·확인 시각 |
| evidence_queries | MCP 조회ID·검사/초안ID·내용/기준 버전·노트북ID·출처ID·상태·조회 시각 |
| requests | 요청ID·action·내용 해시·결과(같은 요청 중복 방지) |
| photos | 사진ID·Drive file_id·SHA-256·형식(비공개 Drive 사진) |
| inspection_updates | 검사 정보 수정 이력(제품·검사일시·중량·메모·변경 사유·내용 버전) |

Sheets에 외래키나 SQL 트랜잭션이 있다고 표현하지 않습니다. GAS가 참조·자료형·필수값을 검사하고 ScriptLock으로 경쟁 쓰기를 직렬화합니다. Drive와 Sheets 사이에는 원자적 트랜잭션이 없으므로 업로드 단계를 기록하고 일부 실패/소속 미연결 파일을 복구 목록에 남깁니다. 재시도로 같은 요청의 사진을 중복 생성하지 않습니다. 원본·실패 파일을 자동 영구 삭제하지 않습니다.

**숫자로 시작하는 문자열은 텍스트로 쓰고, 이미 날짜 셀이 된 값은 읽을 때 쓴 텍스트로 되돌립니다.** Sheets는 `2026-10-19 08:30:00` 같은 날짜 모양 텍스트를 날짜 셀로 바꾸고 `getValues`는 그 셀을 Date로 돌려줍니다. 그래서 2026-10-19 실제 웹앱에서 홈 집계일이 `Mon Oct 19`로 나왔습니다. 쓸 때 `sanitize`는 수식 문자(`=` `+` `-` `@`)와 숫자로 시작하는 문자열(검사일시, 날짜나 숫자 같은 메모·변경 사유) 앞에 `'`를 붙여 텍스트로 남기고, `desanitize`는 읽은 값에 `'`가 남아 있으면 뗍니다. 이 규칙 전에 날짜 셀로 저장된 값은 `getRows`가 `sheetDateText`로 되돌립니다. `inspected_at`은 스프레드시트 시간대(`getSpreadsheetTimeZone`)의 `yyyy-MM-dd HH:mm:ss`로 바꿉니다. Sheets가 그 시간대로 텍스트를 읽어 날짜 셀을 만들었으므로 같은 시간대로 되돌리면 쓴 텍스트가 나옵니다. 나머지 시각 열(`created_at`, `recorded_at` 등)은 `toISOString()` 텍스트이고, Date 셀이면 같은 순간의 ISO 텍스트로 읽습니다.

**시트는 탭마다 한 번에 읽고, 목록·홈은 메모리에서 묶습니다.** `getRows`는 `getDataRange().getValues()` 한 번으로 머리글과 행을 읽습니다. 상세·목록·홈은 `readInspections`가 검사 관련 탭을 한 번씩 읽어 검사별로 묶은 결과를 씁니다. 검사 수가 늘어도 읽는 탭 수는 그대로입니다. 쓰기는 `appendRow`(머리글을 읽고 한 행 추가)와 `updateLiveRow`(바뀐 칸만 씀)이고, 스크립트 속성은 필요할 때 `getProperty`로 읽습니다. 모든 action은 스크립트 잠금을 30초까지 기다리고, 못 잡으면 `CONFLICT`(「서버가 현재 다른 작업을 처리 중입니다」)로 답합니다. 화면은 이 응답을 그대로 보여 줍니다.

**읽기 시에도 키 중복·끊어진 참조·필수 열 누락을 검증합니다.** 오류가 있으면 데이터 무결성 오류를 알리고 임의로 행을 버리거나 0건으로 집계하지 않습니다. 원본 시트의 임의 직접 편집을 웹의 버전/변경 이력과 자동 동기화한다고 주장하지 않습니다. 이번 런타임 변경은 대시보드와 명시적 import 경로를 사용합니다.

셀 기록은 사용자 입력의 `=`, `+`, `-`, `@` 수식 주입을 막는 명시적인 안전한 쓰기 방식을 사용합니다. ID·수치와 문자열 처리를 구분하고 내보내기에서도 수식 주입을 방어합니다.

## API와 실행 계약

`/api/home`, `/api/products`, `/api/inspections`, 검사 상세·수정·사진 API를 GAS 저장소로 지원합니다. 설정 화면은 저장소 연동 상태를 보여 줍니다(`GET /api/operations`의 `integrations`).

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

변경 요청은 요청ID를 재사용해 중복을 방지합니다. 같은 요청ID와 다른 payload는 충돌 처리합니다. `expected_version`이 최신 버전과 다르면 409이고 덮어쓰지 않습니다. 수정은 내용 버전을 올립니다.

## 홈 수치

홈 수치는 최근 저장 검사일 기준입니다. 검사ID를 한 번만 집계하며 NG/HOLD는 등록할 때의 판단을 사용합니다. 보고서 검토 대기는 아직 셀 보고서가 없어 늘 0입니다. 모의 저장소와 GAS가 같은 규칙을 씁니다. 조회 실패를 0건으로 표시하지 않습니다.

## 반입·운영·완료 기준

- MySQL 데이터를 Sheets로 옮기던 반입 스크립트는 MySQL 경로와 함께 지웠습니다. 필요하면 git 이력(커밋 df43d90)의 `scripts/migrate-to-sheets.mjs`를 봅니다.
- 교육 이미지는 공개 저장소 `startup-life/manufacturing-quality-student-images`에서 lockfile의 고정 커밋/해시로 가져옵니다. 그 저장소에는 train/val 128장만 있고 평가용 사진과 강사 자료는 들어 있지 않습니다.
- 시트와 Drive 폴더는 편집기에서 `setupTumblerResources`를 실행할 때만 만들고, 다시 실행하면 같은 자원을 씁니다. 웹앱 요청으로는 폴더·시트가 자동 생성되지 않습니다.
- 개인 Google 계정의 GAS 실행/서비스 할당량은 별도 확인합니다. 더미 교육 데이터만 전송합니다.
- 전체 단위/계약 테스트와 모의 GAS 실패 시험을 실행합니다. 실제 인증·Drive/Sheets 저장은 별도 실증을 남깁니다.
- 실인증이 없는 상태에서는 정상 코드와 모의 실행을 제출할 수 있지만, 실제 Google 리소스 완료로 보고하지 않습니다. 외부 미완료 목록·다음 사용자 행동을 명시합니다.

규모가 커지면 Sheets의 조회 성능·동시 쓰기·무결성 한계 때문에 DB 정본으로 재설계해야 합니다. 이번 버전은 단일 사용자 역할의 소규모 교육용이며 생산 공장용 SLA나 완전 ACID 저장을 주장하지 않습니다.

## 공식 근거

- [Apps Script 웹앱](https://developers.google.com/apps-script/guides/web): `doPost` 진입점과 배포 접근 설정.
- [Apps Script 할당량](https://developers.google.com/apps-script/guides/services/quotas): 실행 시간과 서비스별 한도.
