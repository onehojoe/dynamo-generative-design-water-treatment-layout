# Dynamo + Generative Design — Water Treatment Plant Layout / 수처리시설 배치 자동화

**Revit Dynamo와 Generative Design으로 수처리시설(정수장·하수처리장) 배치를 자동화하는 12시간 실무 교육 자료입니다.**
CAD 도면 정리부터 대안 생성, Revit 요소 변환, 출력 Sheet 구성까지 전 과정을 다룹니다.

Course materials for a 12-hour hands-on program: automating **water treatment plant layout**
with **Revit Dynamo** and **Generative Design**, from CAD data preparation through
alternative generation to Revit elements and drawing sheets.

> 📄 Blog write-up: *(발행 후 링크)*
> 🎥 Background — Autodesk University 2025, *Exploring the Dynamo Product Road Map and Vision for the Future* (27:30):
> https://www.autodesk.com/autodesk-university/class/Exploring-the-Dynamo-Product-Road-Map-and-Vision-for-the-Future-2025

---

## 무엇이 들어 있나 / What is here

| 폴더 | 주제 | Topic |
|---|---|---|
| `01_cad-prep` | CAD Data 변형 및 Dynamo 인식 — 대지·시설물 정보 정리 | CAD import, layer filtering, polyline closure |
| `02_layout-basics` | 공간·시설물 REC 이동 — 단수/다중 이동, 회전, 겹침 | Rectangle translation, rotation, overlap |
| `03_gd-connection` | Dynamo → Generative Design 연결 원리 | Inputs/outputs binding for the solver |
| `04_placement-rules` | 배치 기준 및 배치 규칙 고도화 | Placement criteria and rule refinement |
| `05_output-criteria` | 출력 설정 — 판단 기준 설정 | Objective and constraint definition |
| `06_revit-elements` | 대안 생성 및 Revit 요소 검토 | Converting alternatives into Revit elements |
| `07_sheets` | 출력 Sheet 구성 — 결과물 대안 Sheet | Assembling results onto sheets |

**포함되지 않은 것 / Not included**
- 집필 중인 교재 원고 (비공개)
- 실제 프로젝트 데이터 — 여기의 샘플은 전부 **교육용 합성 데이터**입니다

---

## 요구 환경 / Requirements

| | |
|---|---|
| Revit | *(버전 확정 후 기입)* |
| Dynamo for Revit | *(버전 확정 후 기입)* |
| Generative Design for Revit | 설치 필요 |

> `.dyn` 파일은 Dynamo 버전이 다르면 노드가 깨질 수 있습니다. 위 버전을 먼저 확인하세요.

---

## 시작하기 / Getting started

```
1. 이 저장소를 내려받는다 (Code → Download ZIP)
2. 01_cad-prep 부터 순서대로 연다
3. 각 폴더의 README.md 에 그 단계의 목표와 함정이 적혀 있다
```

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
