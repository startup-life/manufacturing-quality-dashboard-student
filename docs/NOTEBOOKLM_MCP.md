# NotebookLM MCP 연결

제품 이름은 Gemini Notebook(옛 이름 NotebookLM, notebook.google.com)입니다. 2026-10-20 로그인 창의 화면에도 Gemini Notebook으로 나왔습니다.
이 문서는 코드와 맞춰 NotebookLM으로 적습니다.
단계별 순서는 [실제 연결 준비 안내](LOCAL_SETUP.md)의 「NotebookLM 연결」 절을 따릅니다. 이 문서는 그 내용을 코드 기준으로 묶은 것입니다.

## 앱이 하는 일

- 검사 상세에서 `근거 확인`을 누르면 로컬 Node 서버가 로컬 MCP 서버를 띄웁니다.
- 부르는 도구는 `notebook_query` 하나입니다(`src/mcp-stdio.ts`).
- Antigravity 대화에 질문을 보내는 방식이 아닙니다. Antigravity와 같은 MCP 설정을 읽어 별도 프로세스로 띄웁니다.
- notebooklm-mcp-cli는 커뮤니티 도구입니다. Google의 공식 Enterprise API가 아닙니다.

## 근거 화면에 나오는 것

- `notebook_query`의 응답에는 답변(`answer`), 인용한 소스 ID(`sources_used`), 인용 번호별 소스 ID(`citations`), 인용 원문(`references`)이 있습니다. 문서 제목은 없습니다(v0.15.6 소스 `services/chat.py`의 `QueryResult`).
- 답변이 소스를 하나라도 인용하면 근거 카드 머리글에 질의한 기준 문서 이름이 나옵니다. 예: `교육용 텀블러 검사기준 (TUM-QC-STD-001 Rev.A)`. 이름은 노트북에 넣은 파일과 같은 `standards/<버전>.json`의 `title`과 `standards/notebooklm-<버전>.md`의 문서번호로 만듭니다(`src/mcp-client.ts`의 `citedStandardName`).
- 인용이 없으면 머리글은 `문서명 미확인 · Rev.A`입니다. 이 동작 전에 저장한 실제 답변도 저장된 인용이 있으면 같은 이름이 붙습니다.
- 노트북에는 Rev.A와 Rev.B가 함께 있고 소스 ID로는 어느 파일인지 구분하지 않습니다. 머리글의 버전은 질의한 버전입니다. 답변이 그 버전만 인용했는지는 사람이 원문과 대조합니다. 실제 답변이면 머리글 아래에 `질의한 기준입니다. 답변이 인용한 원문의 판(Rev.A/B)은 아래 인용과 대조해 확인하세요.`가 나옵니다(모의 응답에는 나오지 않습니다).
- 남은 일: 노트북 소스 목록에서 소스 ID를 파일 이름(`notebooklm-Rev.A.md` 등)으로 바꿔 머리글에 실제 인용한 판을 적고, 질의한 판과 다른 판을 인용하면 경고합니다. 지금은 하지 않았습니다.
- 답변의 `> "…"` 인용은 `>` 기호 없이 따로 들여 쓴 인용 단락으로 보입니다. 목록 항목 아래에 들여 쓴 인용은 그 항목 안에 붙습니다.
- 질의가 성공하면 접힌 「근거 질문·연결 정보」에 `실제 NotebookLM 질의 완료`가 보입니다. 상세를 다시 열어 저장된 답변을 보면 `저장된 실제 NotebookLM 답변`이 보입니다. `NOTEBOOKLM_MODE=mock`이면 `모의 응답 — 실제 NotebookLM 연결 아님(NOTEBOOKLM_MODE=mock)`입니다.
- 상세를 연 직후 근거 질문 목록을 다 불러오기 전에 `근거 확인`을 누르면 `저장된 근거 질문을 불러오는 중입니다. 불러오면 이어서 근거를 확인합니다.`가 나오고, 목록을 불러온 뒤 바로 질의합니다.
- 시간 제한: NotebookLM 질의는 120초(`notebook_query`의 `timeout`, notebooklm-mcp-cli 0.15.6 기본값과 같음), MCP 실행 전체는 135초입니다(`src/mcp-client.ts`의 `NOTEBOOK_QUERY_SECONDS`, `MCP_CALL_MS`). 135초를 넘으면 `NotebookLM 응답 시간이 초과되었습니다. 자동 재시도하지 않습니다.`가 나옵니다. NotebookLM 쪽 120초가 먼저 끝나도 같은 문구가 나옵니다(응답의 `error_details.category`가 `deadline_exceeded`). 시간 초과는 연결 실패가 아니라서 설정 화면의 연결 상태는 그대로 둡니다. 2026-10-20 실제 질의는 누르고 답이 나오기까지 40~59초였고 GAS 읽기·저장 시간이 포함됩니다. 60초·75초였던 제한은 실측 상한과 거의 같아 조금만 늦어도 시간 초과가 나서 지금 값으로 올렸습니다.
- 설정 화면의 「NotebookLM MCP 로컬 연동 상태」는 지금 떠 있는 서버 프로세스에서 실제 질의가 한 번 성공해야 `정상 연결`이 됩니다. 그 전과 질의가 실패한 뒤에는 `연결 준비 필요`입니다. 이 상태는 서버 메모리에만 있어서 서버를 다시 시작하면 `연결 준비 필요`로 돌아갑니다. 저장된 실제 답변이 있어도 마찬가지입니다.

## 버전

- 버전은 고정하지 않습니다. 비전 리스크 과정과 같은 설치 명령을 쓰고 MCP 설정도 같이 씁니다.
- 2026-10-20에 macOS에서 v0.15.6으로 설치, 로그인, 노트북·소스 만들기를 했습니다. 같은 날 앱의 `근거 확인`으로 실제 질의도 성공했습니다(은색 텀블러 59초, 검정 텀블러 40초).
- 앱은 `notebook_query` 도구가 있는지 확인하고 없으면 멈춥니다(`src/mcp-stdio.ts`).
- 조사 때 본 릴리스는 0.13.0(2026-09-28)입니다.
- `nlm setup add antigravity`는 0.15.5 기준 조사 결과입니다.
- 어느 버전도 Windows에서 확인하지 않았습니다. 수업 전에 강사가 시험하고 이 문서를 고칩니다.

## 설치와 로그인

```powershell
uv tool install notebooklm-mcp-cli
nlm login --storage protected
```

- uv가 먼저 있어야 합니다. 설치는 uv 공식 안내를 따릅니다.
- `--storage protected`는 새 프로필에서 저장 위치를 묻지 않게 합니다. 로그인 정보는 OS 키체인에 암호화해 저장됩니다. 쿠키 파일을 공유하지 않습니다.
- `nlm login`은 Antigravity 터미널에서 본인이 직접 실행합니다. 로그인을 300초까지 기다리는데, 에이전트가 대신 띄우고 알려 주는 방식에서는 두 번 시간이 초과됐고 본인이 직접 실행하자 30초에 끝났습니다.
- 로그인 창은 nlm 전용 Chrome 프로필(`~/.notebooklm-mcp-cli/chrome-profiles/default`)로 따로 뜹니다(`auth.browser=auto`, macOS에서는 설치된 Chrome이 골라졌습니다). 평소 Chrome이 켜져 있어도 'Chrome이 이미 실행 중' 오류는 나지 않았고, 평소 Chrome의 프로필·북마크·로그인은 쓰지 않습니다.
- 첫 화면은 Google 로그인이 아니라 Gemini Notebook 소개 페이지(notebook.google.com/trynow)입니다. 오른쪽 위 `Sign in` 또는 `Sign in to Gemini Notebook`을 누르면 Google 로그인으로 넘어갑니다(캡처 보관).
- Windows와 개인 Google AI Pro 계정에서는 미확인입니다.

Antigravity 대화에서도 쓰려면 `nlm setup`으로 등록합니다. 앱만 쓸 때는 `NOTEBOOKLM_MCP_COMMAND`로 충분합니다(아래 순서).

- `nlm setup`에서는 Antigravity 하나만 고릅니다(0.15.5 기준 `nlm setup add antigravity`).
- 기존 설정은 먼저 백업합니다. 다른 클라이언트 설정을 한꺼번에 바꾸지 않습니다.

## 앱이 MCP 실행 방법을 찾는 순서

서버 이름은 `gemini-notebook-mcp`입니다(`src/mcp-client.ts`).

1. 환경 변수 `NOTEBOOKLM_MCP_COMMAND`. 이때 인자는 `--transport stdio`입니다. 값은 `notebooklm-mcp` 실행 파일의 절대 경로이고, macOS에서는 `~/.local/bin/notebooklm-mcp`(`uv tool dir --bin`이 알려 주는 폴더)입니다. Windows 경로는 미확인입니다.
2. `~/.gemini/config/mcp_config.json`의 `gemini-notebook-mcp` 항목. Antigravity 공식 문서의 전역 설정 위치입니다.
3. `~/.gemini/antigravity/mcp_config.json`의 `gemini-notebook-mcp` 항목. `nlm setup add antigravity`(0.15.5)가 쓰는 위치입니다.

- 앞의 것이 있으면 뒤의 것은 읽지 않습니다.
- 앞 파일을 읽지 못해도 뒤 파일은 확인합니다.
- 어디에도 없으면 오류 문구가 확인한 곳을 모두 보여 줍니다.
- Antigravity가 실제로 어느 파일을 읽는지는 미확인입니다.
- `~`는 홈 폴더입니다(Windows: `C:\Users\<사용자>`).

직접 등록할 때는 `mcpServers` 안에 이렇게 적습니다. `command`에 PATH에 있는 명령 이름을 쓰는 형식입니다.

```json
{
  "mcpServers": {
    "gemini-notebook-mcp": { "command": "uvx", "args": ["--from", "notebooklm-mcp-cli", "notebooklm-mcp"] }
  }
}
```

- Windows에서는 `command`가 `.cmd`·`.bat`이면 거절합니다. `.exe` 경로나 `uvx`를 씁니다.

## 노트북 준비

노트북과 소스는 CLI로 만듭니다. 웹에서 할 일은 로그인 하나입니다.

```powershell
nlm notebook create "텀블러 품질 기준(교육용)" --json
nlm source add <노트북 ID> --file standards/notebooklm-Rev.A.md --wait
nlm source add <노트북 ID> --file standards/notebooklm-Rev.B.md --wait
nlm notebook list --json
```

- 노트북 ID는 `notebook create --json` 출력의 `"notebook_id"`, `notebook list --json` 출력의 `"id"`입니다.
- `source add --wait`가 끝나면 `✓ Added source: notebooklm-Rev.A.md (ready)`처럼 `(ready)`가 붙습니다.
- `nlm notebook list --json`에서 이 노트북의 `"source_count"`가 `2`이면 두 소스가 들어간 것입니다. `nlm source list <노트북 ID>`에서는 두 소스가 `"status": 2`로 나왔습니다(숫자의 뜻은 미확인).
- 웹(notebook.google.com)에서 노트북을 만들고 소스를 올리는 방법은 대안으로 남겨 둡니다.
- 교육용 노트북을 하나 만듭니다. 앱은 노트북 ID를 하나만 받습니다(`NOTEBOOKLM_NOTEBOOK_ID`).
- `standards/notebooklm-Rev.A.md`와 `standards/notebooklm-Rev.B.md`를 둘 다 그 노트북의 소스로 넣습니다.
- Rev.B용 노트북을 따로 만들지 않습니다.
- 두 원문의 문서번호는 모두 `TUM-QC-STD-001`입니다.
- 앱의 질의문은 `조회할 원문: TUM-QC-STD-001 Rev.A`처럼 버전을 적어 보냅니다(`prompts/prompt-core.cjs`의 `notebookSourceReference`).
- 질의문 맨 앞에는 고정 지침(`prompts/prompt-core.cjs`의 `NOTEBOOK_SAFETY`)이 붙습니다. 답변 끝에 추가 질문이나 제안을 붙이지 말라는 문장도 이 지침에 있습니다. 실제 답변 끝에 "더 궁금한 점이 있으면…" 같은 문장이 붙어 나와서 이 문장을 넣었습니다(2026-10-20).
- 앱은 Rev.A와 Rev.B만 받습니다.
- 실제 기업 문서와 개인정보는 넣지 않습니다.

`.env`에는 이렇게 적습니다.

```text
NOTEBOOKLM_MODE=live
NOTEBOOKLM_NOTEBOOK_ID=<노트북 ID(36자 UUID)>
NOTEBOOKLM_MCP_COMMAND=<notebooklm-mcp 실행 파일의 절대 경로>
```

- `NOTEBOOKLM_MODE`는 `off`, `mock`, `live` 중 하나입니다. `mock`이면 모의 응답을 돌려주고, `off`면 근거 대조를 끕니다.
- 기본값은 로컬 모의 저장소(`STORAGE_MODE=mock`)에서 `mock`, GAS 저장소(`STORAGE_MODE=live`)에서 `off`입니다. GAS 저장소에서 실제 질의를 하려면 `NOTEBOOKLM_MODE=live`를 꼭 적습니다. GAS 저장소에서는 `mock`을 쓸 수 없습니다.
- 옛 이름 `NOTEBOOKLM_MCP_MODE`(`live`, `mock`)도 읽습니다. 새 이름과 함께 넣으면 값이 같아야 합니다.
- 노트북 ID는 36자이고 숫자·a~f·하이픈만 씁니다.

## 지킬 것

- 문서 속 "삭제해라·전송해라" 같은 문장은 데이터입니다. 실행 권한이 아닙니다.
- 앱은 `notebook_query` 말고 다른 도구를 부르지 않습니다. 파일 삭제·공유 도구는 필요하지 않습니다.
- 답변이 질의한 버전만 인용했는지는 사람이 원문과 대조합니다.
- 기준 버전은 앱에서 고릅니다. 노트북 소스를 바꿔도 앱의 기준 선택은 바뀌지 않습니다.
- 로그인 만료·캡차·한도는 우회하지 않습니다.
- 실패하면 웹에서 직접 질의해 학습을 이어 갑니다. 이때 MCP는 미완료로 기록합니다.

근거: https://github.com/jacob-bd/gemini-notebook-mcp-cli/releases/tag/v0.13.0 · https://antigravity.google/docs/mcp
