# Release Notes

프로젝트가 **왜** 시작됐고 **무엇을** 어떤 근거로 만들었는지에 대한 기록.
설치·사용법은 [README.md](README.md)에 있다.

---

## v0.5.0 — 2026-09-04

**웹에서 "고쳐지지 않는다"의 원인을 셋 다 걷어냈다.** 코덱은 이미 1,397개를 100%
라운드트립하고 있었는데도 화면에서는 값이 안 들어가는 것처럼 보였다. 실제 원인은
코덱이 아니라 **환경 · 구조 · 어포던스** 세 층에 나뉘어 있었다.

### 1. 환경 — 이틀 된 코드를 보고 있었다

5173 Vite dev 서버가 **2026-09-02 18:33**부터 떠 있었고, 코어는 **09-04 01:10**에
빌드됐다. `@edid/core`는 `dist`를 통해 들어오므로 **Vite HMR이 코어 변경을 잡지 못한다.**
그 서버를 종료하고 **`http://localhost:5177` 단일 URL**로 정리했다(`npm start`가 띄우는
Express가 빌드된 웹을 서빙한다). README에 "코어를 고쳤으면 `npm run build` 후 dev 서버
재시작"을 명시했다.

### 2. 구조 — 블록을 만들 수단이 아예 없었다

실측: **신규 파일은 필드 shape 64개(편집가능 54개)**만 노출하는데 양산 파일은 255개다.
**191개가 도달 불가**였다 — CTA/DisplayID 확장 자체를 만들 수 없으니 그 안의 필드에
접근할 방법이 없었다. `base.desc3`도 "unused"인 채 종류를 바꿀 수 없었다.

`packages/edid-core/src/structure.ts`를 새로 만들었다. `applyField`가 **존재하는 필드의
값**만 바꾸는 데 비해, 이쪽은 **구조 자체**를 바꾼다:

- 확장 추가·삭제(CTA / DisplayID) · CTA 데이터블록 17종 카탈로그 · DisplayID 블록 12종
  카탈로그 · base 디스크립터 4슬롯의 종류 전환(6종) · SAD/SVD/DTD 개수 증감
- **검증은 인코더가 한다.** 변경 → `encodeEdid` → 실패하면 롤백 후 인코더의 메시지를
  그대로 던진다. 바이트 예산 규칙이 `encodeCtaExtension`/`encodeDisplayIdExtension`
  한 곳에만 있으므로 드리프트할 여지가 없다.
- **EEODB 동기화**: 확장을 추가하면 EEODB의 개수도 함께 갱신한다. 안 하면 HDMI 2.1
  EDID 249개를 손상시켰던 그 버그가 재현된다.

결과: **빈 파일에서 279개 shape / 224개 편집 가능**에 도달한다(64/54에서).

### 3. 어포던스 — 편집 경로가 화면에 없었다

편집은 **더블클릭 전용**이었고 화면에 아무 표시가 없었다. enum은 원시 코드를 자유
텍스트로 받아서 `aspect=4`, `format=10`을 외워야 했다.

`packages/edid-core/src/inputs.ts`(신규)의 `describeInput(path, kind)`가 path별 컨트롤을
돌려준다 — 드롭다운 · 범위 힌트 · hex · 리스트 · 개수 스테퍼. **값은 여전히 원시 코드다**
(드롭다운이 `4 — 16:9`를 보여주되 커밋은 `4`). 편집 진입은 **단일 클릭**으로 바꿨다.

`readOnlyReason(path)`도 같이 넣었다. **읽기 전용 셀은 이유를 툴팁으로 말한다** —
"아래 필드들의 요약", "체크섬은 저장할 때 재계산", "리비전 3 미만에서 인코더가 데이터
블록 컬렉션을 통째로 버리므로 보호됨" 등. 4,438개 읽기 전용 행 전부에 사유가 붙는다.

### Fit / Manual 제거 (사용자 지시)

`table.matrix.fit`과 `.manual`은 **CSS가 완전히 동일**했고(둘 다 `table-layout: fixed`),
`table.matrix { width: 100% }` 때문에 고정 폭을 줘도 브라우저가 100%에 맞춰 재분배한다
— Manual은 구조적으로 동작할 수 없었다. 두 버튼과 드래그 핸들을 전부 제거하고 fit 고정.

### 이번에 잡은 버그

1. **Type VII `aspect`가 조용히 무시됐다.** `writeTypeVII`가 `t[field] = value`로
   path 접미사(`aspect`)를 쓰는데 모델 속성은 `aspectRatio`다. 팬텀 속성을 만들고
   `true`를 반환하니 **UI는 성공처럼 보이고 값은 사라졌다.** 이제 대상 속성이 없으면
   `false`를 반환한다.
2. **AMD FreeSync가 저장 못 하는 행을 보여줬다.** `buildAmdFreesyncVsdb`는
   `presentBytes`까지만 쓰는데 flatten은 길이와 무관하게 `maxLum2`/`minLum2Code`까지
   행을 냈다. 블록이 짧으면 편집이 저장 시 버려졌다. 이제 블록이 실제로 가진
   바이트만 행으로 낸다 — 길이는 FreeSync 버전이 정하므로 늘리는 것은 없는 능력을
   지어내는 것이다.
3. **enum이 라벨을 값으로 냈다** — DisplayID `colorDepth`/`tech`/`scan`/`lumInfo`,
   Adaptive-Sync `modes`, Type VIII `codeType`. 규격 규칙(코드를 값으로)을 어겨 편집이
   불가능했다. 전부 코드로 바꾸고 라벨은 행 이름에 넣었다.

### 전 항목 점검 — `scripts/field-audit.mjs` (신규)

모든 필드에 대해 **편집 → 재인코드 → 재디코드 → 값 읽기**까지 확인한다.
`applyField`가 true를 반환한 것만으로는 "검증됨"으로 치지 않는다 — 위 3개 버그가
전부 그 틈에 있었다.

```
TOTAL                        345       303       297         42
                          (필드)  (편집가능) (검증됨)  (읽기전용)
```

- **읽기 전용 42개 전부에 사유가 있다.** 사유 없는 읽기 전용이 하나라도 있으면
  스크립트가 exit 1로 실패한다 — "왜 못 고치지?"를 침묵으로 답하지 않게 하는 장치다.
- 검증 못 한 6개는 자유 텍스트·포맷 문자열이라 자동 값을 만들 수 없는 것들이고,
  스크립트가 이름을 찍어 준다.
- 모집단은 둘이다: 양산 1,134개(실제 블록 조합)와 **카탈로그로 조립한 합성 최대 파일**
  (코퍼스에 0건인 Dolby Vision·Type VIII·Display Parameters·Adaptive-Sync를 덮는다).

### 브라우저 실검증 (5177)

1. **신규 제작** — New → CTA 확장 추가 → Video/Audio/HDMI 1.4b 추가 → SVD 개수 1→3
   스테퍼 → Audio Format 드롭다운 LPCM→E-AC-3 → Save. 디스크의 256바이트 파일이
   체크섬 정상 · 바이트 안정 · 모든 편집 보존.
2. **기존 편집** — 양산 파일 **복제본**에서 Type VII 첫 블록의 aspect를 16:9→64:27로.
   **정확히 2바이트만 변경**(값 1 + 체크섬 1), 나머지 두 Type VII 블록은 그대로.
   원본 md5 불변.

### 규모

| | v0.4.0 | v0.5.0 |
|---|---|---|
| 자동 TC | 74 | **98** |
| 빈 파일에서 도달 가능 | 64 shape / 54 편집가능 | **279 / 224** |
| audit 커버리지 | — | **345 필드 / 303 편집가능 / 297 검증됨** |
| 사유 없는 읽기 전용 | (미측정) | **0** |

---

## v0.4.0 — 2026-09-04

**남아 있던 필드 단위 디코더를 전부 구현했다.** v0.3.0에서 "막힌 것은 다 풀렸으니
다음 라운드는 바로 구현"이라고 적어 둔 항목들이 이번에 들어갔고, 그 과정에서
**조용히 죽어 있던 쓰기 경로 두 건**이 드러나 같이 고쳤다.

### 새로 디코드되는 블록

| 블록 | 캐리어 | 코퍼스 실측 | 근거 |
|---|---|---|---|
| **Dolby Vision VSVDB** 6변형 | CTA 확장 0x01 (OUI 00-D0-46) | **0개** | 디컴파일 전용 |
| **Type VIII** 열거형 타이밍 코드 | CTA 0x23 · DisplayID 0x23 | **0개** | 디컴파일 + 규격 추출물 |
| **Dynamic Range Limits** | DisplayID 0x25 | **6개** | 디컴파일 + `displayid_v2_1a` |

Dynamic Range Limits는 실측 데이터가 있어서 바로 확인됐다 — 57" Odyssey(LS57CG950N)가
`25.000–4233.600 MHz / 48–240 Hz`로, VRR 변형은 `seamless=true`에 `96–240 Hz`로 디코드된다.
4233.6 MHz는 7680x2160@240의 픽셀 클록과 정확히 일치하므로 `kHz-1` 저장 규칙과
3바이트 리틀엔디언 순서가 둘 다 맞다는 뜻이다.

Dolby Vision과 Type VIII은 **코퍼스 인스턴스가 0개**라 회귀 검증이 불가능하다.
합성 픽스처 왕복 TC(`test/decoders.test.mjs` D1~D8) 8개가 유일한 보증이고,
실기에서 처음 만나는 EDID가 사실상 첫 실검증이 된다. `spec/field-map.json`에도
`specDoc`을 비우고 그 사실을 `note`로 남겨서 `npm run spec:drift`가 매번 보고한다.

### 고친 버그

**1. Dolby Vision 변형 판별표가 전부 틀려 있었다.**
기존 표는 길이 25/12/15/12/10/20을 봤는데, 이건 **블록 전체 길이**다.
`DolbyVisionVideoVersion.java:7-13,68`이 `vendorDataLength = length - 5`로
tag·확장태그·OUI 3바이트를 빼는데, 우리 `payload`는 이미 OUI 뒤부터다.
올바른 값은 21/10/7/7/5/15. **실제 Dolby EDID가 들어왔다면 전 변형이 `unknown`으로
떨어졌을 것이다.** 코퍼스에 인스턴스가 0개라 지금까지 아무도 못 밟았다.

**2. `ext<tag>.<field>` 캐치올이 구조화 쓰기 경로를 전부 가리고 있었다.**
`applyCta`에서 `EXT_TAG_FIELD = /^ext(\d+)\.(.+)$/` 분기가 Type VII/VIII/X와
Y420 분기보다 **위에** 있어서, 그 아래 코드가 전부 도달 불가였다.
게이트(`isFieldEditable`)는 "편집 가능"이라고 답하는데 `applyField`는 `false`를
반환하니, **UI에서 입력은 받아 놓고 저장은 조용히 아무것도 안 하는** 상태였다.
v0.3.0에서 추가한 Type VII/X CTA 캐리어 쓰기가 처음부터 죽어 있었다는 뜻이다.

**3. 반복되는 확장 블록이 같은 path로 뭉개졌다.**
Type VII은 블록 하나에 디스크립터가 하나뿐이라, 타이밍 3개를 광고하는 모니터는
ext34 블록을 3개 갖는다. 그런데 path가 전부 `cta1.ext34.t7.clock`으로 같아서
**행에는 마지막 블록 값이 보이고 편집은 첫 블록에 들어갔다.**
반복 가능한 태그(0x22/0x23/0x2a)에만 발생 순번을 붙여 `ext34_0` · `ext34_1` ·
`ext34_2`로 분리했다. 실측 확인: 27" G60SD가 이제
`1920x1080@937.75MHz` · `2560x1440@1667.17MHz` · `2560x1440@1111.25MHz` 세 행으로 뜬다.

### 이 버그들을 다시는 놓치지 않기 위해

2번이 특히 나빴던 이유는 **뮤테이션 프로브가 그것을 통과시켰기 때문**이다.
프로브는 `applyField`가 `false`를 반환하면 그냥 `continue`했다 — 거부된 편집은
검사할 게 없다고 봤다. 그래서 게이트와 쓰기의 불일치가 통계에도 안 잡혔다.

`test/corpus/span.test.mjs`에 두 가지를 추가했다:

- **게이트/쓰기 합치**: `isFieldEditable`이 참인 필드를 `applyField`가 `false`로
  거부하면 실패한다. 코덱 계약상 `false`는 "이 path를 쓸 줄 모른다"는 뜻이고,
  값이 잘못된 경우는 예외를 던지기로 되어 있으므로 이 불변식은 깔끔하다.
- **조용한 no-op 금지**: 편집을 받아들이고도 바이트가 하나도 안 바뀌면 실패한다.
  단, 저장 단위가 거친 필드 5개는 정당하므로 이유와 함께 허용 목록에 적었다
  (DTD 픽셀 클록 10 kHz · range limit max clock 10 MHz · `Max_TMDS` 5 MHz —
  ±1 nudge가 같은 바이트로 반올림된다).

되돌려서 확인했다: 2번 버그를 다시 넣으면 새 단언이
`18 field shape(s) are editable per the gate but rejected by applyField`로 실패하고,
고치면 통과한다.

### 규모

| | v0.3.0 | v0.4.0 |
|---|---|---|
| 자동 TC | 66 | **74** |
| 뮤테이션 프로브 | 1,038 edits / 261 shapes | **1,462 edits / 368 shapes** |
| 편집 가능 필드 shape | 262 | **248 편집 가능 / 22 읽기 전용** |
| `field-map.json` 등재 | 103 | **122** |

남은 읽기 전용 22개는 전부 정당하다 — 구성 요소가 따로 편집 가능한 요약 행,
계산되는 값(체크섬·개수), 그리고 의도적으로 보호한 구조 필드(`cta*.revision`은
편집하면 인코더가 데이터 블록 컬렉션을 통째로 버린다).

---

## v0.3.0 — 2026-09-03

**"이 값은 왜 못 고치지?"를 없앤 라운드.** 실측 1,134개 파일 기준으로 편집 가능 필드가
**123 → 262개**로 늘었고, 남은 22개는 전부 파생 요약이거나 구조적으로 위험해서
의도적으로 막아둔 것이다.

### 못 고치던 것은 3계층이었다

측정해 보니 문제는 "편집 분기가 없다"만이 아니었다:

| 계층 | 규모 | 조치 |
|---|---|---|
| A. 표시되는데 편집 불가 | 36개 shape | 편집 분기 추가 |
| **B. 디코드되는데 표시조차 안 됨** | **47개 속성** | flatten 행 추가 — 가장 컸고 가장 쌌다 |
| C. payload hex 통짜 | 7종 블록 | hex 편집 폴백 |

B가 핵심이었다. 코덱은 이미 양방향 decode/encode를 다 하고 있었는데 UI가 그걸 안 보여줬을
뿐이다. 특히 **DTD(상세 타이밍) 16개 필드는 1,148개 인스턴스에서 전부 비표시**였다 —
요약 문자열 한 줄만 있었다. 이제 H/V active·blank·sync offset·pulse·극성·이미지 크기·
border·interlaced·stereo·sync type까지 전부 개별 편집된다.

### 새로 편집 가능해진 것

- **DTD 16필드** (base 디스크립터 + CTA DTD 공용 writer)
- **Established Timings** 17모드 · **Standard Timings** 8슬롯(사용 여부·해상도·비율·주사율)
- **Display Range Limits** — vMin/vMax/hMin/hMax/maxClock.
  ⚠ **+255 offset 자동 관리**: 값이 255를 넘으면 `offsetFlags` 비트를 세우고 저장값에서
  255를 뺀다. 이걸 안 하면 300 입력이 44로 조용히 잘린다.
- **색좌표 8개**(10비트 코드) · Feature Support 4개 · gamma · manufacture week ·
  EDID version/revision · bit depth · digital interface
- **HDMI Forum 18개** (rrCapable/cableStatus/ccbpci/lte340Scramble/independentView/
  dualView/osdDisparity3d/uhdVic/negMvrr/mdelta/fapaStart/fapaEndExt/DSC bpc 3종/
  dscAllBpp/qmsTfrMin/qmsTfrMax)
- **AMD FreeSync 5개** (gammaBits/maxLum1/minLum1 code/maxLum2/minLum2 code)
- **HDMI 1.4b 3D 섹션** — imageSize/3dPresent/3dMulti/hdmiVics.
  ⚠ 인코더가 `flagsRaw`를 그대로 쓰므로 **플래그 동기화 필수**. 3D를 껐다 켜면
  바이트가 원본과 완전히 일치하는 것으로 검증했다.
- **DisplayID 헤더** version major/minor, use case

### 미해독 블록도 편집 가능해졌다

980manager의 폴백 사다리(`ReservedBlockEditor`/`BlockDataEditor`)를 옮겨왔다.
필드로 못 쪼갠 블록 — Type VII/X payload, Dolby Vision payload, HDR Dynamic Metadata,
미지의 확장 태그, 미지의 OUI VSDB, unknown DisplayID 태그, 미지의 디스크립터 —
전부 **hex 문자열로 직접 편집**된다. 바이트 예산(CTA 31바이트, 확장 태그면 30)을 넘으면
사유를 담아 거부한다. 그래서 **"값이 안 들어가는 블록"은 이제 없다.**

### 편집을 일부러 막아둔 것

- `cta*.revision` — `encodeCtaExtension`이 revision 3 미만에서 다른 분기를 타
  **데이터블록 컬렉션을 통째로 버리고 패딩을 쓴다.** 3→2 편집이 조용히 모든 블록을
  파괴하므로 읽기 전용으로 되돌렸다. (뮤테이션 프로브 TC가 잡아냈다.)
- `base.input.kind` — digital↔analog 유니언 교체라 같은 이유로 제외.
- 파생 요약(`base.desc*.dtd`, `chroma.*`, `svd`, `speakerAlloc`, Colorimetry hex,
  `eotf`, `*.count`, checksum, extensionCount)은 구성 필드가 편집 가능하므로 그대로 둔다.

### UX

행이 평균 121 → **244개**(최대 474)로 늘어, 트리가 **스스로 접히도록** 바꿨다.
자식이 6개를 넘는 그룹만 기본 접힘 — CTA 헤더(6개 플래그)는 열린 채로 남고,
VSDB나 Established Timings(17개)는 접힌다. 하드코딩 목록이 아니라 적응형이다.
실측: 402행짜리 EDID가 처음엔 **14행**만 보인다.

### 버그 2건

1. **`base.desc*.{name,serial,text}` 게이트 불일치** — `applyField`는 받는데
   `isFieldEditable`이 막고 있었다. v0.2.0 릴리스 노트에 "고쳤다"고 적혀 있었으나
   실제로는 미수정이었다(위 정정 참조). 이제 고쳤고, **양방향 회귀 TC**를 넣었다:
   기존 TC는 "편집 가능 → 쓰기 성공"만 봤고, 그 반대 방향이 비어 있어서 놓쳤다.
2. **`isFieldEditable`의 DisplayID 분기가 블록 tag를 안 봄** — Type X 블록에서
   `did1.db0.clock`이 `true`인데 `applyField`는 `false`였다(실측 확인).
   지금은 그 행이 나오지 않아 안 보이지만 Type VII/X 디코더를 붙이면 드러난다.

검증: `npm run test:all` **66/66**, 뮤테이션 프로브가 **444 → 874개 편집**으로 늘었고
위반 0건. 코퍼스 1,397개 라운드트립은 계속 100%.

### 남은 일

Type VII/X · Y420 Capability Map · Dolby Vision 6변형 · Type VIII의 **필드 단위**
디코더는 아직이다(현재는 hex로 편집). 다만 이번 조사에서 막혀 있던 부분이 풀렸다 —
자세한 근거는 아래 "남은 일" 절.

---

## v0.2.0 — 2026-09-03

UX 전면 개편 + 블록별 필드 편집기 확대. v0.1.0 배포 직후 실사용 피드백 5가지를 반영했다.

**1. 파일 관리** — 좌측이 평면 파일 목록에서 **모델 단위 폴더 트리**로 바뀌었다. 신규 `.ddc`
생성(`POST /api/file`, `createBlankEdid()`), 기존 파일 가져오기(`.xml`/`.bin`/구분자 섞인 hex
덤프까지 관대하게 읽는 `POST /api/import`), 복제(`POST /api/duplicate`), 폴더 생성, 삭제가
전부 붙었다. **`.ddc`가 작업 포맷이 됐다** — `.xml`/`.bin`은 가져오기 경로에서만 남는다.

**2. 열 폭** — `table-layout: fixed` + `Fit`/`Manual` 두 모드로 바뀌어, 열이 몇 개든 가로
스크롤 없이 한 화면에 들어오고 헤더 경계를 드래그해 개별 조절할 수 있다.

**3~5. 계층 트리 + 블록별 편집기 + 통합 뷰**는 서로 얽혀 있어 한 번에 다뤘다:

- **바이트 출처** — 모든 필드가 자기 바이트 범위(`ByteSpan`)를 안다. 디코드 시점에
  기록하지 않고 **인코더를 다시 불러 계산**한다(`layout.ts`) — 편집이 데이터블록을
  통째로 교체할 수 있어서, 디코드 시점 오프셋은 편집 직후 낡기 때문이다.
  1,397개 코퍼스에 대해 계산된 영역이 실제 인코더 출력과 일치하는지(`layout.test.mjs`),
  그리고 필드를 실제로 흔들었을 때 바뀐 바이트가 선언한 span 안에만 있는지
  (`span.test.mjs`, 뮤테이션 프로브)를 검증한다.
- **탭 제거** — Spec Matrix / Detail·Hex 두 탭이 **상단 매트릭스 + 하단 도킹 hex 패널**로
  합쳐졌다. hex는 16바이트 행 + 오프셋 거터로 다시 그렸다.
- **3단계 강조** — 필드 선택 → 그 바이트 진하게, 소블록 은은하게, 블록 헤더까지 표시.
  편집 직후엔 바뀐 바이트가 잠깐 플래시된다. hex 바이트를 클릭하면 역방향으로 그
  바이트를 소유한 행이 선택된다(`fieldsAtByte`).
- **매트릭스 트리 렌더** — 블록 → 소블록 → 필드 들여쓰기 + 접기/펼치기. 블록 행에
  checksum 상태 표시.

**Part 4 — 통짜 payload를 필드로.** 코퍼스 빈도 순으로 4개 그룹 중 3개를 편집 가능하게 했다:

| 그룹 | 대상 | 코퍼스 |
|---|---|---|
| A | SVD(가변 길이 VIC 목록 편집) · SAD(포맷·채널·7종 샘플레이트·byte3) · Speaker Allocation(3바이트, 20개 스피커 플래그 전부) | 4,169 |
| B | Colorimetry(10개 색역 플래그) · Video Capability(QY/QS/S_PT/S_IT/S_CE) · HDR Static Metadata 편집 가능화(EOTF 4플래그 + 휘도 3필드) | 1,818 / 2,101 |
| C | DisplayID Type I 상세 타이밍 — pixel clock·H/V active·blank·sync·극성·aspect·interlaced·3D. 코퍼스 336개 파일에서 디코드됨 | — |
| D | CTA VTDB Type VII/X, Dolby Vision 변형별 필드 | **미착수** |

D를 미룬 이유: Type VII/X는 여러 타이밍 항목이 가변 길이 "extra" 필드와 함께 하나의
확장 블록에 순차 패킹되는데, 그 경계를 정하는 메커니즘을 아직 실측하지 못했다.
Dolby Vision은 이번 라운드에서 손대지 않았다 — `version` 필드만 기존대로 편집 가능.

기존 버그도 하나 발견했다: `base.desc*.{name,serial,text}`가 `applyField`로는 써지는데
`isFieldEditable`은 `false`를 반환해 UI가 회색으로 막고 있었다.

> **정정(v0.3.0)** — v0.2.0 배포 시점에 이 문장은 "고쳤다"로 적혀 있었으나
> **실제 수정은 들어가 있지 않았다.** 실제 수정과 양방향 회귀 TC는 v0.3.0에서 들어갔다.

검증: `npm run test:all` **65/65**(코퍼스 1,397개 라운드트립 포함), 신규
`npm run test:integration` **13/13**(파일 생성·가져오기·트리·편집·저장·경로 이탈 거부).
브라우저 시나리오는 [docs/TESTPLAN.md](docs/TESTPLAN.md).

---

## v0.1.0 — 2026-09-03

첫 사용 가능 버전. Base EDID · CTA-861 · VSDB 5종 · DisplayID 1.x/2.0을 필드 단위로 읽고 쓰며,
실측 EDID **1,397개 전량 바이트 완전 라운드트립**을 회귀 게이트로 세웠다.

---

## 1. 배경 — 왜 만들었나

기존 도구는 Quantum Data **ATP Manager 7.90.04**(별칭 980 Manager)다.
EDID 생성 부분에서 세 가지가 문제였다.

### 1-1. 버그

체크섬을 손으로 만질 수 있게 돼 있어서, 편집 순서에 따라 저장물이 달라졌다.
새 도구는 저장 경로에서 **항상 재계산**한다 — 체크섬은 편집 대상이 아니다.

### 1-2. 특수 VSDB를 payload 통짜 hex로 입력

HDMI Forum·Dolby Vision·HDR10+ 같은 블록은 UI가 없어서 규격서를 보며 hex를 직접 쳐 넣어야 했다.
비트 하나 틀리면 조용히 잘못된 EDID가 나온다.
새 도구는 이들을 **구조화된 필드**로 편집한다.

특히 **AMD FreeSync VSDB(OUI 00-00-1A)는 ATP Manager가 "Unknown Vendor specific data Block"으로만
표시**한다 — 대체가 아니라 순수 개선인 지점이다.

### 1-3. 파일을 하나씩만 열 수 있음

실제 업무는 **횡전개**다. 한 모델을 기준으로 파생 모델에 사양을 퍼뜨리고,
복사된 사양을 한눈에 확인하고, 빠르게 붙여넣어야 한다.
파일을 하나씩 열어 비교하는 방식으로는 안 된다.

그래서 **행 = 사양 항목, 열 = 모델** 매트릭스를 1급 화면으로 만들었다.

### 1-4. 범위 결정

| 항목 | 결정 |
|---|---|
| 규격 범위 | Base EDID + CTA-861(필수), HDMI VSDB(1.4b + Forum 2.1), HDR(Static + HDR10+ + Dolby Vision), DisplayID 1.2/1.3 — 이후 2.0까지 확장 |
| 형태 | 로컬 서버형 (Node + React) |
| 장비 통신 | **범위 밖.** 파일 생성·편집 전용 |
| 매트릭스 축 | 행 = 사양 항목, 열 = 모델 |

---

## 2. 어떻게 만들었나 — 근거의 3단계

비트 레이아웃은 추측하지 않는다. 근거의 강도를 `packages/edid-core/spec/field-map.json`의
`sourceKind`로 필드마다 기록한다.

| sourceKind | 필드 수 | 근거 |
|---|---|---|
| `decompiled` | 90 | ATP Manager 플러그인 JAR을 CFR로 디컴파일(785 클래스)해 실제 구현에서 읽어냄 |
| `port` | 10 | 별도 파이썬 EDID 플랫폼의 `decoders.py`에서 이식 |
| `corpus` | 3 | 실측 EDID와 디코드 리포트를 대조해 역산 |

**합계 103개 필드 · 그중 55개 편집 가능.**

### 2-1. 디컴파일이 규격서보다 강한 근거인 이유

ATP Manager는 Eclipse RCP / SWT **Java** 앱이다. 규격 문서를 해석해 "이렇게 동작할 것이다"를
추정하는 대신, 실제로 파일을 쓰는 코드를 직접 읽을 수 있었다. 여기서 확정한 것들:

- **파일 포맷** — `EdidDataFile.java`: `DATAOBJ` XML, `BLOCK0`~`BLOCK31`에 128바이트씩 대문자 hex.
  읽기는 첫 빈 블록에서 멈춘다. `.bin`은 128의 배수인 raw 바이트.
- **HDMI Forum VSDB** — `Scds.java` + `HFOption.java`: 옵션 비트 위치, VRR min/max 분할 저장,
  DSC 3바이트 필드까지.
- **DisplayID** — 1.x/2.0 전체 태그 표, Display Params v2의 29바이트 레이아웃, 휘도가
  **IEEE 754 half-precision float**이라는 점, `ColorCoord12`의 12비트 2개 3바이트 패킹,
  Tiled Topology의 6비트 값 상위 2비트 분할.

### 2-2. 이식하지 않기로 한 것

파이썬 `decoders.py`의 HF-VSDB 구현은 **VRR_Max 상위 2비트(`b8 & 0xC0`)를 병합하지 않아
240Hz를 넘는 값에서 틀린다.** JAR 근거로 이미 올바르게 구현돼 있었으므로 그 부분은 가져오지 않았다.
HDR10+도 파이썬은 확장태그 `0x01`만 보고 OUI를 확인하지 않는다.

### 2-3. 규격서가 없는 블록 — HDR10+

HDR10+는 공개 규격 PDF가 없고, 참조 파이썬 디코더는 **OUI 바이트를 필드로 잘못 읽고 있었다.**
실측 297개 EDID에서 나온 payload 8종과 각각의 리포트 값을 대조해 비트 배치를 역산했다:

```
bits[1:0]  Application_Version
bits[3:2]  Full_Frame_Peak_Luminance_Index
bits[7:4]  Peak_Luminance_Index
```

관측된 8종 값이 전부 이 배치로 설명된다.

---

## 3. 구현 내용

### 3-1. 코덱 (`packages/edid-core`, 의존성 0)

| 파일 | 내용 |
|---|---|
| `bytes.ts` | 비트 추출·패킹, 체크섬, hex 변환 |
| `base.ts` | Base Block 0 전체 필드 |
| `descriptors.ts` | 18바이트 디스크립터 — DTD, 제품명, 시리얼, range limits |
| `cta.ts` | CTA-861 확장 + 데이터블록 컬렉션 + 확장태그 |
| `displayid.ts` | DisplayID 섹션 프레이밍·체크섬 |
| `displayid2.ts` | DisplayID 1.x/2.0 데이터블록 — Display Params v2, Adaptive-Sync, Tiled Topology, ContainerID, half-float, ColorCoord12 |
| `vic.ts` | CTA-861 VIC 154종 → `3840x2160p @ 60 Hz 16:9` 라벨 |
| `vsdb/` | HDMI 1.4b · HDMI Forum 2.1 · AMD FreeSync · HDR10+ · Dolby Vision |
| `flatten.ts` | EDID → 비교 가능한 스펙 행 (매트릭스의 근간) |
| `applyField.ts` | 스펙 행 → EDID 되쓰기 (횡전개 전파의 근간) |

코덱은 **브라우저에서 그대로 돈다.** 서버는 파일 읽기·쓰기만 한다.

### 3-2. 지금 되는 것

| 영역 | 상태 |
| --- | --- |
| Base EDID Block 0 | 전체 필드 |
| 18바이트 디스크립터 | DTD, 제품명, 시리얼, range limits (패딩 바이트까지 보존) |
| CTA-861 확장 | 헤더 플래그, DTD, HF-EEODB, Y420/InfoFrame(표시만). **편집 가능**: SVD(가변 VIC 목록) · SAD(포맷·채널·샘플레이트·byte3) · Speaker Allocation(20 플래그) · Colorimetry(10 플래그) · Video Capability(QY/QS/S_PT/S_IT/S_CE) · HDR Static Metadata(EOTF 4플래그+휘도) |
| HDMI 1.4b VSDB | 물리주소, 딥컬러, Max TMDS, 지연(인터레이스 포함), 컨텐츠 타입 CNC0-3, 4K HDMI_VIC, 3D 구조/엔트리 |
| HDMI Forum VSDB | 버전, Max TMDS, Max FRL, SCDC, 4:2:0 딥컬러, ALLM/FVA/QMS/CinemaVRR, VRR min·max, DSC 전 필드 |
| AMD FreeSync VSDB | 버전, FreeSync/Native/Local Dimming, min·max refresh, MCCS, 휘도, LSB refresh |
| HDR | Static Metadata(EOTF·휘도), Dynamic Metadata, HDR10+ 전체 인덱스 |
| Dolby Vision | 버전·variant 판별 + payload 무손실 (변형별 필드 편집기는 미구현) |
| DisplayID 1.x / 2.0 | 전체 태그 표, Display Params v2, Adaptive-Sync, Tiled Topology, ContainerID (표시). **편집 가능**: Type I 상세 타이밍(pixel clock·H/V active·blank·sync·극성·aspect·interlaced·3D) — 코퍼스 336개 파일에서 디코드됨 |
| 매트릭스 | 블록→소블록→필드 계층 트리(접기/펼치기), diff 하이라이트, 행 전파, 열 복사·일괄 붙여넣기, `Fit`/`Manual` 열 폭 |
| hex 뷰 | 매트릭스 하단 도킹, 필드↔바이트 양방향 강조(3단계: 필드/소블록/블록), 편집 직후 바이트 플래시 |
| 파일 관리 | 모델 폴더 트리, 신규 `.ddc` 생성, `.ddc`/`.xml`/`.bin` 가져오기, 복제, 폴더 생성, 삭제 |

---

## 4. 검증 — 실측 코퍼스가 게이트다

**실측 모니터 EDID 1,397개**와, 그중 1,371개에 딸린 독립 디코더 리포트
(Teledyne LeCroy HTML 1,162 · DDC Manager TXT 206 · DATAOBJ XML 3)를 회귀 기준으로 삼는다.

| 티어 | 케이스 | 검증 |
|---|---|---|
| T1 | 1,397 | `decode → encode` **바이트 완전 일치** |
| T2 | 1,397 | 모든 블록 체크섬 ≡ 0, 재인코딩 후에도 유효 |
| T3 | 1,162 | 리포트 hex 덤프가 `.ddc`의 정확한 접두사 |
| T3b | 1,162 | 리포트 길이가 byte126 또는 EEODB 카운트와 일치 — EEODB 해석의 교차검증 |
| T6 | 합성 | 헤더 손상·길이 불량·빈 입력 거부, 체크섬 자동 복구 |
| VSDB | 2,071 | 벤더 블록 payload `parse → build` 바이트 일치, 필드 범위 검사 |
| VIC | 7,930 | 모든 SVD가 154종 VIC 표에서 해석됨 (미해석 0) |

코퍼스에 불량 EDID가 **한 건도 없어서**(1,397개 전부 체크섬 정상) T6은 직접 합성한다.

### 4-1. 이 코퍼스가 잡아낸 실제 버그

벤더 샘플 30개로는 라운드트립이 100%였지만, 실측 1,397개를 물리자 **68.9%**로 떨어졌다.
실패 모드는 8종뿐이었고 전부 계통적이었다.

**① HF-EEODB 확장 카운트 손상 (249개 파일)**
HDMI 2.1은 레거시 소스 호환을 위해 base `byte126`을 1로 두고, 진짜 확장 블록 개수를
EEODB(CTA 확장태그 `0x78`)에 담는다. 인코더가 `byte126`을 물리 블록 수로 무조건 덮어써서
**HDMI 2.1 EDID를 저장할 때마다 손상**시키고 있었다.

**② DisplayID 섹션 잘림 (182개)**
원본이 선언한 `sectionSize`(예: 121) 안에 데이터블록 1개(63바이트)와 제로 패딩이 들어 있는데,
인코더가 63으로 재계산해 **섹션 체크섬 위치까지 앞으로 당겨졌다.**

**③ 텍스트 디스크립터 패딩 (1개)**
VESA는 `0x20` 패딩을 규정하지만 실제 패널은 `0x00`을 쓴다.
손대지 않은 파일을 저장해도 바이트가 바뀌고 있었다.

세 건 모두 **"편집되지 않았으면 원본 값을 보존한다"** 는 같은 원칙으로 고쳤다
(`sourceDtdOffset` · `sourceSectionSize` · `padByte`). 결과 **1,397/1,397 (100%)**.

**④ AMD FreeSync 요약이 `undefined` (문서화 작업 중 발견)**
`apps/web/src/EditorView.tsx`의 `summarise()`가 `amd-freesync` 케이스를 빠뜨려
프로덕션 빌드(`tsc -b`)가 실패하고 있었다. Vite dev 서버는 타입 검사를 하지 않아
개발 중에는 드러나지 않았다. 이 때문에 **CI가 `npm run build`를 반드시 돌리도록** 구성했다.

---

## 5. 규격 갱신을 반영하는 방법

비트 연산은 **타입 있는 TypeScript로 손수 유지**한다. 대신 추적성을 붙였다.

1. `packages/edid-core/spec/field-map.json` — 필드 path마다 `specDoc` · `section` · `sourceKind` 기록.
2. `scripts/spec-drift.mjs` — 규격 PDF의 SHA-256을 기준선과 대조해
   **바뀐 문서 + 그 문서를 인용하는 TS 필드 목록**을 마크다운으로 출력한다. 코드는 건드리지 않는다.
3. 구현은 사람이 하고, **1,397개 코퍼스 회귀가 모든 변경을 게이트**한다.

### 왜 코드 자동 생성이 아닌가

이식원 파이썬 시스템은 이 고리를 codegen으로 닫으려 했다:
PDF 43종 → 추출 → LLM → `answers/*.json` 636개(필드 레코드 2,958개) → 병합 335개 `.md` →
`codegen` → `docs_update/stubs.py`(433KB, 293개 클래스).

실측 결과:

| 확인 항목 | 결과 |
|---|---|
| `stubs.py`의 293개 클래스 중 `NotImplementedError` | **293개 전부** |
| `stubs.py`를 import하는 코드 | **없음** (생성기 자신과 help 텍스트뿐) |
| 런타임 `edid_blocks.py` 손수 작성 클래스 vs 규격 수 | **30 vs 335** |
| 추출물에 계산식 (예: Max_TMDS `×5 MHz`) | **0건** |

`manage_docs.py:289`가 직접 `"Review the stubs, then integrate into edid_blocks.py"`를 출력한다 —
**사람이 통합하는 설계였고, 통합된 적이 없다.**
근본 원인은 추출물에 **계산식이 없다**는 것이다. LLM이 만든 것은 코드가 아니라 검토 자료였다.

그래서 여기서는 추출물을 **"무엇을 다시 봐야 하는지 지시하는 용도"** 로만 쓴다.

---

## 6. 제외한 것

### 6-1. UFO GUI 에이전트 (제거됨)

초기에는 [microsoft/UFO](https://github.com/microsoft/ufo)를 띄워 ATP Manager를 자동 조작하면서
필요한 항목을 뽑아낼 계획이었다. 설치까지 진행했고(Python 3.11 venv, torch·pywinauto),
`pandas==1.4.3`이 Python 3.11 wheel이 없어 `1.5.3`으로 올려야 하는 문제도 해결했다.

**결과적으로 필요 없었다.**

- ATP Manager는 SWT 앱이라 **UIAutomation에 아무것도 노출하지 않는다** — 실측 결과 창 하위
  99개 요소가 전부 이름 없는 `SWT_Window0` Pane이고 지원 패턴이 0개였다.
  화면을 읽으려면 OmniParser(비전 모델) 경로가 필요했다.
- 그 사이 **JAR 디컴파일이 훨씬 강한 근거**를 제공했다. 화면을 클릭해 관찰하는 것보다
  파일을 쓰는 코드를 직접 읽는 편이 정확하다.
- 정확성은 결국 **디컴파일 + 1,397개 코퍼스 회귀**가 보장했다.

v0.1.0에서 `tools/UFO/`(1.48GB)와 관련 설정을 전부 제거했다.
이로써 저장소에서 **Python 의존이 완전히 사라졌다.**

### 6-2. 장비 통신

범위 밖. 파일 생성·편집 전용이다.

---

## 7. 남은 일

- **Type VII 플래그 바이트 충돌 미해결.** `reference/port/decoders.py:395-399`는
  `bit7=preferred / bits6:5=stereo / bit4=y420 / bits3:0=aspect`로 읽고, CTA-861-H
  추출 기록은 `bit7=T7Y420 / bit6=3D / bit5=T7IL / bits4:0=aspect`로 읽는다.
  실측 코퍼스는 해당 상위 비트가 전부 0이라 **두 해석이 같은 결과**를 내므로
  데이터로는 구분이 안 된다. 지금은 추출 기록 쪽으로 구현되어 있고, 어느 쪽이든
  기존 데이터에는 회귀가 없다. `ANSI-CTA-861-H-Final.pdf` p.160-161로 확정할 것.
- **Dolby Vision · Type VIII은 실검증 전이다.** 코퍼스 인스턴스가 0개라 합성 픽스처
  왕복만으로 보증된다. 실기에서 처음 만나는 EDID가 첫 실검증이 되므로, 그때
  디코드 결과를 반드시 리포트와 대조할 것.
- **T4 / T5 필드 오라클** — 리포트의 디코드된 값과 우리 필드를 자동 대조하는 티어.
  T1~T3와 VSDB 티어가 이미 강한 회귀를 세우고 있어 후순위.
  라벨 → 필드 path 매핑 표를 손으로 만들어야 한다.
- **DisplayID Type II/III/IV/V/VI/IX** 타이밍의 구조화 디코드 — Type I/VII/VIII/X는
  처리된다. 코퍼스 실측 빈도가 낮아 후순위.
- **`docs/TESTPLAN.md`의 B10(횡전개 붙여넣기)** — 코드 경로는 검증됐지만 브라우저
  클릭으로 재확인은 아직. 반복 확장 블록에 `_0`/`_1` 순번이 붙었으므로, 모델 간
  붙여넣기가 순번까지 맞춰 대응되는지 이때 같이 본다.
- **라이선스 결정** — 공개 저장소로 올릴지 여부에 따라 `.gitignore`의 데이터 제외 정책도 함께 검토.
