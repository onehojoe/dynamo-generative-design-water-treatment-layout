# 02 · 공간·시설물 REC 이동

Rectangle(REC)을 기본 단위로 이동·회전·겹침을 익힌다. 배치 로직의 토대.
Rectangle as the primitive: translation, rotation, and overlap detection.

## 다루는 것

- 점에서 점으로의 이동 — Vector 로 표현되는 방향
- 단수 이동과 다중 이동
- 회전
- 겹침 판정

## 흔한 함정

- list rank / list level 을 틀리면 결과가 조용히 잘못 나온다. 형상이 나왔다고 맞는 것이 아니다
- 빈 브랜치와 null 이 섞이면 이후 노드가 통째로 실패한다
- ㄱ·ㄴ·ㄷ 형태는 REC 로 먼저 근사한 뒤 나중에 변형하는 편이 실무적으로 빠르다

## 파일

*(샘플 파일 추가 예정)*
