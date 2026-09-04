# EDID Workbench

EDID / DisplayID 파일을 **여러 모델을 나란히 놓고** 편집하는 로컬 웹앱.
Quantum Data ATP Manager(980 Manager)의 EDID 생성 기능을 대체한다.

- **행 = 사양 항목, 열 = 모델.** 기준 모델 하나를 잡으면 다른 열에서 다른 값만 하이라이트된다.
- **필드 단위로 읽고 쓴다** — CTA-861 데이터블록, DisplayID 데이터블록, VSDB(HDMI 1.4b ·
  HDMI Forum 2.1 · AMD FreeSync · HDR10+ · Dolby Vision)까지 통짜 hex가 아니라 각 값으로 편집한다.
- **블록·데이터블록을 새로 추가**할 수 있다 — 빈 파일에서 시작해 CTA/DisplayID 확장을 얹고
  사양을 채워 나갈 수 있다.
- **체크섬은 항상 자동.** 저장 경로에서 다시 계산되므로 손으로 맞출 일이 없다.
- 편집이 hex 바이트 어디에 반영되는지 같은 화면에서 바로 보인다.

> 유지보수 절차(자주 하는 작업)는 [SKILLS.md](SKILLS.md), 코드 규칙과 불변식은
> [CLAUDE.md](CLAUDE.md), 프로젝트 배경과 구현 내역은 [RELEASE_NOTES.md](RELEASE_NOTES.md)에 있다.

---

## 요구사항

| 항목 | 값 |
|---|---|
| Node.js | **22.0.0 이상** (검증: v24.19.0) |
| npm | 10 이상 (검증: 11.17.0) |
| OS | Windows / macOS / Linux — 네이티브 의존성 없음 |

Python은 필요 없다. 런타임 의존성은 `express` 하나뿐이고, EDID 코덱(`packages/edid-core`)은
**의존성이 0개**다.

버전 관리자를 쓴다면 저장소 루트의 `.nvmrc`가 `22`를 가리킨다(`nvm use`).

## 설치

```bash
git clone https://github.com/doyoung42/makeEDID.git edid-workbench
cd edid-workbench
npm ci
npm run build
```

- `npm ci`는 `package-lock.json`대로만 설치한다(재현 가능).
- `npm run build`는 4개 워크스페이스(`@edid/core` · `@edid/io` · `@edid/server` · `@edid/web`)를
  `tsc`로 컴파일한다. 타입 검사도 여기서 같이 돈다.

## 구동

```bash
npm start
```

`http://localhost:5177` 접속. **평소 사용·확인은 이 주소 하나만 쓰면 된다** — 빌드된
웹을 API 서버가 그대로 서빙한다.

작업할 EDID 폴더는 환경변수로 지정한다(미지정 시 저장소의 `projects/`).

```bash
EDID_PROJECT_DIR="D:/work/G80SD" npm start        # macOS/Linux, bash
```

```powershell
$env:EDID_PROJECT_DIR = "D:\work\G80SD"; npm start   # Windows PowerShell
```

포트를 바꾸려면 `PORT=6000 npm start`.

좌측 파일 트리에서 `.ddc` 파일을 체크해 열을 만들고, `New`로 새 파일을 시작한다.
셀을 클릭하면 그 자리에서 값을 고칠 수 있고, `Save`로 저장한다.

> 코드를 고치며 화면을 즉시 확인하고 싶을 때만 `npm run dev:api` + `npm run dev:web`
> (포트 5173, HMR)을 쓴다. 개발 모드와 실행 주소의 차이, 코어를 고쳤을 때의 재시작
> 규칙은 [SKILLS.md](SKILLS.md)에 있다.

## 라이선스

[MIT](LICENSE). 포함된 제3자 자료(파생 데이터 등)의 출처와 라이선스는
[NOTICE.md](NOTICE.md)에 정리돼 있다.
