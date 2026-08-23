# 01 · 공간(시설) 배치 방법론 — REC 이동·회전·겹침

Rectangle(REC)을 기본 단위로 이동·회전·겹침을 익힙니다. 배치 로직의 토대이고, 강의 1일차 오후에 해당합니다.
Rectangle as the primitive: translation, rotation, and overlap detection.

## 파일 — 세 단계로 이어집니다

| 파일 | 노드 | 무엇이 늘어났나 |
|---|---:|---|
| `SAMPLE 1.dyn` | 37 | 점에서 점으로의 이동 — Vector 로 표현되는 방향 |
| `SAMPLE 1-1.dyn` | 60 | 다중 이동과 회전 |
| `SAMPLE 1-1-1 겹침 제외.dyn` | 117 | **겹침 판정과 제외** |

같은 그래프를 단계별로 저장한 것이라 **순서대로 여는 것을 전제로 만들어져 있습니다.**
세 파일은 Dynamo 내부 Uuid 가 같습니다. 세 개를 동시에 열면 Dynamo 가 같은 그래프로 볼 수 있으니 하나씩 여세요.

## 다루는 것

- 점에서 점으로의 이동 — Dynamo 에서 방향은 Vector 로 표현되고, 시작점과 끝점을 Input 으로 연결합니다
- 단수 이동 → 다중 이동
- 회전
- 겹침 판정 (`Geometry.DoesIntersect`)

## 흔한 함정

- **list rank / list level** 을 틀리면 결과가 조용히 잘못 나옵니다. 형상이 나왔다고 맞는 것이 아닙니다
- 빈 브랜치와 null 이 섞이면 그 다음 노드가 통째로 실패합니다
- ㄱ·ㄴ·ㄷ 형태는 REC 로 먼저 근사한 뒤 나중에 변형하는 편이 실무적으로 빠릅니다
- 중복점이 남아 있으면 겹침 판정이 어긋납니다 (`Point.PruneDuplicates`)
