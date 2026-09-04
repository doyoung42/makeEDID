# NOTICE — 제3자 자료 출처

이 저장소의 코드는 새로 작성한 것이지만, 일부는 외부 자료를 근거로 하거나 그로부터 파생됐다.

---

## 1. 저장소에 포함된 것

### CTA-861 VIC 타이밍 표 — `packages/edid-core/src/vic.ts`

VIC 1–127 / 193–219, 154종.

| 항목 | 값 |
|---|---|
| 출처 | [edid-decode](https://git.linuxtv.org/v4l-utils.git/tree/utils/edid-decode) (v4l-utils) `edid_cta_modes` 테이블 |
| 출처 라이선스 | MIT (`utils/edid-decode/LICENSE`, Copyright 2006–2012 Red Hat, Inc.; 2018–2024 Cisco Systems, Inc. and/or its affiliates) |
| 원 데이터 | 타이밍 수치 자체는 **CTA-861-H 표준이 정의하는 사실 데이터** |

`vic.ts`는 `reference/port/cea861_vic_timings.json`에서 **생성된 파일**이다. 손으로 고치지 않는다.
상위 프로젝트가 `h_total` / `v_total` / 포치 분해를 해결하지 않았으므로 그 필드들은 없다.

---

## 2. 저장소에 포함되지 않는 것 (`.gitignore` 대상)

아래는 전부 로컬 자료다. 재배포 권한이 없거나 사내 자료라서, 이 저장소의 공개 범위와
무관하게 항상 제외된다.

| 경로 | 내용 | 배포 |
|---|---|---|
| `corpus/` | 실측 양산 모니터 EDID 1,397개, 사내 EDID List 사양서 xlsx(2건 DRM 잠김), 경쟁사 캡처 | **불가** — 사내 자료 |
| `reference/specs/pdf/` | VESA / CTA / HDMI 표준 PDF 43종 | **불가** — 사이트 라이선스 문서 |
| `reference/specs/extracted/` | 위 PDF에서 LLM으로 추출한 필드 레코드 | **불가** — 원문 파생물 |
| `reference/decompiled/` | Quantum Data ATP Manager 플러그인 JAR을 CFR로 디컴파일한 785 클래스 | **불가** — 상용 SW 파생물 |
| `reference/samples/` | ATP Manager 계측기에 동봉된 DATAOBJ XML 픽스처 30종 | **불가** — 벤더 동봉 자료 |
| `reference/rules/` | 사내 EDID 검토 체크리스트 | **불가** — 사내 자료 |
| `reference/port/` | 별도 사내 파이썬 EDID 플랫폼의 디코더 | **불가** — 사내 자료 |
| `projects/` | 작업 중인 모델 EDID(`*.ddc`) | **불가** — 사내 자료 |
| `tools/cfr.jar` | [CFR](https://www.benf.org/other/cfr/) 0.152 Java 디컴파일러 (MIT) | 배포 대신 상위에서 받는다 |

### 이 자료들이 없어도 코드는 돈다

- `npm test` / `npm run test:corpus` — 데이터가 없으면 해당 TC가 **사유를 붙여 skip**된다
  (`test/fixtures.mjs`, `test/corpus/loader.mjs`).
- `npm run spec:drift` — 레지스트리가 비었다고 보고한다.
- 앱 자체(`npm start`)는 이 자료들을 전혀 참조하지 않는다.

---

## 3. 참고한 규격

구현은 아래 표준을 근거로 하지만, 표준 문서 자체는 포함하지 않는다.

- VESA E-EDID Standard (Enhanced EDID) Release A, Rev. 2
- VESA DisplayID Standard v1.3 / v2.0
- CTA-861-G / CTA-861-H (ANSI/CTA)
- HDMI Specification 1.4b / 2.1 (HDMI Forum)
- Dolby Vision EDID Extension
- AMD FreeSync VSDB (OUI 00-00-1A) — 공개 규격 없음, 이식·관찰 기반
- HDR10+ VSVDB (OUI 90-84-8B) — 공개 규격 없음, **실측 297개 EDID에서 비트 배치 역산**

---

## 4. 이 프로젝트 코드의 라이선스

**MIT.** 저장소 루트의 [LICENSE](LICENSE) 참조. 위 1절에 명시한 파생 자료(VIC 타이밍 표)의
원 라이선스도 MIT라서 함께 배포하는 데 문제가 없다. 2절에 적힌 항목들은 이 저장소의
라이선스와 무관하게 — 사내 자료·제3자 라이선스 문서이므로 — 계속 제외된다.
