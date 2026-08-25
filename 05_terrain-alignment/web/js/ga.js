/* ga.js — GA 본체 (워커/메인스레드 공용)
 * 목적함수 = v7 GD05 총점(0-100, 클수록 좋음).
 * 파레토 아카이브는 핸드오프 권고 3목표: 장애물겹침↓ · 총연장↓ · 도로점수↑
 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const q01 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100; // 슬라이더 step 0.01 재현

  function decode(g, p) {
    const span = p.piMax - p.piMin;
    const activePI = Math.min(p.piMax, Math.max(p.piMin, Math.round(p.piMin + g[0] * span)));
    const u = [], v = [];
    for (let i = 0; i < 10; i++) { u.push(q01(g[1 + i])); v.push(q01(g[11 + i])); }

    /* 종단 유전자 (21~33) — 계획고는 절대표고가 아니라 «지반고 대비 offset» 이다.
     * 지형이 바뀌어도 유전자가 의미를 잃지 않게 하려는 것. */
    const prof = {
      nVIP: 5 + Math.round(q01(g[21]) * 7),                 // 5~12 (3~4 는 8km 에서 항상 손해)
      dz: [],                                              // −1..+1 → ±zRange m
      lvc: [],                                             // 0..1 → 종단곡선 길이 배율
    };
    for (let i = 0; i < 12; i++) {
      prof.dz.push(q01(g[22 + i]) * 2 - 1);
      prof.lvc.push(q01(g[34 + i]));
    }
    return { activePI, u, v, prof };
  }

  /* 파레토 축 — 장애물겹침↓ · 총연장↓ · 도로점수↑ (+ 토공총량↓, 있을 때만) */
  function axes(x) {
    const a = [x.m.obstacleOverlap, x.m.totalLength, -x.m.roadScore];
    if (x.m.earthTotal != null) a.push(x.m.earthTotal);
    return a;
  }

  /* 선택 적합도 = v7 총점 − 토공벌점.
   * ★m.score(v7 계보)는 절대 건드리지 않는다. 고르는 기준만 바꾼다.
   *   earthPenalty = 점 / 백만 m³ (사용자가 정한다. 0 이면 v7 그대로) */
  let EW = 0, OW = 0;
  /* ★2026-08-25 실측 결함 교정 — 토공 벌점만 두면 GA 가 선형을 대지 밖으로 빼
   *   토공 계산을 회피한다(ewp=40 에서 8,220m 중 6,500m 이탈). 이탈 벌점을 같이 건다. */
  function fit(x) {
    let s = x.m.score;
    if (EW && x.m.earthTotal != null) s -= EW * (x.m.earthTotal / 1e6);
    if (OW && x.m.outsideLen != null) s -= OW * (x.m.outsideLen / 1000);
    return s;
  }

  function dominates(a, b) {
    const A = axes(a), B = axes(b);
    const n = Math.min(A.length, B.length);
    let better = false;
    for (let i = 0; i < n; i++) { if (A[i] > B[i]) return false; if (A[i] < B[i]) better = true; }
    return better;
  }

  function updateFront(front, cand) {
    if (cand.m.disqualified) return front;            // 종단경사·종단곡선 위반은 대안이 아니다
    for (let i = 0; i < front.length; i++) if (dominates(front[i], cand)) return front;
    const kept = front.filter(f => !dominates(cand, f));
    kept.push(cand);
    if (kept.length > 120) { kept.sort((a, b) => fit(b) - fit(a)); kept.length = 120; }
    return kept;
  }

  /* ctx: {site, params, obsGrid, roadGrid}
     onProgress(payload) — 세대 보고. shouldStop() — 중단 질의. */
  /* run(cfg, ctx, onProgress, shouldStop [, done])
   *   done 없음 → 동기 실행 후 결과를 반환한다 (워커에서 쓰는 경로. 기존 그대로)
   *   done 있음 → 세대를 잘라 setTimeout 으로 양보하며 돌고 done(결과) 로 알린다
   *
   * ★왜 비동기 경로가 필요한가: 배포본은 file:// 에서 열린다. 그런데 브라우저는
   *   file:// 문서에서 Web Worker 생성을 막는다(SecurityError, origin 'null').
   *   그래서 워커를 못 쓰는 환경에서는 메인스레드로 돌리되 UI 가 얼지 않게 쪼갠다. */
  function run(cfg, ctx, onProgress, shouldStop, done) {
    EW = +(cfg.earthPenalty || 0);   // 토공 벌점 (점/백만 m³)
    OW = +(cfg.outsidePenalty || 0); // 대지 이탈 벌점 (점/km)
    const rnd = mulberry32(cfg.seed >>> 0);
    const P = cfg.pop, G = cfg.gens, D = 46;   // 21(평면) + 1(nVIP) + 12(dz) + 12(lvc)
    const t0 = Date.now();
    let evals = 0;

    const evalGenome = (g) => {
      const gen = decode(g, ctx.params);
      const r = KHScore.evaluate(gen, ctx);
      evals++;
      return { g: g, gen: gen, m: r.metrics };
    };

    /* 초기 집단 — 종단 유전자는 절반을 «지반추종(offset 0)» 으로 심는다.
     * ★2026-08-25 실측: 전부 무작위로 두면 20세대에서 지반추종 자동산정보다
     *   토공이 7배 나빴다(1,084,144 vs 155,527 m³). 좋은 해를 알고 있으면 심어야 한다. */
    let pop = [];
    for (let i = 0; i < P; i++) {
      const g = new Array(D);
      for (let d = 0; d < D; d++) g[d] = rnd();
      if (i % 2 === 0) {
        for (let d = 22; d < 34; d++) g[d] = 0.5;    // dz = 0 → 자동산정선 그대로
        for (let d = 34; d < 46; d++) g[d] = 0.0;    // 종단곡선 = 최소 K 길이
      }
      pop.push(evalGenome(g));
    }
    let front = [];
    for (const ind of pop) front = updateFront(front, ind);
    let best = pop.reduce((a, b) => (fit(b) > fit(a) ? b : a));
    const history = [best.m.score];

    const pick = () => {
      const a = pop[(rnd() * P) | 0], b = pop[(rnd() * P) | 0];
      return fit(a) >= fit(b) ? a : b;
    };

    function oneGeneration(gen) {
      pop.sort((a, b) => fit(b) - fit(a));
      const next = pop.slice(0, cfg.elite);
      while (next.length < P) {
        const p1 = pick().g, p2 = pick().g;
        const c = new Array(D);
        for (let d = 0; d < D; d++) {
          const lo = Math.min(p1[d], p2[d]), hi = Math.max(p1[d], p2[d]), I = hi - lo;
          c[d] = lo - 0.35 * I + rnd() * (I * 1.7);                       // BLX-alpha 교차
          if (rnd() < cfg.mutRate) {                                      // 가우시안 변이
            const u1 = Math.max(1e-9, rnd()), u2 = rnd();
            c[d] += Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.283185307 * u2) * cfg.mutSigma;
          }
          c[d] = Math.min(1, Math.max(0, c[d]));
        }
        const ind = evalGenome(c);
        next.push(ind);
        front = updateFront(front, ind);
      }
      pop = next;
      const gb = pop.reduce((a, b) => (fit(b) > fit(a) ? b : a));
      if (fit(gb) > fit(best)) best = gb;
      history.push(best.m.score);

      if (onProgress && (gen % cfg.report === 0 || gen === G)) {
        onProgress({
          type: 'progress', gen: gen, gens: G, evals: evals, ms: Date.now() - t0,
          best: { gen: best.gen, m: best.m }, history: history.slice(),
          front: front.map(f => ({ m: f.m, gen: f.gen }))
        });
      }
    }

    function finish() {
      const ms = Date.now() - t0;
      return {
        type: 'done', evals: evals, ms: ms, gens: G,
        evalsPerSec: evals / Math.max(0.001, ms / 1000),
        best: { gen: best.gen, m: best.m }, history: history,
        front: front.map(f => ({ m: f.m, gen: f.gen }))
      };
    }

    const stopped = () => !!(shouldStop && shouldStop());

    if (!done) {                                   // 동기 — 워커 경로
      for (let gen = 1; gen <= G; gen++) {
        if (stopped()) break;
        oneGeneration(gen);
      }
      return finish();
    }

    // 비동기 — 60 ms 씩 돌고 화면에 양보한다(진행 그래프·중지 버튼이 살아 있게)
    let gen = 1;
    (function tick() {
      const slice = Date.now();
      while (gen <= G && !stopped() && Date.now() - slice < 60) {
        oneGeneration(gen);
        gen++;
      }
      if (gen > G || stopped()) { done(finish()); return; }
      setTimeout(tick, 0);
    })();
    return null;
  }

  global.KHGA = { run, decode, mulberry32 };
})(typeof self !== 'undefined' ? self : this);
