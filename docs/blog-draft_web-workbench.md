# [블로그 초안] Dynamo 그래프를 브라우저로 옮기면 무엇이 보이나 — 정수장 배치 워크벤치

> 상태: **초안 v1 (2026-08-24, 미발행)** — WeeklyDynamo 게재용, 영한병기.
> 발행 전 확인: ①실 프로젝트 명칭 익명화 유지 ②AU 클래스 링크 삽입 ③리포 공개 후 링크 교체.

---

정수처리시설 배치를 Generative Design으로 푸는 Dynamo 그래프가 있다.
대지경계 안에 시설 박스 11개를 겹치지 않게 놓고, 공정 연결 거리를 비용으로 환산해
대안을 고르는 구조다. AU 2025에서 발표한 그 워크플로다.

There is a Dynamo graph that solves water-treatment-plant layout with Generative
Design: place 11 facility boxes inside a site boundary without overlaps, convert
process-connection distances into cost, and pick an alternative — the workflow
we presented at AU 2025.

이번에 그 그래프를 **브라우저로 옮겼다.** Revit도 Dynamo도 필요 없다.
`RUN.bat`을 더블클릭하면 끝이다. 왜 이런 짓을 했는가.

This time we ported that graph **to the browser**. No Revit, no Dynamo —
double-click `RUN.bat` and you are in. Why bother?

## 1. 데이터는 이미 dyn 안에 있었다 / The data was already inside the .dyn

Dynamo의 `Data.Remember` 노드는 업스트림 결과를 그래프 파일 안에 캐시로 저장한다.
이 그래프에는 캐시 4개가 있었고, 열어 보니 **대지경계 폴리라인, 시설 박스 11개,
출입구 원 2개가 좌표 JSON 그대로** 들어 있었다. Revit 모델을 열지 않고도
파이썬 몇 줄로 전부 꺼낼 수 있었다.

Dynamo's `Data.Remember` node caches upstream results inside the graph file
itself. This graph carried four caches — and inside them sat the site boundary
polyline, all 11 facility boxes, and two entry circles **as plain coordinate
JSON**. A few lines of Python extracted everything, no Revit session required.

교훈: 그래프 파일은 로직만이 아니라 데이터의 운반체이기도 하다.
캐시를 지운 배포 사본은 이 성질을 잃는다 — 실제로 같은 그래프의 다른 저장본은
캐시가 비어 있어 쓸 수 없었다.

Lesson: a graph file carries data, not just logic. A copy saved with cleared
caches loses this property — another saved copy of the same graph had empty
caches and was useless for extraction.

## 2. 로직은 200줄이면 충분했다 / The logic fit in ~200 lines

그래프는 354노드지만, 배치 로직의 뼈대는 이것뿐이다:

The graph has 354 nodes, but the skeleton of the placement logic is just:

1. 대지 안에 후보점 그리드를 깐다 (원본: 51×51 파라미터 그리드)
2. 시설마다 후보점을 셔플하고, 경계를 벗어나지 않고 기존 배치와 겹치지 않는
   **첫 번째 점**에 놓는다
3. 쓴 점과 막힌 점을 지우고 다음 시설로
4. 공정 연결쌍(취수→혼화→침전 …)의 중심 간 거리 합 = Length & Cost

11번 반복되는 노드 뭉치가 자바스크립트 함수 하나가 된다. 노드 수는 로직의
복잡도가 아니라 **복사-붙여넣기의 횟수**였다.

The eleven copy-pasted node clusters collapse into one JavaScript function.
Node count measured **paste operations, not logical complexity**.

## 3. 옮기다 발견한 것 — Shuffle에는 시드가 없다 / Found in translation

이식 중 가장 중요한 발견은 버그도 기법도 아니고 **재현성**이었다.
Dynamo의 `List.Shuffle`은 시드를 받지 않는다. 같은 슬라이더 값으로 두 번 돌리면
다른 배치가 나올 수 있다는 뜻이다. Generative Design 솔버 입장에서는
"같은 입력 = 같은 출력"이 깨진 문제 공간을 탐색하는 셈이다.

The most important find was neither a bug nor a trick — it was
**reproducibility**. Dynamo's `List.Shuffle` takes no seed: the same slider
values can produce different layouts on different runs. For a Generative Design
solver, that means exploring a space where "same input = same output" does not
hold.

워크벤치에서는 슬라이더 값을 난수 시드로 쓰는 결정적 셔플로 바꿨다.
같은 시드는 언제나 같은 배치를 낸다. 원본 그래프에도 같은 교정을 권고했다
(리포의 `docs/dyn-update-review.md`).

The workbench replaces it with a deterministic shuffle seeded by the slider
value: same seed, same layout, every time. We recommend the same fix for the
original graph (see `docs/dyn-update-review.md` in the repo).

## 4. 브라우저에서 GD 화면을 재현하다 / Reproducing the GD screens

Generative Design의 매력 절반은 Outcome 그리드다 — 대안 수십 개를 썸네일로
훑고, 평행좌표에서 걸러내는 그 화면. 워크벤치는 같은 화면을 캔버스 2개로
재현했다: 대안 30개 생성 → 갤러리 정렬(Count↓ · Cost↑) → 클릭하면 해당
시드가 슬라이더로 로드되고 평행좌표에 빨간 선으로 뜬다.

Half the appeal of Generative Design is the outcome grid — browsing dozens of
alternatives as thumbnails, filtering on parallel coordinates. The workbench
reproduces both with two canvases: generate 30 alternatives → sorted gallery →
click one and its seeds load into the sliders, highlighted red on the parallel
coordinates.

솔버는 없다. 무작위 시드 + 정렬뿐이다. 그런데 교육 현장에서는 이게 오히려
낫다 — "Randomize가 하는 일"의 최소 골격이 그대로 보이기 때문이다.

There is no solver — just random seeds and sorting. For teaching, that is
arguably better: it exposes the bare skeleton of what "Randomize" does.

## 5. 무엇을 검증했고 무엇은 안 했나 / What is verified, what is not

- 검증한 것: 같은 시드 → 같은 배치(브라우저·node 양쪽 1,402m 일치),
  전체 버튼·갤러리·정렬 동작, RUN.bat 인코딩(ASCII·CRLF).
- **하지 않은 것**: Dynamo 실행값과의 수치 대조(사양 이식 ≠ 실행값 동치),
  비용 단가의 실값(화면에 "미검증" 배지로 표시).

Verified: same seed → same layout (browser and node both report 1,402 m), every
button and gallery interaction, RUN.bat encoding. **Not verified**: numeric
equivalence against an actual Dynamo run, and the real cost rate (flagged
"unverified" in the UI).

안 한 것을 안 했다고 쓰는 것까지가 도구의 일부라고 생각한다.

Stating what was *not* done is part of the tool.

---

*자료는 교육용 샘플이며 특정 시설을 나타내지 않습니다. 리포: (공개 후 링크)*
*Samples are for training and do not represent any actual facility. Repo: (link after publishing)*
