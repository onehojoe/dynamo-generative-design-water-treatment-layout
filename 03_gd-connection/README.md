# 03 · Dynamo → Generative Design 연결 원리

배치 그래프를 Generative Design 스터디로 바꾸는 단계.
Turning a layout graph into a Generative Design study.

## 다루는 것

- Input / Output 노드 선언
- 솔버가 실제로 변화시킬 수 있는 형태로 파라미터 정리
- 스터디 실행과 결과 확인

## 흔한 함정

- Input 으로 선언하지 않은 값은 아무리 중요해도 탐색되지 않는다
- Output 이 수치가 아니면 비교가 불가능하다
- 그래프가 한 번이라도 실패하면 스터디 전체가 멈춘다. 예외 입력으로 먼저 돌려본다

## 파일

*(샘플 파일 추가 예정)*
