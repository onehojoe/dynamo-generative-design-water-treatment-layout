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
//
// v0.4 추가 (아래 §UV / §METRICS):
//  - runPlacementUV: 시드 셔플 대신 UV 목표점 + 최근접 수복. 입력이 연속이 되어 GD 탐색이 성립한다.
//    ★UV는 새 좌표계가 아니다 — dyn의 후보점이 이미 바닥면 파라미터 0..1 그리드에서 나온다.
//      u = i/(n-1), v = j/(n-1) 로 candidatePoints 의 격자와 정확히 같은 점을 가리킨다.
//  - evaluate: O1~O4 목표와 C1~C6 제약을 한 번에 재는 공용 평가기(시드판·UV판 양쪽에서 호출).

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

// 두 축평행 사각형의 면-사이 최단거리(mm). 겹치면 0.
function rectGap(a, b) {
  const gx = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2;
  const gy = Math.abs(a.cy - b.cy) - (a.h + b.h) / 2;
  return Math.hypot(Math.max(0, gx), Math.max(0, gy));
}

// 선분이 사각형을 지나가는가 (끝점이 사각형 안인 경우 포함)
function segHitsRect(p1, p2, r) {
  const inR = (p) => Math.abs(p[0] - r.cx) <= r.w / 2 && Math.abs(p[1] - r.cy) <= r.h / 2;
  if (inR(p1) || inR(p2)) return true;
  const cs = rectCorners(r.cx, r.cy, r.w, r.h);
  for (let k = 0; k < 4; k++) {
    if (segIntersect(p1, p2, cs[k], cs[(k + 1) % 4])) return true;
  }
  return false;
}

function bboxOf(boundary) {
  const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

// 후보점 생성: 대지경계 bbox 위 n×n 파라미터 그리드 → 내부만 (dyn: 0..1..0.02 → 51)
function candidatePoints(boundary, n) {
  const b = bboxOf(boundary);
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / (n - 1);
      const y = b.minY + ((b.maxY - b.minY) * j) / (n - 1);
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
      placed.push(Object.assign({ idx: box.idx, label: box.label, name: box.name, color: box.color, rot: 0 }, cand));
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
    mode: "seed",
    opts: o,
  };
}

// ═══════════════════════════════════════════════════════════════
// §UV — UV 입력 + 최근접 수복 (v0.4)
// ═══════════════════════════════════════════════════════════════
//
// 왜 바꾸나: 시드는 불연속이다. 59와 60의 배치가 완전히 다르다 → 교배·변이가 의미를 잃어
// GD가 사실상 랜덤 탐색이 된다. UV는 "이 시설을 여기쯤 두고 싶다"는 연속 좌표라
// 작은 변화가 작은 이동을 낳는다.
//
// 무효해 처리 = 최근접 수복(B안): 목표점이 못 쓰는 자리면 가장 가까운 유효점으로 밀어넣는다.
//   - 페널티(A안)는 파레토를 무효해로 오염시키고, 하드 리젝(C안)은 세대를 낭비한다.
// ★"수복이면 항상 유효해"는 사실이 아니다(계획 문서의 최초 표현을 여기서 정정한다).
//   배치는 고정 순서 그리디라, 앞의 10개가 자리를 차지하고 나면 마지막 큰 시설이
//   **앉을 자리가 하나도 없는** 경우가 실제로 생긴다 — 무작위 500건 중 10건, 전부 [13] 관리동
//   (60.6×40.5m). 전 격자 전수 스캔으로 '가능한 자리 0'임을 확인했으므로 엔진 결함이 아니라
//   기하학적 불가능이다. 이 경우 미배치로 남고 C1에 걸려 실격 처리된다.
// 탐색은 격자 위 나선(spiral)으로 한다. 전체 정렬(O(n log n))보다 훨씬 싸다.

// 격자: candidatePoints 와 같은 매핑. u = i/(n-1), v = j/(n-1)
function buildGrid(boundary, n) {
  const b = bboxOf(boundary);
  const dx = (b.maxX - b.minX) / (n - 1), dy = (b.maxY - b.minY) / (n - 1);
  const inside = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      inside[i * n + j] = pointInPoly(b.minX + dx * i, b.minY + dy * j, boundary) ? 1 : 0;
    }
  }
  return { n, dx, dy, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, inside };
}

// (ci,cj)에서 체비셰프 거리 r 인 격자칸들 — 실제 유클리드 거리 순으로 정렬해 돌려준다
function ringCells(ci, cj, r, n) {
  const out = [];
  const push = (i, j) => { if (i >= 0 && j >= 0 && i < n && j < n) out.push([i, j]); };
  if (r === 0) { push(ci, cj); return out; }
  for (let i = ci - r; i <= ci + r; i++) { push(i, cj - r); push(i, cj + r); }
  for (let j = cj - r + 1; j <= cj + r - 1; j++) { push(ci - r, j); push(ci + r, j); }
  out.sort((p, q) => {
    const dp = (p[0] - ci) * (p[0] - ci) + (p[1] - cj) * (p[1] - cj);
    const dq = (q[0] - ci) * (q[0] - ci) + (q[1] - cj) * (q[1] - cj);
    return dp - dq;
  });
  return out;
}

// uvs = [{u,v,rot}] × 11 (placeOrder 순서)
// opts: {gridN, clearance, costRate, allowRotate}
function runPlacementUV(data, uvs, opts) {
  const o = Object.assign({ gridN: 51, clearance: 10000, costRate: 1, allowRotate: false }, opts || {});
  const G = buildGrid(data.boundary, o.gridN);
  const avail = Uint8Array.from(G.inside);
  const placed = [], failed = [], repairs = [];

  data.placeOrder.forEach((boxIdx, k) => {
    const box = data.boxes[boxIdx];
    const g = uvs[k] || { u: 0.5, v: 0.5, rot: 0 };
    const u = Math.min(1, Math.max(0, g.u)), vv = Math.min(1, Math.max(0, g.v));
    const rot = o.allowRotate && g.rot ? 1 : 0;
    const w = rot ? box.h : box.w, h = rot ? box.w : box.h;
    const ci = Math.round(u * (G.n - 1)), cj = Math.round(vv * (G.n - 1));
    let ok = false;
    // 2단 탐색: ① 남은 후보칸에서 나선 탐색(빠름, dyn의 '사용점 정리'를 그대로 따름)
    //           ② 못 앉으면 소거 마스크를 무시하고 전 격자를 다시 훑는다.
    //   마스크는 '중심이 박스+이격 안'인 칸만 지우는 근사이므로, 마스크가 앉을 수 있는 자리를
    //   먼저 지워 버릴 여지가 원리상 있다. ②는 그 여지를 막는 백스톱이다.
    //   ※정직: 무작위 500건 실측에서 ②가 ①을 구제한 사례는 0건이었다(마스크는 한 번도 병목이 아니었다).
    //     그래도 남겨 둔다 — 이게 있어야 "미배치 = 진짜 불가능"이 구조적으로 성립한다(게이트가 이걸 검사).
    for (let pass = 0; pass < 2 && !ok; pass++) {
    for (let r = 0; r < 2 * G.n && !ok; r++) {
      const cells = ringCells(ci, cj, r, G.n);
      for (const [i, j] of cells) {
        if (pass === 0 ? !avail[i * G.n + j] : !G.inside[i * G.n + j]) continue;
        const cx = G.minX + G.dx * i, cy = G.minY + G.dy * j;
        const cand = { cx, cy, w, h };
        if (!rectInsideBoundary(cx, cy, w, h, data.boundary)) continue;
        if (placed.some((q) => rectsOverlap(cand, q, o.clearance))) continue;
        placed.push(Object.assign({ idx: box.idx, label: box.label, name: box.name, color: box.color, rot },
          cand, { u: i / (G.n - 1), v: j / (G.n - 1) }));
        // 수복 거리: 원하던 자리에서 얼마나 밀렸나 (추론 패널이 이걸 읽는다)
        const tx = G.minX + G.dx * ci, ty = G.minY + G.dy * cj;
        repairs.push({ label: box.label, movedM: Math.hypot(cx - tx, cy - ty) / 1000, ring: r, pass });
        // 사용점 정리: 배치 박스(+제외영역)를 덮는 격자칸 제거 (시드판의 filter와 같은 조건)
        const i0 = Math.max(0, Math.ceil((cx - w / 2 - o.clearance - G.minX) / G.dx));
        const i1 = Math.min(G.n - 1, Math.floor((cx + w / 2 + o.clearance - G.minX) / G.dx));
        const j0 = Math.max(0, Math.ceil((cy - h / 2 - o.clearance - G.minY) / G.dy));
        const j1 = Math.min(G.n - 1, Math.floor((cy + h / 2 + o.clearance - G.minY) / G.dy));
        for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) avail[a * G.n + b] = 0;
        ok = true;
        break;
      }
    }
    }
    if (!ok) { failed.push(box.label); repairs.push({ label: box.label, movedM: null, ring: -1 }); }
  });

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
    placed, failed, links, repairs,
    count: placed.length,
    lengthM: Math.round(lengthM * 10) / 10,
    cost: Math.round(lengthM * o.costRate),
    uvs: uvs.map((g) => ({ u: g.u, v: g.v, rot: g.rot ? 1 : 0 })),
    mode: "uv",
    opts: o,
  };
}

// 시드 배치 결과 → 같은 배치를 내는 UV 벡터 (모드 전환 시 화면이 튀지 않게)
function uvFromResult(data, result) {
  const b = bboxOf(data.boundary);
  const byIdx = {};
  result.placed.forEach((p) => { byIdx[p.idx] = p; });
  return data.placeOrder.map((boxIdx) => {
    const p = byIdx[boxIdx];
    if (!p) return { u: 0.5, v: 0.5, rot: 0 };
    return {
      u: (p.cx - b.minX) / (b.maxX - b.minX),
      v: (p.cy - b.minY) / (b.maxY - b.minY),
      rot: p.rot || 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// §METRICS — 목표 O1~O4 · 제약 C1~C6 (v0.4). 시드판·UV판 공용.
// ═══════════════════════════════════════════════════════════════

// 점유격자 위 최대 빈 축평행 사각형 (히스토그램 최대사각형, O(n·m))
// R8 계열 증설: 남는 땅은 "면적"이 아니라 "한 덩어리"여야 쓸 수 있다.
function largestEmptyRect(boundary, placed, margin, n) {
  const b = bboxOf(boundary);
  const dx = (b.maxX - b.minX) / n, dy = (b.maxY - b.minY) / n;
  const free = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    const x = b.minX + dx * (i + 0.5);
    for (let j = 0; j < n; j++) {
      const y = b.minY + dy * (j + 0.5);
      if (!pointInPoly(x, y, boundary)) continue;
      let hit = false;
      for (const p of placed) {
        if (Math.abs(x - p.cx) <= p.w / 2 + margin && Math.abs(y - p.cy) <= p.h / 2 + margin) { hit = true; break; }
      }
      if (!hit) free[i * n + j] = 1;
    }
  }
  // j를 행, i를 열로 보고 행마다 히스토그램을 쌓는다
  const heights = new Int32Array(n);
  let best = { cells: 0, i0: 0, i1: 0, j0: 0, j1: 0 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) heights[i] = free[i * n + j] ? heights[i] + 1 : 0;
    const stack = [];
    for (let i = 0; i <= n; i++) {
      const cur = i === n ? 0 : heights[i];
      while (stack.length && heights[stack[stack.length - 1]] >= cur) {
        const top = stack.pop();
        const h = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const cells = h * (i - left);
        if (cells > best.cells) best = { cells, i0: left, i1: i - 1, j0: j - h + 1, j1: j };
      }
      stack.push(i);
    }
  }
  if (!best.cells) return { areaM2: 0, wM: 0, hM: 0, rect: null };
  const rect = {
    x0: b.minX + dx * best.i0, x1: b.minX + dx * (best.i1 + 1),
    y0: b.minY + dy * best.j0, y1: b.minY + dy * (best.j1 + 1),
  };
  const wM = (rect.x1 - rect.x0) / 1000, hM = (rect.y1 - rect.y0) / 1000;
  return { areaM2: Math.round(wM * hM), wM: Math.round(wM), hM: Math.round(hM), rect };
}

// 평가 본체
// net  = {links:[{id,a,b,system}], systems:{}, access:[], mainline:[], hazard:[]}
// opts = {clearance, measure:'center'|'edge', expGridN, hazardMinM}
function evaluate(data, net, result, opts) {
  const o = Object.assign({ clearance: 10000, measure: "center", expGridN: 64, hazardMinM: null }, opts || {});
  const placed = result.placed;
  const byFac = {};
  placed.forEach((p) => p.label.split(",").forEach((f) => { byFac[f.trim()] = p; }));

  // ── O1 가중 관로연장 ──
  const links = [];
  let rawM = 0, o1 = 0, mainM = 0;
  const bySystem = {};
  net.links.forEach((L) => {
    const pa = byFac[L.a], pb = byFac[L.b];
    if (!pa || !pb) { links.push(Object.assign({}, L, { missing: true, lenM: 0, wLenM: 0 })); return; }
    const centerM = Math.hypot(pa.cx - pb.cx, pa.cy - pb.cy) / 1000;
    const edgeM = rectGap(pa, pb) / 1000;
    const lenM = o.measure === "edge" ? edgeM : centerM;
    const sys = net.systems[L.system] || { weight: 1, name: L.system };
    const wLenM = lenM * sys.weight;
    rawM += lenM; o1 += wLenM;
    if (L.system === "main") mainM += lenM;
    bySystem[L.system] = (bySystem[L.system] || 0) + wLenM;
    links.push(Object.assign({}, L, {
      from: pa, to: pb, lenM, centerM, edgeM, wLenM, weight: sys.weight, missing: false,
    }));
  });

  // ── O2 가중 관로교차 ──
  const crossings = [];
  let o2 = 0;
  const live = links.filter((l) => !l.missing);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j];
      if (A.from === B.from || A.from === B.to || A.to === B.from || A.to === B.to) continue; // 끝점 공유는 교차가 아니다
      if (segIntersect([A.from.cx, A.from.cy], [A.to.cx, A.to.cy], [B.from.cx, B.from.cy], [B.to.cx, B.to.cy])) {
        const w = A.weight * B.weight;
        crossings.push({ a: A.id, b: B.id, w: Math.round(w * 100) / 100, aSys: A.system, bSys: B.system });
        o2 += w;
      }
    }
  }
  o2 = Math.round(o2 * 100) / 100;

  // ── O3 증설 여지 ──
  const exp = largestEmptyRect(data.boundary, placed, o.clearance, o.expGridN);

  // ── O4 반출·관리 동선 ──
  const access = [];
  let o4 = 0;
  (net.access || []).forEach((A) => {
    const p = byFac[A.facility];
    if (!p || !data.entries.length) { access.push(Object.assign({}, A, { missing: true, totalM: 0 })); return; }
    let bestE = null, bestD = Infinity;
    data.entries.forEach((e, ei) => {
      const d = Math.hypot(p.cx - e.cx, p.cy - e.cy);
      if (d < bestD) { bestD = d; bestE = { e, ei }; }
    });
    const straightM = bestD / 1000;
    // 관통 우회는 근사다: 관통한 박스마다 (w+h)/4 를 더한다. 실제 도로 우회 계산이 아니다.
    const pierced = [];
    let detourM = 0;
    placed.forEach((q) => {
      if (q === p) return;
      if (segHitsRect([p.cx, p.cy], [bestE.e.cx, bestE.e.cy], q)) {
        pierced.push(q.label);
        detourM += (q.w + q.h) / 4 / 1000;
      }
    });
    const totalM = straightM + detourM;
    o4 += totalM;
    access.push(Object.assign({}, A, {
      missing: false, from: p, entry: bestE.e, entryIdx: bestE.ei,
      straightM, detourM, pierced, totalM,
    }));
  });

  // ── C5 자연유하 역행 ──
  const ml = (net.mainline || []).map((f) => byFac[f]).filter(Boolean);
  const reverse = [];
  let axis = null;
  if (ml.length >= 2) {
    const a = ml[0], b = ml[ml.length - 1];
    const L = Math.hypot(b.cx - a.cx, b.cy - a.cy);
    if (L > 0) {
      axis = [(b.cx - a.cx) / L, (b.cy - a.cy) / L];
      links.filter((l) => !l.missing && l.system === "main").forEach((l) => {
        const proj = ((l.to.cx - l.from.cx) * axis[0] + (l.to.cy - l.from.cy) * axis[1]) / 1000;
        if (proj < 0) reverse.push({ id: l.id, a: l.a, b: l.b, projM: Math.round(proj) });
      });
    }
  }

  // ── C2/C3/C4 이격·겹침 ──
  let minGapM = Infinity, overlaps = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const g = rectGap(placed[i], placed[j]) / 1000;
      if (g <= 0) overlaps++;
      if (g < minGapM) minGapM = g;
    }
  }
  if (!isFinite(minGapM)) minGapM = 0;
  const outside = placed.filter((p) => !rectInsideBoundary(p.cx, p.cy, p.w, p.h, data.boundary)).length;

  // ── C6 안전이격 ──
  const hazard = (net.hazard || []).map((H) => {
    const pa = byFac[H.a], pb = byFac[H.b];
    const gapM = pa && pb ? rectGap(pa, pb) / 1000 : null;
    const ok = o.hazardMinM == null || gapM == null ? null : gapM >= o.hazardMinM;
    return Object.assign({}, H, { gapM: gapM == null ? null : Math.round(gapM), ok });
  });

  return {
    links, crossings, access, reverse, hazard, exp,
    o1: Math.round(o1 * 10) / 10,
    o2,
    o3: exp.areaM2,
    o4: Math.round(o4 * 10) / 10,
    rawLengthM: Math.round(rawM * 10) / 10,
    mainLengthM: Math.round(mainM * 10) / 10,
    bySystem,
    count: placed.length,
    failed: result.failed.slice(),
    overlaps, outside,
    minGapM: Math.round(minGapM * 10) / 10,
    reverseCount: reverse.length,
    measure: o.measure,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    runPlacement, runPlacementUV, uvFromResult, evaluate, largestEmptyRect,
    candidatePoints, buildGrid, ringCells, shuffled, mulberry32,
    pointInPoly, segIntersect, rectsOverlap, rectInsideBoundary, rectGap, segHitsRect, bboxOf,
  };
}
