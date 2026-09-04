# CLAUDE.md — EDID Workbench

이 저장소에서 작업할 때 먼저 읽을 것. 설치·구동은 [README.md](README.md),
작업 절차(어떻게 고치나)는 [SKILLS.md](SKILLS.md),
프로젝트 배경과 결정 근거는 [RELEASE_NOTES.md](RELEASE_NOTES.md).

---

## 절대 규칙

1. **비밀값을 읽거나 출력하지 않는다.** 루트의 `key.env.txt`와 모든 `*.env`는
   `.gitignore` 대상이다. 내용을 읽어 로그·커밋 메시지·응답에 남기지 않는다.
2. **`corpus/` · `reference/` 를 커밋 대상으로 만들지 않는다.**
   사내 양산 EDID·사양서 xlsx·라이선스 규격 PDF·상용 SW 디컴파일 결과다. 저장소는 MIT로
   공개돼 있지만(`LICENSE`) 이 자료들은 이 저장소의 라이선스와 무관한 남의 것이거나 사내
   자료이므로 계속 제외된다 — `.gitignore`의 해당 블록을 풀려면 그 자료 자체의 재배포
   권한을 사람이 별도로 확인한 뒤에 결정한다.
3. **코퍼스를 수정·삭제·이동하지 않는다.** 그라운드트루스이자 회귀 기준선이다.
4. **바이트를 추측하지 않는다.** 새 필드의 비트 위치는 근거가 있어야 하고,
   근거의 종류를 `packages/edid-core/spec/field-map.json`에 `sourceKind`로 기록한다.
5. **커밋·푸시는 사용자가 요청할 때만 한다.**

## 이 프로젝트가 하는 일

EDID / DisplayID 바이너리를 **필드 단위로 읽고 다시 쓰는** 로컬 웹앱.
Quantum Data ATP Manager(980 Manager)의 EDID 생성 기능을 대체한다.
핵심 화면은 **행 = 사양 항목, 열 = 모델**인 횡전개 매트릭스다.

## 저장소 지도

```
packages/edid-core/    EDID 코덱. 의존성 0, 브라우저/Node 공용  ← 대부분의 작업이 여기
  src/flatten.ts        EDID → 스펙 행,  src/applyField.ts  스펙 행 → EDID (값 편집)
  src/structure.ts      블록·확장 추가/삭제 + 카탈로그 (값이 아니라 구조를 바꾼다)
  src/inputs.ts          입력 어포던스(드롭다운·범위)와 읽기전용 사유
  spec/field-map.json   필드별 근거 기록 (드리프트 리포트가 소비)
  CLAUDE.md              코덱 작업 규칙 — 코덱을 건드리면 반드시 읽는다
packages/edid-io/      DATAOBJ XML / .bin 입출력
apps/server/           Express. 폴더 스캔 + 파일 읽기/쓰기 + 빌드된 웹 서빙 (포트 5177)
apps/web/              React + Vite. 매트릭스+hex 통합 뷰 (dev 포트 5173)
test/                  자체 완결 단위 TC
test/corpus/           실측 코퍼스 TC (데이터 없으면 skip)
test/integration/      서버 API TC
scripts/spec-drift.mjs 규격 문서 드리프트 리포트
scripts/field-audit.mjs 전 항목 편집 점검 (SKILLS.md 참조)
docs/TESTPLAN.md       브라우저 수동 검증 시나리오
──────────────────────  아래는 전부 git 제외 (증거 자료 / 사내 자료)
corpus/                실측 EDID 1,397개 + 디코드 리포트
reference/decompiled/  ATP Manager JAR 디컴파일 785 클래스 ← 가장 강한 근거
reference/specs/       규격 PDF 43종 + LLM 추출물
reference/samples/     벤더 픽스처 DATAOBJ XML 30종 (단위 TC가 사용)
reference/port/        이식원 파이썬 디코더
tools/cfr.jar          JAR 디컴파일러 (CFR 0.152, MIT)
```

## 개발 루프

```bash
npm ci                # 최초 1회
npm run build         # tsc 전 워크스페이스 = 빌드 겸 타입 검사
npm run test:all      # 데이터 있으면 전부 pass / 0 skip
```

**변경을 끝냈다고 보고하기 전에 `npm run build && npm run test:all`이 초록인지 확인한다.**

- `npm run dev:web`(Vite)은 **타입 검사를 하지 않는다.** dev에서 잘 돌아도 `tsc -b`는 깨질 수 있다.
  또한 `@edid/core`는 `dist`를 통해 들어오므로 코어를 고치고 dev 서버를 재시작하지 않으면
  며칠 전 코드를 보게 된다 — 실제로 그런 혼선이 있었다(자세한 내용은 SKILLS.md).
- 데이터가 없는 환경에서는 상당수가 skip된다. **skip은 통과가 아니다** — 코덱을 고쳤으면
  코퍼스가 있는 곳에서 `npm run test:corpus`를 돌린 결과로 판단한다.

## 코드에 손대기 전에 알아야 할 불변식

### 편집하지 않은 바이트는 바뀌지 않는다

이 코덱의 가장 중요한 성질이다. 사용자가 필드 하나만 고쳤으면 나머지 바이트는
**한 개도** 달라지면 안 된다. 라운드트립 100%가 이것을 강제한다.

값을 "재계산"하고 싶어질 때마다 멈춘다. 이미 세 번 이런 식으로 데이터를 손상시켰다:

| 값 | 재계산했을 때 벌어진 일 | 지금 방식 |
|---|---|---|
| base `byte126` 확장 개수 | HF-EEODB가 있는 HDMI 2.1 EDID 249개 손상 | EEODB 있으면 원본 유지 (`findEeodbExtensionCount`) |
| DisplayID `sectionSize` | 선언 크기보다 짧게 줄여 섹션 체크섬 위치 이동, 182개 손상 | 데이터블록이 들어가면 `sourceSectionSize` 유지 |
| 텍스트 디스크립터 패딩 | 규격대로 `0x20`을 썼는데 실제 패널은 `0x00` | 원본 패딩 바이트를 `padByte`로 캡처 |
| CTA DTD 오프셋 | 내용이 없는데 0으로 덮어씀 | 내용 없으면 `sourceDtdOffset` 유지 |

**예외는 체크섬 하나뿐이다.** 체크섬은 항상 재계산한다(기존 도구의 버그가 그것이었다).

### 모르는 바이트는 그대로 들고 다닌다

파싱하지 못한 꼬리 영역은 `trailing` / `extra3D` / `payload` 같은 필드에 원본 그대로 보관하고,
빌드할 때 그대로 되붙인다. 해석하지 못하는 것과 버리는 것은 다르다.

### 서버는 프로젝트 폴더 밖으로 나가지 않는다

`resolveInProject()`가 경로 이탈을 막는다. 파일 API를 손댈 때 이 검사를 우회하지 않는다.

## 자주 하는 작업

절차(새 필드 노출하기 · 새 VSDB 추가하기 · 새 블록을 카탈로그에 등록하기 · 규격 문서
갱신 반영하기 · 전 항목 점검 돌리기)는 전부 [SKILLS.md](SKILLS.md)에 옮겨 놨다.
여기서는 그 절차를 관통하는 원칙 하나만 반복한다:

**코드를 자동 생성하지 않는다.** 이식원 파이썬 시스템이 그렇게 했다가 293개 전부
`NotImplementedError`인 스텁을 만들고 아무도 쓰지 않았다. 추출물에는 계산식이 없다
(`Max_TMDS`의 `×5 MHz` 규칙이 2,958개 필드 레코드 어디에도 없다).
자세한 실측은 [RELEASE_NOTES.md](RELEASE_NOTES.md#왜-코드-자동-생성이-아닌가).

## 알아둘 함정

- **`.ddc` 이중 인코딩** — 대부분 ASCII-hex 텍스트지만 경쟁사 캡처 15개는 진짜 바이너리다.
  `test/corpus/loader.mjs`의 `loadDdc()`가 EDID 매직으로 판별한다.
- **LeCroy 리포트는 `EDID[0x7E] + 1` 블록만 덤프한다.** EEODB가 있는 파일에서는 리포트가
  `.ddc`의 **접두사**일 뿐이다. 리포트를 오라클로 쓸 때 길이를 단정하지 않는다.
- **AMD FreeSync를 LeCroy는 "Unknown Vendor specific data Block"으로만 표기한다.**
  우리가 더 깊이 디코드하므로 이건 불일치가 아니라 "오라클 침묵"이다.
- **AMD FreeSync에 min > max인 실측 데이터가 존재한다**(VRR-off 변형). DDC Manager 오라클도
  같은 값을 보고한다. 버그가 아니므로 단정하지 말고 범위 검사만 한다.
- **HDMI 1.4b 블록은 중간에 끝난다.** `HDMI_Video_present`가 서 있는데 길이 바이트가 없는
  EDID가 102개 있다. `headBytes` / `hasLengthByte`가 이것을 기록한다 — 어느 필드가 설정됐는지로
  길이를 역산하지 않는다.
- **코퍼스에 불량 EDID는 없다**(1,397개 전부 체크섬 정상). 네거티브 TC는 합성해야 한다.
- **벤더 픽스처 4개는 원본 체크섬이 틀려 있다.** 우리가 고쳐서 내보내는 것이 정답이고,
  TC가 그 수리를 단정한다.

## 사실을 확인하는 방법

숫자와 동작은 문서보다 **재현 커맨드**를 신뢰한다.

```bash
npm run test:all                       # 티어별 통계를 콘솔에 찍는다
npm run audit                          # 블록별 편집 커버리지 + 사유 없는 읽기전용 검사
node scripts/spec-drift.mjs            # 규격 문서 상태 + 필드 출처 집계
grep -rn "<필드명>" packages/edid-core/src
```

근거를 찾을 때 우선순위: `reference/decompiled/`(실제 구현) > 규격 PDF > 코퍼스 관찰.
