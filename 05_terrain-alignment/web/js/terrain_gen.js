/* terrain_gen.js — 브라우저에서 지형을 다시 만든다 (KHTerrain 확장)
 *
 *   z(x,y) = 기준표고 + 전체경사 + Σ 산(가우시안) − 하천 절개 + 값잡음(fBm)
 *   등고선 = marching squares 로 격자에서 추출. 등고선이 정본이다.
 *
 * ★ 파이썬 생성기(20_TOOLS/build_terrain.py)와 «잡음» 구현이 다르다.
 *   초기 terrain.json 은 파이썬 산출물이고, 화면에서 지형 슬라이더를 만지면
 *   이 구현으로 대체된다. 산·하천·경사 항의 식은 동일하므로 형상 성격은 같다.
 */
(function (global) {
  'use strict';
  const K = global.KHTerrain;
  if (!K) return;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* 값잡음 — 격자 난수 + smoothstep. 옥타브마다 주파수 2배·진폭 1/2. */
  function valueNoise(nx, ny, octaves, seed) {
    const out = new Float32Array(nx * ny);
    let amp = 1, freq = 2, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const rnd = mulberry32(seed + o * 7919);
      const gw = freq + 1, gh = freq + 1;
      const lat = new Float32Array(gw * gh);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd() * 2 - 1;
      for (let j = 0; j < ny; j++) {
        const fy = (j / Math.max(1, ny - 1)) * freq;
        const j0 = Math.min(gh - 2, Math.floor(fy));
        const ty = fy - j0, sy = ty * ty * (3 - 2 * ty);
        for (let i = 0; i < nx; i++) {
          const fx = (i / Math.max(1, nx - 1)) * freq;
          const i0 = Math.min(gw - 2, Math.floor(fx));
          const tx = fx - i0, sx = tx * tx * (3 - 2 * tx);
          const a0 = lat[j0 * gw + i0], a1 = lat[j0 * gw + i0 + 1];
          const b0 = lat[(j0 + 1) * gw + i0], b1 = lat[(j0 + 1) * gw + i0 + 1];
          out[j * nx + i] += amp * ((a0 + (a1 - a0) * sx) * (1 - sy) + (b0 + (b1 - b0) * sx) * sy);
        }
      }
      norm += amp; amp *= 0.5; freq *= 2;
    }
    if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }

  function generate(P) {
    const G = K.grid();
    const T = K.raw();
    if (!G || !T) return null;
    const nx = G.nx, ny = G.ny, cell = G.cell, x0 = G.x0, y0 = G.y0;
    const x1 = x0 + nx * cell, y1 = y0 + ny * cell;
    const z = new Float32Array(nx * ny);
    const th = P.slope_dir_deg * Math.PI / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    const noise = valueNoise(nx, ny, Math.max(1, P.noise_octaves | 0), P.seed | 0);

    const riv = (P.river || []).map(uv => [x0 + uv[0] * (x1 - x0), y0 + uv[1] * (y1 - y0)]);
    const peaks = (P.peaks || []).map(pk =>
      [x0 + pk[0] * (x1 - x0), y0 + pk[1] * (y1 - y0), pk[2], pk[3], pk[4]]);

    for (let j = 0; j < ny; j++) {
      const gy = y0 + (j + 0.5) * cell;
      for (let i = 0; i < nx; i++) {
        const gx = x0 + (i + 0.5) * cell;
        let v = P.base_el + (cs * (gx - x0) + sn * (gy - y0)) * P.slope_pct / 100;
        for (let k = 0; k < peaks.length; k++) {
          const pk = peaks[k];
          const dx = gx - pk[0], dy = gy - pk[1];
          const t = Math.sqrt(dx * dx + dy * dy) / Math.max(1, pk[3]);
          v += pk[2] * Math.exp(-t * t * pk[4]);
        }
        if (riv.length > 1 && P.river_depth > 0) {
          let dmin = Infinity;
          for (let k = 0; k < riv.length - 1; k++) {
            const ax = riv[k][0], ay = riv[k][1];
            const bx = riv[k + 1][0] - ax, by = riv[k + 1][1] - ay;
            const L2 = bx * bx + by * by;
            let t = L2 > 1e-9 ? ((gx - ax) * bx + (gy - ay) * by) / L2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const ddx = gx - (ax + t * bx), ddy = gy - (ay + t * by);
            const dd = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dd < dmin) dmin = dd;
          }
          const w = dmin / Math.max(1, P.river_width);
          v -= P.river_depth * Math.exp(-w * w);
        }
        z[j * nx + i] = v + P.noise_amp * noise[j * nx + i];
      }
    }
    G.z = z;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < z.length; i++) { if (z[i] < lo) lo = z[i]; if (z[i] > hi) hi = z[i]; }
    T.params = P;
    T.meta.z_min = Math.round(lo * 100) / 100;
    T.meta.z_max = Math.round(hi * 100) / 100;
    T.contours = marchingSquares(T.meta.interval || 5);
    return T;
  }

  /* marching squares — 레벨별 등고선 폴리라인 */
  function marchingSquares(interval) {
    const G = K.grid();
    const nx = G.nx, ny = G.ny, cell = G.cell, x0 = G.x0, y0 = G.y0, z = G.z;
    const r = K.range();
    const l0 = Math.floor(r[0] / interval) * interval;
    const l1 = Math.ceil(r[1] / interval) * interval;
    const out = [];
    const at = (i, j) => z[j * nx + i];
    const px = (i) => x0 + (i + 0.5) * cell;
    const py = (j) => y0 + (j + 0.5) * cell;
    const T4 = {
      1: [3, 0], 2: [0, 1], 3: [3, 1], 4: [1, 2], 6: [0, 2], 7: [3, 2],
      8: [2, 3], 9: [2, 0], 11: [2, 1], 12: [1, 3], 13: [1, 0], 14: [0, 3],
    };

    for (let lv = l0; lv <= l1 + 1e-9; lv += interval) {
      const segs = [];
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
          if (!(a === a && b === b && c === c && d === d)) continue;
          let k = 0;
          if (a > lv) k |= 1;
          if (b > lv) k |= 2;
          if (c > lv) k |= 4;
          if (d > lv) k |= 8;
          if (k === 0 || k === 15) continue;
          const ip = (za, zb, xa, ya, xb, yb) => {
            const t = (lv - za) / ((zb - za) || 1e-9);
            return [xa + (xb - xa) * t, ya + (yb - ya) * t];
          };
          const E = [
            () => ip(a, b, px(i), py(j), px(i + 1), py(j)),
            () => ip(b, c, px(i + 1), py(j), px(i + 1), py(j + 1)),
            () => ip(d, c, px(i), py(j + 1), px(i + 1), py(j + 1)),
            () => ip(a, d, px(i), py(j), px(i), py(j + 1)),
          ];
          if (k === 5) { segs.push([E[3](), E[0]()]); segs.push([E[1](), E[2]()]); continue; }
          if (k === 10) { segs.push([E[0](), E[1]()]); segs.push([E[2](), E[3]()]); continue; }
          const e = T4[k];
          if (e) segs.push([E[e[0]](), E[e[1]]()]);
        }
      }
      if (segs.length) out.push({ el: lv, rings: chain(segs) });
    }
    return out;
  }

  /* 조각 선분 → 폴리라인 (끝점 해시로 이어 붙임) */
  function chain(segs) {
    const key = (p) => Math.round(p[0] * 10) + ',' + Math.round(p[1] * 10);
    const map = new Map();
    segs.forEach((s, i) => {
      [key(s[0]), key(s[1])].forEach(k => {
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(i);
      });
    });
    const used = new Array(segs.length).fill(false);
    const rings = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const line = [segs[i][0], segs[i][1]];
      for (let dir = 0; dir < 2; dir++) {
        for (;;) {
          const end = dir === 0 ? line[line.length - 1] : line[0];
          const cand = map.get(key(end)) || [];
          let nxt = -1;
          for (let c = 0; c < cand.length; c++) if (!used[cand[c]]) { nxt = cand[c]; break; }
          if (nxt < 0) break;
          used[nxt] = true;
          const s = segs[nxt];
          const add = (key(s[0]) === key(end)) ? s[1] : s[0];
          if (dir === 0) line.push(add); else line.unshift(add);
        }
      }
      if (line.length >= 2) rings.push(line);
    }
    return rings;
  }

  K.generate = generate;
  K.marchingSquares = marchingSquares;
})(this);
