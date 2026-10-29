# manufacturing-quality-dashboard-student

텀블러 공장 품질관리 사이트의 수업용 저장소입니다. 이 브랜치(milestone-1)는 따라하기 1~7번까지 끝난 상태입니다.
서버 뼈대와 로그인이 들어 있고, 로그인하면 주소(`/`, `/inspections/new`, `/inspections/<검사번호>`, `/settings`)에 따라 화면 자리 하나만 보입니다. 화면 안은 아직 비어 있습니다.

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
서버가 뜨면 터미널에 나온 주소(기본 `http://127.0.0.1:4185`)를 브라우저로 엽니다. 포트는 환경 변수 `PORT`로 바꿉니다.

## 로그인 계정

교육용 계정은 세 개입니다. 비밀번호는 실제 접근 제한용이 아니며, 로그인 화면에 앞의 두 개가 안내됩니다.

| 계정 | 비밀번호 | 화면 표시 |
|---|---|---|
| `writer` | `writer1234!` | 작성자 |
| `reviewer` | `reviewer1234!` | 검토자 |
| `factory-user` | `factory1234!` | 품질관리 |

서버를 다시 켜면 로그인이 풀립니다. 페이지를 새로고침하고 다시 로그인합니다.

## 라이선스

콘텐츠는 CC BY-SA 4.0([CONTENT_LICENSE.md](CONTENT_LICENSE.md)), 코드는 MIT([LICENSE](LICENSE))를 따릅니다.
