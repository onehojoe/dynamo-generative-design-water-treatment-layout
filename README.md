# Dynamo + Generative Design — Water Treatment Plant Layout / 수처리시설 배치 자동화

**Revit Dynamo와 Generative Design으로 수처리시설(정수장·하수처리장) 배치를 자동화하는 12시간 실무 교육 자료입니다.**
CAD 도면 정리부터 대안 생성, Revit 요소 변환, 출력 Sheet 구성까지 다룹니다.

Course materials for a 12-hour hands-on program: automating **water treatment plant layout**
with **Revit Dynamo** and **Generative Design**, from CAD data preparation through
alternative generation to Revit elements and drawing sheets.

> 📄 Blog write-up: [Dynamo Generative Design for Water Treatment Plant Layout](https://weeklydynamo.blogspot.com/2026/08/dynamo-generative-design-water-treatment-plant-layout.html) — WeeklyDynamo (영문 + 한국어 전문)
> 🎥 Background — Autodesk University 2025, *Exploring the Dynamo Product Road Map and Vision for the Future* (27:30):
> https://www.autodesk.com/autodesk-university/class/Exploring-the-Dynamo-Product-Road-Map-and-Vision-for-the-Future-2025

---

## 요구 환경 / Requirements

| | 버전 | 확인 근거 |
|---|---|---|
| **Revit** | **2024** | 샘플 모델 헤더 `Format: 2024`, `Build: 20231029_1515 (x64)` |
| **Dynamo for Revit** | **2.19.3.6394** | 모든 `.dyn` 파일의 `Version` 필드 |
| **Generative Design for Revit** | 패키지 **6.1.1.0** | `시설 배치 관련 v2.dyn` 의 `NodeLibraryDependencies` |

> ⚠️ Dynamo 버전이 다르면 노드가 깨질 수 있습니다. **Revit 2025 이상은 Dynamo 3.x** 라서 그대로 열리지 않을 수 있습니다.
> 위 버전은 추정이 아니라 파일에서 직접 읽은 값입니다.

---

## 무엇이 들어 있나 / What is here

### `01_layout-method` — 공간(시설) 배치 방법론 (1일차 오후)

Rectangle(REC) 이동·회전·겹침. 세 단계로 이어지는 `.dyn` 3개.

| 파일 | 노드 |
|---|---:|
| `SAMPLE 1.dyn` | 37 |
| `SAMPLE 1-1.dyn` | 60 |
| `SAMPLE 1-1-1 겹침 제외.dyn` | 117 |

### `02_layout-application` — 공간(시설) 배치 응용 (2일차)

`시설 배치 관련 v2.dyn` (노드 142). Generative Design 연결 → 배치 규칙 → 출력 기준 →
Revit 요소 변환 → 시트 구성이 한 그래프에 이어져 있습니다.
`시설 배치 Sample.rvt` (Revit 2024) 를 먼저 열고 그래프를 실행합니다.

하위 폴더 `cad 인식 등 set` 에 CAD 인식 단계 자료가 있습니다 — DWG 5장, 그래프 2개, 샘플 모델 1개.

### `03_web-workbench` — 브라우저 배치 워크벤치 (Revit·Dynamo 불필요)

배치 그래프의 로직을 브라우저에 이식한 교육 도구. **`RUN.bat` 더블클릭이 전부**
(서버·설치·인터넷 불필요). 시드 슬라이더 11개 → 배치 → Count·Length&Cost →
대안 갤러리·평행좌표(GD Outcome 화면 재현). 상세·정직 고지는 폴더 안 `README.md`.

### `04_tunnel-section-viewer` — NATM 터널 내공단면 산정 뷰어 (Revit·Dynamo 불필요)

설계 조건에서 **3심원 내공단면(R1·R2·R2′)** 을 산정하고, 조건 4축을 스윕해 만든 900개 대안을
파레토로 비교·판정해 하나를 고른다. `RUN.bat` 더블클릭이 전부(추가 설치 없음, 파이썬 3.8+만 필요).
03 이 «부지 안 시설 배치» 라면 04 는 «그 길이 산을 지날 때의 **단면 그 자체**» 다 —
배치가 아니라 **단면 형상이 설계 기준에서 어떻게 결정되는가**를 다룬다.
산출은 DXF(실제 ARC/LINE 엔티티)·JSON 계약·CSV·검토보고서. 검증 게이트 9종 동봉.
사용법은 그림 10장이 든 `docs/사용자_설명서.html`, AI 어시스턴트용 지침은 `AI_GUIDE.md`.
**근거 등급을 문서에 명시한다** — R1 규칙은 원본 결과 60행 중 56행 일치, R2/R2′ 는 원본 산정식이
자료에 없어 재현하지 않고 새로 정의한 값, 판정 기준·부대공 배치는 잠정·가정이다.

### `05_terrain-alignment` — 지형·선형 GD 워크벤치 (Revit·Dynamo 불필요)

등고선 지형을 만들고, 그 위에서 도로의 **평면 + 종단** 선형을 GA 로 찾는다.
`RUN.bat` 더블클릭이 전부(서버·설치·파이썬 불필요). 03 이 «부지 안 시설 배치» 라면
05 는 «부지를 가로지르는 도로» 이고, 지형이 들어오면서 제약이 기하에서 **설계기준**으로 옮겨간다.
종단경사 ±8%(입력)·종단곡선 K·토공(절성토)·터널/교량 판정.
**부지·지형 모두 합성 샘플**이며 특정 시설을 나타내지 않는다. 상세는 폴더 안 `README.md`.

### `docs`

- `curriculum.md` — 12시간 커리큘럼
- `01_cad-prep.md` — CAD Data 변형 및 Dynamo 인식 (1일차 오전, **샘플 파일 없이 설명만**)
- `dyn-update-review.md` — 배치 dyn 업데이트 가능성 검토 (GD 결선·셔플 시드화 등 7항목)
- `blog-draft_web-workbench.md` — 블로그 초안 (미발행)

---

## 포함되지 않은 것 / Not included

- 집필 중인 교재 원고 — 비공개
- 실제 프로젝트 데이터 — 여기의 샘플은 전부 **교육용 자료**이며 특정 시설을 나타내지 않습니다

---

## 이 자료가 답하는 질문 / Questions this answers

- 다이나모로 CAD 도면 레이어를 어떻게 인식시키나
- 닫히지 않은 폴리라인을 어떻게 처리하나
- Rectangle(REC) 겹침을 어떻게 판정하나
- Generative Design 결과를 Revit 요소로 어떻게 되돌리나
- 대안 결과를 시트로 어떻게 자동 배치하나
- How do I get Generative Design results back into Revit as real elements
- How do I place study outputs onto sheets automatically

---

## 라이선스 / License

교육 자료는 [CC BY-NC 4.0](LICENSE). 상업적 재사용은 금지, 출처 표기 시 자유롭게 사용·수정 가능합니다.

## 문의 / Contact

WonHo Cho — Generative Designer · [WeeklyDynamo](https://weeklydynamo.blogspot.com/) · [LinkedIn](https://www.linkedin.com/in/weeklydynamo/)
