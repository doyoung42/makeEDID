# CLAUDE.md — `@edid/core`

EDID 코덱. **의존성 0**, 브라우저와 Node 양쪽에서 그대로 돈다.
저장소 전체 규칙은 루트 [CLAUDE.md](../../CLAUDE.md)에 있다.

---

## 설계 원칙

### 1. 디코드는 손실이 없어야 한다

`encodeEdid(decodeEdid(bytes))`는 **원본 바이트와 완전히 같아야 한다.**
실측 EDID 1,397개 전량이 이것을 강제한다(`test/corpus/conformance.test.mjs` T1).

해석하지 못한 영역은 버리지 않고 모델에 담는다:

| 필드 | 담는 것 |
|---|---|
| `trailing` (VSDB 각종) | 모델링한 구간 뒤의 나머지 바이트 |
| `extra3D` (HDMI 1.4b) | 선언된 3D 길이 중 소비하지 못한 부분 |
| `padding` (DisplayID) | 섹션 안의 제로 패딩 |
| `payload` (generic VSDB) | OUI를 모르는 블록 전체 |

### 2. 원본이 선언한 값을 재계산하지 않는다

**`source*` 접두사가 붙은 필드는 전부 이 원칙의 산물이다.** 손대지 말 것.

| 필드 | 왜 있는가 |
|---|---|
| `sourceDtdOffset` (`cta.ts`) | 데이터블록도 DTD도 없는 확장이 오프셋에 0이 아닌 값을 들고 있다 |
| `sourceSectionSize` (`types.ts`) | DisplayID 섹션은 데이터블록보다 크게 선언되고 나머지는 제로 패딩이다. 줄이면 섹션 체크섬 위치가 이동한다 |
| `padByte` (`descriptors.ts`) | VESA는 `0x20` 패딩을 규정하지만 실제 패널은 `0x00`을 쓴다 |
| `headBytes` (`vsdb/hdmi14b.ts`) | 블록이 3바이트에서 끝나기도 한다. 어느 필드가 설정됐는지로 길이를 역산할 수 없다 |
| `hasLengthByte` (`vsdb/hdmi14b.ts`) | `HDMI_Video_present`가 서 있는데 길이 바이트가 없는 EDID가 102개 있다 |
| `presentBytes` (`vsdb/amdFreesync.ts`) | 짧은 블록이 길어지지 않게 한다 |

base `byte126`(확장 개수)도 같은 문제다. `codec.ts`의 `findEeodbExtensionCount()`가
HF-EEODB(CTA 확장태그 `0x78`)를 찾아, **있으면 원본 값을 그대로 둔다** —
HDMI 2.1은 레거시 소스 호환을 위해 `byte126`을 1로 두고 진짜 개수를 EEODB에 담기 때문이다.

**재계산하는 것은 체크섬뿐이다.**

### 3. 실패는 조용하지 않게

파싱 실패는 `throw`하고 메시지에 이유와 위치를 담는다.
`applyField()`는 쓸 수 없는 path나 범위를 벗어난 값에 대해 `false`나 예외를 돌려준다 —
조용히 무시하지 않는다.

---

## 파일 배치

| 파일 | 책임 |
|---|---|
| `bytes.ts` | `bits` / `bit` / `packBits` / 체크섬 / hex ↔ bytes / 블록 분할·결합 |
| `types.ts` | 모델 타입 전부. 모델을 바꾸면 여기부터 |
| `codec.ts` | 최상위 `decodeEdid` / `encodeEdid`, 확장 개수 처리 |
| `base.ts` | Block 0 |
| `descriptors.ts` | 18바이트 디스크립터 |
| `cta.ts` | CTA-861 확장, 데이터블록 컬렉션, `CtaExtendedTag` |
| `displayid.ts` | DisplayID 섹션 프레이밍·체크섬 |
| `displayid2.ts` | DisplayID 데이터블록 + half-float / ColorCoord12 유틸 |
| `displayidTiming.ts` | DisplayID Type I 상세 타이밍 (20바이트, 코퍼스 최다 DisplayID 블록) |
| `vic.ts` | **생성 파일.** VIC 154종 표 |
| `vsdb/*.ts` | 벤더 블록별 파서·빌더 |
| `layout.ts` | 모델을 걸으며 인코더에 길이를 물어 바이트 영역 지도를 만든다 (디코더는 안 건드림) |
| `fieldTree.ts` | 평면 `SpecField[]` → 계층 트리, 바이트→행 역방향 조회(`fieldsAtByte`) |
| `flatten.ts` | EDID → 스펙 행 (표시·비교) |
| `applyField.ts` | 스펙 행 → EDID (편집·전파) |
| `template.ts` | `createBlankEdid()` — 신규 파일 생성용 최소 유효 EDID |
| `spec/field-map.json` | 필드별 근거 기록 |

`flatten.ts`와 `applyField.ts`는 **짝**이다. 한쪽에만 필드를 추가하면 매트릭스에 보이지만
편집이 안 되거나(또는 그 반대) 하는 상태가 된다.

### 바이트 출처 — `layout.ts` + `SpecField.span`

매트릭스와 hex 패널이 필드↔바이트를 연결하는 근거는 **디코더가 아니라 인코더**다.
`applyField`가 CTA 데이터블록을 통째로 새 객체로 교체하는 경우가 있어(VSDB 편집 등)
디코드 시점 오프셋을 저장해 두면 편집 직후 바로 낡는다. 대신 `computeLayout(edid)`가
**매번** 기존 인코더(`encodeDataBlock` 등)에 길이를 물어 위치를 다시 계산한다 —
`encodeEdid(decodeEdid(b))`가 바이트 일치이므로 인코더가 곧 위치의 정답이다.

`flatten.ts`의 `add()`는 5-인자 그대로 두면 `span: null`을 낸다(파생/집계 행).
바이트를 가진 잎은 `add.at(상대오프셋, 길이, ...)`, 소블록·블록 같은 컨테이너 행은
`add.scope(..., region, role)`가 만든다 — 반환된 emitter가 그 region 기준으로
`.at()` 오프셋을 해석하므로, 소블록이 어디에 있든 잎의 오프셋 숫자는 그대로다.

**새 필드에 span을 달 때**: `test/corpus/span.test.mjs`(S1)가 코퍼스 전량에서
실제로 값을 흔들고 재인코딩해, 바뀐 바이트가 선언한 span(+체크섬) 안에 들어가는지
검증한다. 손으로 만든 오프셋 표가 아니라 이 TC가 정답이다 — 새 span을 추가했으면
`node --test test/corpus/span.test.mjs`를 반드시 돌린다.

---

## 새 VSDB를 추가하는 순서

1. **근거를 먼저 확보한다.** 우선순위:
   `reference/decompiled/com/quantumdata/i980/core/edid/model/cea/dblock/` (실제 구현)
   > 규격 PDF > 코퍼스 관찰(payload 값과 리포트 값 대조).
2. `vsdb/<name>.ts` — `OUI` 상수, 인터페이스, `parse…` / `build…`.
   **`parse → build`가 바이트 일치해야 한다.** 모르는 꼬리는 `trailing`으로.
3. `vsdb/index.ts` — `VsdbView` 유니언에 추가, `parseVsdb` / `buildVsdb`의 `switch`에 등록.
4. **`flatten.ts`의 `switch (view.type)`에도 케이스를 추가한다.** 이 switch에는
   `default`가 없어서 **TypeScript가 빠뜨린 케이스를 잡아주지 않는다** — 컴파일은
   통과하고 그냥 그 VSDB가 화면에 안 뜬다. 손으로 확인할 것.
   (예전에는 별도 `EditorView.tsx`의 `summarise()`에도 케이스가 필요했는데, 그 파일은
   매트릭스+hex 통합 뷰로 흡수되며 사라졌다 — 지금은 이 한 곳뿐이다.)
5. `applyField.ts` — 편집 가능하게 할 필드를 허용 목록과 검증에 추가.
   비트 플래그를 노출한다면 `flagsRaw` 류 원본 바이트도 함께 갱신할 것.
6. `spec/field-map.json` 기록.
7. `npm run build && npm run test:all`.

---

## 이 코덱을 만들며 확인한 사실

- **HDR10+ payload 1바이트 레이아웃** — 공개 규격이 없어 실측 297개에서 역산했다.
  `bits[1:0]` Application_Version · `bits[3:2]` Full_Frame_Peak_Luminance_Index ·
  `bits[7:4]` Peak_Luminance_Index. 관측된 8종 값이 전부 설명된다.
  (이식원 파이썬은 이 값들을 **OUI 바이트에서** 읽고 있었다 — 틀렸다.)
- **HF-VSDB VRR_Max는 상위 2비트가 다른 바이트에 있다**(`b8 & 0xC0`).
  이식원 파이썬은 이걸 병합하지 않아 240Hz 초과에서 틀린다. **이식하지 않았다.**
- **AMD FreeSync 최소 휘도는 제곱근 압축 코드**다: `(raw/255)² × max / 100`.
- **DisplayID 2.0 휘도는 IEEE 754 half-precision float**이다.
- **`ColorCoord12`는 12비트 2개를 3바이트에 패킹**한다.
- **Tiled Topology의 6비트 값은 상위 2비트가 분리 저장**된다(`hvCntLoc` big-endian 24비트).

---

## enum 필드는 코드를 값으로 낸다, 라벨이 아니다

편집 가능한 enum 필드(예 `hdmiForum.maxFrl`, `cta*.sad*.format`, `cta*.ext0.spt`)는
**원시 코드 숫자**를 `value`로 낸다. 사람이 읽는 라벨(`AUDIO_FORMAT[code]` 같은)은
비-편집 표시용 별도 행에만 쓴다. 두 번 실수로 걸렸다: 라벨 문자열을 `value`로 냈다가
`applyField(edid, path, field.value)`(자기 값을 그대로 되돌려주는 라운드트립 TC)가
`clampInt`에서 깨졌다. `isFieldEditable(path)`가 true인 필드는 **자기 자신의 표시값을
다시 넣었을 때 받아들여야 한다** — `test/applyField.test.mjs`의
"isFieldEditable agrees with what applyField accepts"가 이걸 강제한다.

## 필드를 편집 가능하게 만들 때 걸리는 함정 4가지

실측으로 하나씩 밟은 것들이다.

1. **표시값을 되돌려 넣었을 때 받아들여져야 한다.** `isFieldEditable(path)`가 true인
   필드는 `applyField(edid, path, 그 필드의 현재 value)`가 성공해야 한다
   (`test/applyField.test.mjs`가 **양방향**으로 강제한다). 라벨을 `value`로 내면 깨진다 —
   위의 enum 규칙과 같은 이야기다. `base.week`의 "model year"나 `base.gamma`의
   "defined by DI-EXT"처럼 특수 상태를 문자열로 보여준다면, writer가 **그 문자열도
   받아줘야** 한다.

2. **파생 뷰와 원시 바이트가 따로 있으면 둘 다 갱신한다.** 인코더가 원시 바이트를
   그대로 쓰는 경우가 있다 — `buildVideoSection`은 `video.flagsRaw`를 그대로 emit하는데
   `threeDPresent`/`imageSize`는 디코드 시점에 그 바이트에서 파생된 뷰다. 한쪽만 고치면
   모델과 emit된 바이트가 어긋난다. AMD FreeSync의 `setFlag` 패턴을 따를 것.

3. **인코더에 분기가 있으면 그 분기를 넘나드는 편집은 파괴적이다.**
   `cta*.revision`은 3 미만에서 데이터블록을 통째로 버리고 패딩을 쓴다. 그래서
   **일부러 읽기 전용**으로 뒀다. 뮤테이션 프로브가 "span은 1바이트인데 6바이트가
   바뀌었다"로 잡아준 케이스다 — 그런 신호가 나오면 span을 넓히지 말고 **왜 그 바이트들이
   움직였는지**를 먼저 볼 것.

4. **저장 시 보정이 있는 필드는 writer가 보정을 책임진다.** Display Range Limits는
   byte 4에 "+255" 플래그가 있고 encode가 그만큼 빼서 저장한다. 값만 쓰고 플래그를
   안 세우면 300이 44로 조용히 잘린다. 값에서 플래그를 **파생**시켜야지,
   사용자에게 두 필드를 맞춰 달라고 하면 안 된다.

## 디코더가 없는 블록도 편집은 된다

필드로 못 쪼갠 블록은 `isRawPayloadPath(path)`에 해당하면 **hex 문자열로 직접 편집**된다
(`applyCtaRawPayload` / DisplayID payload / 디스크립터 raw). 바이트 예산을 넘으면 던진다.
ATP Manager의 `ReservedBlockEditor`/`BlockDataEditor`와 같은 폴백이다.

단, **구조화된 요약 행은 여기서 제외**한다(`STRUCTURED_EXT_TAGS`). `cta*.ext0`은
`"0x03"`을, `ext14`는 VIC 이름 목록을 보여주므로 hex로 파싱하면 안 된다.

## 하면 안 되는 것

- 파싱 못 한 바이트를 버리기
- 원본이 선언한 길이·오프셋·개수를 "정확한 값"으로 덮어쓰기 (체크섬 제외)
- 근거 없이 비트 위치 추정하기 — `sourceKind`에 적을 게 없으면 아직 구현할 때가 아니다
- `vic.ts`를 손으로 수정하기 — 생성 파일이다
- 런타임 의존성 추가하기 — 이 패키지는 의존성 0을 유지한다

## 확장 블록 쓰기 경로의 순서 규칙

`applyCta`의 `EXT_TAG_FIELD`(`/^ext(\d+)\.(.+)$/`) 분기는 **반드시 맨 마지막**에 둔다.
이 패턴은 Type VII/VIII/X와 Y420의 path도 같이 매치하므로, 위에 두면 그 아래
구조화 쓰기 분기가 전부 도달 불가가 된다. 그러면 게이트(`isFieldEditable`)는
"편집 가능"이라 답하는데 `applyField`는 `false`를 반환해서, **UI는 입력을 받고
저장은 조용히 아무것도 하지 않는다.** 실제로 v0.3.0의 Type VII/X CTA 캐리어
쓰기가 이 상태로 한 라운드 내내 죽어 있었다.

`test/corpus/span.test.mjs`가 이제 이것을 단언한다 — 게이트가 편집 가능하다고 한
필드를 `applyField`가 `false`로 거부하면 실패한다. 계약은 그대로다:
**`false` = "이 path를 쓸 줄 모른다", 예외 = "쓸 줄은 아는데 값이 틀렸다".**

## 반복되는 확장 블록에는 순번을 붙인다

Type VII(0x22) · Type VIII(0x23) · Type X(0x2a)는 한 CTA 확장 안에 여러 번 나온다
— Type VII은 블록 하나가 디스크립터 하나뿐이라 타이밍 3개면 블록도 3개다.
이 태그들만 path에 발생 순번이 붙는다(`ext34_0` · `ext34_1` · …).
`REPEATABLE_EXT_TAGS`(flatten)와 `findExtendedBlock(ext, tag, occurrence)`(applyField)가
같은 순서를 세므로 **둘 중 하나만 고치면 다른 블록의 바이트를 쓴다.**

## 캐리어마다 옵션 바이트의 위치가 다르다 (Type VII/VIII/X)

| | CTA 캐리어 | DisplayID 캐리어 |
|---|---|---|
| 옵션 바이트 | `payload[0]` | `revision` 바이트 |

Type VIII은 여기서 한 걸음 더 나간다 — **바이트만이 아니라 비트 위치까지 다르다**:

| 필드 | CTA | DisplayID |
|---|---|---|
| block revision | bits 2:0 | (revision 바이트 자체) |
| code size | bit 3 | bit 0 |
| YCbCr 4:2:0 | bit 5 | bit 2 |
| code type | bits 7:6 | bits 4:3 |

`parseTypeVIIIOptions(byte, carrier)` 하나로 통일해 두었으니 직접 비트를 세지 않는다.

## 구조를 바꾸는 것과 값을 바꾸는 것은 다른 모듈이다

`applyField`는 **이미 있는 필드의 값**만 바꾼다. 블록을 만들거나 없애는 것은
`structure.ts`다. 계약은 같다 — `false`는 "이 대상에 적용 불가", 예외는 "적용은
가능한데 인자·예산이 틀림".

`structure.ts`의 모든 연산은 **인코더로 검증한다**: 변경 → `encodeEdid` → 실패하면
롤백하고 인코더 메시지를 그대로 던진다. 바이트 예산 규칙(`encodeCtaExtension`의
128바이트, `encodeDataBlock`의 31바이트)을 여기에 복사하지 않는다 — 두 곳에 두면
반드시 어긋난다.

**확장을 추가·삭제하면 EEODB도 갱신한다.** `encodeEdid`는 EEODB가 있으면 base
byte 126을 건드리지 않으므로, EEODB의 개수를 안 고치면 새 블록이 HDMI 2.1 싱크에
보이지 않는다.

## 필드 이름과 모델 속성이 같다고 가정하지 않는다

`writeTypeVII`가 `t[field] = value`로 path 접미사를 그대로 썼다가 조용히 실패했다 —
접미사는 `aspect`인데 모델 속성은 `aspectRatio`라서 **팬텀 속성을 만들고 `true`를
반환했다.** UI는 성공으로 보이고 값은 사라진다. 이제 대상 속성이 없으면 `false`를
반환한다. 인덱스 대입을 쓸 때는 반드시 `prop in target`을 확인한다.

## flatten이 내는 행은 인코더가 저장할 수 있어야 한다

AMD FreeSync는 `presentBytes`까지만 직렬화하는데 flatten이 길이와 무관하게
`maxLum2`까지 행을 냈다. 짧은 블록에서 편집이 저장 시 조용히 버려졌다.
**블록이 실제로 가진 바이트만 행으로 낸다.** 저장할 수 없는 행은 없느니만 못하다.

## 편집 불가 필드는 이유를 말한다

`inputs.ts`의 `readOnlyReason(path)`가 모든 읽기 전용 필드에 사유를 붙인다.
`node scripts/field-audit.mjs`는 사유 없는 읽기 전용이 하나라도 있으면 **실패한다**.
읽기 전용 자체는 정당할 수 있지만(파생값·체크섬·보호 필드), **침묵은 정당하지 않다** —
화면에서 "왜 못 고치지?"가 나오면 그건 기능이 없는 것과 구분되지 않는다.

## enum은 코드를 값으로 낸다 (재확인)

이 규칙을 어겨 라운드트립 TC를 **세 번** 깨뜨렸다. 최근 사례는 DisplayID
`colorDepth`/`tech`/`scan`/`lumInfo`, Adaptive-Sync `modes`, Type VIII `codeType`가
라벨 문자열을 값으로 내던 것이다 — 편집 자체가 불가능했다.
**사람이 읽을 이름은 행 라벨에 넣고, `value`에는 코드를 넣는다.**
드롭다운 라벨은 `inputs.ts`의 `describeInput`이 공급한다.
