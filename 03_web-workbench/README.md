# 03 · 웹 워크벤치 — 브라우저에서 돌리는 배치 스터디 / Web Workbench

`2500726 정수장 python 최적화 v1.dyn`(강의 2일차 응용 그래프의 발전형)의 배치 로직을
**Revit·Dynamo 없이 브라우저에서** 그대로 체험하는 교육용 도구입니다.

An interactive reproduction of the layout logic — run the placement study
**in a browser, no Revit / Dynamo required**.

## 실행 / Run

**`RUN.bat` 더블클릭.** 그게 전부입니다 — 서버·설치·인터넷 불필요(데이터는 `js/data.js`에 내장).
수동 실행: `index.html`을 브라우저로 열기.

받은 직후 점검(선택): `python tools/selfcheck.py` — 파일·스키마·RUN.bat 인코딩·엔진 결정성 4종.

## 무엇을 재현했나 / What is reproduced

| dyn 원본 | 워크벤치 |
|---|---|
| IntegerSlider 11개 (rec0~rec10) | 우측 시드 슬라이더 11개 (시설명 표기) |
| 바닥면 파라미터 그리드 `0..1..0.02` 후보점 | 후보점 그리드 N×N (기본 51) |
| 셔플 → 비겹침 첫 점 배치 → 점 정리 | 동일 (결정적 시드 셔플) |
| 제외영역 오프셋 (10~15) | 이격 파라미터 (기본 10 m) |
| 연결쌍 1-3 · 2-3 · 3-4 · 4-5 · 5-6 · 6-7 · 6-12 · 11-12 | 동일 — 중심 간 거리 합 |
| 출력: Count · Length & Cost | 동일 + 미배치 경고 |
| GD Randomize → Outcome 그리드·평행좌표 | 대안 생성 → 갤러리·평행좌표 |

시설 번호↔명칭은 AU 2025 발표 *Water Treatment Plant Design with Generative Design* 기준
([1] Intake Basin ~ [13] Management Facility, [9,10,11]은 한 박스).

## 정직 고지 — 원본과 다른 점 / Known deviations

1. **Dynamo `List.Shuffle`은 시드가 없다** → 원본은 실행마다 결과가 달라질 수 있으나,
   워크벤치는 슬라이더 값을 시드로 쓰는 **결정적 셔플**이다(같은 시드 = 항상 같은 배치).
   교육 도구로서는 이쪽이 낫다고 판단해 의도적으로 바꿨다. → `docs/dyn-update-review.md` 참조.
2. **후보점 생성은 근사** — 원본은 Revit 바닥 Surface의 파라미터 그리드, 여기서는 대지경계
   bbox 그리드 + 내부 필터. 바닥면 ≒ 대지경계이면 실질 동일하나 검증하지 않았다.
3. **비용 단가 미검증** — Length→Cost 환산 계수의 실값을 원본 자료에서 확인하지 못해
   기본 1(=길이가 곧 비용)로 두었다. 화면의 빨간 배지가 그 표시다.
4. **Dynamo 실행값과의 수치 대조 미실시** — 이 도구는 "사양 이식"이며 "실행값 동치성"은
   Revit에서 원본 그래프를 돌려 대조해야 닫힌다.

## 데이터 재생성 / Regenerating data

```
python tools/extract_cache.py "<Remember 캐시를 가진 dyn 경로>"
```

dyn의 `Data.Remember` 캐시(대지경계·박스 11·출입 2·참조점 4)를 직독해 `js/data.js`를 다시 만든다.
⚠ 캐시가 빈 dyn(예: 캐시를 지운 배포 사본)은 쓸 수 없다 — 스크립트가 FAIL로 알려준다.

## 파일 / Files

```
RUN.bat            실행 (ASCII·CRLF — 인코딩 함정 차단 확인됨)
index.html         화면
js/data.js         dyn 캐시 추출 데이터 (생성물)
js/engine.js       배치·채점 엔진 (DOM 무의존 — node로도 실행 가능)
js/app.js          UI·갤러리·평행좌표
tools/extract_cache.py   dyn → data.js
tools/selfcheck.py       오프라인 4종 자가검사
```
