/* score.js — v7 채점 이식 (GD02/03/04/05)
 *
 * 출처: KH_03_GD_SURF_FAST_v7_native_line_output.dyn 의 CPython3 노드 5종.
 * 아래 수식은 그 코드에서 그대로 옮긴 것이며 임의 변경 금지.
 *
 *  GD02/03 겹침 : 구간마다 t=(k+0.5)/N 로 N개 점을 찍고
 *                 overlap += 구간길이 × (hit수/N)
 *  GD04 길이점수 : clamp(weight × baseline/total, 0, 100)
 *  GD05 총점     : raw = 길이점수 + 도로점수×도로가중 - 장애물벌점×장애물가중
 *                 raw_min = -100×장애물가중, raw_max = 100 + 100×도로가중
 *                 score  = clamp((raw-raw_min)/(raw_max-raw_min)×100, 0, 100)
 */
(function (global) {
  'use strict';

  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  /* 도로 우선순위 판정기.
   *
   * ★v7에는 없는 로직이다. v7의 GD02(도로)·GD03(장애물)은 서로 독립 판정이라
   *   두 레이어가 겹치는 구간은 도로겹침·장애물겹침에 이중 계상된다.
   *   설계 의도상 겹침 구간은 **도로가 우위**(2026-08-09 확정).
   *   → 장애물 판정에서 도로에 걸린 점을 빼는 방식으로 교정한다(폴리곤 불리언 불필요).
   *   ex 가 null 이면 v7 그대로 동작한다.
   */
  function makeHit(grid, tol, ex, exTol) {
    if (!ex) return (x, y) => grid.hit(x, y, tol);
    return (x, y) => grid.hit(x, y, tol) && !ex.hit(x, y, exTol);
  }

  /* GD02/GD03 — 구간 샘플링 겹침 길이 */
  function overlapLength(spans, grid, tol, samplesPerSpan, ex, exTol) {
    if (!grid) return 0;
    const N = Math.max(1, samplesPerSpan | 0);
    const hit = makeHit(grid, tol, ex, exTol || 0);
    let total = 0;
    for (let s = 0; s < spans.length; s++) {
      const a = spans[s][0], b = spans[s][1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len <= 1e-9) continue;
      let hits = 0;
      for (let k = 0; k < N; k++) {
        const t = (k + 0.5) / N;
        if (hit(a[0] + dx * t, a[1] + dy * t)) hits++;
      }
      total += len * (hits / N);
    }
    return total;
  }

  /* 균일 호장 샘플링 — 모드 간 비교를 가능하게 하는 추정량.
   *
   * ★왜 필요한가: v7 추정량은 "PI구간당 N샘플"이라 구간 길이에 따라 해상도가 변한다.
   *   poly(구간 4개, 8.5km)면 샘플 간격 ~85m, spiral(8m 간격 점열)이면 ~8m.
   *   같은 선형이라도 도로겹침 추정치가 몇 배씩 달라져 모드 간 점수 비교가 무의미해진다.
   *   (실측: 같은 사이트에서 poly 2,426m vs spiral 7,946m)
   *   따라서 모드 비교 시에는 반드시 이 균일 간격 추정량을 쓴다.
   */
  function overlapUniform(points, grid, tol, spacing, ex, exTol) {
    if (!grid || points.length < 2) return 0;
    const hit = makeHit(grid, tol, ex, exTol || 0);
    const segLen = [], cum = [0];
    for (let i = 1; i < points.length; i++) {
      const L = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      segLen.push(L); cum.push(cum[i - 1] + L);
    }
    const total = cum[cum.length - 1];
    if (total <= 1e-9) return 0;
    const N = Math.max(1, Math.round(total / Math.max(1e-6, spacing)));
    const ds = total / N;
    let hitLen = 0, si = 0;
    for (let k = 0; k < N; k++) {
      const s = (k + 0.5) * ds;
      while (si < segLen.length - 1 && cum[si + 1] < s) si++;
      const L = segLen[si] || 1e-9;
      const t = (s - cum[si]) / L;
      const a = points[si], b = points[si + 1];
      if (hit(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) hitLen += ds;
    }
    return hitLen;
  }

  function spansLength(spans) {
    let L = 0;
    for (let s = 0; s < spans.length; s++) {
      L += Math.hypot(spans[s][1][0] - spans[s][0][0], spans[s][1][1] - spans[s][0][1]);
    }
    return L;
  }

  /* GD04 + GD05 — 스칼라 점수 조합 */
  function combine(totalLength, baselineLen, roadOverlap, obstacleOverlap, w) {
    const lengthWeight = clamp(w.lengthWeight, 0, 100);
    const roadW = Math.max(0, w.roadWeight);
    const obsW = Math.max(0, w.obstacleWeight);

    const ratio = (totalLength <= 1e-9 || baselineLen <= 1e-9) ? 0 : clamp(baselineLen / totalLength, 0, 1);
    const lengthScore = clamp(lengthWeight * ratio, 0, 100);

    const denom = totalLength > 1e-9 ? totalLength : baselineLen;
    let roadRatio, obsRatio;
    if (denom <= 1e-9) { roadRatio = 0; obsRatio = 1; }
    else { roadRatio = clamp(roadOverlap / denom, 0, 1); obsRatio = clamp(obstacleOverlap / denom, 0, 1); }

    const roadScore = clamp(100 * roadRatio, 0, 100);
    const obstaclePenalty = clamp(100 * obsRatio, 0, 100);

    const raw = lengthScore + roadScore * roadW - obstaclePenalty * obsW;
    const rawMin = -100 * obsW, rawMax = 100 + 100 * roadW;
    const score = (rawMax <= rawMin + 1e-9)
      ? clamp(raw, 0, 100)
      : clamp((raw - rawMin) / (rawMax - rawMin) * 100, 0, 100);

    return {
      score: score,                     // GD OUT Score 0-100
      totalLength: totalLength,         // GD OUT Total Length m
      roadOverlap: roadOverlap,         // GD OUT Road Overlap m
      obstacleOverlap: obstacleOverlap, // GD OUT Obstacle Overlap m
      lengthScore: lengthScore,         // GD OUT Length 0-100
      roadScore: roadScore,             // GD OUT Road 0-100
      obstaclePenalty: obstaclePenalty, // GD OUT Obstacle Penalty 0-100
      baselineLen: baselineLen, raw: raw
    };
  }

  /* 전체 평가: 유전자 → 7종 출력 */
  function evaluate(genome, ctx) {
    const p = ctx.params;
    const frame = KHAlign.piFrame(ctx.site.start, ctx.site.end, genome.activePI, genome.u, genome.v, p.widthM, p.scale);
    const al = KHAlign.build(frame.points, { mode: p.mode, R: p.R, Ls: p.Ls, step: p.curveStep });

    const totalLength = spansLength(al.spans) / p.scale;
    let roadOv, obsOv, sampleNote;

    // 도로 우선 시, 장애물 판정에서 도로에 걸린 점을 제외한다.
    const exGrid = p.roadWins ? ctx.roadGrid : null;
    const exTol = (p.roadWinsTol || 0) * p.scale;

    if (p.sampleMode === 'uniform') {
      // 모드 간 비교 가능. 간격은 m 단위 고정.
      const sp = (p.sampleSpacing || 25) * p.scale;
      roadOv = overlapUniform(al.points, ctx.roadGrid, p.roadTol * p.scale, sp) / p.scale;
      obsOv = overlapUniform(al.points, ctx.obsGrid, p.obstacleTol * p.scale, sp, exGrid, exTol) / p.scale;
      sampleNote = 'uniform ' + (p.sampleSpacing || 25) + 'm';
    } else {
      // v7 원본 추정량: PI구간당 N샘플. poly 모드에서만 v7과 동일.
      const spp = (al.mode === 'poly') ? p.samples : 1;
      roadOv = overlapLength(al.spans, ctx.roadGrid, p.roadTol * p.scale, spp) / p.scale;
      obsOv = overlapLength(al.spans, ctx.obsGrid, p.obstacleTol * p.scale, spp, exGrid, exTol) / p.scale;
      sampleNote = (al.mode === 'poly') ? ('v7 구간당 ' + p.samples) : '구간당 1(곡선)';
    }

    const m = combine(totalLength, frame.baselineLen, roadOv, obsOv, p);
    m.violations = al.violations;
    m.sampleNote = sampleNote;

    // ── 종단·토공 (지형과 종단 파라미터가 있을 때만) ──
    const T = (typeof KHTerrain !== 'undefined') ? KHTerrain : null;
    if (ctx.pparams && T && T.loaded() && typeof KHProfile !== 'undefined') {
      const o = Object.assign({}, ctx.pparams, { fallback: T.sampleOrNearest });
      if (ctx.useGenomeProfile && genome.prof) o.genomeProf = genome.prof;
      const pts = al.points.map(q => [q[0] / p.scale, q[1] / p.scale]);
      const pr = KHProfile.compute(pts, T.sample, o);
      if (pr) {
        m.cutM3 = pr.earth.cut;
        m.fillM3 = pr.earth.fill;
        m.earthTotal = pr.earth.total;
        m.earthBalance = pr.earth.balance;
        m.maxGrade = pr.maxGrade;
        m.gradeNG = pr.review.ng;
        m.outsideLen = pr.earth.outsideLen;
        // 제약 위반은 실격. 점수를 깎지 않고 0 으로 떨어뜨린다(회계가 흐려지지 않게).
        if (pr.review.ng > 0) { m.scoreRaw = m.score; m.score = 0; m.disqualified = true; }
      }
    }
    return { metrics: m, alignment: al, frame: frame };
  }

  global.KHScore = { overlapLength, overlapUniform, spansLength, combine, evaluate, clamp };
})(typeof self !== 'undefined' ? self : this);
