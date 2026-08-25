/* terrain.js — 지형 필드 · 등고선 · 대지 경계
 *
 * 정본은 등고선이다(삼각망 아님). 등고선은 격자 필드에서 뽑고, 격자는 언제든 다시 만든다.
 * 외부 지형 파일(DEM · LandXML · DXF 등고선 · 점군)이 들어와도
 * 아래 인터페이스만 맞추면 뷰어·채점·애드인이 그대로 돌아간다:
 *
 *     KHTerrain.load(json)   → 적재
 *     KHTerrain.sample(x, y) → z   (쌍선형 보간. 대지 밖이면 NaN)
 *     KHTerrain.contours()   → [{el, rings:[[[x,y]…]]}]
 *     KHTerrain.boundary()   → [[x,y]…]
 *
 * ★ 지금 데이터는 전량 합성이다. 원본 site.json 에 Z 가 없다.
 */
(function (global) {
  'use strict';

  let T = null;          // terrain.json 원본
  let G = null;          // {x0,y0,cell,nx,ny,z:Float32Array}

  function load(json) {
    T = json;
    const g = json.grid;
    const z = new Float32Array(g.nx * g.ny);
    for (let i = 0; i < z.length; i++) {
      const v = g.z[i];
      z[i] = (v === null || v === undefined) ? NaN : v;
    }
    G = { x0: g.x0, y0: g.y0, cell: g.cell, nx: g.nx, ny: g.ny, z: z };
    return T;
  }

  function loaded() { return !!G; }

  /* 셀 중심이 x0 + (i+0.5)·cell 인 격자에서의 쌍선형 보간.
   * 네 이웃 중 하나라도 NaN(대지 밖)이면 가장 가까운 유효값으로 물러난다 —
   * 선형이 경계를 살짝 벗어나도 종단이 끊기지 않게. */
  function sample(x, y) {
    if (!G) return NaN;
    const fx = (x - G.x0) / G.cell - 0.5;
    const fy = (y - G.y0) / G.cell - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    const tx = fx - i0, ty = fy - j0;
    const at = (i, j) => {
      const ii = Math.min(G.nx - 1, Math.max(0, i));
      const jj = Math.min(G.ny - 1, Math.max(0, j));
      return G.z[jj * G.nx + ii];
    };
    const z00 = at(i0, j0), z10 = at(i0 + 1, j0), z01 = at(i0, j0 + 1), z11 = at(i0 + 1, j0 + 1);
    const ok = [z00, z10, z01, z11].filter(v => v === v);
    if (ok.length === 0) return NaN;                 // 대지 밖 — 지어내지 않는다
    if (ok.length < 4) return ok.reduce((a, b) => a + b, 0) / ok.length;
    return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
  }

  /* 대지 밖 — 나선으로 가장 가까운 유효 셀을 찾는다(최대 40셀). */
  function nearestValid(x, y) {
    if (!G) return NaN;
    const ci = Math.round((x - G.x0) / G.cell - 0.5);
    const cj = Math.round((y - G.y0) / G.cell - 0.5);
    for (let r = 1; r <= 150; r++) {
      for (let d = -r; d <= r; d++) {
        const cand = [[ci + d, cj - r], [ci + d, cj + r], [ci - r, cj + d], [ci + r, cj + d]];
        for (const [i, j] of cand) {
          if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
          const v = G.z[j * G.nx + i];
          if (v === v) return v;
        }
      }
    }
    return NaN;
  }

  function inside(x, y) {
    if (!G) return false;
    const i = Math.round((x - G.x0) / G.cell - 0.5);
    const j = Math.round((y - G.y0) / G.cell - 0.5);
    if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) return false;
    const v = G.z[j * G.nx + i];
    return v === v;
  }

  function contours() { return T ? T.contours : []; }
  function boundary() { return T ? T.boundary : []; }
  function meta() { return T ? T.meta : {}; }
  function params() { return T ? T.params : {}; }
  function range() { return T ? [T.meta.z_min, T.meta.z_max] : [0, 1]; }

  /* 표고 → 색 (지형색 램프). 등고선 채색·범례 공용. */
  function color(z, alpha) {
    const [lo, hi] = range();
    const t = Math.max(0, Math.min(1, (z - lo) / Math.max(1e-9, hi - lo)));
    const stops = [                       // 제도지 위 지형 채색(저→고)
      [0.00, [214, 224, 208]], [0.25, [222, 224, 190]], [0.50, [226, 214, 172]],
      [0.75, [214, 190, 150]], [1.00, [232, 222, 206]],
    ];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
    const c = [0, 1, 2].map(k => Math.round(a[1][k] + (b[1][k] - a[1][k]) * u));
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (alpha == null ? 1 : alpha) + ')';
  }

  /* 등고선을 Path2D 로 미리 굽는다(주곡선 / 계곡선 분리). */
  function buildPaths(indexInterval) {
    const iv = (T && T.meta.interval) || 5;
    const every = indexInterval || 5;                 // 계곡선 = 주곡선 5개마다
    const minor = new Path2D(), major = new Path2D();
    contours().forEach(c => {
      const isMajor = Math.abs((c.el / iv) % every) < 1e-6;
      const p = isMajor ? major : minor;
      c.rings.forEach(r => {
        if (r.length < 2) return;
        p.moveTo(r[0][0], r[0][1]);
        for (let i = 1; i < r.length; i++) p.lineTo(r[i][0], r[i][1]);
      });
    });
    const bnd = new Path2D();
    const b = boundary();
    if (b.length > 1) {
      bnd.moveTo(b[0][0], b[0][1]);
      for (let i = 1; i < b.length; i++) bnd.lineTo(b[i][0], b[i][1]);
      bnd.closePath();
    }
    return { minor: minor, major: major, boundary: bnd };
  }

  /* 대지 밖이면 가장 가까운 유효 표고로 대체(외삽 아님. 표시는 «대지 밖»으로). */
  function sampleOrNearest(x, y) {
    const z = sample(x, y);
    return (z === z) ? z : nearestValid(x, y);
  }

  global.KHTerrain = {
    load: load, loaded: loaded, sample: sample, sampleOrNearest: sampleOrNearest,
    inside: inside,
    contours: contours, boundary: boundary, meta: meta, params: params,
    range: range, color: color, buildPaths: buildPaths,
    grid: function () { return G; }, raw: function () { return T; },
  };
})(this);
