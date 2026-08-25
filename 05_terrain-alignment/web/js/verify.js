/* verify.js — 사양일치 자체검사
 * 파이썬 독립 재구현(tools/verify_score.py)이 만든 기준값과 브라우저 JS 결과를 대조.
 * ★이것은 'v7 사양서대로 옮겼는가' 검사이지 Dynamo 실행 대조가 아니다.
 */
(function (global) {
  'use strict';

  function run(site, refs) {
    const P = refs.params;
    const obs = site.obstacle.concat(site.obstacle_extra);
    const ctx = {
      site: site,
      params: {
        mode: 'poly', R: 600, Ls: 0, curveStep: 8,
        widthM: P.widthM, scale: P.scale, samples: P.samples,
        roadTol: P.roadTol, obstacleTol: P.obstacleTol,
        lengthWeight: P.lengthWeight, roadWeight: P.roadWeight, obstacleWeight: P.obstacleWeight,
        piMin: 1, piMax: 10,
        // ★사양일치 검사는 반드시 v7 그대로여야 한다. 도로 우선은 v7에 없는 교정이므로 끈다.
        roadWins: false
      },
      obsGrid: new KHGeom.Grid(obs, 120),
      roadGrid: new KHGeom.Grid(site.road, 120)
    };

    const rows = [];
    let worst = 0;
    for (const c of refs.cases) {
      const r = KHScore.evaluate({ activePI: c.activePI, u: c.u, v: c.v }, ctx);
      const m = r.metrics;
      const d = {
        score: Math.abs(m.score - c.score),
        total: Math.abs(m.totalLength - c.total),
        road: Math.abs(m.roadOverlap - c.road),
        obs: Math.abs(m.obstacleOverlap - c.obs)
      };
      const maxd = Math.max(d.score, d.total / 1000, d.road / 1000, d.obs / 1000);
      if (maxd > worst) worst = maxd;
      rows.push({
        case: c.case,
        js: { score: m.score, total: m.totalLength, road: m.roadOverlap, obs: m.obstacleOverlap },
        py: { score: c.score, total: c.total, road: c.road, obs: c.obs },
        diff: d,
        pass: d.score < 0.01 && d.total < 0.1 && d.road < 0.1 && d.obs < 0.1
      });
    }
    const allPass = rows.every(r => r.pass);
    return { pass: allPass, rows: rows, worst: worst };
  }

  global.KHVerify = { run };
})(typeof self !== 'undefined' ? self : this);
