// engine.js — 배치·채점 엔진 (DOM 무의존; 브라우저 + node 양쪽에서 동작)
// 원본 사양: 2500726 정수장 python 최적화 v1.dyn (2026-08-24 그래프 판독)
//  - 후보점: 바닥면 파라미터 그리드 0..1..0.02 (51×51) → 대지경계 내부만
//  - 배치: 박스INDEX 순서 [0,1,2,3,4,8,7,6,5,10,9]로, 셔플된 후보점을 앞에서부터 시도,
//    대지경계 이탈·기배치 박스(+제외영역 오프셋)와 겹치지 않는 첫 점에 배치, 사용점 정리
//  - 평가: 연결쌍 중심간 거리 합(Length) × 단가 = Cost, 배치 수(Count)
// ★사양 이식 한계(정직 고지):
//  - Dynamo List.Shuffle은 시드가 없어 실행마다 결과가 다르다. 여기서는 슬라이더 값을
//    mulberry32 시드로 쓰는 결정적 셔플로 대체 — 같은 시드는 항상 같은 배치.
//  - Dynamo 실행값과의 수치 대조는 미실시 (사양 이식 게이트 ≠ 실행값 대조 게이트).

"use strict";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, seed) {
  const rnd = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 점-다각형 내부 판정 (ray casting)
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function segIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d === 0) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

function rectCorners(cx, cy, w, h) {
  const hw = w / 2, hh = h / 2;
  return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
}

// 사각형이 대지경계 안에 완전히 들어가는가: 4모서리 내부 + 경계선과 변 교차 없음
function rectInsideBoundary(cx, cy, w, h, boundary) {
  const cs = rectCorners(cx, cy, w, h);
  for (const c of cs) {
    if (!pointInPoly(c[0], c[1], boundary)) return false;
  }
  for (let i = 0; i < boundary.length; i++) {
    const b1 = boundary[i], b2 = boundary[(i + 1) % boundary.length];
    for (let k = 0; k < 4; k++) {
      if (segIntersect(cs[k], cs[(k + 1) % 4], b1, b2)) return false;
    }
  }
  return true;
}

// 축평행 사각형 겹침 (clearance = 제외영역 오프셋)
function rectsOverlap(a, b, clearance) {
  return !(a.cx + a.w / 2 + clearance <= b.cx - b.w / 2 ||
           b.cx + b.w / 2 + clearance <= a.cx - a.w / 2 ||
           a.cy + a.h / 2 + clearance <= b.cy - b.h / 2 ||
           b.cy + b.h / 2 + clearance <= a.cy - a.h / 2);
}

// 후보점 생성: 대지경계 bbox 위 n×n 파라미터 그리드 → 내부만 (dyn: 0..1..0.02 → 51)
function candidatePoints(boundary, n) {
  const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = minX + ((maxX - minX) * i) / (n - 1);
      const y = minY + ((maxY - minY) * j) / (n - 1);
      if (pointInPoly(x, y, boundary)) pts.push([x, y]);
    }
  }
  return pts;
}

// 메인: seeds[11] → 배치 결과
// opts: {gridN, clearance(mm), costRate(원/m)}
function runPlacement(data, seeds, opts) {
  const o = Object.assign({ gridN: 51, clearance: 10000, costRate: 1 }, opts || {});
  let avail = candidatePoints(data.boundary, o.gridN);
  const placed = [];   // {idx,label,name,color,cx,cy,w,h}
  const failed = [];
  data.placeOrder.forEach((boxIdx, k) => {
    const box = data.boxes[boxIdx];
    const tries = shuffled(avail, seeds[k] === undefined ? 0 : seeds[k] + k * 101);
    let ok = false;
    for (const p of tries) {
      const cand = { cx: p[0], cy: p[1], w: box.w, h: box.h };
      if (!rectInsideBoundary(cand.cx, cand.cy, cand.w, cand.h, data.boundary)) continue;
      if (placed.some((q) => rectsOverlap(cand, q, o.clearance))) continue;
      placed.push(Object.assign({ idx: box.idx, label: box.label, name: box.name, color: box.color }, cand));
      // 점 정리: 배치 박스(+제외영역) 안의 후보점 제거
      avail = avail.filter((q) =>
        !(Math.abs(q[0] - cand.cx) <= cand.w / 2 + o.clearance &&
          Math.abs(q[1] - cand.cy) <= cand.h / 2 + o.clearance));
      ok = true;
      break;
    }
    if (!ok) failed.push(box.label);
  });
  // 연결쌍 채점 — 시설번호 → 박스 라벨 매핑 (9,10,11은 한 박스)
  const byFacility = {};
  placed.forEach((p) => p.label.split(",").forEach((f) => { byFacility[f.trim()] = p; }));
  const links = [];
  let totalMm = 0;
  data.connections.forEach(([a, b]) => {
    const pa = byFacility[String(a)], pb = byFacility[String(b)];
    if (!pa || !pb) return;
    const L = Math.hypot(pa.cx - pb.cx, pa.cy - pb.cy);
    totalMm += L;
    links.push({ a: String(a), b: String(b), from: pa, to: pb, lenM: L / 1000 });
  });
  const lengthM = totalMm / 1000;
  return {
    placed, failed, links,
    count: placed.length,
    lengthM: Math.round(lengthM * 10) / 10,
    cost: Math.round(lengthM * o.costRate),
    seeds: seeds.slice(),
    opts: o,
  };
}

if (typeof module !== "undefined") {
  module.exports = { runPlacement, candidatePoints, shuffled, mulberry32, pointInPoly };
}
