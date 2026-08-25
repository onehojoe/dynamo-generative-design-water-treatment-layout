/* alignment.js — 선형 모델
 *
 * [poly]   v7 재현. PI를 직선으로 연결(GD01 사양 그대로).
 * [arc]    PI마다 원곡선 삽입.
 * [spiral] 직선-완화곡선(클로소이드)-원곡선-완화곡선-직선. 실무 선형.
 *
 * ★ poly 모드의 PI 산출식은 v7 GD01과 문자 그대로 동일해야 한다:
 *     station_i = (i + u_i) / activePI
 *     offset_i  = (v_i - 0.5) * (widthM * scale)
 *     pi_i      = start + baseline*station_i + normal*offset_i
 *     normal    = (-axis.y, axis.x)
 */
(function (global) {
  'use strict';

  /* v7 GD01: PI 제어점 생성 */
  function piFrame(start, end, activePI, u, v, widthM, scale) {
    const bx = end[0] - start[0], by = end[1] - start[1];
    const baselineLen = Math.hypot(bx, by);
    const ax = baselineLen > 1e-9 ? bx / baselineLen : 1, ay = baselineLen > 1e-9 ? by / baselineLen : 0;
    const nx = -ay, ny = ax;                       // v7: normal = (-axis.y, axis.x, 0)
    const widthModel = Math.max(1, widthM) * scale;

    const pts = [[start[0], start[1]]];
    const rows = [];
    const n = Math.max(0, Math.min(10, activePI | 0));
    for (let i = 0; i < n; i++) {
      const lu = Math.min(1, Math.max(0, u[i] != null ? u[i] : 0.5));
      const lv = Math.min(1, Math.max(0, v[i] != null ? v[i] : 0.5));
      const station = (i + lu) / n;                // zone_start + (zone_end-zone_start)*u
      const offset = (lv - 0.5) * widthModel;
      const px = start[0] + bx * station + nx * offset;
      const py = start[1] + by * station + ny * offset;
      pts.push([px, py]);
      rows.push({ pi: i + 1, station, offset_m: offset / scale, u: lu, v: lv, x: px, y: py });
    }
    pts.push([end[0], end[1]]);
    return { points: pts, rows, baselineLen: baselineLen / scale, normal: [nx, ny], axis: [ax, ay] };
  }

  function polylineLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  /* 한 PI에서의 전이곡선 생성 (A→B→C). Ls=0이면 순수 원곡선. */
  function curveAtPI(A, B, C, R, Ls, step) {
    const d1x = B[0] - A[0], d1y = B[1] - A[1];
    const d2x = C[0] - B[0], d2y = C[1] - B[1];
    const L1 = Math.hypot(d1x, d1y), L2 = Math.hypot(d2x, d2y);
    if (L1 < 1e-6 || L2 < 1e-6) return null;
    const u1x = d1x / L1, u1y = d1y / L1, u2x = d2x / L2, u2y = d2y / L2;

    const cross = u1x * u2y - u1y * u2x;
    let dot = u1x * u2x + u1y * u2y;
    dot = Math.min(1, Math.max(-1, dot));
    const delta = Math.acos(dot);                  // 편각(교각의 보각) 0..pi
    if (delta < 1e-4) return null;                 // 거의 직선
    const sign = cross >= 0 ? 1 : -1;              // 좌선회 +, 우선회 -

    const thetaS = Ls > 0 ? Ls / (2 * R) : 0;      // 완화곡선이 소비하는 각
    if (2 * thetaS >= delta) {
      // 편각이 완화곡선 2개를 못 담는다 → 이 R/Ls 조합은 불성립
      return { violation: 'Ls_too_long', delta, need: 2 * thetaS };
    }
    // 이정량 p·k 는 KHDesign 의 엄밀식(급수) 사용. 1차 근사(p≈L²/24R, k≈L/2) 아님.
    const cl = (Ls > 0 && global.KHDesign) ? global.KHDesign.clothoid(R, Ls) : null;
    const p = cl ? cl.p : 0;
    const kM = cl ? cl.k : 0;
    const Ts = (R + p) * Math.tan(delta / 2) + kM;
    const avail = Math.min(L1, L2);
    const violation = Ts > avail ? 'Ts_overrun' : null;

    const TSx = B[0] - u1x * Ts, TSy = B[1] - u1y * Ts;
    let th = Math.atan2(u1y, u1x);
    let x = TSx, y = TSy;
    const out = [[x, y]];
    const kinds = [];               // 각 구간(out[i]→out[i+1])의 요소 종류
    const st = Math.max(1, step || 8);

    // 진입 완화곡선(TS→SC): 곡률 0 → 1/R
    if (Ls > 0) {
      const N = Math.max(6, Math.ceil(Ls / st)), ds = Ls / N;
      for (let k = 0; k < N; k++) {
        const sMid = (k + 0.5) * ds;
        const kap = sign * (sMid / (R * Ls));
        const thMid = th + kap * ds / 2;
        x += Math.cos(thMid) * ds; y += Math.sin(thMid) * ds;
        th += kap * ds;
        out.push([x, y]); kinds.push('spiral');
      }
    }
    // 원곡선(SC→CS)
    const dc = delta - 2 * thetaS;
    const arcLen = R * dc;
    const Na = Math.max(6, Math.ceil(arcLen / st)), dsa = arcLen / Na;
    for (let k = 0; k < Na; k++) {
      const kap = sign / R;
      const thMid = th + kap * dsa / 2;
      x += Math.cos(thMid) * dsa; y += Math.sin(thMid) * dsa;
      th += kap * dsa;
      out.push([x, y]); kinds.push('arc');
    }
    // 진출 완화곡선(CS→ST): 곡률 1/R → 0
    if (Ls > 0) {
      const N = Math.max(6, Math.ceil(Ls / st)), ds = Ls / N;
      for (let k = 0; k < N; k++) {
        const sMid = (k + 0.5) * ds;
        const kap = sign * ((Ls - sMid) / (R * Ls));
        const thMid = th + kap * ds / 2;
        x += Math.cos(thMid) * ds; y += Math.sin(thMid) * ds;
        th += kap * ds;
        out.push([x, y]); kinds.push('spiral');
      }
    }
    return { pts: out, kinds: kinds, violation, Ts, delta, thetaS, arcLen, sign, R, Ls };
  }

  /* 전체 선형 생성. spans = 채점용 구간 목록. */
  function build(piPts, opts) {
    const mode = opts.mode || 'poly';
    if (mode === 'poly' || piPts.length < 3) {
      const spans = [], kinds = [];
      for (let i = 1; i < piPts.length; i++) { spans.push([piPts[i - 1], piPts[i]]); kinds.push('tangent'); }
      return { points: piPts.slice(), spans, kinds, nodes: [], violations: [], mode: 'poly', minR: Infinity };
    }
    const R = Math.max(1, opts.R || 300);
    const Ls = mode === 'spiral' ? Math.max(0, opts.Ls || 0) : 0;
    const step = opts.step || 8;

    const out = [[piPts[0][0], piPts[0][1]]];
    const kinds = [];               // 구간별 요소: tangent | spiral | arc
    const nodes = [];               // 주요점: TS / SC / CS / ST
    const violations = [];
    for (let i = 1; i < piPts.length - 1; i++) {
      const c = curveAtPI(piPts[i - 1], piPts[i], piPts[i + 1], R, Ls, step);
      if (!c) continue;
      if (!c.pts) { violations.push({ pi: i, kind: c.violation, delta: c.delta }); continue; }
      if (c.violation) violations.push({ pi: i, kind: c.violation, Ts: c.Ts });
      // 직전 점 → 곡선 시작점(TS)은 직선
      out.push(c.pts[0]); kinds.push('tangent');
      const base = out.length - 1;                       // TS 의 인덱스
      for (let k = 1; k < c.pts.length; k++) { out.push(c.pts[k]); kinds.push(c.kinds[k - 1]); }
      // 요소 경계점 수집
      const label = Ls > 0 ? ['TS', 'SC', 'CS', 'ST'] : ['BC', 'BC', 'EC', 'EC'];
      let iSC = base, iCS = base;
      for (let k = 0; k < c.kinds.length; k++) {
        if (c.kinds[k] === 'arc' && iSC === base) iSC = base + k;
        if (c.kinds[k] === 'arc') iCS = base + k + 1;
      }
      nodes.push({ t: label[0], p: out[base], pi: i });
      if (Ls > 0) nodes.push({ t: label[1], p: out[iSC], pi: i });
      if (Ls > 0) nodes.push({ t: label[2], p: out[iCS], pi: i });
      nodes.push({ t: label[3], p: out[out.length - 1], pi: i });
    }
    out.push([piPts[piPts.length - 1][0], piPts[piPts.length - 1][1]]);
    kinds.push('tangent');

    const spans = [];
    for (let i = 1; i < out.length; i++) spans.push([out[i - 1], out[i]]);
    return { points: out, spans, kinds, nodes, violations, mode, minR: R };
  }

  global.KHAlign = { piFrame, build, curveAtPI, polylineLength };
})(typeof self !== 'undefined' ? self : this);
