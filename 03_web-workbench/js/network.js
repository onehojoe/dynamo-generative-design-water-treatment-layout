// network.js — 수처리 계통 연결망 v2 (v0.4 신설)
//
// data.js 의 connections(8쌍)는 dyn 원본 그대로 보존한다. 이 파일은 그것을 대체하지 않고
// "계통 지식으로 재구성한 연결망"을 따로 담는다. 화면에서 둘 중 하나를 골라 쓴다.
//
// ★근거와 가정을 구분해 적는다. note 의 [dyn]/[PPT]/[계통] 표기가 그 등급이다.
//   [dyn]  = 원본 그래프의 연결쌍에 실재
//   [PPT]  = AU2025 발표자료 Rule01~04 에 실재
//   [계통] = 정수장 공정상 반드시 존재하나 두 자료 어디에도 없어 v0.4에서 추가 (가정)
//
// 판독한 계열: 후처리형 고도정수처리
//   원수 → [1]착수정 → [2]혼화지 → [3]침전지 → [4]급속여과지 → [5]오존접촉조
//        → [6]활성탄흡착지 → [7]정수지 → 송수(부지 외)
"use strict";

// ── 계통별 상대가중 ─────────────────────────────────────────────
// ★미검증 가정. 관경·유량 위계를 반영한 상대값이며 실단가가 아니다.
//   본류는 전량 통수 대구경, 슬러지는 소량 소구경이라 같은 1m가 같은 값이 아니다.
//   실단가 입수 시 weight 만 교체하면 된다.
const WTP_SYSTEMS = {
  main:     { key: "main",     name: "본류(정수계통)", weight: 1.00, color: "#1668c1", dash: [] },
  backwash: { key: "backwash", name: "역세척",         weight: 0.45, color: "#8a4fbf", dash: [11, 5] },
  effluent: { key: "effluent", name: "배출수",         weight: 0.40, color: "#c98a00", dash: [7, 4] },
  ret:      { key: "ret",      name: "반송",           weight: 0.35, color: "#2a8f6f", dash: [9, 3, 2, 3] },
  sludge:   { key: "sludge",   name: "슬러지",         weight: 0.30, color: "#8b5a2b", dash: [3, 3] },
};

// ── 연결망 v2 (L1~L12) ─────────────────────────────────────────
const WTP_NETWORK = [
  { id: "L1",  a: "1",  b: "2",  system: "main",     note: "착수정→혼화지 [계통] dyn은 1-3으로 되어 있어 혼화지를 건너뛴다(오기 추정)" },
  { id: "L2",  a: "2",  b: "3",  system: "main",     note: "혼화지→침전지 [dyn][PPT]" },
  { id: "L3",  a: "3",  b: "4",  system: "main",     note: "침전지→급속여과지 [dyn][PPT]" },
  { id: "L4",  a: "4",  b: "5",  system: "main",     note: "여과지→오존접촉조 [dyn]" },
  { id: "L5",  a: "5",  b: "6",  system: "main",     note: "오존→활성탄흡착지 [dyn][PPT]" },
  { id: "L6",  a: "6",  b: "7",  system: "main",     note: "활성탄→정수지 [dyn][PPT]" },
  { id: "L7",  a: "7",  b: "8",  system: "backwash", note: "정수지→역세척펌프장 [계통] 역세용수는 정수지에서 취한다" },
  { id: "L8",  a: "8",  b: "4",  system: "backwash", note: "역세척펌프장→여과지 [계통] 이 두 링크가 [8]을 채점에 참여시킨다" },
  { id: "L9",  a: "4",  b: "9",  system: "effluent", note: "여과지 역세배출수→배출수지 [PPT]" },
  { id: "L10", a: "3",  b: "10", system: "sludge",   note: "침전슬러지→배슬러지지 [PPT]" },
  { id: "L11", a: "11", b: "12", system: "sludge",   note: "농축조→탈수시설 [dyn]" },
  { id: "L12", a: "9",  b: "1",  system: "ret",      note: "배출수지 상징수→착수정 반송 [계통]" },
];

// ── 차량 동선 (D1·D2) ──────────────────────────────────────────
// 관로가 아니라 도로다. O4 로 따로 잰다.
const WTP_ACCESS = [
  { id: "D1", facility: "12", label: "케이크 반출", note: "탈수 케이크는 덤프트럭 반출 — 정문까지 짧고 본류를 관통하지 않아야 한다" },
  { id: "D2", facility: "13", label: "직원·방문",   note: "관리동 동선. [13]을 채점에 참여시킨다" },
];

// ── 본류 순서 (자연유하 역행 검사용) ─────────────────────────────
// 정수장 본류는 무동력 중력흐름이 원칙(착수정이 가장 높고 정수지가 가장 낮다).
// 표고 데이터가 없으므로 [1]→[7] 주축에 대한 링크 투영으로 대리 측정한다.
const WTP_MAINLINE = ["1", "2", "3", "4", "5", "6", "7"];

// ── 안전이격 쌍 ────────────────────────────────────────────────
// ★임계값은 규정 원문 미확인. 화면에서 사용자가 넣는다(기본 미설정 = 검사 안 함).
const WTP_HAZARD = [
  { a: "5", b: "13", label: "오존접촉조 ↔ 관리동", why: "오존발생설비 누출 위험 — 상시 체류시설과 이격" },
];

// ── dyn 원본 8쌍 (대조용) ───────────────────────────────────────
// data.js 의 connections 를 그대로 쓰되, 계통 태그가 없으므로 전부 main 취급한다.
function dynNetwork(data) {
  return data.connections.map((c, i) => ({
    id: `D${i + 1}`, a: String(c[0]), b: String(c[1]), system: "main",
    note: "dyn 원본 연결쌍",
  }));
}

if (typeof module !== "undefined") {
  module.exports = { WTP_SYSTEMS, WTP_NETWORK, WTP_ACCESS, WTP_MAINLINE, WTP_HAZARD, dynNetwork };
}
