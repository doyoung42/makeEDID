# 브라우저 기능 검증 시나리오 (Part 6-2)

`npm run test:all`(42+ 자동화 TC, 코퍼스 1,397개 회귀 포함)이 코덱을 게이트한다.
이 문서는 **자동화되지 않는 계층** — 실제 브라우저에서 사람 또는 Claude for Chrome이
직접 조작해 확인해야 하는 시나리오다.

각 항목: **조작 → 기대 결과 → 확인 방법**. `PASS`/`FAIL`과 확인 일자를 기록해 둔다.

사전 준비:
```bash
npm run build
EDID_PROJECT_DIR="D:/EDID/projects/demo" node apps/server/dist/index.js
```
`http://localhost:5177` 접속.

---

## B1 — 신규 파일 생성

**조작**: 좌측 `New` 클릭 → 이름 입력 → `Create`.
**기대 결과**: 트리에 `<이름>.ddc`가 나타나고 자동으로 열에 로드된다. Block 0
checksum이 `checksum OK`.
**확인 방법**: 하단 hex 패널에서 `BLOCK 0` 헤더 옆 `checksum OK` 확인.

**검증(2026-09-03, 자동화 브라우저 세션)**: PASS — `TEST-NEW-PANEL.ddc` 생성,
4번째 열로 자동 로드, 헤더에 `checksum OK`, 기본 8bpc/DisplayPort/1920x1080p 확인.

---

## B2 — `.xml`/`.bin` 가져오기 → `.ddc` 변환

**조작**: 폴더 행의 `import` 클릭(또는 폴더에 파일 드래그&드롭) → `.xml` 파일 선택.
**기대 결과**: 트리에 `.ddc` 확장자로 나타난다. 원본 바이트가 그대로 보존된다
(같은 파일을 다시 `.xml`로 내보내 비교하면 동일).
**확인 방법**: `GET /api/tree`에 새 항목이 `.ddc`로 뜨는지, 값들이 원본과 일치하는지.

**검증**: PASS — `test/integration/server.test.mjs`의 I2가 `.xml`/`.bin`/공백 섞인
hex 덤프/오프셋 거터 붙은 덤프 4종 전부 바이트 완전 일치로 자동 확인함.

---

## B3 — 모델 폴더 생성 + 트리 펼침/접힘

**조작**: `+dir`로 하위 폴더 생성 → 그 안에 `+file`로 파일 생성 → 폴더 접기/펼치기.
**기대 결과**: 빈 폴더도 트리에 남는다. 접으면 하위 항목이 숨는다.
**확인 방법**: 화면에서 트리 구조 확인.

**검증**: PASS — `test/integration/server.test.mjs`의 I3가 빈 하위 폴더가
트리에 유지되는지, 파일이 올바른 폴더 아래 중첩되는지 자동 확인함.

---

## B4 — 열 폭 (v0.5.0부터 fit 고정)

`Fit`/`Manual` 토글은 v0.5.0에서 제거했다 — 두 모드의 CSS가 사실상 동일했고,
`table.matrix { width: 100% }` 때문에 `Manual`로 준 고정 폭도 브라우저가 100%에
맞춰 재분배해 애초에 동작할 수 없었다(B11-b 4번 참조). 지금은 항상 가용 폭을
균등 분할하고, 긴 값은 말줄임(`…`) 처리된다.

**조작**: 열 5개 로드.
**기대 결과**: Fit/Manual 버튼이 화면에 없다. 4~5열이 가로 스크롤 없이 한 화면에
들어온다.
**확인 방법**: 화면에서 툴바에 폭 관련 버튼이 없는지, 열이 균등 분배되는지.

**검증**: PASS — B11-b 4번에서 함께 확인함(2026-09-04).

---

## B5 — 계층 트리 펼침/접힘 + 블록 checksum

**조작**: `Block 0 — Base EDID` 행의 `−`/`+` 클릭. `Collapse all`/`Expand all`.
**기대 결과**: 블록 행이 다른 행보다 굵게 표시되고 옆에 checksum 상태가 있다.
접으면 하위 필드가 숨는다.
**확인 방법**: 화면에서 확인.

**검증**: PASS — Block 0 checksum 행이 `checksum OK`로 표시, 접기 토글 동작 확인.

---

## B6 — 셀 편집 → hex 바이트 강조

**조작**: 매트릭스에서 편집 가능한 셀 더블클릭 → 값 변경 → Enter.
**기대 결과**: 3단계 강조 — ① 그 필드의 바이트가 진하게, ② 소블록이 옅게,
③ 전체 블록 헤더가 표시. 편집 직후 바뀐 바이트가 잠깐 플래시된다.
**확인 방법**: 하단 hex 패널에서 해당 바이트 값이 실제로 바뀌었는지 16진수로 확인.

**검증**: PASS — `base.productCode`를 `12345`로 변경 → hex 패널에서 offset 10-11
바이트가 `35 72`에서 정확히 `0x3039`(12345)로 바뀌고 Block Checksum 행도
`0xC7`→`0xF0`로 자동 재계산됨을 확인. `base.input.bitDepth` 선택 시 단일 바이트
(offset 20)만 강조됨을 확인.

---

## B7 — hex 바이트 클릭 → 필드로 이동

**조작**: hex 패널에서 바이트를 클릭.
**기대 결과**: 그 바이트를 소유한 가장 구체적인 필드 행이 매트릭스에서 선택된다.
**확인 방법**: 선택된 행이 파란 테두리로 표시되는지, hex 헤더의 경로 텍스트가
클릭한 바이트와 일치하는지.

**검증**: 코드 경로 확인 완료(`fieldsAtByte` 기반, `HexPanel.tsx`의 `onClick`).
실사용 클릭 검증은 향후 세션에서 진행 — 이번 세션에서는 셀→hex 방향만 실사용 확인함.

---

## B8 — Part 4 블록별 필드 편집 (계산된 payload 확인)

**A. SVD 리스트** — `Short Video Descriptors` 값 셀을 `16*, 4, 97*, 3`처럼 편집 →
재로드 시 같은 값이 유지되고 checksum이 유효한지.
**검증**: PASS — 스크립트 검증(`node`, `applyField`)으로 증가/감소 양쪽 확인,
모든 블록 checksum 유효.

**B. SAD 필드** — `Format`/`Max Channels`/샘플레이트 체크박스/`Byte 3` 편집.
**검증**: PASS — format 1→7, `rate176_4` false→true 편집 후 재인코딩 확인.

**C. Speaker Allocation** — 20개 스피커 체크박스(3바이트 전체) 편집.
**검증**: PASS — `speaker.tblTbr`(byte 2, bit 0 — 저장 바이트 밖의 확장 플래그)
false→true 편집 후 재인코딩·checksum 확인.

**D. Colorimetry / VCDB / HDR Static** — 10개 색역 플래그, QY/QS/S_PT/S_IT/S_CE,
EOTF 4개 플래그 + 휘도 3필드.
**검증**: `test/corpus/span.test.mjs`가 코퍼스 전량에 대해 이 필드들을 포함해
392개 편집을 뮤테이션 검증함(0건 위반).

**E. DisplayID Type I 상세 타이밍** — pixel clock, H/V active·blank·sync,
aspect ratio, interlaced, preferred, 3D 지원.
**검증**: PASS — 실제 코퍼스 파일(2560x1440 @ 497.75MHz)에서 `hActive`를
2560→2660으로 편집 → 정확히 2바이트(필드) + 1바이트(DisplayID 섹션 체크섬)만
변경, 나머지 무변화 확인. 코퍼스 336개 파일에서 이 블록이 디코드됨.

**F. CTA VTDB Type VII/X + Dolby Vision 변형별 필드** — **미구현.**
사유: Type VII는 여러 타이밍 항목이 가변 길이 "extra" 필드와 함께 하나의
확장 블록 payload에 순차 패킹되는데, 그 항목 경계(각 항목의 extra 길이)를
결정하는 메커니즘을 아직 실측하지 못했다(`reference/decompiled/.../timing/TypeVII.java`는
`extra.length()`를 별도 설정으로 받는다는 것만 확인됨 — 그 길이가 어디서
오는지는 `CtaTypeVIIEditor.java`/`VideoFormatBlockEditor.java`를 더 파야 함).
Dolby Vision은 이번 세션에서 손대지 않았다 — `version` 필드만 기존대로 편집 가능.

---

## B9 — 저장 → 재로드 → Revert

**조작**: 셀 편집 → `Save` → 페이지에서 파일 재로드(체크 해제 후 재체크) → 값 유지 확인.
저장 전에는 `Revert`로 원복 확인.
**검증**: PASS — `test/integration/server.test.mjs` I4가 편집→저장→재로드 후
값 유지 및 "편집한 바이트 외 무변화"(정확히 productCode 2바이트 + checksum 1바이트만)를
자동 확인. UI에서도 dirty 배지/Save all 카운트 동작 확인.

---

## B10 — 횡전개 (기준 열 복사 → 다중 붙여넣기)

**조작**: 기준 열 지정 → `Copy baseline spec` → 대상 열 체크 → `Paste into N selected`.
**기대 결과**: 편집 가능한 필드가 전부 복사되고, diff가 없어진 셀은 하이라이트가 사라진다.
**확인 방법**: 붙여넣기 후 매트릭스에서 확인.

**검증**: 코드 경로는 1·2단계에서 이미 구현·검증됨(`copyColumn`/`pasteInto`),
UI 배치는 이번 세션에서 유지. 3단계 트리 뷰와의 상호작용(구조 행은 복사 대상에서
자동 제외 — `isFieldEditable`이 구조 행에 대해 false) 재확인 필요.

---

## B11 — 거부 경로

**조작**: 범위를 벗어난 값(예: Product Code에 `999999`) 입력 → Enter.
**기대 결과**: 저장되지 않고 상단 배너에 사유가 뜬다. 셀은 원래 값으로 돌아간다.
**검증**: `test/applyField.test.mjs`의 "invalid values are rejected with a readable
message"가 자동 확인(단위 계층). UI 배너 표시는 기존 동작 유지.

**추가**: `test/integration/server.test.mjs`의 I8이 서버 레벨에서 잘못된 값이
파일을 건드리지 않는지 확인.

---

## B12 — 전 항목 편집 점검 (v0.5.0)

두 층으로 나눈다. 편집 가능한 필드 shape가 300개를 넘어 브라우저로 하나씩 클릭하는
것은 현실적이지 않고, 반대로 자동 검사만으로는 UI 배선을 못 잡는다.

### B11-a 자동 전수

```bash
npm run audit          # 코퍼스가 다른 곳에 있으면 EDID_CORPUS_ROOT=... 를 붙인다
```

모든 필드를 **편집 → 재인코드 → 재디코드 → 값 읽기**까지 확인하고 블록별 커버리지
표를 찍는다. `applyField`가 true를 반환한 것만으로는 검증으로 치지 않는다.

**합격 기준**
- 사유 없는 읽기 전용 **0건** (있으면 스크립트가 exit 1)
- "accepted an edit but did not read back" **0건**
- "could not exercise" 목록에 새 항목이 늘지 않을 것 (늘었다면 손으로 확인)

### B11-b 브라우저 대표 (http://localhost:5177)

⚠ **`projects/production`의 원본을 직접 고치지 않는다.** 복제본에서 작업하고
끝나면 지운다. 확인 후 원본 md5가 그대로인지 본다.

1. **신규 제작** — New → `Add extension…` → CTA-861 → 블록 행의 `＋`로 Video ·
   Audio · HDMI 1.4b 추가 → 개수 셀 스테퍼로 SVD 1→3 → Audio Format 드롭다운에서
   다른 코덱 선택 → Save.
   확인: 저장된 파일이 256바이트, 전 블록 체크섬 정상, 재로드 시 값 보존.
2. **기존 편집** — 양산 파일 복제본을 열고 Type VII 첫 블록의 Aspect Ratio를 바꾼다.
   확인: **바뀐 바이트가 값 1개 + 체크섬 1개뿐**, 같은 태그의 다른 블록은 불변
   (`ext34_0` / `ext34_1` / `ext34_2` 가 서로 다른 행인지 함께 본다).
3. **어포던스** — enum 셀이 `코드 — 라벨` 드롭다운인지, 숫자 셀에 범위 힌트가 뜨는지,
   **한 번 클릭**으로 편집에 들어가는지, 읽기 전용 셀 툴팁에 사유가 있는지.
4. **폭** — Fit / Manual 버튼이 없고 열이 균등 분배되는지.

---

## 종합 (v0.5.0 기준)

| 계층 | 결과 |
|---|---|
| 자동화 (`npm run test:all`) | 98/98 pass (코퍼스 1,397개 라운드트립 포함) |
| 자동화 (`npm run test:corpus` 뮤테이션 프로브) | 1,381 edits / 351 shapes, 위반 0 |
| 자동화 (`npm run audit`) | 345 필드 / 303 편집가능 / 297 검증됨, 사유 없는 읽기전용 0 |
| 브라우저 실사용 (B1, B4~B6, B9, B12-b) | 직접 조작으로 확인 완료 |
| 브라우저 실사용 (B2, B3, B7, B8, B10, B11) | 스크립트/통합 TC로 등가 검증, 브라우저 클릭 경로는 다음 세션 권장 |
| Dolby Vision · Type VIII | 코퍼스 실측 0건 — 합성 픽스처 왕복(`test/decoders.test.mjs`)으로만 검증됨 |
