# SKILLS.md — 유지보수 절차

이 저장소를 나중에 고칠 때 필요한 **절차**(how)를 모아 둔다. **규칙과 불변식**(why/must)은
[CLAUDE.md](CLAUDE.md)와 [packages/edid-core/CLAUDE.md](packages/edid-core/CLAUDE.md)에 있고,
여기서는 그 규칙을 지키면서 실제로 손을 움직이는 순서만 다룬다. 코드를 고치기 전에
CLAUDE.md의 "절대 규칙"과 "코드에 손대기 전에 알아야 할 불변식"은 먼저 읽는다.

---

## 두 개의 실행 주소

| 주소 | 무엇 | 언제 |
|---|---|---|
| **`http://localhost:5177`** | `npm start`가 띄우는 Express. **빌드된** 웹을 서빙한다. | 실사용·검증은 여기 |
| `http://localhost:5173` | `npm run dev:web`의 Vite dev 서버. `/api`만 5177로 프록시한다. | UI를 고치는 중일 때만 |

⚠ **`packages/edid-core`를 고쳤으면 `npm run build` 후 dev 서버를 재시작한다.**
`@edid/core`는 `dist`를 통해 들어오므로 Vite HMR이 소스 변경을 잡지 못한다. 이걸 모르면
며칠 지난 코드를 보면서 "고쳐도 반영이 안 된다"고 판단하게 된다 — 실제로 그런 일이 있었다.

---

## 자주 하는 작업

### 1. 새 필드를 매트릭스에 노출하기

1. `packages/edid-core/src/`에서 파싱·빌드 구현(해당 블록 파일).
2. `flatten.ts`에 행 추가 → 매트릭스에 표시된다. enum은 **원시 코드를 `value`로** 낸다
   (사람이 읽는 이름은 라벨에 넣는다 — CLAUDE.md 참조).
3. 편집 가능하게 하려면 `applyField.ts`의 게이트(`isFieldEditable`)와 쓰기 분기에 추가.
4. 드롭다운·범위 힌트가 필요하면 `inputs.ts`의 `describeInput`에 규칙 추가.
5. 읽기 전용으로 남긴다면 `inputs.ts`의 `readOnlyReason`에 **사유**를 반드시 추가한다
   (`npm run audit`이 사유 없는 읽기 전용을 실패로 잡는다 — 아래 6번 참조).
6. `spec/field-map.json`에 `path` · `specDoc` · `section` · `sourceKind` 기록.
7. `npm run build && npm run test:all`.

### 2. 새 VSDB(벤더 확장 블록) 추가하기

`packages/edid-core/CLAUDE.md`의 "새 VSDB를 추가하는 순서"를 그대로 따른다. 요약:

1. 근거 확보 — `reference/decompiled/` > 규격 PDF > 코퍼스 관찰 순.
2. `vsdb/<name>.ts` — `OUI` 상수 · 인터페이스 · `parse…`/`build…`(바이트 일치 필수).
3. `vsdb/index.ts`의 `VsdbView` 유니언과 `parseVsdb`/`buildVsdb`에 등록.
4. `flatten.ts`에 행 추가. **이 switch는 TypeScript가 exhaustiveness를 강제하지 않는다** —
   케이스를 빠뜨려도 빌드는 통과하고 그냥 화면에 안 뜬다. 손으로 체크한다.
5. `applyField.ts`에 편집 가능 필드 추가. 비트 플래그를 노출한다면 `flagsRaw` 류 원본
   바이트도 함께 갱신한다(AMD FreeSync `setFlag` 패턴 참고).
6. `spec/field-map.json` 기록.
7. `npm run build && npm run test:all`.

### 3. 새 CTA/DisplayID 데이터블록을 "추가" 가능하게 만들기

빈 파일에서 시작해 그 블록을 얹을 수 있게 하려면 `structure.ts`의 카탈로그에 등록한다.

1. CTA 블록이면 `ctaBlockCatalogue()`에, DisplayID 블록이면 `displayIdBlockCatalogue()`에
   항목을 추가한다. **기본값은 반드시 유효한 최소 블록**이어야 한다 — 추가 직후 인코드가
   통과하고, 디코드했을 때 같은 블록이 나와야 한다.
2. `test/structure.test.mjs`의 X2/X3(카탈로그 전수 왕복 테스트)가 이 계약을 검증한다.
   새 항목을 추가하면 이 테스트가 자동으로 그 항목도 검증한다 — 따로 TC를 추가할 필요 없음.
3. 바이트 예산 검증은 `structure.ts`가 인코더(`encodeCtaExtension`/`encodeDisplayIdExtension`)
   에게 위임한다. 예산 규칙을 여기 새로 만들지 않는다.
4. `npm run build && npm run test:all`.

### 4. 전 항목 편집 점검 돌리기

```bash
npm run audit                                    # 카탈로그로 조립한 합성 최대 파일만
EDID_CORPUS_ROOT="D:/edid-data/corpus" npm run audit   # + 실측 코퍼스도 함께
```

모든 필드에 대해 **편집 → 재인코드 → 재디코드 → 값 읽기**까지 확인하고 블록별 커버리지
표를 찍는다. **읽기 전용 필드에 사유가 하나라도 빠지면 exit 1로 실패한다** — 새 필드를
추가했는데 게이트도 사유도 안 달았을 때 여기서 걸린다.

### 5. 규격 문서가 갱신됐을 때

```bash
npm run spec:drift          # 바뀐 문서 + 영향받는 TS 필드 목록
# 사람이 타입 있는 TS로 구현 (자동 생성하지 않는다 — CLAUDE.md 참조)
npm run test:corpus         # 실측 코퍼스 회귀가 게이트
npm run spec:drift:accept   # 검토가 끝났으면 기준선 갱신
```

### 6. 테스트

```bash
npm test                  # 자체 완결 단위 TC — 개발 루프용, 데이터 없이 항상 돈다
npm run test:corpus       # 실측 코퍼스 전량 (없으면 사유를 붙여 skip)
npm run test:integration  # 서버 API — 파일 생성·가져오기·편집·저장·경로 이탈 거부
npm run test:all          # 전부
```

**코드를 고쳤으면 `npm run build && npm run test:all`이 초록인지 확인하고 커밋한다.**
데이터가 없는 환경에서는 상당수가 skip된다 — **skip은 통과가 아니다.** 코덱을 고쳤으면
코퍼스가 있는 곳에서 `npm run test:corpus`를 돌린 결과로 판단한다.

검증 데이터(코퍼스·벤더 픽스처)는 이 저장소에 포함되지 않는다 — `.gitignore`가
`corpus/`, `reference/*`를 제외한다(이유는 `.gitignore` 주석과 `NOTICE.md` 참조).
로컬에서 전량 TC를 돌리려면:

| 자료 | 기본 경로 | 환경변수 |
|---|---|---|
| 실측 EDID 코퍼스(`**/*.ddc` + 디코드 리포트) | `corpus/` | `EDID_CORPUS_ROOT` |
| 벤더 픽스처(DATAOBJ `*.xml` 30종) | `reference/samples/` | `EDID_SAMPLES_DIR` |

### 7. 릴리즈 노트 갱신

기능 단위 변경을 마치면 `RELEASE_NOTES.md` 맨 위에 새 버전 항목을 추가한다. 기존 항목의
형식(배경 → 무엇을 바꿨나 → 실측/검증 → 잡은 버그 → 규모 비교표)을 따른다.
**실제로 돌려서 확인한 숫자만 적는다** — 과거에 "고쳤다"고 적었다가 실제로는 안 고쳐진
사례가 있었고(`RELEASE_NOTES.md`의 정정 항목 참조), 재발하지 않도록 문서보다
재현 커맨드를 신뢰한다.

### 8. 브라우저 수동 검증

`docs/TESTPLAN.md`에 시나리오가 있다. 편집 가능 필드 shape가 300개를 넘으므로,
**블록 계열별 대표 하나씩만** 브라우저로 클릭하고 나머지는 `npm run audit`(4번)에 맡긴다.

⚠ 실 데이터로 검증할 때는 **반드시 복제본에서** 한다. 서버는 프로젝트 폴더 밖으로
나가지 않지만(`resolveInProject()`), 폴더 *안*의 실 파일을 직접 고치는 것은 막지 않는다.

---

## 문제 해결

| 증상 | 원인 / 조치 |
|---|---|
| `EADDRINUSE :::5177` | 이전 서버가 살아 있다. `npx kill-port 5177` 또는 `PORT=5178 npm start` |
| `http://localhost:5177`이 404 | `apps/web/dist`가 없다 → `npm run build` |
| 코어를 고쳤는데 웹에서 반영이 안 됨 | 위 "두 개의 실행 주소" 참조 — dev 서버를 재시작한다 |
| 5173에서 API 호출 실패 | `npm run dev:api`가 안 떠 있다. 5177을 먼저 띄운다 |
| 파일 목록이 비어 있음 | `EDID_PROJECT_DIR`이 가리키는 폴더에 `.ddc`가 없다. 상단에 실제 경로가 표시된다 — `New`로 시작하면 된다 |
| TC가 전부 skip | 정상 — 코퍼스/픽스처가 없는 상태다(위 6번) |
| `npm run build` 타입 오류 | 고치고 다시 빌드한다. CI가 같은 명령으로 게이트한다 |
| `path escapes the project directory` | 서버는 프로젝트 폴더 밖을 읽고 쓰지 않는다. `EDID_PROJECT_DIR`을 옮긴다 |
| `npm run audit`가 exit 1 | 사유 없는 읽기 전용 필드가 있다. 출력에 shape 목록이 찍힌다 — 위 1번대로 사유를 추가한다 |

## 저장소 지도

```
packages/edid-core/       EDID 코덱 (TypeScript, 의존성 0)
  src/flatten.ts          EDID → 스펙 행 (표시·비교)
  src/applyField.ts       스펙 행 → EDID (값 편집)
  src/structure.ts        블록·확장 추가/삭제, 카탈로그
  src/inputs.ts           입력 어포던스(드롭다운·범위)와 읽기전용 사유
  src/vsdb/*.ts           벤더 블록별 파서·빌더
  src/template.ts         createBlankEdid() — 신규 파일 생성용
  spec/field-map.json     필드별 근거 기록
  CLAUDE.md                코덱 작업 규칙 — 코덱을 건드리면 반드시 읽는다
packages/edid-io/         .ddc / DATAOBJ XML / .bin 입출력
apps/server/               Express — 폴더 스캔 + 파일 CRUD + 빌드된 웹 서빙 (5177)
apps/web/                  React + Vite — 매트릭스+hex 통합 뷰 (dev 5173)
test/                      단위 TC · test/corpus/ 코퍼스 TC · test/integration/ 서버 API TC
docs/TESTPLAN.md           브라우저 수동 검증 시나리오
scripts/spec-drift.mjs     규격 문서 드리프트 리포트
scripts/field-audit.mjs    전 항목 편집 점검
projects/                  작업 폴더 기본값 (내용은 git 제외)
```
