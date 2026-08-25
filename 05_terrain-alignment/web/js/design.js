/* design.js — 평면선형 설계 공식과 기준 검토
 *
 * ┌─ 증거 등급 구분 (必) ───────────────────────────────────────────────┐
 * │ [공식] 물리·기하에서 유도되는 식. 이 파일 안에서 자기검증 가능.          │
 * │ [수치] 법규·지침의 표 값. ★출처 원문 대조 전까지 확정 아님.            │
 * │        → data/design_standards.json 에 분리, 화면에 미검증 배지 표시.  │
 * └────────────────────────────────────────────────────────────────────┘
 */
(function (global) {
  'use strict';

  /* ===== [공식] 최소 평면곡선반경 =====
   * 원심력 ↔ 편경사+횡마찰 평형:
   *     V_m²/(g·R) = e + f      (V_m: m/s, g=9.8)
   *     V[km/h] 대입 → R = V² / (127·(e + f))       127 ≈ 9.8 × 3.6²
   */
  function minRadius(V, e, f) { return (V * V) / (127 * (e + f)); }

  /* [공식] 반경 R에서 필요한 편경사 (마찰 f 소진 가정) */
  function requiredSuper(V, R, f) { return (V * V) / (127 * R) - f; }

  /* ===== [공식] 클로소이드 요소 =====
   *   A² = R·L                     (클로소이드 파라미터)
   *   τ  = L / (2R)                (접선각, rad)
   *   급수 (τ 작을 때 수렴):
   *     X = L(1 − τ²/10 + τ⁴/216 − τ⁶/9360 + …)
   *     Y = L(τ/3 − τ³/42 + τ⁵/1320 − τ⁷/75600 + …)
   *   이정량(shift)  p = Y − R(1 − cos τ)      ← 엄밀식
   *   k (= X_M)      k = X − R·sin τ           ← 엄밀식
   *   1차 근사        p ≈ L²/(24R),  k ≈ L/2
   *   접선장         TL = (R + p)·tan(Δ/2) + k
   */
  function clothoid(R, L) {
    const A = Math.sqrt(R * L);
    const t = L / (2 * R);
    const t2 = t * t, t3 = t2 * t, t4 = t2 * t2, t5 = t4 * t, t6 = t4 * t2, t7 = t6 * t;
    const X = L * (1 - t2 / 10 + t4 / 216 - t6 / 9360);
    const Y = L * (t / 3 - t3 / 42 + t5 / 1320 - t7 / 75600);
    const p = Y - R * (1 - Math.cos(t));
    const k = X - R * Math.sin(t);
    return {
      A: A, tau: t, tauDeg: t * 180 / Math.PI, X: X, Y: Y,
      p: p, k: k,
      pApprox: (L * L) / (24 * R), kApprox: L / 2,
      ratioAR: A / R                        // [수치] 시각 원활성 판정에 쓰임
    };
  }

  function tangentLength(R, L, deltaRad) {
    const c = clothoid(R, L);
    return (R + c.p) * Math.tan(Math.abs(deltaRad) / 2) + c.k;
  }

  /* ===== [공식] 완화곡선 최소길이 — 3기준의 최대값이 지배 ===== */
  function spiralMinLength(V, R, o) {
    o = o || {};
    // ① 주행시간 기준: 완화곡선을 t초 동안 통과
    const t = o.driveSec != null ? o.driveSec : 2.0;
    const byTime = (V / 3.6) * t;

    // ② 원심가속도 변화율(jerk) 기준
    //    C = V_m³/(R·L)  →  L = V_m³/(R·C) = V³/(46.656·R·C),  3.6³ = 46.656
    const C = o.jerk != null ? o.jerk : 0.6;          // [수치] m/s³
    const byJerk = Math.pow(V, 3) / (46.656 * C * R);

    // ③ 편경사 접속설치 기준: L = Δe · B / (편경사 변화율)
    //    B = 회전축~포장단부 폭, Δe = 편경사 차(직선 0 → 원곡선 e)
    const e = o.e != null ? o.e : 0.06;
    const B = o.rotWidth != null ? o.rotWidth : 3.5;  // [수치] m
    const rate = o.runoffRate != null ? o.runoffRate : (1 / 150); // [수치] 1/150
    const byRunoff = (e * B) / rate;

    const gov = Math.max(byTime, byJerk, byRunoff, o.tableMin || 0);
    let govBy = 'time';
    if (byJerk >= byTime && byJerk >= byRunoff && byJerk >= (o.tableMin || 0)) govBy = 'jerk';
    else if (byRunoff >= byTime && byRunoff >= byJerk && byRunoff >= (o.tableMin || 0)) govBy = 'runoff';
    else if ((o.tableMin || 0) > byTime && (o.tableMin || 0) > byJerk && (o.tableMin || 0) > byRunoff) govBy = 'table';
    return { byTime: byTime, byJerk: byJerk, byRunoff: byRunoff, tableMin: o.tableMin || 0, governing: gov, governingBy: govBy };
  }

  /* ===== 선형 전체 기준 검토 =====
   * piPts: [start, PI…, end]  /  std: design_standards.json 의 한 설계속도 행 + 전역값
   * 반환: PI별 판정 + 직선구간 판정
   */
  function review(piPts, R, Ls, std) {
    const V = std.V;
    const Rmin = minRadius(V, std.eMax, std.f);
    const items = [], straights = [];

    // 각 PI: 편각·접선장·완화곡선
    const geo = [];
    for (let i = 1; i < piPts.length - 1; i++) {
      const A = piPts[i - 1], B = piPts[i], C = piPts[i + 1];
      const u1 = norm(sub(B, A)), u2 = norm(sub(C, B));
      const L1 = len(sub(B, A)), L2 = len(sub(C, B));
      const cross = u1[0] * u2[1] - u1[1] * u2[0];
      let dot = u1[0] * u2[0] + u1[1] * u2[1];
      dot = Math.min(1, Math.max(-1, dot));
      const delta = Math.acos(dot);
      geo.push({ i: i, delta: delta, dir: cross >= 0 ? 1 : -1, L1: L1, L2: L2 });
    }

    const STRAIGHT = 0.5 * Math.PI / 180;    // 편각 0.5° 미만 = 사실상 직선, 곡선 없음

    geo.forEach((g, gi) => {
      const c = clothoid(R, Ls);

      // ① 편각이 없으면 곡선 자체가 없다. 검토 대상 아님(위반도 아님).
      if (g.delta < STRAIGHT) {
        items.push({
          pi: g.i, deltaDeg: g.delta * 180 / Math.PI, dir: '-', noCurve: true,
          TL: null, arcLen: null, clo: c, Rmin: Rmin, checks: [], ng: 0
        });
        return;
      }
      // ② 완화곡선이 편각을 다 먹으면 원곡선이 남지 않는다 → 성립 불가로 보고
      if (2 * c.tau >= g.delta) {
        items.push({
          pi: g.i, deltaDeg: g.delta * 180 / Math.PI, dir: g.dir > 0 ? '좌' : '우',
          impossible: true, TL: null, arcLen: null, clo: c, Rmin: Rmin,
          checks: [{ key: '완화곡선 과대', ok: false, val: 2 * c.tauDeg, req: g.delta * 180 / Math.PI,
            unit: '°', note: '2τ ≥ Δ — R을 줄이거나 Ls를 줄여야 성립' }],
          ng: 1
        });
        return;
      }

      const TL = tangentLength(R, Ls, g.delta);
      const sm = spiralMinLength(V, R, {
        e: std.eMax, jerk: std.jerk, driveSec: std.driveSec,
        rotWidth: std.rotWidth, runoffRate: std.runoffRate, tableMin: std.LsMin
      });
      const arcLen = R * (g.delta - 2 * c.tau);
      const checks = [];
      checks.push({ key: '최소곡선반경', ok: R >= Rmin, val: R, req: Rmin, unit: 'm',
        note: 'R ≥ V²/(127(e+f))' });
      checks.push({ key: '완화곡선장', ok: Ls >= sm.governing, val: Ls, req: sm.governing, unit: 'm',
        note: '지배기준=' + sm.governingBy });
      checks.push({ key: '클로소이드 A', ok: c.ratioAR >= (std.aOverRMin || 1 / 3) && c.ratioAR <= (std.aOverRMax || 1.0),
        val: c.A, req: R * (std.aOverRMin || 1 / 3), unit: 'm', note: 'R/3 ≤ A ≤ R (시각 원활성)' });
      checks.push({ key: '원곡선 잔여', ok: arcLen >= (std.arcMin || 0), val: arcLen, req: std.arcMin || 0, unit: 'm',
        note: '완화곡선 2개 뺀 원곡선 길이' });
      checks.push({ key: '접선장 여유', ok: TL <= Math.min(g.L1, g.L2), val: TL, req: Math.min(g.L1, g.L2), unit: 'm',
        note: 'TL ≤ 인접 접선장' });
      items.push({
        pi: g.i, deltaDeg: g.delta * 180 / Math.PI, dir: g.dir > 0 ? '좌' : '우',
        TL: TL, arcLen: arcLen, clo: c, spiralMin: sm, Rmin: Rmin,
        checks: checks, ng: checks.filter(x => !x.ok).length
      });
    });

    // 곡선 사이 직선장 — [수치] 동일방향 6V / 반대방향 2V (V km/h → m)
    // 곡선이 없는 PI는 직선장 판정 대상이 아니다.
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i];
      if (a.noCurve || b.noCurve || a.impossible || b.impossible) continue;
      const avail = geo[i].L1 - a.TL - b.TL;
      const same = geo[i - 1].dir === geo[i].dir;
      const req = (same ? (std.straightSame || 6) : (std.straightOpp || 2)) * V;
      straights.push({
        between: a.pi + '→' + b.pi, same: same, avail: avail, req: req, ok: avail >= req,
        note: same ? '동일방향 ' + (std.straightSame || 6) + 'V' : '반대방향 ' + (std.straightOpp || 2) + 'V'
      });
    }

    const ng = items.reduce((s, x) => s + x.ng, 0) + straights.filter(s => !s.ok).length;
    return { Rmin: Rmin, items: items, straights: straights, ng: ng };
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (a) => Math.hypot(a[0], a[1]);
  const norm = (a) => { const L = len(a) || 1; return [a[0] / L, a[1] / L]; };

  global.KHDesign = { minRadius, requiredSuper, clothoid, tangentLength, spiralMinLength, review };
})(typeof self !== 'undefined' ? self : this);
