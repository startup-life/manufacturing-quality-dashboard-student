# 텀블러 공장 따라하기

6회차 수업에서 AI 도구에 프롬프트를 하나씩 붙여 넣으며 텀블러 공장 품질관리 웹앱을 만듭니다.
프롬프트는 한 번에 1~2줄이고, 화면에서 무엇이 되어야 하는지만 쉬운 말로 적었습니다. 화면 색과 배치, 글귀는 사람마다 조금씩 달라도 괜찮습니다. 각 번호의 "확인"에 적힌 동작만 되면 됩니다.

| 회차 | 파일 | 단계 | 끝나면 되는 것 | 완료 브랜치 |
|---|---|---|---|---|
| 1 | [session-1.md](session-1.md) | 17 | 서버가 켜지고 로그인·로그아웃, 주소별 화면 이동 | `milestone-1` |
| 2 | [session-2.md](session-2.md) | 12 | 사진 등록, 검사 상세 1번 탭, 홈 품질 현황, 내 컴퓨터 저장 | `milestone-2` |
| 3 | [session-3.md](session-3.md) | 23 | 검사는 Google 시트에, 사진은 Google 드라이브에 저장 | `milestone-3` |
| 4 | [session-4.md](session-4.md) | 27 | Gemini 사진 판독, 2번 탭 결과와 배지 | `milestone-4` |
| 5 | [session-5.md](session-5.md) | 31 | NotebookLM으로 검사기준 근거 확인, 3번 탭 출처 대조 | `milestone-5` |
| 6 | [session-6.md](session-6.md) | 13 | 4번 탭 내 판단 기록과 변경 이력 | `main` |

## 준비물

- Windows 10·11 PC, Chrome
- Node.js 22.12 이상, Git for Windows
- AI 도구 하나: Antigravity 또는 Cline(둘 다 됩니다)
- 개인 Google 계정 하나(3회차부터 Google 시트·드라이브·Apps Script·NotebookLM에 씁니다)
- 이 저장소에 초대받은 GitHub 계정(완료 브랜치를 받을 때 씁니다)

## 먼저 알아 둘 말

- **AI**: 프롬프트를 붙여 넣는 AI 도구(Antigravity나 Cline)입니다. 회차 파일에서는 그냥 "AI"라고 부릅니다.
- **서버**: 앱 뒤에서 일하는 프로그램입니다. 서버를 켜 두면 Chrome에서 http://127.0.0.1:4185 로 앱을 엽니다.
- **터미널**: 명령을 치는 검은 창입니다. Windows에서는 PowerShell을 씁니다.
- **서버 창**: 서버를 켜 두는 터미널입니다. 다른 명령은 서버 창이 아닌 터미널에서 칩니다.
- **직접 하기**: AI에게 보내지 않고 내가 손으로 하는 일입니다.
- **확인**: 그 단계가 잘 됐는지 화면에서 보는 방법입니다.

## 폴더와 학습 사진

- 수업 폴더는 `C:\ai-class`, 앱 폴더는 `C:\ai-class\tumbler-factory`입니다. OneDrive가 동기화하는 폴더나 한글이 든 경로는 피합니다.
- 학습 사진은 앱 폴더 바깥에 받습니다.

```powershell
cd C:\ai-class
git clone https://github.com/startup-life/manufacturing-quality-student-images.git
```

## 진행 방법

1. AI 도구에서 `C:\ai-class\tumbler-factory` 폴더를 엽니다.
2. 회차 파일의 프롬프트 상자 하나를 통째로 복사해 AI에게 붙여 넣습니다. 앞 번호가 끝난 뒤에 다음 번호를 보냅니다.
3. AI가 파일을 고치거나 명령을 실행해도 되는지 물으면 승인합니다. 다만 컴퓨터 설정이나 프로그램 버전을 바꾸는 명령(`Set-ExecutionPolicy`, `npm audit fix` 같은 것)은 승인하지 말고 강사에게 알립니다.
4. 각 번호의 "확인"을 해 봅니다. 다르게 나오면 화면의 오류 문장이나 터미널의 빨간 줄을 그대로 복사해 "이렇게 나와요. 고쳐 주세요."와 함께 AI에게 붙여 넣습니다.
5. 서버는 내가 서버 창에서 직접 끄고 켭니다(`Ctrl+C`로 끄고 `npm.cmd start`로 켬). 다시 켜면 로그인이 풀리니 새로고침하고 다시 로그인합니다.

### 프로젝트 규칙 파일(AGENTS.md)

1회차 첫 단계(1-1)가 앱 폴더 맨 위에 `AGENTS.md`를 만듭니다. Antigravity와 Cline 모두 대화할 때마다 이 파일을 읽습니다. 2~6회차는 각 회차 첫 단계에서 그 회차의 약속을 이 파일 끝에 덧붙입니다. 그래서 프롬프트가 짧아도 AI가 정해 둔 방식대로 만듭니다. 이 파일은 내용을 이해할 필요 없이 복사해 넣기만 하면 됩니다.

### 비밀 값

`.env`에는 Google 웹앱 주소, Gemini API 키 같은 비밀 값이 들어갑니다. 이 값은 `.env`에만 두고 채팅·화면 공유·문서에 옮기지 않습니다. `.env`는 Git에 올라가지 않습니다.

## 회차를 다 못 끝냈을 때: 완료 브랜치 받기

다음 회차를 시작하기 전에 직전 회차의 완료 브랜치를 받아 같은 출발선에서 시작합니다. 예를 들어 2회차를 못 끝냈으면 3회차 전에 `milestone-2`를 받습니다.

```powershell
cd C:\ai-class
Rename-Item tumbler-factory tumbler-factory-old
git clone -b milestone-2 https://github.com/startup-life/manufacturing-quality-dashboard-student.git tumbler-factory
cd tumbler-factory
npm.cmd ci
```

- `milestone-2` 자리에 받을 브랜치 이름을 넣습니다(6회차 완료본은 `main`).
- 처음 받을 때 GitHub 로그인 창이 뜨면 이 저장소에 초대받은 계정으로 로그인합니다.
- 완료 브랜치에는 그 회차까지의 약속이 든 `AGENTS.md`가 들어 있습니다. 다음 회차 첫 단계는 그대로 하면 됩니다.
- 3회차 이후 Google 연결을 해 두었으면 `tumbler-factory-old\.env`를 새 `tumbler-factory` 폴더로 복사합니다. 완료 브랜치의 Google 쪽 코드는 내가 만든 것과 다르므로, 각 회차 파일 끝의 "완료 브랜치 받기" 안내대로 Google 쪽 코드를 다시 올립니다.
- 내가 만든 코드는 `tumbler-factory-old` 폴더에 그대로 남습니다.
- 그다음 AI 도구로 새 `tumbler-factory` 폴더를 열고, 서버를 켜서 로그인되는지 확인한 뒤 다음 회차를 시작합니다.

학습 사진은 앱 폴더 바깥(`C:\ai-class\manufacturing-quality-student-images`)에 있으므로 다시 받지 않아도 됩니다.
