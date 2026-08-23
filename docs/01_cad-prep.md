# 01 · CAD Data 변형 및 Dynamo 인식

CAD 도면을 Dynamo가 읽을 수 있는 데이터로 바꾸는 단계. 대지 경계와 시설물 정보를 정리한다.
Turning a CAD drawing into data Dynamo can read: site boundary and facility information.

## 다루는 것

- DWG/DXF 가져오기와 레이어 필터링
- 닫히지 않은 폴리라인 판별과 보정
- 대지 경계 추출, 시설물 외곽선 추출
- 좌표계·단위 정합

## 흔한 함정

- 레이어 이름 규칙이 문서화돼 있지 않은 도면이 대부분이다. 이름이 아니라 **속성으로 거르는 경로**를 항상 함께 만든다
- 육안으로 닫혀 보이는 폴리라인이 실제로는 열려 있다. 반드시 기계로 검사한다
- 단위 변환을 마지막에 하면 이미 늦다

## 파일

*(샘플 파일 추가 예정)*
