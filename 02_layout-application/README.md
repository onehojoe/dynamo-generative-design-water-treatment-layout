# 02 · 공간(시설) 배치 응용 — Generative Design 연결부터 시트까지

`시설 배치 관련 v2.dyn` (노드 142개, GenerativeDesign 패키지 6.1.1.0 의존) 한 그래프에
아래 다섯 단계가 이어져 있습니다. 강의 2일차 전체에 해당합니다.

---

## 03 · Dynamo → Generative Design 연결 원리

배치 그래프를 Generative Design 스터디로 바꾸는 단계.
Turning a layout graph into a Generative Design study.

### 다루는 것

- Input / Output 노드 선언
- 솔버가 실제로 변화시킬 수 있는 형태로 파라미터 정리
- 스터디 실행과 결과 확인

### 흔한 함정

- Input 으로 선언하지 않은 값은 아무리 중요해도 탐색되지 않는다
- Output 이 수치가 아니면 비교가 불가능하다
- 그래프가 한 번이라도 실패하면 스터디 전체가 멈춘다. 예외 입력으로 먼저 돌려본다

---

## 04 · 배치 기준 및 배치 규칙 고도화

대안 생성 룰을 실무 수준으로 끌어올린다.
Refining placement criteria and rules toward practical quality.

### 다루는 것

- 배치 기준 추가 1 · 2
- 규칙 간 충돌 해소
- 만족 불가능한 제약 판별

### 흔한 함정

- 생성기가 만족시킬 방법이 없는 제약을 쓰는 것이 가장 흔한 실패다. 제약을 쓰기 전에 **그 제약을 만족하는 배치가 존재하는지** 먼저 확인한다
- 규칙을 한꺼번에 넣으면 어느 규칙이 결과를 지배하는지 알 수 없다. 하나씩 넣고 확인한다

---

## 05 · 출력 설정 — 판단 기준

무엇을 좋은 배치로 볼 것인지 정의한다.
Defining what counts as a better layout.

### 다루는 것

- 목적함수 설정
- 제약 설정
- 판단 기준의 수치화

### 흔한 함정

- 대안을 만드는 것은 쉬운 쪽이고, 어느 대안이 나은지 정하는 쪽이 어렵다
- 목적이 서로 상충하면 파레토 관점으로 봐야 한다. 하나의 점수로 합치면 정보가 사라진다

---

## 06 · 대안 생성 및 Revit 요소 검토

선택한 대안을 실제 Revit 요소로 되돌린다.
Converting a chosen alternative back into real Revit elements.

### 다루는 것

- 대안 선택
- Revit 요소 작성
- 결과물 관리

### 흔한 함정

- 트랜잭션 경계를 잘못 잡으면 일부만 생성되고 나머지가 사라진다
- 유효하지 않은 형상이 하나 섞이면 전체 생성이 중단된다. 생성 전에 걸러낸다
- 링크 모델 좌표 변환을 빠뜨리면 요소가 엉뚱한 곳에 생긴다

---

## 07 · 출력 Sheet 구성

결과 대안을 도면 시트로 정리한다. 여기까지 가야 산출물이다.
Assembling alternatives onto sheets. Without this it stays a demonstration.

### 다루는 것

- 뷰 생성과 배치
- 시트 구성 자동화
- 대안별 비교 시트

### 흔한 함정

- Generative Design 창 안에서 끝난 스터디는 납품물이 아니다
- 대형 모델에서는 뷰 생성이 성능 병목이 된다. 생성 개수를 먼저 가늠한다
